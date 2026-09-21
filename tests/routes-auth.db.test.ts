import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 로그인·딥링크 왕복.
 *
 * 여기가 비어 있어서 "리다이렉트가 https://0.0.0.0:3000 으로 나가는" 버그가
 * 배포까지 갔다. 상태 코드가 아니라 **Location 값**을 본다.
 *
 * 세션은 쿠키(next/headers)에 기대므로 테스트에서는 갈아끼운다.
 */
let currentUser: string | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSessionUserId: async () => currentUser,
    requireUserId: async () => {
      if (!currentUser) throw new actual.UnauthenticatedError();
      return currentUser;
    },
    destroySession: async () => {
      currentUser = null;
    },
  };
});

const { POST: logout } = await import("@/app/auth/signout/route");
const { GET: deepLink } = await import("@/app/t/[seq]/route");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const req = (path: string) => new NextRequest(`https://todo.example.com${path}`);
const params = (seq: string) => ({ params: Promise.resolve({ seq }) }) as never;

let f: Fixture;

beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("route");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

d("로그아웃 /auth/signout", () => {
  const post = (headers: Record<string, string> = {}) =>
    new NextRequest("https://todo.example.com/auth/signout", { method: "POST", headers });

  it("세션을 지우고 로그인으로 보낸다", async () => {
    currentUser = f.owner.id;
    const res = await logout(post({ "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/login");
    expect(currentUser).toBeNull();
  });

  it("다른 사이트가 시킨 로그아웃은 거절한다", async () => {
    currentUser = f.owner.id;
    const res = await logout(post({ "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(currentUser).toBe(f.owner.id);
  });
});

d("작업 딥링크 /t/{seq}", () => {
  it("로그인 전에는 원래 주소를 들고 로그인으로 간다", async () => {
    currentUser = null;
    const res = await deepLink(req(`/t/${f.task.seq}`), params(String(f.task.seq)));
    expect(res.headers.get("Location")).toBe(`/login?returnTo=${encodeURIComponent(`/t/${f.task.seq}`)}`);
  });

  it("권한이 있으면 상세 패널이 열린 목록으로 보낸다", async () => {
    currentUser = f.owner.id;
    const res = await deepLink(req(`/t/${f.task.seq}`), params(String(f.task.seq)));
    expect(res.headers.get("Location")).toBe(`/list/${f.list.id}?task=${f.task.id}`);
  });

  it("공유받은 사람도 열린다", async () => {
    currentUser = f.viewer.id;
    const res = await deepLink(req(`/t/${f.task.seq}`), params(String(f.task.seq)));
    expect(res.headers.get("Location")).toBe(`/list/${f.list.id}?task=${f.task.id}`);
  });

  it("권한 없는 번호와 없는 번호를 구분하지 않는다", async () => {
    currentUser = f.stranger.id;
    const forbidden = await deepLink(req(`/t/${f.task.seq}`), params(String(f.task.seq)));
    const missing = await deepLink(req("/t/99999999"), params("99999999"));

    expect(forbidden.headers.get("Location")).toBe("/t/not-found");
    expect(missing.headers.get("Location")).toBe("/t/not-found");
    expect(forbidden.status).toBe(missing.status);
  });

  it("공유받지 않은 목록의 작업은 막는다", async () => {
    currentUser = f.viewer.id;
    const res = await deepLink(req(`/t/${f.secretTask.seq}`), params(String(f.secretTask.seq)));
    expect(res.headers.get("Location")).toBe("/t/not-found");
  });

  it("숫자가 아닌 번호도 같은 곳으로 보낸다", async () => {
    currentUser = f.owner.id;
    for (const bad of ["abc", "-1", "0", "1.5"]) {
      const res = await deepLink(req(`/t/${bad}`), params(bad));
      expect(res.headers.get("Location")).toBe("/t/not-found");
    }
  });

  it("어떤 응답도 절대 URL 을 내보내지 않는다", async () => {
    for (const [user, seq] of [
      [null, String(f.task.seq)],
      [f.owner.id, String(f.task.seq)],
      [f.stranger.id, String(f.task.seq)],
      [f.owner.id, "99999999"],
    ] as const) {
      currentUser = user;
      const loc = (await deepLink(req(`/t/${seq}`), params(seq))).headers.get("Location")!;
      expect(loc, `user=${user} seq=${seq}`).toMatch(/^\//);
    }
  });
});
