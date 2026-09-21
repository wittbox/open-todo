import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from "node:crypto";

/**
 * 비밀번호 저장·확인 — Node 내장 argon2id(Node 24.7+), 추가 패키지 없음.
 *
 * 저장 형식은 다른 argon2 도구와 같은 PHC 문자열이다:
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 * 매개변수(OWASP 권장 최소값)를 올리면 예전 해시는 그대로 확인되고, 다음 로그인 때 새 값으로 다시 저장된다.
 *
 * 규칙(NIST SP 800-63B): 8자 이상, 256자 이하, 흔한 비밀번호 차단. 문자 조합은 강요하지 않는다.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

type Params = { memory: number; passes: number; parallelism: number };
const CURRENT: Params = { memory: 19_456, passes: 2, parallelism: 1 };
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, p: Params, tagLength = TAG_LENGTH): Promise<Buffer> {
  const params: Argon2Parameters = {
    // 같은 글자가 다른 방식으로 입력돼도(한글 조합형·완성형 등) 같은 비밀번호가 되게.
    message: Buffer.from(password.normalize("NFKC"), "utf8"),
    nonce: salt,
    parallelism: p.parallelism,
    tagLength,
    memory: p.memory,
    passes: p.passes,
  };
  return new Promise((resolve, reject) =>
    argon2("argon2id", params, (err, key) => (err ? reject(err) : resolve(Buffer.from(key)))),
  );
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, CURRENT);
  const { memory: m, passes: t, parallelism: p } = CURRENT;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

type Parsed = { params: Params; salt: Buffer; hash: Buffer };

function parse(stored: string): Parsed | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return null;
  const params = { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) };
  // DB 에 이상한 값이 들어 있어도 서버가 멈출 만큼 일하지 않게 상한을 둔다.
  if (params.memory > 1 << 20 || params.passes > 16 || params.parallelism > 16) return null;
  const salt = Buffer.from(m[4], "base64");
  const hash = Buffer.from(m[5], "base64");
  if (salt.length < 8 || hash.length < 16) return null;
  return { params, salt, hash };
}

const DUMMY_SALT = randomBytes(SALT_LENGTH);

/**
 * 비밀번호 확인. `needsRehash` 면 매개변수가 예전 것이라 새로 저장해야 한다.
 * 저장값이 없거나 깨졌어도 같은 시간만큼 일한다 — 응답 시간으로 계정 유무가 새지 않게.
 */
export async function verifyPassword(
  stored: string | null | undefined,
  password: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const parsed = stored ? parse(stored) : null;
  if (!parsed || password.length > PASSWORD_MAX) {
    await burnPasswordCheck(password);
    return { ok: false, needsRehash: false };
  }
  const got = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  const ok = timingSafeEqual(got, parsed.hash);
  const p = parsed.params;
  const outdated = p.memory !== CURRENT.memory || p.passes !== CURRENT.passes || p.parallelism !== CURRENT.parallelism;
  return { ok, needsRehash: ok && outdated };
}

/** 없는 계정으로 로그인할 때 — 비밀번호 확인 한 번만큼 일하고 버린다. */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password.slice(0, PASSWORD_MAX), DUMMY_SALT, CURRENT);
}

export type PasswordProblem = "tooShort" | "tooLong" | "common";

let common: Set<string> | undefined;

/** 흔한 비밀번호 약 4.9만 개(zxcvbn-ts 사전, MIT). 처음 쓸 때 한 번만 푼다. */
async function commonPasswords(): Promise<Set<string>> {
  if (!common) {
    const { dictionary } = await import("@zxcvbn-ts/language-common");
    common = new Set(dictionary["passwords-common"]);
  }
  return common;
}

/**
 * 새 비밀번호로 쓸 수 없는 이유. 괜찮으면 null.
 * 이메일(또는 @ 앞부분)을 그대로 쓴 것도 흔한 비밀번호로 본다.
 */
export async function passwordProblem(password: string, email?: string): Promise<PasswordProblem | null> {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "tooShort";
  if (length > PASSWORD_MAX) return "tooLong";
  const lower = password.normalize("NFKC").toLowerCase();
  if ((await commonPasswords()).has(lower)) return "common";
  if (/^(.)\1+$/u.test(lower)) return "common";
  if (email) {
    const e = email.toLowerCase();
    if (lower === e || lower === e.slice(0, e.indexOf("@"))) return "common";
  }
  return null;
}
