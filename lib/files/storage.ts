import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 첨부 파일이 실제로 놓이는 곳.
 *
 * 디스크 이름은 여기서 만든다. 사용자가 준 이름은 DB 에만 두고 경로에 쓰지
 * 않으므로, 이름으로 상위 폴더를 타고 나가는 일이 원천적으로 불가능하다.
 *
 * 서버에서는 docker-compose 가 호스트의 ./data/uploads 를 컨테이너에 붙여 준다.
 */

export function uploadDir(): string {
  // 실행할 때 정해지는 경로다. 표시가 없으면 번들러가 이 경로를 따라 프로젝트 전체를 서버 산출물에 싣는다.
  return process.env.UPLOAD_DIR || join(/*turbopackIgnore: true*/ process.cwd(), "data", "uploads");
}

/** 열쇠 하나 = 파일 하나. 확장자를 붙이지 않아 무엇으로도 실행되지 않는다. */
export function newStorageKey(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 열쇠에서 경로를 만든다.
 * 16진수만 허용해 어떤 값이 들어와도 폴더를 벗어날 수 없게 한다.
 */
function pathFor(storageKey: string): string {
  if (!/^[0-9a-f]{32}$/.test(storageKey)) {
    throw new Error("Invalid storage key.");
  }
  // 한 폴더에 파일이 수만 개 쌓이지 않도록 앞 두 자리로 나눈다.
  return join(/*turbopackIgnore: true*/ uploadDir(), storageKey.slice(0, 2), storageKey);
}

export async function saveFile(bytes: Buffer): Promise<{ storageKey: string; sha256: string }> {
  const storageKey = newStorageKey();
  const target = pathFor(storageKey);
  await mkdir(join(/*turbopackIgnore: true*/ uploadDir(), storageKey.slice(0, 2)), { recursive: true });
  await writeFile(target, bytes);
  return { storageKey, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function readFileBytes(storageKey: string): Promise<Buffer> {
  return readFile(pathFor(storageKey));
}

/**
 * 디스크에서 지운다.
 * 이미 없더라도 조용히 넘어간다 — DB 행을 지우는 쪽이 늘 먼저다.
 */
export async function removeFile(storageKey: string): Promise<void> {
  try {
    await unlink(pathFor(storageKey));
  } catch {
    /* 파일이 이미 없으면 할 일이 없다 */
  }
}
