import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getUserPrefs } from "@/lib/prefs";

/**
 * 사람마다의 언어·시간대(User.settings). 받는 사람 기준으로 만드는 알림·메일이 이 값을 쓴다.
 * 이상한 값이 들어 있어도 설치 기본값으로 떨어질 뿐 오류가 나지 않아야 한다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const suffix = `prefs-${process.pid}`;
const ids: Record<string, string> = {};

d("사용자별 언어·시간대 (DB)", () => {
  beforeAll(async () => {
    const make = (key: string, settings: object) =>
      prisma.user.create({
        data: { email: `${key}-${suffix}@x.test`, name: key, settings },
      });
    ids.ny = (await make("ny", { locale: "en", timeZone: "America/New_York" })).id;
    ids.bad = (await make("bad", { locale: "xx", timeZone: "Mars/Base" })).id;
    ids.none = (await make("none", {})).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("적어 둔 값을 쓴다", async () => {
    expect(await getUserPrefs(ids.ny)).toEqual({ locale: "en", timeZone: "America/New_York" });
  });

  it("틀린 값·빈 설정·없는 사람은 설치 기본값", async () => {
    expect(await getUserPrefs(ids.bad)).toEqual({ locale: "ko", timeZone: "Asia/Seoul" });
    expect(await getUserPrefs(ids.none)).toEqual({ locale: "ko", timeZone: "Asia/Seoul" });
    expect(await getUserPrefs("no-such-user")).toEqual({ locale: "ko", timeZone: "Asia/Seoul" });
  });
});
