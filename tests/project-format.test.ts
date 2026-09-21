import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/messages";
import { dayKeyOf, dayLabel, relativeShort, timeOf, type Translate } from "@/lib/projects/format";

/**
 * 메시지 시각 표기. 서울 시간으로 묶고 적어야 서버와 화면이 같은 날짜 구분선을 그린다.
 * UTC 로 보면 전날인 시각(한국 새벽)이 경계다.
 *
 * 문구는 화면이 넘겨 준다 — 여기서는 진짜 한국어 번역을 넘겨, 옮긴 뒤에도 같은 말이 나오는지 본다.
 */
const tKo = createTranslator({
  locale: "ko",
  messages: loadMessages("ko"),
  namespace: "projects",
}) as unknown as Translate;

const tEn = createTranslator({
  locale: "en",
  messages: loadMessages("en"),
  namespace: "projects",
}) as unknown as Translate;

describe("메시지 시각", () => {
  it("한국 새벽은 UTC 전날이지만 서울 날짜로 묶는다", () => {
    expect(dayKeyOf("2026-09-15T16:30:00.000Z")).toBe("2026-09-16"); // 01:30 KST
    expect(timeOf("2026-09-15T16:30:00.000Z")).toBe("01:30");
  });

  it("구분선 문구: 오늘 · 어제 · 요일 · 다른 해", () => {
    expect(dayLabel("2026-09-16", "2026-09-16", tKo)).toBe("오늘");
    expect(dayLabel("2026-09-15", "2026-09-16", tKo)).toBe("어제");
    expect(dayLabel("2026-09-14", "2026-09-16", tKo)).toBe("9월 14일 월요일");
    expect(dayLabel("2025-12-03", "2026-09-16", tKo)).toBe("2025년 12월 3일 수요일");
  });

  it("달·요일 이름은 언어가 만든다 — 한국어 배열을 쓰지 않는다", () => {
    expect(dayLabel("2026-09-16", "2026-09-16", tEn, "en")).toBe("Today");
    expect(dayLabel("2026-09-14", "2026-09-16", tEn, "en")).toBe("Monday, September 14");
    expect(dayLabel("2025-12-03", "2026-09-16", tEn, "en")).toBe("Wednesday, December 3, 2025");
  });

  it("짧은 상대 시각", () => {
    const now = new Date("2026-09-16T03:00:00.000Z"); // 12:00 KST
    const ago = (iso: string) => relativeShort(iso, now, undefined, tKo);
    expect(ago("2026-09-16T02:59:40.000Z")).toBe("방금");
    expect(ago("2026-09-16T02:45:00.000Z")).toBe("15분 전");
    expect(ago("2026-09-16T00:00:00.000Z")).toBe("3시간 전");
    expect(ago("2026-09-15T01:00:00.000Z")).toBe("어제 10:00");
    expect(ago("2026-09-10T01:00:00.000Z")).toBe("9/10 10:00");
  });
});
