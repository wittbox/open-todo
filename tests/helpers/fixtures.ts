import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/date";
import type { ReportContent } from "@/lib/report/aggregate";

/**
 * 라우트 테스트가 쓰는 공용 픽스처.
 *
 * 개발 DB를 함께 쓰므로 접두사로 자기 것만 만들고 끝나면 그것만 지운다.
 * 시드 데이터에 기대지 않는다 — 시드가 바뀌면 테스트가 같이 흔들린다.
 */
export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export async function createFixture(tag: string) {
  const p = `${tag}-${process.pid}`;
  // 사용자는 이메일을 확인해야 생긴다 — 픽스처도 확인된 사람으로 만든다.
  const emailVerifiedAt = new Date();

  const owner = await prisma.user.create({
    data: { email: `own-${p}@x.test`, name: "소유자", emailVerifiedAt },
  });
  const editor = await prisma.user.create({
    data: { email: `edt-${p}@x.test`, name: "편집자", emailVerifiedAt },
  });
  const viewer = await prisma.user.create({
    data: { email: `vwr-${p}@x.test`, name: "열람자", emailVerifiedAt },
  });
  const stranger = await prisma.user.create({
    data: { email: `str-${p}@x.test`, name: "외부인", emailVerifiedAt },
  });

  const group = await prisma.group.create({
    data: { ownerId: owner.id, name: `G-${p}`, order: "a0" },
  });
  const list = await prisma.list.create({
    data: { ownerId: owner.id, groupId: group.id, name: `L-${p}`, order: "a0" },
  });
  const task = await prisma.task.create({
    data: { listId: list.id, creatorId: owner.id, title: `할일-${p}`, order: "a0" },
  });

  // 아무에게도 공유하지 않은 목록 — 접근이 막히는지 확인하는 데 쓴다.
  const secretList = await prisma.list.create({
    data: { ownerId: owner.id, name: `S-${p}`, order: "a1" },
  });
  const secretTask = await prisma.task.create({
    data: { listId: secretList.id, creatorId: owner.id, title: `비밀-${p}`, order: "a0" },
  });

  await prisma.share.create({
    data: { subjectType: "GROUP", subjectId: group.id, granteeUserId: editor.id, role: "EDITOR" },
  });
  await prisma.share.create({
    data: { subjectType: "LIST", subjectId: list.id, granteeUserId: viewer.id, role: "VIEWER" },
  });

  const content: ReportContent = {
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    rangeLabel: "2026-08-03 ~ 2026-08-09",
    title: `보고서-${p}`,
    summary: "요약",
    taskCount: 1,
    sections: [
      {
        key: "done",
        label: "이번 주 완료",
        groups: [
          {
            path: `G-${p} › L-${p}`,
            owner: null,
            tasks: [
              {
                id: task.id, seq: task.seq, title: task.title, listId: list.id,
                path: `G-${p} › L-${p}`, stepDone: 0, stepTotal: 0,
                dueDate: null, dueLabel: null, steps: [], comment: null, assignee: null,
                reason: "step",
              },
            ],
          },
        ],
      },
    ],
  };

  const published = await prisma.weeklyReport.create({
    data: {
      authorId: owner.id, weekStart: dateOnly(2026, 8, 3), title: `보고서-${p}`,
      contentJson: content, publishedAt: new Date(),
    },
  });
  const draft = await prisma.weeklyReport.create({
    data: { authorId: owner.id, weekStart: dateOnly(2026, 7, 27), title: `초안-${p}` },
  });

  await prisma.share.create({
    data: { subjectType: "REPORT", subjectId: published.id, granteeUserId: viewer.id, role: "VIEWER" },
  });

  return { p, owner, editor, viewer, stranger, group, list, task, secretList, secretTask, published, draft };
}

export async function destroyFixture(f: Fixture) {
  const userIds = [f.owner.id, f.editor.id, f.viewer.id, f.stranger.id];
  await prisma.share.deleteMany({
    where: { subjectId: { in: [f.group.id, f.list.id, f.published.id, f.draft.id] } },
  });
  await prisma.reportSend.deleteMany({ where: { reportId: { in: [f.published.id, f.draft.id] } } });
  await prisma.weeklyReport.deleteMany({ where: { authorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
