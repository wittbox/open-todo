import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 데이터를 돌려주는 라우트.
 *
 * 여기서 확인할 것은 "권한 밖 데이터가 응답에 섞이지 않는가" 하나다.
 * 화면이 가려 주는 것과 API 가 안 주는 것은 다르다 — 주소는 누구나 칠 수 있다.
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
  };
});

const { GET: search } = await import("@/app/api/search/route");
const { GET: shareState } = await import("@/app/api/share/route");
const { GET: userSearch } = await import("@/app/api/users/search/route");
const { POST: sendReport } = await import("@/app/api/reports/[id]/send/route");
const { GET: health } = await import("@/app/api/health/route");
const { prisma } = await import("@/lib/db");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const get = (path: string) => new NextRequest(`https://todo.example.com${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`https://todo.example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

let f: Fixture;

beforeAll(async () => {
  if (!hasDb) return;
  process.env.MOCK_MAIL = "1";
  f = await createFixture("rdata");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

d("검색 /api/search", () => {
  it("로그인 없이는 아무것도 주지 않는다", async () => {
    currentUser = null;
    const res = await search(get("/api/search?q=할일"));
    expect(res.status).toBe(401);
    expect((await res.json()).hits).toEqual([]);
  });

  it("권한 있는 작업은 찾는다", async () => {
    currentUser = f.owner.id;
    const body = await (await search(get(`/api/search?q=${encodeURIComponent(f.task.title)}`))).json();
    expect(body.hits.map((h: { id: string }) => h.id)).toContain(f.task.id);
  });

  it("권한 밖 작업은 결과에 없다", async () => {
    currentUser = f.viewer.id; // 목록 하나만 공유받음 — secretList 는 못 본다
    const body = await (await search(get(`/api/search?q=${encodeURIComponent(f.secretTask.title)}`))).json();
    expect(body.hits).toEqual([]);
    expect(body.jump).toBeNull();
  });

  it("번호로 찾을 때도 권한을 지킨다", async () => {
    currentUser = f.owner.id;
    expect((await (await search(get(`/api/search?q=%23${f.secretTask.seq}`))).json()).jump?.id).toBe(
      f.secretTask.id,
    );

    currentUser = f.stranger.id;
    expect((await (await search(get(`/api/search?q=%23${f.secretTask.seq}`))).json()).jump).toBeNull();
  });

  it("빈 검색어는 빈 결과", async () => {
    currentUser = f.owner.id;
    const body = await (await search(get("/api/search?q="))).json();
    expect(body).toEqual({ jump: null, hits: [] });
  });
});

d("공유 상태 /api/share", () => {
  it("로그인 없이는 401", async () => {
    currentUser = null;
    expect((await shareState(get(`/api/share?type=LIST&id=${f.list.id}`))).status).toBe(401);
  });

  it("잘못된 파라미터는 400", async () => {
    currentUser = f.owner.id;
    expect((await shareState(get("/api/share?type=BOGUS&id=x"))).status).toBe(400);
    expect((await shareState(get("/api/share?type=LIST"))).status).toBe(400);
  });

  it("권한 없으면 404 — 없는 것과 구분하지 않는다", async () => {
    currentUser = f.stranger.id;
    const forbidden = await shareState(get(`/api/share?type=LIST&id=${f.list.id}`));
    const missing = await shareState(get("/api/share?type=LIST&id=does-not-exist"));
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await forbidden.json()).toEqual(await missing.json());
  });

  it("소유자만 관리 권한을 받는다", async () => {
    currentUser = f.owner.id;
    expect((await (await shareState(get(`/api/share?type=LIST&id=${f.list.id}`))).json()).state.canManage).toBe(true);

    currentUser = f.editor.id;
    expect((await (await shareState(get(`/api/share?type=LIST&id=${f.list.id}`))).json()).state.canManage).toBe(false);
  });

  it("관리 권한이 없으면 후보 검색 결과를 주지 않는다", async () => {
    currentUser = f.editor.id;
    const body = await (await shareState(get(`/api/share?type=LIST&id=${f.list.id}&q=${f.p}`))).json();
    expect(body.candidates).toEqual([]);
  });
});

d("사용자 검색 /api/users/search", () => {
  it("로그인 없이는 빈 배열", async () => {
    currentUser = null;
    const res = await userSearch(get("/api/users/search?q=a"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual([]);
  });

  it("자기 자신은 결과에서 빠진다", async () => {
    currentUser = f.owner.id;
    const hits = await (await userSearch(get(`/api/users/search?q=${f.p}`))).json();
    const emails = hits.map((h: { email: string }) => h.email);
    expect(emails).not.toContain(f.owner.email);
    expect(emails).toContain(f.editor.email);
  });

  it("이름·메일·소속·아바타색 말고는 흘리지 않는다", async () => {
    currentUser = f.owner.id;
    const hits = await (await userSearch(get(`/api/users/search?q=${f.p}`))).json();
    expect(Object.keys(hits[0]).sort()).toEqual([
      "avatarColor", "department", "email", "id", "name",
    ]);
  });
});

d("보고서 발송 /api/reports/{id}/send", () => {
  it("로그인 없이는 401", async () => {
    currentUser = null;
    const res = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: ["a@x.test"] }), ctx(f.published.id));
    expect(res.status).toBe(401);
  });

  it("남의 보고서는 보낼 수 없다 — 공유받았어도", async () => {
    currentUser = f.viewer.id; // 이 보고서를 읽을 수는 있다
    const res = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: ["a@x.test"] }), ctx(f.published.id));
    expect(res.status).toBe(404);
  });

  it("발행 전에는 보낼 수 없다", async () => {
    currentUser = f.owner.id;
    const res = await sendReport(post(`/api/reports/${f.draft.id}/send`, { to: ["a@x.test"] }), ctx(f.draft.id));
    expect(res.status).toBe(400);
  });

  it("받는 사람이 없으면 400", async () => {
    currentUser = f.owner.id;
    const res = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: [] }), ctx(f.published.id));
    expect(res.status).toBe(400);
  });

  it("이메일 형식이 아니면 400", async () => {
    currentUser = f.owner.id;
    const res = await sendReport(
      post(`/api/reports/${f.published.id}/send`, { to: ["good@x.test", "나쁜주소"] }),
      ctx(f.published.id),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("나쁜주소");
  });

  it("한 번에 10명을 넘기지 못한다(REPORT_MAIL_MAX_RECIPIENTS)", async () => {
    currentUser = f.owner.id;
    const many = Array.from({ length: 11 }, (_, i) => `u${i}@x.test`);
    const res = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: many }), ctx(f.published.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("10");
  });

  it("이메일을 확인하지 않은 계정은 보내지 못한다", async () => {
    currentUser = f.owner.id;
    await prisma.user.update({ where: { id: f.owner.id }, data: { emailVerifiedAt: null } });
    const res = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: ["a@x.test"] }), ctx(f.published.id));
    await prisma.user.update({ where: { id: f.owner.id }, data: { emailVerifiedAt: new Date() } });
    expect(res.status).toBe(403);
  });

  it("보내면 이력이 남는다", async () => {
    currentUser = f.owner.id;
    const before = await prisma.reportSend.count({ where: { reportId: f.published.id } });

    const res = await sendReport(
      post(`/api/reports/${f.published.id}/send`, { to: ["a@x.test", "a@x.test", "b@x.test"] }),
      ctx(f.published.id),
    );
    expect(res.status).toBe(200);

    const rows = await prisma.reportSend.findMany({ where: { reportId: f.published.id } });
    expect(rows.length).toBe(before + 1);
    // 중복 수신자는 한 번만
    expect(rows[rows.length - 1].toEmails.sort()).toEqual(["a@x.test", "b@x.test"]);
    expect(rows[rows.length - 1].status).toBe("SENT");
  });

  it("하루 한도를 넘으면 429 — 예약도 센다(REPORT_MAIL_DAILY_LIMIT)", async () => {
    currentUser = f.owner.id;
    const { recipientsInLastDay } = await import("@/lib/report/mail-quota");
    const used = await recipientsInLastDay(f.owner.id);
    process.env.REPORT_MAIL_DAILY_LIMIT = String(used + 1);
    try {
      const two = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: ["c@x.test", "d@x.test"] }), ctx(f.published.id));
      expect(two.status).toBe(429);
      const inAnHour = new Date(Date.now() + 3_600_000);
      inAnHour.setMinutes(0, 0, 0);
      const scheduled = await sendReport(
        post(`/api/reports/${f.published.id}/send`, { to: ["c@x.test", "d@x.test"], scheduleAt: inAnHour.toISOString() }),
        ctx(f.published.id),
      );
      expect(scheduled.status).toBe(429);
      const one = await sendReport(post(`/api/reports/${f.published.id}/send`, { to: ["c@x.test"] }), ctx(f.published.id));
      expect(one.status).toBe(200);
    } finally {
      delete process.env.REPORT_MAIL_DAILY_LIMIT;
    }
  });
});

d("헬스체크 /api/health", () => {
  it("로그인 없이도 응답하고 내부 정보를 담지 않는다", async () => {
    currentUser = null;
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
