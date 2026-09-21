import { getRequestConfig } from "next-intl/server";
import { getRequestPrefs } from "@/lib/prefs";
import { isLocale } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";

/**
 * next-intl 요청 설정. URL 에 언어를 넣지 않는다 — 로그인 뒤에 쓰는 앱이고 `/t/1042` 같은 링크가 그대로여야 한다.
 *
 * `getTranslations({ locale })` 처럼 언어를 **명시**하면 그 값이 먼저다(받는 사람 언어로 메일을 만들 때 등).
 * 시간대도 함께 준다 — 빠뜨리면 서버와 브라우저가 다른 시간대로 그려 수화 불일치가 난다.
 */
export default getRequestConfig(async ({ locale: explicit }) => {
  const prefs = await getRequestPrefs();
  const locale = isLocale(explicit) ? explicit : prefs.locale;
  return { locale, timeZone: prefs.timeZone, messages: loadMessages(locale) };
});
