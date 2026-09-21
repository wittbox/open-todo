import type { AppLocale } from "@/i18n/locales";

import koAdmin from "@/messages/ko/admin.json";
import koAuth from "@/messages/ko/auth.json";
import koCalendar from "@/messages/ko/calendar.json";
import koCommon from "@/messages/ko/common.json";
import koErrors from "@/messages/ko/errors.json";
import koFiles from "@/messages/ko/files.json";
import koMail from "@/messages/ko/mail.json";
import koNav from "@/messages/ko/nav.json";
import koNotifications from "@/messages/ko/notifications.json";
import koProjects from "@/messages/ko/projects.json";
import koReportMail from "@/messages/ko/reportMail.json";
import koReports from "@/messages/ko/reports.json";
import koSettings from "@/messages/ko/settings.json";
import koShare from "@/messages/ko/share.json";
import koTasks from "@/messages/ko/tasks.json";

import enAdmin from "@/messages/en/admin.json";
import enAuth from "@/messages/en/auth.json";
import enCalendar from "@/messages/en/calendar.json";
import enCommon from "@/messages/en/common.json";
import enErrors from "@/messages/en/errors.json";
import enFiles from "@/messages/en/files.json";
import enMail from "@/messages/en/mail.json";
import enNav from "@/messages/en/nav.json";
import enNotifications from "@/messages/en/notifications.json";
import enProjects from "@/messages/en/projects.json";
import enReportMail from "@/messages/en/reportMail.json";
import enReports from "@/messages/en/reports.json";
import enSettings from "@/messages/en/settings.json";
import enShare from "@/messages/en/share.json";
import enTasks from "@/messages/en/tasks.json";

/**
 * 번역 파일. 화면 묶음(namespace)마다 한 파일이라 번역할 때 한 화면씩 볼 수 있다.
 * 언어를 추가하려면 `messages/<언어>/` 를 통째로 만들고 여기에 한 벌 더 적는다(i18n/locales.ts 에도 한 줄).
 *
 * 정적으로 읽는다 — 요청 밖(cron 메일·시험)에서도 그대로 쓰고, 번들에 그대로 들어간다.
 * 키 모양은 한국어가 기준이다(global.d.ts). 영어가 어긋나면 tests/i18n-messages.test.ts 가 잡는다.
 */
const KO = {
  admin: koAdmin,
  auth: koAuth,
  calendar: koCalendar,
  common: koCommon,
  errors: koErrors,
  files: koFiles,
  mail: koMail,
  nav: koNav,
  notifications: koNotifications,
  projects: koProjects,
  reportMail: koReportMail,
  reports: koReports,
  settings: koSettings,
  share: koShare,
  tasks: koTasks,
};

const EN = {
  admin: enAdmin,
  auth: enAuth,
  calendar: enCalendar,
  common: enCommon,
  errors: enErrors,
  files: enFiles,
  mail: enMail,
  nav: enNav,
  notifications: enNotifications,
  projects: enProjects,
  reportMail: enReportMail,
  reports: enReports,
  settings: enSettings,
  share: enShare,
  tasks: enTasks,
};

export type Messages = typeof KO;

export const MESSAGES_BY_LOCALE: Record<AppLocale, Messages> = { ko: KO, en: EN as Messages };

export function loadMessages(locale: AppLocale): Messages {
  return MESSAGES_BY_LOCALE[locale] ?? KO;
}
