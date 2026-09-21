import { afterEach, describe, expect, it } from "vitest";
import { APP_NAME_MAX, cleanAppName, DEFAULT_APP_NAME, envAppName } from "@/lib/brand";

/**
 * 설치 이름은 세 곳을 차례로 본다: 관리자가 적은 이름 → `APP_NAME` → 기본 이름.
 * 제목 줄과 메일 머리글에 그대로 들어가므로 줄바꿈과 길이를 여기서 막는다.
 */
afterEach(() => {
  delete process.env.APP_NAME;
});

describe("설치 이름", () => {
  it("앞뒤 공백을 떼고 줄바꿈은 한 칸으로", () => {
    expect(cleanAppName("  Team Todo  ")).toBe("Team Todo");
    expect(cleanAppName("Team\n\nTodo")).toBe("Team Todo");
  });

  it("비어 있으면 null — 다음 차례로 넘어간다", () => {
    expect(cleanAppName("")).toBeNull();
    expect(cleanAppName("   ")).toBeNull();
    expect(cleanAppName(null)).toBeNull();
    expect(cleanAppName(undefined)).toBeNull();
  });

  it("길면 자른다", () => {
    const long = "a".repeat(100);
    expect(cleanAppName(long)).toHaveLength(APP_NAME_MAX);
  });

  it("환경 변수도 같은 규칙, 없으면 null", () => {
    expect(envAppName()).toBeNull();
    process.env.APP_NAME = "  Acme Tasks ";
    expect(envAppName()).toBe("Acme Tasks");
  });

  it("기본 이름", () => {
    expect(DEFAULT_APP_NAME).toBe("open-todo");
  });
});
