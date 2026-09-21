import "dotenv/config";
import { afterAll, vi } from "vitest";

/**
 * 화면 컴포넌트의 next-intl 훅. 앱에서는 NextIntlClientProvider 가 요청의 언어·시간대를 내려 주지만,
 * 시험에서는 컴포넌트를 하나씩 그리므로 그 자리를 tests/helpers/intl.ts 의 값으로 채운다.
 * 번역·날짜 형식은 진짜 next-intl(createTranslator·createFormatter)로 만든다.
 */
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const { testIntl } = await import("./helpers/intl");
  const { loadMessages } = await import("@/i18n/messages");
  return {
    ...actual,
    useLocale: () => testIntl.locale,
    useTimeZone: () => testIntl.timeZone,
    useNow: () => new Date(),
    useMessages: () => loadMessages(testIntl.locale),
    useFormatter: () => actual.createFormatter({ locale: testIntl.locale, timeZone: testIntl.timeZone }),
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: testIntl.locale, messages: loadMessages(testIntl.locale), namespace: namespace as never }),
  };
});

/**
 * 테스트는 앱과 같은 로컬 DB를 쓴다.
 * 커넥션을 크게 잡고 닫지 않으면 로컬 Prisma 서버의 커넥션이 말라 앱까지 끊긴다.
 * 그래서 테스트에서는 풀을 작게 잡고, 파일이 끝날 때마다 확실히 닫는다.
 * (lib/db.ts 는 VITEST 환경에서 클라이언트를 전역 캐시하지 않는다)
 */
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/connection_limit=\d+/, "connection_limit=3");
}

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});
