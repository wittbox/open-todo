import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 프로젝트 이슈 — DB 로 확인하는 규칙.
 *
 * 설정(약어·켜기), 번호, 권한(멤버·관리자·보관·끈 프로젝트), 고칠 때 남는 활동 기록과 해결·닫은 시각,
 * 댓글, 알림(맡김·상태·댓글·멘션이 누구에게 가는지), 지우기, 딥링크.
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

const A = await import("@/lib/actions/issue");
const { listIssues, getIssueDetail, resolveIssueRef, getIssueSettings } = await import("@/lib/queries/issues");
const as = (id: string) => (currentUser = id);
const ok = <T,>(r: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

// 약어는 설치 전체에서 하나 — 시험마다 다른 약어를 쓴다.
const rand = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, "X");
const KEY = `Q${rand()}`.slice(0, 6);

let f: ProjectFixture;
const notesOf = (userId: string, kind?: string) =>
  prisma.notification.findMany({ where: { userId, ...(kind ? { kind: kind as never } : {}), projectId: f.priv.id }, select: { kind: true, issueId: true } });

d("이슈 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("issue");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  describe("설정", () => {
    it("켜려면 약어가 있어야 하고, 모양이 맞아야 한다. 멤버는 설정을 못 바꾼다", async () => {
      as(f.owner.id);
      expect(errorOf(await A.updateIssueSettingsAction(f.priv.id, { enabled: true }))).toMatch(/약어/);
      expect(errorOf(await A.updateIssueSettingsAction(f.priv.id, { enabled: true, key: "1BUG" }))).toMatch(/영문 대문자/);
      as(f.member.id);
      expect(errorOf(await A.updateIssueSettingsAction(f.priv.id, { enabled: true, key: KEY }))).not.toBeNull();
    });

    it("처음 켜면 버그 템플릿과 라벨 셋(버그·개선·질문)이 생긴다", async () => {
      as(f.admin.id);
      ok(await A.updateIssueSettingsAction(f.priv.id, { enabled: true, key: KEY.toLowerCase() }));
      const s = await getIssueSettings(f.priv.id);
      expect(s).toMatchObject({ enabled: true, key: KEY, keyLocked: false });
      expect(s.template).toContain("재현 순서");
      expect(s.labels.map((l) => l.name)).toEqual(["버그", "개선", "질문"]);
    });

    it("약어는 설치 전체에서 하나", async () => {
      as(f.owner.id);
      expect(errorOf(await A.updateIssueSettingsAction(f.pub.id, { enabled: true, key: KEY }))).toMatch(/다른 프로젝트/);
    });
  });

  let first: { id: string; number: number };
  let labels: { id: string; name: string }[];

  describe("만들기", () => {
    it("번호는 1부터 차례로, 올린 사람이 보고자. 다른 프로젝트의 라벨은 붙지 않는다", async () => {
      labels = (await getIssueSettings(f.priv.id)).labels;
      const foreign = await prisma.issueLabel.create({ data: { projectId: f.pub.id, name: "남의 라벨" } });
      as(f.member.id);
      first = ok(
        await A.createIssueAction({
          projectId: f.priv.id, title: "  PDF 머리글이\n사라짐 ", body: "재현: 표가 길 때", priority: "HIGH",
          labelIds: [labels[0].id, foreign.id], dueDate: "2026-10-10",
        }),
      );
      const second = ok(await A.createIssueAction({ projectId: f.priv.id, title: "두 번째", body: "" }));
      expect([first.number, second.number]).toEqual([1, 2]);

      const d1 = (await getIssueDetail(f.member.id, f.priv.id, 1))!;
      expect(d1).toMatchObject({ ref: `${KEY}-1`, title: "PDF 머리글이 사라짐", priority: "HIGH", status: "OPEN", dueDate: "2026-10-10" });
      expect(d1.reporter?.id).toBe(f.member.id);
      expect(d1.labelIds).toEqual([labels[0].id]);
      expect(d1.events.map((e) => e.kind)).toEqual(["CREATED"]);
      expect((await getIssueSettings(f.priv.id)).keyLocked).toBe(true);
    });

    it("이슈가 생긴 뒤에는 약어를 못 바꾼다", async () => {
      as(f.owner.id);
      expect(errorOf(await A.updateIssueSettingsAction(f.priv.id, { enabled: true, key: "NEWKEY" }))).toMatch(/바꿀 수 없습니다/);
    });

    it("같은 순간 여럿이 올려도 번호가 겹치지 않는다", async () => {
      as(f.admin.id);
      const made = await Promise.all(
        Array.from({ length: 5 }, (_, i) => A.createIssueAction({ projectId: f.priv.id, title: `동시 ${i}`, body: "" })),
      );
      const numbers = made.map((r) => ok(r).number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(5);
      expect(numbers).toEqual([3, 4, 5, 6, 7]);
    });

    it("담당자는 프로젝트 멤버만. 외부인·보관·이슈를 끈 프로젝트는 거절", async () => {
      as(f.member.id);
      expect(errorOf(await A.createIssueAction({ projectId: f.priv.id, title: "x", body: "", assigneeId: f.stranger.id }))).toMatch(/멤버/);
      expect(errorOf(await A.createIssueAction({ projectId: f.priv.id, title: "  ", body: "" }))).toMatch(/제목/);
      as(f.stranger.id);
      expect(errorOf(await A.createIssueAction({ projectId: f.priv.id, title: "x", body: "" }))).not.toBeNull();
      as(f.owner.id);
      expect(errorOf(await A.createIssueAction({ projectId: f.pub.id, title: "x", body: "" }))).toMatch(/이슈를 쓰지 않습니다/);
    });

    it("목록·딥링크는 멤버에게만", async () => {
      expect(await listIssues(f.stranger.id, f.priv.id)).toBeNull();
      expect((await listIssues(f.member.id, f.priv.id))!.length).toBe(7);
      expect(await resolveIssueRef(f.member.id, KEY, 1)).toEqual({ projectId: f.priv.id, number: 1 });
      expect(await resolveIssueRef(f.stranger.id, KEY, 1)).toBeNull();
      expect(await resolveIssueRef(f.member.id, KEY, 999)).toBeNull();
    });
  });

  describe("고치기 · 알림", () => {
    it("맡기면 기록이 남고 새 담당자에게 알림. 자기가 맡으면 알림 없음", async () => {
      as(f.member.id);
      ok(await A.updateIssueAction(first.id, { assigneeId: f.admin.id }));
      expect(await notesOf(f.admin.id, "ISSUE_ASSIGNED")).toHaveLength(1);
      as(f.admin.id);
      const two = (await listIssues(f.admin.id, f.priv.id))!.find((i) => i.number === 2)!;
      ok(await A.updateIssueAction(two.id, { assigneeId: f.admin.id }));
      expect(await notesOf(f.admin.id, "ISSUE_ASSIGNED")).toHaveLength(1);
    });

    it("상태: 해결됨이면 해결 시각, 닫으면 닫은 시각, 다시 열면 둘 다 지운다. 보고자·담당자에게 알림(바꾼 사람 빼고)", async () => {
      as(f.admin.id);
      ok(await A.updateIssueAction(first.id, { status: "RESOLVED" }));
      let row = await prisma.issue.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.resolvedAt).not.toBeNull();
      expect(row.closedAt).toBeNull();
      expect(await notesOf(f.member.id, "ISSUE_STATUS")).toHaveLength(1); // 보고자
      expect(await notesOf(f.admin.id, "ISSUE_STATUS")).toHaveLength(0); // 바꾼 사람

      as(f.member.id);
      ok(await A.updateIssueAction(first.id, { status: "CLOSED" }));
      row = await prisma.issue.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.closedAt).not.toBeNull();
      expect(row.resolvedAt).not.toBeNull();

      ok(await A.updateIssueAction(first.id, { status: "OPEN" }));
      row = await prisma.issue.findUniqueOrThrow({ where: { id: first.id } });
      expect([row.resolvedAt, row.closedAt]).toEqual([null, null]);
      expect(await notesOf(f.admin.id, "ISSUE_STATUS")).toHaveLength(2); // 담당자는 닫음·다시 엶을 받았다
    });

    it("바뀐 칸마다 기록 — 우선순위·라벨·기한·제목. 본문 고침은 기록하지 않는다", async () => {
      as(f.member.id);
      ok(
        await A.updateIssueAction(first.id, {
          priority: "URGENT", labelIds: [labels[0].id, labels[1].id], dueDate: null, title: "PDF 머리글 사라짐", body: "고친 본문",
        }),
      );
      const detail = (await getIssueDetail(f.member.id, f.priv.id, 1))!;
      const kinds = detail.events.map((e) => e.kind);
      expect(kinds).toEqual(expect.arrayContaining(["PRIORITY", "LABELS", "DUE", "TITLE"]));
      expect(detail.events.find((e) => e.kind === "LABELS")).toMatchObject({ fromValue: "버그", toValue: "버그, 개선" });
      expect(detail.body).toBe("고친 본문");
      // 같은 값으로 다시 고치면 아무 기록도 없다
      const before = detail.events.length;
      ok(await A.updateIssueAction(first.id, { priority: "URGENT", labelIds: [labels[1].id, labels[0].id] }));
      expect((await getIssueDetail(f.member.id, f.priv.id, 1))!.events).toHaveLength(before);
    });

    it("댓글: 부른 사람은 멘션 하나만, 나머지 보고자·담당자·지켜보는 사람은 댓글 알림", async () => {
      as(f.owner.id);
      ok(await A.setWatchingAction(first.id, true));
      as(f.member.id);
      const before = { admin: (await notesOf(f.admin.id)).length, owner: (await notesOf(f.owner.id)).length };
      ok(await A.addCommentAction(first.id, `<@${f.admin.id}> 확인 부탁합니다`));
      const adminNew = (await notesOf(f.admin.id)).slice(before.admin);
      expect((await notesOf(f.admin.id, "ISSUE_MENTION")).length).toBe(1);
      expect(adminNew.length).toBe(1);
      expect((await notesOf(f.owner.id)).length - before.owner).toBe(1); // 지켜보는 사람 → 댓글 알림
      expect((await notesOf(f.owner.id, "ISSUE_COMMENT")).length).toBe(1);
      const detail = (await getIssueDetail(f.member.id, f.priv.id, 1))!;
      expect(detail.commentCount).toBe(1);
      expect(detail.people.map((p) => p.userId)).toContain(f.admin.id);
    });

    it("댓글 고치기는 쓴 사람만, 지우기는 쓴 사람이나 관리자 — 자리는 남는다", async () => {
      const ev = (await getIssueDetail(f.member.id, f.priv.id, 1))!.events.find((e) => e.kind === "COMMENT")!;
      as(f.admin.id);
      expect(errorOf(await A.editCommentAction(ev.id, "남의 글"))).toMatch(/내가 쓴/);
      as(f.member.id);
      ok(await A.editCommentAction(ev.id, "고친 댓글"));
      as(f.owner.id);
      ok(await A.deleteCommentAction(ev.id));
      const after = (await getIssueDetail(f.member.id, f.priv.id, 1))!.events.find((e) => e.id === ev.id)!;
      expect(after).toMatchObject({ deleted: true, body: "" });
      expect((await getIssueDetail(f.member.id, f.priv.id, 1))!.commentCount).toBe(0);
    });

    it("보관된 프로젝트는 읽기 전용", async () => {
      await prisma.project.update({ where: { id: f.priv.id }, data: { archivedAt: new Date() } });
      as(f.member.id);
      expect(errorOf(await A.addCommentAction(first.id, "되나?"))).toMatch(/읽기 전용/);
      await prisma.project.update({ where: { id: f.priv.id }, data: { archivedAt: null } });
    });
  });

  describe("지우기", () => {
    it("올린 사람이나 관리자만. 번호는 되돌리지 않는다", async () => {
      as(f.admin.id);
      const mine = ok(await A.createIssueAction({ projectId: f.priv.id, title: "관리자 것", body: "" }));
      as(f.member.id);
      expect(errorOf(await A.deleteIssueAction(mine.id))).toMatch(/올린 사람/);
      ok(await A.deleteIssueAction(first.id)); // 내가 올린 것
      as(f.admin.id);
      ok(await A.deleteIssueAction(mine.id));
      const next = ok(await A.createIssueAction({ projectId: f.priv.id, title: "다음", body: "" }));
      expect(next.number).toBe(mine.number + 1);
      expect(await prisma.notification.count({ where: { issueId: first.id } })).toBe(0); // 알림도 함께 사라졌다
    });
  });
  describe("파일", () => {
    it("댓글에 붙인 파일은 프로젝트 멤버만 받는다 — 외부인은 없는 파일과 같은 404", async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { NextRequest } = await import("next/server");
      const { POST: postComment } = await import("@/app/api/issues/[id]/comments/route");
      const { GET: download } = await import("@/app/api/files/[id]/route");
      const dir = await mkdtemp(join(tmpdir(), "todo-issue-files-"));
      process.env.UPLOAD_DIR = dir;
      try {
        as(f.member.id);
        const it1 = ok(await A.createIssueAction({ projectId: f.priv.id, title: "파일 시험", body: "" }));
        const form = new FormData();
        form.set("body", "캡처");
        form.append("files", new File(["png-bytes"], "화면.png", { type: "image/png" }));
        const res = await postComment(
          new NextRequest(`https://todo.test/api/issues/${it1.id}/comments`, { method: "POST", body: form }),
          { params: Promise.resolve({ id: it1.id }) } as never,
        );
        expect(res.status).toBe(200);
        const file = await prisma.attachment.findFirstOrThrow({ where: { issueEvent: { issueId: it1.id } }, select: { id: true } });
        const get = (id: string) => download(new Request(`https://todo.test/api/files/${id}`), { params: Promise.resolve({ id }) } as never);
        expect((await get(file.id)).status).toBe(200);
        as(f.stranger.id);
        expect((await get(file.id)).status).toBe(404);
        // 외부인은 댓글도 못 단다 — 없는 이슈와 같은 404
        const res2 = await postComment(
          new NextRequest(`https://todo.test/api/issues/${it1.id}/comments`, { method: "POST", body: form }),
          { params: Promise.resolve({ id: it1.id }) } as never,
        );
        expect(res2.status).toBe(404);
      } finally {
        delete process.env.UPLOAD_DIR;
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
  describe("메시지 → 이슈", () => {
    it("메시지의 파일을 복사해 붙이고(메시지에도 남는다), 메시지 아래에 이슈가 이어 보인다. 다른 프로젝트 메시지는 거절", async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { createMessage } = await import("@/lib/projects/messages");
      const { listMessages } = await import("@/lib/queries/project");
      const dir = await mkdtemp(join(tmpdir(), "todo-msg-issue-"));
      process.env.UPLOAD_DIR = dir;
      try {
        const msg = await createMessage(f.member.id, {
          projectId: f.priv.id,
          body: "로그인하면 가끔 빈 화면",
          files: [{ name: "캡처.png", bytes: Buffer.from("png"), mimeType: "image/png" }],
        });
        as(f.member.id);
        const made = ok(
          await A.createIssueAction({ projectId: f.priv.id, title: "로그인 직후 빈 화면", body: msg.body, sourceMessageId: msg.id }),
        );
        const issue = await prisma.issue.findUniqueOrThrow({
          where: { id: made.id },
          select: { sourceMessageId: true, attachments: { select: { name: true, storageKey: true } } },
        });
        expect(issue.sourceMessageId).toBe(msg.id);
        expect(issue.attachments.map((a) => a.name)).toEqual(["캡처.png"]);
        const original = await prisma.attachment.findFirstOrThrow({ where: { messageId: msg.id }, select: { storageKey: true } });
        expect(issue.attachments[0].storageKey).not.toBe(original.storageKey); // 복사본

        const listed = await listMessages(f.member.id, f.priv.id, {});
        const row = listed!.messages.find((m) => m.id === msg.id)!;
        expect(row.issues).toEqual([{ ref: `${KEY}-${made.number}`, title: "로그인 직후 빈 화면" }]);

        const elsewhere = await createMessage(f.owner.id, { projectId: f.pub.id, body: "다른 곳" });
        expect(
          errorOf(await A.createIssueAction({ projectId: f.priv.id, title: "x", body: "", sourceMessageId: elsewhere.id })),
        ).toMatch(/원 메시지/);
      } finally {
        delete process.env.UPLOAD_DIR;
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
  describe("주간보고서", () => {
    it("내가 맡은 이슈가 같은 구간에 실린다 — 해결한 것은 완료, 진행 중은 진행 중. 범위에서 빼면 빠진다", async () => {
      const { getReportSource, EMPTY_SCOPE } = await import("@/lib/queries/report");
      const { currentWeekStart } = await import("@/lib/date");
      as(f.admin.id);
      const a = ok(await A.createIssueAction({ projectId: f.priv.id, title: "보고서 — 고친 것", body: "", assigneeId: f.member.id }));
      const b = ok(await A.createIssueAction({ projectId: f.priv.id, title: "보고서 — 하는 중", body: "", assigneeId: f.member.id }));
      as(f.member.id);
      ok(await A.updateIssueAction(a.id, { status: "RESOLVED" }));
      ok(await A.updateIssueAction(b.id, { status: "IN_PROGRESS" }));

      const week = currentWeekStart();
      const src = await getReportSource(f.member.id, week, EMPTY_SCOPE);
      const mine = src.tasks.filter((t) => t.ref?.startsWith(`${KEY}-`));
      const byTitle = new Map(mine.map((t) => [t.title, t]));
      expect(byTitle.get("보고서 — 고친 것")).toMatchObject({ isCompleted: true, ref: `${KEY}-${a.number}` });
      expect(byTitle.get("보고서 — 하는 중")).toMatchObject({ isCompleted: false, issueInProgress: true });
      const scopeId = `__issues__:${f.priv.id}`;
      expect(src.groups.map((g) => g.id)).toContain(scopeId);

      // 남이 맡은 이슈는 내 보고서에 없다
      const other = await getReportSource(f.admin.id, week, EMPTY_SCOPE);
      expect(other.tasks.some((t) => t.title === "보고서 — 고친 것")).toBe(false);

      // 범위에서 이 프로젝트를 빼면 빠진다
      const narrowed = await getReportSource(f.member.id, week, { ...EMPTY_SCOPE, allGroups: false, groupIds: [] });
      expect(narrowed.tasks.some((t) => t.ref?.startsWith(`${KEY}-`))).toBe(false);
    });
  });
  describe("나에게 할당됨 · 달력", () => {
    it("내가 맡은 열림·진행 중만 — 해결됨·닫힘·남의 것·이슈를 끈 프로젝트는 빼고, 달력은 기한 범위로", async () => {
      const { listMyIssues, countMyIssues } = await import("@/lib/queries/issues");
      as(f.admin.id);
      const mk = async (title: string, dueDate: string | null) =>
        ok(await A.createIssueAction({ projectId: f.priv.id, title, body: "", assigneeId: f.member.id, dueDate }));
      const open = await mk("맡음 — 열림", "2026-10-20");
      const prog = await mk("맡음 — 진행 중", null);
      const resolved = await mk("맡음 — 해결됨", "2026-10-21");
      ok(await A.updateIssueAction(prog.id, { status: "IN_PROGRESS" }));
      ok(await A.updateIssueAction(resolved.id, { status: "RESOLVED" }));
      await A.createIssueAction({ projectId: f.priv.id, title: "남의 것", body: "", assigneeId: f.admin.id });

      const mine = await listMyIssues(f.member.id);
      const titles = mine.map((i) => i.title).filter((t) => t.startsWith("맡음"));
      expect(titles).toEqual(["맡음 — 진행 중", "맡음 — 열림"]); // 진행 중이 먼저
      expect(mine.find((i) => i.title === "맡음 — 열림")).toMatchObject({
        href: `/projects/${f.priv.id}?tab=issues&issue=${open.number}`, dueDate: "2026-10-20",
      });
      const before = await countMyIssues(f.member.id);
      expect(before).toBe(mine.length);

      const { dateOnlyFromString } = await import("@/lib/date");
      const inRange = await listMyIssues(f.member.id, { from: dateOnlyFromString("2026-10-18"), to: dateOnlyFromString("2026-10-25") });
      expect(inRange.map((i) => i.title)).toEqual(["맡음 — 열림"]);

      // 이슈를 끄면 비춰 보이지 않는다(이슈는 남는다)
      as(f.owner.id);
      ok(await A.updateIssueSettingsAction(f.priv.id, { enabled: false }));
      expect(await countMyIssues(f.member.id)).toBe(0);
      ok(await A.updateIssueSettingsAction(f.priv.id, { enabled: true }));
      expect(await countMyIssues(f.member.id)).toBe(before);
    });
  });

  describe("자동 새로고침 표시", () => {
    it("상태·댓글·댓글 고침·지움·지켜보기·지우기마다 바뀌고, 아무 일 없으면 그대로", async () => {
      const { issueStamp } = await import("@/lib/queries/issues");
      as(f.member.id);
      const i = ok(await A.createIssueAction({ projectId: f.priv.id, title: "표시 확인", body: "" }));
      const seen = new Set<string>();
      const step = async (what: string) => {
        const s = await issueStamp(f.priv.id);
        expect(seen.has(s), what).toBe(false);
        seen.add(s);
        return s;
      };
      const start = await step("만듦");
      expect(await issueStamp(f.priv.id)).toBe(start);
      ok(await A.updateIssueAction(i.id, { status: "IN_PROGRESS" }));
      await step("상태");
      const c = ok(await A.addCommentAction(i.id, "봤습니다"));
      await step("댓글");
      ok(await A.editCommentAction(c.id, "봤어요"));
      await step("댓글 고침");
      ok(await A.deleteCommentAction(c.id));
      await step("댓글 지움");
      as(f.owner.id);
      ok(await A.setWatchingAction(i.id, true));
      await step("지켜보기");
      ok(await A.deleteIssueAction(i.id));
      await step("이슈 지움");
    });

    it("바뀜 표시 주소는 멤버에게만 — 로그아웃 401, 외부인 404", async () => {
      const { GET } = await import("@/app/api/projects/[id]/issues/route");
      const call = () =>
        GET(new Request(`http://x.test/api/projects/${f.priv.id}/issues`) as never, { params: Promise.resolve({ id: f.priv.id }) } as never);
      as(f.member.id);
      const res = await call();
      expect(res.status).toBe(200);
      expect(((await res.json()) as { stamp: string }).stamp).toMatch(/^\d+(\.\d+){7}$/);
      as(f.stranger.id);
      expect((await call()).status).toBe(404);
      currentUser = "";
      expect((await call()).status).toBe(401);
    });
  });
});
