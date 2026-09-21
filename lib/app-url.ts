/**
 * 설치 주소(`APP_BASE_URL`) — 메일 속 링크와 제공자 로그인의 돌아올 주소를 만든다.
 *
 * 요청 주소로 만들면 프록시 뒤에서 내부 주소(0.0.0.0:3000)가 나간다(lib/http.ts 참고).
 * 개발 중에는 비어 있어도 localhost:3000 으로 동작하고, 운영에서는 반드시 있어야 한다.
 */
export function appBaseUrl(): URL {
  const raw = process.env.APP_BASE_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url;
    } catch {
      // 아래에서 알린다.
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL is missing or invalid. Set it to the address this install is served from, e.g. https://todo.example.com");
  }
  return new URL("http://localhost:3000");
}

/** 설치 주소 위의 절대 주소 */
export function appUrl(path: string): string {
  return new URL(path, appBaseUrl()).toString();
}
