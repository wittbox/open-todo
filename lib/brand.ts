/**
 * 이 설치의 이름. 화면 제목·메일·PDF 가 여기서 읽는다.
 *
 * 세 곳을 차례로 본다: 관리자가 `/admin` 에서 적은 이름 → `APP_NAME` 환경 변수 → 기본 이름.
 * 이 파일은 브라우저 번들에도 들어가므로 DB 를 보지 않는다 — 실제로 고른 이름은 서버에서
 * `lib/brand-server.ts` 의 `appName()` 이, 화면에서는 `useAppName()` 이 준다.
 */

export const DEFAULT_APP_NAME = "open-todo";

/** 제목 줄·메일 머리글에 들어가므로 길이를 제한한다. */
export const APP_NAME_MAX = 40;

/** 적어 넣은 이름을 다듬는다. 빈 값이면 null — 그러면 다음 차례(환경 변수·기본 이름)로 넘어간다. */
export function cleanAppName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, APP_NAME_MAX);
  return name || null;
}

/** 설치할 때 `.env` 로 정한 이름. */
export function envAppName(): string | null {
  return cleanAppName(process.env.APP_NAME);
}
