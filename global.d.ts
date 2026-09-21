import type { AppLocale } from "./i18n/locales";
import type { Messages } from "./i18n/messages";

// next-intl 의 키·언어 타입 검사. 없는 키를 쓰면 tsc 가 잡는다.
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
