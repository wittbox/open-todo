import { afterEach, describe, expect, it } from "vitest";
import { installProblems, type InstallFacts } from "@/lib/startup";
import { cronKeyOk } from "@/lib/cron-key";

/**
 * 시작할 때 하는 설치 점검. "떠 있기는 한데 쓸 수 없는" 설치를 로그인 화면까지 가서 발견하지 않게 한다.
 */

const OK: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://todo:pw@db:5432/todo",
  SESSION_SECRET: "x".repeat(64),
  APP_BASE_URL: "https://todo.example.com",
  CRON_KEY: "y".repeat(64),
};

const FACTS: InstallFacts = { hasArgon2: true, mailConfigured: true };

const messages = (env: NodeJS.ProcessEnv, facts: Partial<InstallFacts> = {}) =>
  installProblems(env, { ...FACTS, ...facts }).map((p) => `${p.level}: ${p.message}`);

const has = (lines: string[], level: "error" | "warn", needle: string) =>
  lines.some((l) => l.startsWith(level + ":") && l.includes(needle));

describe("설치 점검", () => {
  it("제대로 된 설치는 아무 말도 하지 않는다", () => {
    expect(messages(OK)).toEqual([]);
  });

  it("argon2 가 없는 런타임", () => {
    expect(has(messages(OK, { hasArgon2: false }), "error", "crypto.argon2")).toBe(true);
  });

  it("DB 주소·세션 열쇠가 없으면 오류", () => {
    const lines = messages({ ...OK, DATABASE_URL: "", SESSION_SECRET: undefined });
    expect(has(lines, "error", "DATABASE_URL")).toBe(true);
    expect(has(lines, "error", "SESSION_SECRET")).toBe(true);
  });

  it("세션 열쇠가 짧으면 오류", () => {
    expect(has(messages({ ...OK, SESSION_SECRET: "short" }), "error", "SESSION_SECRET")).toBe(true);
  });

  it("APP_BASE_URL 은 운영에서 필수, 개발에서는 알림만", () => {
    expect(has(messages({ ...OK, APP_BASE_URL: "" }), "error", "APP_BASE_URL")).toBe(true);
    expect(has(messages({ ...OK, NODE_ENV: "development", APP_BASE_URL: "" }), "warn", "APP_BASE_URL")).toBe(true);
  });

  it("주소 모양이 틀리면 오류, 끝 슬래시·경로는 알림", () => {
    expect(has(messages({ ...OK, APP_BASE_URL: "todo.example.com" }), "error", "not a URL")).toBe(true);
    expect(has(messages({ ...OK, APP_BASE_URL: "https://todo.example.com/" }), "warn", "trailing slash")).toBe(true);
    expect(has(messages({ ...OK, APP_BASE_URL: "https://todo.example.com/app" }), "warn", "trailing slash")).toBe(true);
  });

  it("운영에서 http 면 쿠키가 보호되지 않는다고 알린다 — 개발 기계는 빼고", () => {
    expect(has(messages({ ...OK, APP_BASE_URL: "http://todo.example.com" }), "warn", "without Secure")).toBe(true);
    expect(has(messages({ ...OK, APP_BASE_URL: "http://localhost:3000" }), "warn", "without Secure")).toBe(false);
  });

  it("프록시 수가 숫자가 아니면 알린다", () => {
    expect(has(messages({ ...OK, TRUST_PROXY: "yes" }), "warn", "TRUST_PROXY")).toBe(true);
    expect(has(messages({ ...OK, TRUST_PROXY: "1" }), "warn", "TRUST_PROXY")).toBe(false);
  });

  it("아직 닫아 둔 제공자의 열쇠를 넣으면 알린다 — Google 은 조용하다", () => {
    expect(has(messages({ ...OK, KAKAO_CLIENT_ID: "k" }), "warn", "Kakao sign-in isn't available")).toBe(true);
    expect(has(messages({ ...OK, NAVER_CLIENT_ID: "n" }), "warn", "NAVER sign-in isn't available")).toBe(true);
    expect(messages({ ...OK, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" })).toEqual([]);
  });

  it("cron 열쇠·메일 서버가 없으면 무엇이 멈추는지 알린다", () => {
    expect(has(messages({ ...OK, CRON_KEY: "" }), "warn", "morning digest")).toBe(true);
    expect(has(messages(OK, { mailConfigured: false }), "warn", "No mail server")).toBe(true);
    // 개발에서는 메일이 파일로 떨어지므로 조용하다.
    expect(has(messages({ ...OK, NODE_ENV: "development" }, { mailConfigured: false }), "warn", "No mail server")).toBe(false);
  });
});

describe("cron 열쇠", () => {
  afterEach(() => {
    delete process.env.CRON_KEY;
  });

  it("열쇠를 정해 두지 않으면 무엇을 보내든 거짓", () => {
    expect(cronKeyOk("anything")).toBe(false);
    expect(cronKeyOk(null)).toBe(false);
  });

  it("같은 값만 통과한다", () => {
    process.env.CRON_KEY = "a".repeat(32);
    expect(cronKeyOk("a".repeat(32))).toBe(true);
    expect(cronKeyOk("a".repeat(31))).toBe(false);
    expect(cronKeyOk("a".repeat(33))).toBe(false);
    expect(cronKeyOk("b".repeat(32))).toBe(false);
    expect(cronKeyOk(null)).toBe(false);
  });
});
