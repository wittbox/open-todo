import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 사이드바가 30초마다 묻는 안 읽음 라우트. 로그인 없이 401, 내 멤버십의 프로젝트만, 남의 원글만 센다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let currentUser = "";
vi.mock("@/lib/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/session")>();
  return { ...orig, getSessionUserId: async () => currentUser || null };
});

const route = await import("@/app/api/projects/unread/route");
let f: ProjectFixture;

d("안 읽음 라우트 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("unroute");
    await prisma.message.create({ data: { projectId: f.priv.id, authorId: f.owner.id, body: "하나" } });
    await prisma.message.create({ data: { projectId: f.priv.id, authorId: f.member.id, body: "내 글" } });
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("로그인 없이 401", async () => {
    currentUser = "";
    expect((await route.GET()).status).toBe(401);
  });

  it("내 프로젝트의 남의 원글 수만, 외부인은 빈 답", async () => {
    currentUser = f.member.id;
    const data = (await (await route.GET()).json()) as Record<string, number>;
    expect(data[f.priv.id]).toBe(1);
    expect(data[f.pub.id]).toBeUndefined();
    currentUser = f.stranger.id;
    expect(await (await route.GET()).json()).toEqual({});
  });
});
