import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getUnreadByProject, listMessages } from "@/lib/queries/project";
import { getSidebarData } from "@/lib/queries/sidebar";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 메시지·안 읽음·폴링 라우트 (DB).
 *
 * 답글은 원글의 프로젝트를 따르고 한 단계뿐이다. 삭제는 내용을 지우되 답글 달린 원글의 자리는
 * 남긴다. 안 읽음은 남의 원글만 세고 뒤로 가지 않는다. 폴링은 수정·삭제도 전달하며,
 * 비멤버에게는 없는 프로젝트와 같은 404 다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let currentUser = "";
vi.mock("@/lib/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...orig,
    requireUserId: async () => {
      if (!currentUser) throw new orig.UnauthenticatedError();
      return currentUser;
    },
    getSessionUserId: async () => currentUser || null,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const msg = await import("@/lib/actions/message");
const proj = await import("@/lib/actions/project");
const route = await import("@/app/api/projects/[id]/messages/route");
const as = (id: string) => {
  currentUser = id;
};

let f: ProjectFixture;

async function post(userId: string, projectId: string, body: string, parentId?: string) {
  as(userId);
  const r = await msg.postMessage(projectId, body, parentId);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function get(projectId: string, query = "") {
  const req = new Request(`http://x/api/projects/${projectId}/messages${query}`);
  return route.GET(req, { params: Promise.resolve({ id: projectId }) });
}

d("메시지 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("msg");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("seq 는 늘 커지고, 내 원글은 내 읽은 위치를 올린다", async () => {
    const a = await post(f.owner.id, f.priv.id, "첫 글");
    const b = await post(f.owner.id, f.priv.id, "둘째 글");
    expect(b.seq).toBeGreaterThan(a.seq);
    const pm = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: f.priv.id, userId: f.owner.id } },
    });
    expect(pm.lastReadSeq).toBe(b.seq);
  });

  it("외부인·보관 프로젝트·빈 글·너무 긴 글은 거부", async () => {
    as(f.stranger.id);
    expect((await msg.postMessage(f.priv.id, "안녕")).ok).toBe(false);
    as(f.member.id);
    expect((await msg.postMessage(f.archived.id, "안녕")).ok).toBe(false);
    expect((await msg.postMessage(f.priv.id, "   \n ")).ok).toBe(false);
    expect((await msg.postMessage(f.priv.id, "가".repeat(4001))).ok).toBe(false);
  });

  it("답글: 원글의 프로젝트를 따르고, 답글의 답글과 삭제된 원글의 답글은 거부", async () => {
    const root = await post(f.owner.id, f.priv.id, "원글");
    // 다른 프로젝트 id 를 넣어도 원글의 프로젝트에 붙는다
    as(f.member.id);
    const r = await msg.postMessage(f.pub.id, "답글", root.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saved = await prisma.message.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(saved.projectId).toBe(f.priv.id);
    expect((await msg.postMessage(f.priv.id, "답답글", r.data.id)).ok).toBe(false);

    as(f.owner.id);
    expect((await msg.deleteMessage(root.id)).ok).toBe(true);
    as(f.member.id);
    expect((await msg.postMessage(f.priv.id, "늦은 답글", root.id)).ok).toBe(false);
  });

  it("수정은 작성자만, 삭제는 작성자나 관리자", async () => {
    const m = await post(f.member.id, f.priv.id, "멤버 글");
    as(f.admin.id);
    expect((await msg.editMessage(m.id, "고침")).ok).toBe(false);
    as(f.member.id);
    expect((await msg.editMessage(m.id, "고침")).ok).toBe(true);
    const e = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(e.body).toBe("고침");
    expect(e.editedAt).not.toBeNull();

    const other = await post(f.owner.id, f.priv.id, "소유자 글");
    as(f.member.id);
    expect((await msg.deleteMessage(other.id)).ok).toBe(false);
    as(f.admin.id);
    expect((await msg.deleteMessage(other.id)).ok).toBe(true);
  });

  it("삭제는 내용을 비우고 자리를 남기며, 답글은 살아 있다. 답글 없는 삭제 원글은 목록에 없고 폴링에는 있다", async () => {
    const root = await post(f.owner.id, f.priv.id, "지울 원글");
    await post(f.member.id, f.priv.id, "남는 답글", root.id);
    const lone = await post(f.owner.id, f.priv.id, "혼자 지워질 글");
    const before = new Date(Date.now() - 1000);

    as(f.owner.id);
    expect((await msg.deleteMessage(root.id)).ok).toBe(true);
    expect((await msg.deleteMessage(lone.id)).ok).toBe(true);

    const row = await prisma.message.findUniqueOrThrow({ where: { id: root.id } });
    expect(row.body).toBe("");
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.message.count({ where: { parentId: root.id, deletedAt: null } })).toBe(1);

    const page = await listMessages(f.member.id, f.priv.id, {});
    const ids = page!.messages.map((m) => m.id);
    expect(ids).toContain(root.id);
    expect(ids).not.toContain(lone.id);
    const tomb = page!.messages.find((m) => m.id === root.id)!;
    expect(tomb.deletedAt).not.toBeNull();
    expect(tomb.replyCount).toBe(1);

    const poll = await listMessages(f.member.id, f.priv.id, { since: before });
    expect(poll!.messages.map((m) => m.id)).toContain(lone.id);
  });

  it("고정: 원글만, 멤버 누구나, 20개까지", async () => {
    const root = await post(f.owner.id, f.pub.id, "고정할 글");
    const reply = await post(f.owner.id, f.pub.id, "답글", root.id);
    as(f.member.id);
    expect((await msg.pinMessage(reply.id, true)).ok).toBe(false);
    expect((await msg.pinMessage(root.id, true)).ok).toBe(true);
    const pinned = await prisma.message.findUniqueOrThrow({ where: { id: root.id } });
    expect(pinned.pinnedById).toBe(f.member.id);
    expect((await msg.pinMessage(root.id, false)).ok).toBe(true);
  });
});

d("안 읽음 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("unread");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("남의 원글만 센다 — 내 글, 답글, 삭제된 글은 빼고. 비멤버 프로젝트는 나오지 않는다", async () => {
    // 내 글을 쓰면 그때까지를 읽은 것으로 치므로, 세어야 할 남의 글은 그 뒤에 쓴다.
    await post(f.member.id, f.priv.id, "내 글");
    const a = await post(f.owner.id, f.priv.id, "하나");
    await post(f.owner.id, f.priv.id, "둘");
    await post(f.owner.id, f.priv.id, "답글", a.id);
    const gone = await post(f.owner.id, f.priv.id, "지워질 글");
    as(f.owner.id);
    await msg.deleteMessage(gone.id);

    const mine = await getUnreadByProject(f.member.id);
    expect(mine.get(f.priv.id)).toBe(2);
    expect(mine.has(f.pub.id)).toBe(false);
    expect((await getUnreadByProject(f.stranger.id)).size).toBe(0);
  });

  it("읽은 위치는 앞으로만 간다", async () => {
    const last = await prisma.message.aggregate({ where: { projectId: f.priv.id }, _max: { seq: true } });
    const top = last._max.seq!;
    as(f.member.id);
    expect((await proj.markProjectRead(f.priv.id, top)).ok).toBe(true);
    expect((await getUnreadByProject(f.member.id)).get(f.priv.id) ?? 0).toBe(0);
    await proj.markProjectRead(f.priv.id, top - 5);
    const pm = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: f.priv.id, userId: f.member.id } },
    });
    expect(pm.lastReadSeq).toBe(top);
    // 비멤버의 호출은 아무 일도 안 한다
    as(f.stranger.id);
    expect((await proj.markProjectRead(f.priv.id, 999999)).ok).toBe(true);
    expect(await prisma.projectMember.count({ where: { projectId: f.priv.id, userId: f.stranger.id } })).toBe(0);
  });

  it("사이드바에 프로젝트와 안 읽음 수가 실린다 — 보관된 것은 빼고", async () => {
    await post(f.owner.id, f.pub.id, "공개 글");
    await post(f.owner.id, f.archived.id, "보관 글").catch(() => {});
    const data = await getSidebarData(f.member.id);
    const ids = data!.projects.map((p) => p.id);
    expect(ids).toContain(f.pub.id);
    expect(ids).toContain(f.priv.id);
    expect(ids).not.toContain(f.archived.id);
    expect(data!.projects.find((p) => p.id === f.pub.id)!.unread).toBe(1);
  });
});

d("폴링 라우트 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("poll");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("로그인 없이 401, 비멤버와 없는 프로젝트는 같은 404", async () => {
    as("");
    expect((await get(f.priv.id)).status).toBe(401);
    as(f.stranger.id);
    const a = await get(f.priv.id);
    const b = await get("없는-id");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });

  it("since 뒤로 새 글·수정·삭제가 오고, 안 읽음 수는 내 멤버십만", async () => {
    const m = await post(f.owner.id, f.priv.id, "폴링 글");
    const since = new Date(Date.now() - 1000).toISOString();
    as(f.owner.id);
    await msg.editMessage(m.id, "고친 글");
    const gone = await post(f.owner.id, f.priv.id, "지움");
    await msg.deleteMessage(gone.id);

    as(f.member.id);
    const res = await get(f.priv.id, `?since=${encodeURIComponent(since)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: { id: string; body: string; deletedAt: string | null }[];
      unreadByProject: Record<string, number>;
    };
    const byId = new Map(body.messages.map((x) => [x.id, x]));
    expect(byId.get(m.id)?.body).toBe("고친 글");
    expect(byId.get(gone.id)?.deletedAt).not.toBeNull();
    expect(Object.keys(body.unreadByProject)).not.toContain(f.archived.id);
    expect(body.unreadByProject[f.priv.id]).toBeGreaterThan(0);
  });

  it("since 형식이 이상하면 400", async () => {
    as(f.member.id);
    expect((await get(f.priv.id, "?since=어제")).status).toBe(400);
  });
});
