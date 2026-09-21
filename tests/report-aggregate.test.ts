import { describe, expect, it } from "vitest";
import { buildReport, classify, type ReportEdits, type SourceTask } from "@/lib/report/aggregate";
import { dateOnly } from "@/lib/date";

/**
 * 주 범위는 월요일 00:00 ~ 일요일 24:00 (Asia/Seoul).
 * 서울 자정은 UTC 로 전날 15:00 이라 경계가 어긋나기 쉬워 여기서 못박는다.
 */

// 2026-08-10 은 월요일
const WEEK = dateOnly(2026, 8, 10);

const base: SourceTask = {
  id: "t1",
  seq: 1,
  title: "작업",
  listId: "l1",
  listName: "백필",
  groupName: "앱 개발",
  isCompleted: false,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  dueDate: null,
  steps: [],
};

const noEdits: ReportEdits = { title: "주간보고", summary: "", excludedTaskIds: [], comments: {} };

/** 구간만 볼 때. 이유까지 볼 일이 적어 짧게 쓴다. */
const key = (t: SourceTask) => classify(t, WEEK)?.key ?? null;

describe("classify", () => {
  it("이번 주에 완료한 작업은 done", () => {
    // 8/10 00:00 KST = 8/9 15:00 UTC
    expect(key({ ...base, isCompleted: true, completedAt: "2026-08-09T15:00:00.000Z" })).toBe("done");
    // 8/16 23:59 KST = 8/16 14:59 UTC (일요일 마지막)
    expect(key({ ...base, isCompleted: true, completedAt: "2026-08-16T14:59:00.000Z" })).toBe("done");
  });

  it("주 경계 바깥에 완료한 작업은 빠진다", () => {
    // 8/9 23:59 KST = 8/9 14:59 UTC — 지난 주 일요일
    expect(key({ ...base, isCompleted: true, completedAt: "2026-08-09T14:59:00.000Z" })).toBeNull();
    // 8/17 00:00 KST = 8/16 15:00 UTC — 다음 주 월요일
    expect(key({ ...base, isCompleted: true, completedAt: "2026-08-16T15:00:00.000Z" })).toBeNull();
  });

  it("완료 작업은 기한과 무관하게 완료 시점만 본다", () => {
    // 기한이 다음 주여도 완료 시점이 지난 주면 빠진다
    const t = { ...base, isCompleted: true, completedAt: "2026-08-01T00:00:00.000Z", dueDate: "2026-08-20" };
    expect(key(t)).toBeNull();
  });

  describe("착수 흔적이 있으면 진행 중", () => {
    it("세부 단계를 하나라도 끝냈으면 기한과 무관하게 진행 중", () => {
      // 이게 이 규칙의 핵심. 다음 달 마감이어도 손을 댔으면 붙잡고 있는 일이다.
      expect(classify({ ...base, hasStepProgress: true, dueDate: "2026-11-30" }, WEEK)).toEqual({
        key: "inProgress",
        reason: "step",
      });
      expect(classify({ ...base, hasStepProgress: true, dueDate: null }, WEEK)).toEqual({
        key: "inProgress",
        reason: "step",
      });
    });

    it("나의 하루에 올려 둔 작업은 진행 중", () => {
      expect(classify({ ...base, inMyDay: true, dueDate: "2026-12-01" }, WEEK)).toEqual({
        key: "inProgress",
        reason: "myday",
      });
    });

    it("기한이 이번 주 안이면 진행 중", () => {
      expect(classify({ ...base, dueDate: "2026-08-12" }, WEEK)).toEqual({
        key: "inProgress",
        reason: "due",
      });
      // 이번 주 마지막 날(일요일)까지는 아직 이번 주다
      expect(key({ ...base, dueDate: "2026-08-16" })).toBe("inProgress");
    });

    it("이미 지난 기한은 예정으로 밀지 않는다 — 늦은 일이다", () => {
      expect(classify({ ...base, dueDate: "2026-08-07" }, WEEK)).toEqual({
        key: "inProgress",
        reason: "overdue",
      });
    });
  });

  describe("착수 흔적이 없으면 예정", () => {
    it("이번 주를 넘어가는 기한은 멀든 가깝든 예정", () => {
      expect(classify({ ...base, dueDate: "2026-08-17" }, WEEK)).toEqual({
        key: "upcoming",
        reason: "future",
      });
      expect(key({ ...base, dueDate: "2026-08-24" })).toBe("upcoming");
      expect(key({ ...base, dueDate: "2026-11-30" })).toBe("upcoming");
    });

    it("기한이 없어도 이번 주에 새로 만들었으면 예정", () => {
      expect(classify({ ...base, createdAt: "2026-08-11T02:00:00.000Z" }, WEEK)).toEqual({
        key: "upcoming",
        reason: "new",
      });
    });

    it("이번 주 신규라도 단계를 끝냈으면 진행 중이 이긴다", () => {
      expect(
        key({ ...base, createdAt: "2026-08-11T02:00:00.000Z", hasStepProgress: true }),
      ).toBe("inProgress");
    });
  });

  it("아무 접점 없는 미완료 작업은 제외", () => {
    expect(key(base)).toBeNull();
  });

  it("순서만 바꾸거나 담당자만 지정한 것은 착수가 아니다", () => {
    // updatedAt 은 드래그 한 번에도 올라간다. "건드렸다"를 "일했다"로 읽으면
    // 손대지 않은 작업이 매주 진행 중으로 실린다.
    expect(key({ ...base, updatedAt: "2026-08-11T02:00:00.000Z" })).toBeNull();
  });
});

describe("buildReport", () => {
  const tasks: SourceTask[] = [
    { ...base, id: "a", seq: 10, title: "완료된 일", isCompleted: true, completedAt: "2026-08-11T02:00:00.000Z", steps: [{ title: "s1", isCompleted: true }] },
    { ...base, id: "b", seq: 3, title: "진행 중인 일", dueDate: "2026-08-13" },
    { ...base, id: "c", seq: 7, title: "다음 주 일", dueDate: "2026-08-18", listName: "현지 파트너", groupName: "해외 진출" },
    { ...base, id: "d", seq: 99, title: "관계 없는 일" },
  ];

  it("세 구간으로 나눈다", () => {
    const r = buildReport(tasks, WEEK, noEdits);
    const flat = Object.fromEntries(r.sections.map((s) => [s.key, s.groups.flatMap((g) => g.tasks.map((t) => t.title))]));
    expect(flat.done).toEqual(["완료된 일"]);
    expect(flat.inProgress).toEqual(["진행 중인 일"]);
    expect(flat.upcoming).toEqual(["다음 주 일"]);
    expect(r.taskCount).toBe(3);
  });

  it("그룹 › 목록 경로로 묶는다", () => {
    const r = buildReport(tasks, WEEK, noEdits);
    expect(r.sections.find((s) => s.key === "upcoming")!.groups[0].path).toBe("해외 진출 › 현지 파트너");
    expect(r.sections.find((s) => s.key === "done")!.groups[0].path).toBe("앱 개발 › 백필");
  });

  it("제외한 작업은 빠지고 코멘트는 붙는다", () => {
    const r = buildReport(tasks, WEEK, {
      ...noEdits,
      excludedTaskIds: ["b"],
      comments: { a: "  QA 검토 완료  " },
    });
    const inProgress = r.sections.find((s) => s.key === "inProgress")!;
    expect(inProgress.groups).toHaveLength(0);
    expect(r.sections.find((s) => s.key === "done")!.groups[0].tasks[0].comment).toBe("QA 검토 완료");
    expect(r.taskCount).toBe(2);
  });

  it("주 범위 라벨과 진행률을 담는다", () => {
    const r = buildReport(tasks, WEEK, noEdits);
    // 제목이 날짜를 이미 들고 있어서, 머리글은 근무주를 요일과 함께 보여 준다.
    expect(r.rangeLabel).toBe("8/10(월) ~ 8/14(금)");
    const done = r.sections.find((s) => s.key === "done")!.groups[0].tasks[0];
    expect([done.stepDone, done.stepTotal]).toEqual([1, 1]);
    expect(r.sections.find((s) => s.key === "upcoming")!.groups[0].tasks[0].dueLabel).toBe("8/18(화)");
  });

  it("사람이 옮긴 구간이 자동 분류를 이긴다", () => {
    const r = buildReport(tasks, WEEK, { ...noEdits, sections: { b: "upcoming", c: "inProgress" } });
    const flat = Object.fromEntries(
      r.sections.map((s) => [s.key, s.groups.flatMap((g) => g.tasks.map((t) => t.title))]),
    );
    expect(flat.inProgress).toEqual(["다음 주 일"]);
    expect(flat.upcoming).toEqual(["진행 중인 일"]);
    // 옮긴 줄은 이유가 '직접 옮김'으로 바뀐다 — 자동 분류 이유를 그대로 두면
    // 왜 여기 있는지 설명이 틀린다.
    expect(r.sections.find((s) => s.key === "upcoming")!.groups[0].tasks[0].reason).toBe("manual");
  });

  it("완료는 옮기지 않는다 — 사실이라 판단할 여지가 없다", () => {
    const r = buildReport(tasks, WEEK, { ...noEdits, sections: { a: "inProgress" } });
    const done = r.sections.find((s) => s.key === "done")!;
    expect(done.groups[0].tasks.map((t) => t.title)).toEqual(["완료된 일"]);
    expect(r.sections.find((s) => s.key === "inProgress")!.groups.flatMap((g) => g.tasks)).toHaveLength(1);
  });

  it("옮겨도 제외한 작업은 돌아오지 않는다", () => {
    const r = buildReport(tasks, WEEK, {
      ...noEdits,
      excludedTaskIds: ["b"],
      sections: { b: "upcoming" },
    });
    expect(r.sections.flatMap((s) => s.groups.flatMap((g) => g.tasks.map((t) => t.id)))).not.toContain("b");
  });

  it("자동 분류된 줄은 이유를 달고 나온다", () => {
    const r = buildReport(tasks, WEEK, noEdits);
    expect(r.sections.find((s) => s.key === "inProgress")!.groups[0].tasks[0].reason).toBe("due");
    expect(r.sections.find((s) => s.key === "upcoming")!.groups[0].tasks[0].reason).toBe("future");
  });

  it("같은 묶음 안에서는 일련번호 순서로 정렬한다", () => {
    const many: SourceTask[] = [
      { ...base, id: "x", seq: 50, title: "나중 번호", dueDate: "2026-08-12" },
      { ...base, id: "y", seq: 5, title: "앞 번호", dueDate: "2026-08-12" },
    ];
    const r = buildReport(many, WEEK, noEdits);
    expect(r.sections.find((s) => s.key === "inProgress")!.groups[0].tasks.map((t) => t.seq)).toEqual([5, 50]);
  });
});

/**
 * 공유받은 목록의 작업이 내 작업과 같은 줄로 보이던 문제.
 * 누구 목록인지(묶음)와 누가 만들었는지(작업)를 따로 담는다.
 */
describe("소유자와 담당자", () => {
  const mine: SourceTask = { ...base, id: "m", seq: 1, dueDate: "2026-08-12" };
  const theirs: SourceTask = {
    ...base,
    id: "s", seq: 2, title: "이영희 개발 작업", listId: "l2",
    listName: "개발 목록 2", groupName: "개발",
    dueDate: "2026-08-12", ownerName: "이영희", assigneeName: "이영희",
  };

  function inProgress(tasks: SourceTask[]) {
    return buildReport(tasks, WEEK, noEdits).sections.find((s) => s.key === "inProgress")!;
  }

  it("내 목록의 내 작업에는 아무 이름도 붙지 않는다", () => {
    const g = inProgress([mine]).groups[0];
    expect(g.owner).toBeNull();
    expect(g.tasks[0].assignee).toBeNull();
  });

  it("공유받은 목록은 묶음에 소유자를, 남이 만든 작업은 줄에 담당자를 단다", () => {
    const g = inProgress([theirs]).groups[0];
    expect(g.owner).toBe("이영희");
    expect(g.tasks[0].assignee).toBe("이영희");
  });

  it("남의 목록에 내가 만든 작업은 담당자가 비고 소유자만 남는다", () => {
    const g = inProgress([{ ...theirs, assigneeName: null }]).groups[0];
    expect(g.owner).toBe("이영희");
    expect(g.tasks[0].assignee).toBeNull();
  });

  it("이름이 같은 목록이라도 소유자가 다르면 따로 묶는다", () => {
    const groups = inProgress([
      { ...mine, listName: "개발 목록 2", groupName: "개발" },
      theirs,
    ]).groups;
    expect(groups).toHaveLength(2);
    // 내 것이 먼저, 그다음 공유해 준 사람 이름 순
    expect(groups.map((g) => g.owner)).toEqual([null, "이영희"]);
  });

  it("같은 사람의 같은 목록은 하나로 묶는다", () => {
    const groups = inProgress([theirs, { ...theirs, id: "s2", seq: 3 }]).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
  });
});
