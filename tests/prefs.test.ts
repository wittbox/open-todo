import { afterEach, describe, expect, it } from "vitest";
import { appTimeZone, defaultLocale, getRequestPrefs } from "@/lib/prefs";
import { isValidTimeZone } from "@/lib/tz";

/**
 * 설치 기본 언어·시간대. 잘못 적힌 값은 조용히 UTC·영어로 떨어지지 않고 알려진 기본값으로 간다 —
 * 시간대가 틀리면 날짜가 하루씩 밀리는데 눈에 잘 띄지 않는다.
 */
afterEach(() => {
  delete process.env.APP_TZ;
  delete process.env.DEFAULT_LOCALE;
});

describe("설치 기본값", () => {
  it("적힌 값이 맞으면 그대로", () => {
    process.env.APP_TZ = "America/New_York";
    process.env.DEFAULT_LOCALE = "en";
    expect(appTimeZone()).toBe("America/New_York");
    expect(defaultLocale()).toBe("en");
  });

  it("틀리거나 없으면 서울·한국어", () => {
    process.env.APP_TZ = "Mars/Olympus";
    process.env.DEFAULT_LOCALE = "xx";
    expect(appTimeZone()).toBe("Asia/Seoul");
    expect(defaultLocale()).toBe("ko");
  });

  it("요청 밖(시험·스크립트)에서는 설치 기본값", async () => {
    expect(await getRequestPrefs()).toEqual({ locale: "ko", timeZone: "Asia/Seoul" });
  });

  it("시간대 이름 검사", () => {
    expect(isValidTimeZone("Asia/Kathmandu")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Nowhere/City")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
