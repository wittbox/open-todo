/**
 * 설치 점검 — 서버가 켜질 때 한 번 본다(instrumentation.ts).
 *
 * 여기서 잡는 것들은 전부 "떠 있기는 한데 쓸 수 없는" 상태를 만든다. 로그인 화면까지 가서야
 * 알게 되면 늦으므로 시작할 때 한 줄로 알린다. 문구는 서버 로그를 보는 사람(운영자)의 것이라 영어다.
 */

export type Problem = { level: "error" | "warn"; message: string };

export type InstallFacts = {
  /** Node 24.7+ 의 crypto.argon2. 없으면 비밀번호 로그인이 통째로 동작하지 않는다. */
  hasArgon2: boolean;
  /** SMTP_HOST 가 있거나 MOCK_MAIL=1 */
  mailConfigured: boolean;
};

export function installProblems(env: NodeJS.ProcessEnv, facts: InstallFacts): Problem[] {
  const production = env.NODE_ENV === "production";
  const found: Problem[] = [];
  const error = (message: string) => found.push({ level: "error", message });
  const warn = (message: string) => found.push({ level: "warn", message });

  if (!facts.hasArgon2) {
    error(
      "crypto.argon2 is missing. Node 24.7 or newer is required — password sign-in and password changes will fail on this runtime.",
    );
  }

  if (!env.DATABASE_URL?.trim()) {
    error("DATABASE_URL is not set. Nothing can be read or written.");
  }

  const secret = env.SESSION_SECRET?.trim() ?? "";
  if (!secret) {
    error("SESSION_SECRET is not set. Nobody can sign in. Generate one with: openssl rand -hex 32");
  } else if (secret.length < 32) {
    error("SESSION_SECRET is shorter than 32 characters. Generate one with: openssl rand -hex 32");
  }

  const base = env.APP_BASE_URL?.trim() ?? "";
  if (!base) {
    // 개발에서는 localhost 로 잘 돌아간다. 운영에서는 메일 링크와 OAuth 콜백 주소가 여기서 나온다.
    (production ? error : warn)(
      "APP_BASE_URL is not set. Email links and OAuth callbacks need the public address of this install, e.g. https://todo.example.com",
    );
  } else {
    let url: URL | null = null;
    try {
      url = new URL(base);
    } catch {
      error(`APP_BASE_URL is not a URL: ${base}`);
    }
    if (url) {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        error(`APP_BASE_URL must start with http:// or https:// — got ${base}`);
      } else if (url.pathname !== "/" || base.endsWith("/")) {
        // 링크를 만들 때 `${APP_BASE_URL}/auth/...` 로 잇는다. 끝 슬래시는 //auth 가 된다.
        warn(`APP_BASE_URL should be the bare origin without a trailing slash, e.g. ${url.origin}`);
      }
      if (production && url.protocol === "http:" && !isLocal(url.hostname)) {
        // http 설치에서는 세션 쿠키에 Secure 를 붙이지 않는다(붙이면 브라우저가 버린다).
        warn(
          `APP_BASE_URL is http://. Session cookies are then sent without Secure, so anyone on the network can read them. Put HTTPS in front of ${url.host}.`,
        );
      }
    }
  }

  const proxies = env.TRUST_PROXY?.trim();
  if (proxies && !/^\d+$/.test(proxies)) {
    warn(`TRUST_PROXY should be the number of proxies in front of the app (usually 1) — got ${proxies}. Ignoring it.`);
  }

  if (!env.CRON_KEY?.trim()) {
    warn(
      "CRON_KEY is not set, so /api/cron/* stays closed: no reminders, no morning digest and no scheduled report mail. Generate one with: openssl rand -hex 32",
    );
  }

  if (production && !facts.mailConfigured) {
    warn("No mail server (SMTP_HOST). Sign-up confirmation and password reset mail cannot be sent; share invite links by hand.");
  }

  return found;
}

/** 개발 기계에서 http 로 여는 것은 정상이다. */
function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}
