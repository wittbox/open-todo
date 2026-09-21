import type { AppLocale } from "@/i18n/locales";

/**
 * 시험에서 화면 컴포넌트가 받는 언어·시간대. 기본은 한국어·서울 — 지금 시험들이 한국어 문구로
 * 요소를 찾기 때문이다. 다른 언어·시간대를 보는 시험은 setTestIntl 로 바꾸고 afterEach 에서 되돌린다.
 * (tests/setup.ts 가 next-intl 의 훅을 이 값으로 대신한다.)
 */
export const testIntl: { locale: AppLocale; timeZone: string } = { locale: "ko", timeZone: "Asia/Seoul" };

export function setTestIntl(next: Partial<typeof testIntl>) {
  Object.assign(testIntl, next);
}

export function resetTestIntl() {
  Object.assign(testIntl, { locale: "ko", timeZone: "Asia/Seoul" });
}
