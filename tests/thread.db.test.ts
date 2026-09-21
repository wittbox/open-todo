import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getThread } from "@/lib/queries/project";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 스레드 조회. 원글은 이 프로젝트 것이어야 하고(다른 프로젝트의 id 는 null), 답글은 순서대로,
 * 지운 답글은 빠지고, 비멤버는 null.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: ProjectFixture;

d("스레드 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("thread");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("원글 + 답글(삭제 제외, seq 순), 남의 프로젝트 원글·비멤버는 null", async () => {
    const root = await prisma.message.create({ data: { projectId: f.priv.id, authorId: f.owner.id, body: "원글" } });
    const r1 = await prisma.message.create({ data: { projectId: f.priv.id, authorId: f.member.id, parentId: root.id, body: "답1" } });
    await prisma.message.create({ data: { projectId: f.priv.id, authorId: f.admin.id, parentId: root.id, body: "답2" } });
    await prisma.message.create({
      data: { projectId: f.priv.id, authorId: f.admin.id, parentId: root.id, body: "", deletedAt: new Date() },
    });

    const t = await getThread(f.member.id, f.priv.id, root.id);
    expect(t?.parent.id).toBe(root.id);
    expect(t?.parent.replyCount).toBe(2);
    expect(t?.replies.map((m) => m.body)).toEqual(["답1", "답2"]);
    expect(t?.replies[0].isMine).toBe(true);

    expect(await getThread(f.member.id, f.pub.id, root.id)).toBeNull();
    expect(await getThread(f.member.id, f.priv.id, r1.id)).toBeNull(); // 답글은 스레드의 원글이 아니다
    expect(await getThread(f.stranger.id, f.priv.id, root.id)).toBeNull();
  });
});
