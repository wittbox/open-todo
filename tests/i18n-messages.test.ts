import { describe, expect, it } from "vitest";
import { LOCALES, negotiateLocale } from "@/i18n/locales";
import { MESSAGES_BY_LOCALE } from "@/i18n/messages";
import { translatorFor } from "@/i18n/server";

/**
 * 번역 파일.
 *
 * 키 모양은 ko.json 이 기준이다. 다른 언어 파일에 키가 빠지거나 남으면, 또는 {name} 같은
 * 자리표시자가 다르면 그 화면에서 키 이름이 그대로 보이거나 값이 빠진다 — 여기서 먼저 잡는다.
 */

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** ICU 자리표시자 이름들 — {name}, {count, plural, …} 의 앞 이름, <b>…</b> 같은 태그 */
function placeholders(msg: string): string[] {
  const names = new Set<string>();
  for (const m of msg.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)) names.add(`{${m[1]}}`);
  for (const m of msg.matchAll(/<([A-Za-z][\w]*)>/g)) names.add(`<${m[1]}>`);
  return [...names].sort();
}

const FILES = MESSAGES_BY_LOCALE as unknown as Record<string, Tree>;
const ko = FILES.ko;

describe("번역 파일", () => {
  const base = flatten(ko);

  it("지원 언어마다 파일이 있다", () => {
    for (const l of LOCALES) expect(FILES[l], l).toBeTruthy();
  });

  it.each(LOCALES.filter((l) => l !== "ko"))("%s — ko 와 키가 같다", (locale) => {
    const other = flatten(FILES[locale]);
    expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
  });

  it.each(LOCALES.filter((l) => l !== "ko"))("%s — 자리표시자가 같다", (locale) => {
    const other = flatten(FILES[locale]);
    for (const [key, msg] of Object.entries(base)) {
      expect(placeholders(other[key] ?? ""), key).toEqual(placeholders(msg));
    }
  });

  it("빈 번역이 없다", () => {
    for (const l of LOCALES) {
      for (const [key, msg] of Object.entries(flatten(FILES[l]))) expect(msg.trim(), `${l}:${key}`).not.toBe("");
    }
  });

  it("요청 없이도 번역된다(cron 메일·오류 문구)", () => {
    expect(translatorFor("ko")("errors.generic")).toBe("처리 중 오류가 발생했습니다.");
    expect(translatorFor("en")("errors.generic")).toBe("Something went wrong. Please try again.");
  });
});

describe("브라우저 언어 고르기", () => {
  it("품질값 순서대로, 지원하는 첫 언어", () => {
    expect(negotiateLocale("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("ko");
    expect(negotiateLocale("en-US,en;q=0.9,ko;q=0.8")).toBe("en");
    expect(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.5")).toBe("en");
    expect(negotiateLocale("ja;q=0.2,ko;q=0.9")).toBe("ko");
  });

  it("맞는 게 없거나 비었으면 null — 설치 기본값으로 넘어간다", () => {
    expect(negotiateLocale("fr,de")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale("en;q=0")).toBeNull();
  });
});
