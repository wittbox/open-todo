/**
 * 지원 언어. 번역 파일(messages/<locale>.json)을 추가하고 여기에 한 줄 넣으면 된다.
 * 서버·브라우저가 함께 쓰므로 아무것도 import 하지 않는다.
 */
export const LOCALES = ["ko", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** 언어 고르기에 보이는 이름 — 늘 그 언어 자신의 말로 쓴다. */
export const LOCALE_NAMES: Record<AppLocale, string> = { ko: "한국어", en: "English" };

/** 사용자가 고른 언어를 비춰 두는 쿠키 — 로그인 전 화면도 같은 언어로 보인다. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * `Accept-Language` 에서 지원하는 언어 중 가장 선호하는 것을 고른다.
 * "ko-KR,ko;q=0.9,en;q=0.8" → "ko". 맞는 게 없으면 null.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): AppLocale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split("-")[0], quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.base && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked.map((x) => x.base).find(isLocale) ?? null;
}
