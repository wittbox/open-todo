import { createFormatter, createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";

/**
 * 요청 없이 쓰는 번역기 — 받는 사람의 언어·시간대로 메일을 만드는 cron, 서버 액션의 오류 문구, 시험.
 * 화면(서버 컴포넌트)에서는 next-intl 의 getTranslations() 를 쓴다.
 */
export function translatorFor(locale: AppLocale) {
  return createTranslator({ locale, messages: loadMessages(locale) });
}

export function formatterFor(locale: AppLocale, timeZone: string) {
  return createFormatter({ locale, timeZone });
}
