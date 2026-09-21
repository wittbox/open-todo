// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TaskItem } from "@/lib/queries/list";
import { DEFAULT_PREFS, monthGrid, type CalendarList, type CalendarPrefs, type Ghost } from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";

/**
 * 달력 화면.
 *
 * 끌어 놓기는 jsdom 에서 좌표가 없어 흉내 낼 수 없다(기한 저장 경로는 체크와 같은 updateTask).
 * 여기서는 칸 배치, 넘침, 추가 창의 키보드, 권한에 따른 잠금을 못박는다.
 */

const replace = vi.fn();
const refresh = vi.fn();
type Action = (...args: unknown[]) => Promise<{ ok: true }>;
const createTask = vi.fn<Action>(async () => ({ ok: true }));
const updateTask = vi.fn<Action>(async () => ({ ok: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/task", () => ({
  createTask: (...a: unknown[]) => createTask(...a),
  updateTask: (...a: unknown[]) => updateTask(...a),
}));
vi.mock("@/lib/actions/session-guard", () => ({
  runAction: (fn: () => unknown) => fn(),
  handledAuthFailure: () => false,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "cal_prefs=; max-age=0; path=/";
});

function task(p: Partial<TaskItem> & { id: string; title: string }): TaskItem {
  return {
    seq: 1, note: null, isImportant: false, isCompleted: false, completedAt: null, dueDate: null,
    inMyDay: false, order: "a0", createdAt: "2026-09-01T00:00:00.000Z", listId: "inbox", listName: "작업", groupName: null,
    stepCount: 0, stepDoneCount: 0, assignee: null, repeat: null, attachmentCount: 0, remindAt: null,
    ...p,
  };
}

const LISTS: CalendarList[] = [
  { id: "inbox", name: "작업", groupName: null, color: "#2564cf", isInbox: true, writable: true },
  { id: "ship", name: "제품 출하", groupName: "공장", color: "#0f7b6c", isInbox: false, writable: true },
  { id: "sales", name: "영업팀", groupName: null, color: "#b4009e", isInbox: false, writable: false },
];

const SEP = monthGrid(new Date("2026-09-01T00:00:00.000Z"));

function show(
  over: Partial<{
    tasks: TaskItem[];
    ghosts: Ghost[];
    ghostSources: TaskItem[];
    overdue: TaskItem[];
    lists: CalendarList[];
    prefs: CalendarPrefs;
  }> = {},
) {
  return render(
    <CalendarView
      month="2026-09"
      today="2026-09-11"
      weeks={SEP.weeks}
      tasks={[]}
      ghosts={[]}
      ghostSources={[]}
      lists={LISTS}
      prefs={DEFAULT_PREFS}
      meId="me"
      {...over}
    />,
  );
}

const cell = (date: string) => document.querySelector(`[data-date="${date}"]`) as HTMLElement;

describe("달력 칸", () => {
  it("작업은 기한 날짜 칸에 놓이고, 지난 기한만 '기한 지남' 이다", () => {
    show({
      tasks: [
        task({ id: "a", title: "출고준비", dueDate: "2026-09-11", listId: "ship" }),
        task({ id: "b", title: "기술문서 전달", dueDate: "2026-09-07" }),
      ],
    });
    const today = within(cell("2026-09-11")).getByText("출고준비").closest("[data-chip]")!;
    const past = within(cell("2026-09-07")).getByText("기술문서 전달").closest("[data-chip]")!;
    expect(today.hasAttribute("data-overdue")).toBe(false);
    expect(past.hasAttribute("data-overdue")).toBe(true);
  });

  it("공휴일 이름이 그 칸에 보인다", () => {
    show();
    expect(within(cell("2026-09-25")).getByText("추석")).toBeTruthy();
    expect(within(cell("2026-09-24")).getByText("추석 연휴")).toBeTruthy();
  });

  it("칸이 넘치면 '+N개', 누르면 그날 전부가 뜬다", () => {
    const five = ["주간업무보고", "출고준비", "라벨 수정", "원자재 입고 확인", "해외 바이어 회신"].map((title, i) =>
      task({ id: `t${i}`, seq: i + 1, title, dueDate: "2026-09-11" }),
    );
    show({ tasks: five });

    const c = cell("2026-09-11");
    expect(c.querySelectorAll("[data-chip]")).toHaveLength(3);
    fireEvent.click(within(c).getByRole("button", { name: "+2개" }));

    const pop = screen.getByRole("dialog", { name: "9월 11일 (금) 작업" });
    for (const t of five) expect(within(pop).getByText(t.title)).toBeTruthy();
  });

  it("'완료 표시' 를 끄면 완료한 작업이 빠지고, 다음에도 그렇게 보이도록 쿠키에 남는다", () => {
    show({ tasks: [task({ id: "d", title: "파트너 미팅", dueDate: "2026-09-08", isCompleted: true })] });
    expect(within(cell("2026-09-08")).queryByText("파트너 미팅")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "완료 표시" }));

    expect(within(cell("2026-09-08")).queryByText("파트너 미팅")).toBeNull();
    expect(decodeURIComponent(document.cookie)).toContain('"showDone":false');
  });

  it("숨긴 목록의 작업은 빠지고, 버튼에 몇 개 숨겼는지 보인다", () => {
    show({
      tasks: [task({ id: "s", title: "라벨 수정", dueDate: "2026-09-15", listId: "ship" })],
      prefs: { ...DEFAULT_PREFS, hidden: ["ship", "지워진-목록"] },
    });
    expect(within(cell("2026-09-15")).queryByText("라벨 수정")).toBeNull();
    expect(screen.getByRole("button", { name: /목록 1개 숨김/ })).toBeTruthy();
  });
});

describe("칩", () => {
  it("동그라미를 누르면 완료로 저장한다", async () => {
    show({ tasks: [task({ id: "a", title: "출고준비", dueDate: "2026-09-11" })] });
    fireEvent.click(screen.getByRole("button", { name: "출고준비 완료로 표시" }));
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { isCompleted: true }));
  });

  it("보기 전용 목록의 작업은 체크가 잠긴다", () => {
    show({ tasks: [task({ id: "v", title: "견적서 회신", dueDate: "2026-09-09", listId: "sales" })] });
    expect((screen.getByRole("button", { name: "견적서 회신 완료로 표시" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("제목을 누르면 상세 창 주소(?task=)로 바꾼다", () => {
    show({ tasks: [task({ id: "a", title: "출고준비", dueDate: "2026-09-11" })] });
    fireEvent.click(screen.getByRole("button", { name: "출고준비" }));
    expect(replace).toHaveBeenCalledWith("/calendar?task=a", { scroll: false });
  });

  it("칩 어디를 눌러도 연다 — 좁은 칸에서 제목 버튼 폭이 0 이 돼도. 칸의 추가 창은 뜨지 않는다", () => {
    // 2026-09-11 확인 중 발견: 상세 창을 연 채 창이 좁으면 제목 버튼 폭이 0 이 되어 누를 곳이 없었다.
    show({ tasks: [task({ id: "a", title: "출고준비", dueDate: "2026-09-11" })] });
    fireEvent.click(within(cell("2026-09-11")).getByText("출고준비").closest("[data-chip]")!);
    expect(replace).toHaveBeenCalledWith("/calendar?task=a", { scroll: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("동그라미는 완료만 하고 상세 창을 열지 않는다", async () => {
    show({ tasks: [task({ id: "a", title: "출고준비", dueDate: "2026-09-11" })] });
    fireEvent.click(screen.getByRole("button", { name: "출고준비 완료로 표시" }));
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { isCompleted: true }));
    expect(replace).not.toHaveBeenCalled();
  });

  it("반복 다음 회차는 점선이고 체크가 없으며, 누르면 원래 작업을 연다", () => {
    const weekly = task({
      id: "r", title: "주간업무보고", dueDate: "2026-08-28",
      repeat: { unit: "WEEK", every: 1, days: [5] },
    });
    // 기한이 칸보다 앞인 원래 작업은 칸에 없고, 회차만 칸에 온다
    show({ ghostSources: [weekly], ghosts: [{ taskId: "r", date: "2026-09-18" }] });

    const c = cell("2026-09-18");
    const chip = within(c).getByText("주간업무보고").closest("[data-chip]")!;
    expect(chip.hasAttribute("data-ghost")).toBe(true);
    expect(within(c).queryByRole("button", { name: /완료로 표시/ })).toBeNull();

    fireEvent.click(within(c).getByRole("button", { name: "주간업무보고" }));
    expect(replace).toHaveBeenCalledWith("/calendar?task=r", { scroll: false });
  });
});

describe("칸에서 추가", () => {
  it("빈 곳을 누르면 그날 기한으로 추가 — 한글 조합 중 Enter 는 넘기고, Enter 로 저장", async () => {
    show();
    fireEvent.click(cell("2026-09-16"));

    const pop = screen.getByRole("dialog", { name: "9월 16일 (수) 작업 추가" });
    const input = within(pop).getByRole("textbox", { name: "작업 이름" });
    fireEvent.change(input, { target: { value: "원자재 입고 확인" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(createTask).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() =>
      expect(createTask).toHaveBeenCalledWith("inbox", "원자재 입고 확인", { dueDate: "2026-09-16" }),
    );
    // 이어서 입력할 수 있게 창은 열린 채 비워진다
    await vi.waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("목록은 편집할 수 있는 것만 고를 수 있고, 고른 목록을 다음에도 쓴다", async () => {
    show();
    fireEvent.click(within(cell("2026-09-16")).getByRole("button", { name: "9월 16일 (수)에 작업 추가" }));

    const pop = screen.getByRole("dialog", { name: "9월 16일 (수) 작업 추가" });
    const select = within(pop).getByRole("combobox", { name: "목록" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["작업", "공장 › 제품 출하"]);

    fireEvent.change(select, { target: { value: "ship" } });
    fireEvent.change(within(pop).getByRole("textbox", { name: "작업 이름" }), { target: { value: "포장재 발주" } });
    fireEvent.click(within(pop).getByRole("button", { name: "추가" }));

    await vi.waitFor(() => expect(createTask).toHaveBeenCalledWith("ship", "포장재 발주", { dueDate: "2026-09-16" }));
    expect(decodeURIComponent(document.cookie)).toContain('"addListId":"ship"');
  });

  it("편집할 수 있는 목록이 없으면 칸을 눌러도 추가 창이 뜨지 않는다", () => {
    show({ lists: [LISTS[2]] });
    fireEvent.click(cell("2026-09-16"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /에 작업 추가$/ })).toHaveLength(0);
  });
});

describe("추가 창과 폰 키보드", () => {
  // 폰은 키보드가 뜨면서 창 크기가 바뀐다. 크기 바뀜에 닫히던 창이 열리자마자 닫혔다(2026-09-17).
  it("입력칸에 쓰는 중이면 창 크기가 바뀌어도 닫히지 않는다. 쓰지 않을 때는 닫힌다", () => {
    show();
    fireEvent.click(cell("2026-09-16"));
    const input = within(screen.getByRole("dialog", { name: "9월 16일 (수) 작업 추가" })).getByRole("textbox", { name: "작업 이름" });
    input.focus();
    fireEvent(window, new Event("resize"));
    fireEvent.scroll(window);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    input.blur();
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("폰 — 점 달력 + 그날 목록", () => {
  // 폰(768px 미만)은 칸이 50px 남짓이라 이름을 못 쓴다(2026-09-17 미리보기 ②A).
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(max-width: 767.98px)",
      addEventListener() {},
      removeEventListener() {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const day = (date: string) => document.querySelector(`[data-day="${date}"]`) as HTMLElement;
  const TASKS = [
    task({ id: "a", seq: 1, title: "출고준비", dueDate: "2026-09-11", listId: "ship" }),
    task({ id: "b", seq: 2, title: "주간업무보고", dueDate: "2026-09-11" }),
    task({ id: "c", seq: 3, title: "제품 문서 개정", dueDate: "2026-09-22" }),
    task({ id: "d", seq: 4, title: "기술문서 전달", dueDate: "2026-09-07" }),
  ];

  it("칸 달력 대신 점 달력. 오늘이 골라져 있고 아래에 오늘 작업", () => {
    show({ tasks: TASKS });
    expect(cell("2026-09-11")).toBeNull();
    expect(day("2026-09-11").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-11").querySelectorAll("[data-dot]")).toHaveLength(2);
    expect(day("2026-09-07").querySelectorAll("[data-dot]")).toHaveLength(1);
    expect(day("2026-09-16").querySelectorAll("[data-dot]")).toHaveLength(0);

    const list = screen.getByRole("region", { name: "9월 11일 (금) 작업" });
    expect(within(list).getByText("출고준비")).toBeTruthy();
    expect(within(list).getByText("주간업무보고")).toBeTruthy();
    expect(within(list).queryByText("제품 문서 개정")).toBeNull();
  });

  it("날을 누르면 목록이 그날로 바뀐다. 빈 날은 빈 줄 안내", () => {
    show({ tasks: TASKS });
    fireEvent.click(day("2026-09-22"));
    expect(day("2026-09-22").getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("region", { name: "9월 22일 (화) 작업" })).getByText("제품 문서 개정")).toBeTruthy();

    fireEvent.click(day("2026-09-16"));
    expect(within(screen.getByRole("region", { name: "9월 16일 (수) 작업" })).getByText("이날 기한인 작업이 없습니다.")).toBeTruthy();
  });

  it("＋ 는 고른 날 기한으로 추가 창을 연다. 줄을 누르면 상세 창", async () => {
    show({ tasks: TASKS });
    fireEvent.click(day("2026-09-22"));
    fireEvent.click(screen.getByRole("button", { name: "9월 22일 (화)에 작업 추가" }));
    const pop = screen.getByRole("dialog", { name: "9월 22일 (화) 작업 추가" });
    fireEvent.change(within(pop).getByRole("textbox", { name: "작업 이름" }), { target: { value: "현지 교육 자료" } });
    fireEvent.keyDown(within(pop).getByRole("textbox", { name: "작업 이름" }), { key: "Enter" });
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledWith("inbox", "현지 교육 자료", { dueDate: "2026-09-22" }));

    fireEvent.click(within(screen.getByRole("region", { name: "9월 22일 (화) 작업" })).getByText("제품 문서 개정"));
    expect(replace).toHaveBeenCalledWith("/calendar?task=c", { scroll: false });
  });
});

describe("지난 기한 줄", () => {
  // '계획된 일정' 을 없애며 달력이 못 보여 주던 이전 달의 밀린 작업을 여기로 옮겼다(2026-09-16).
  const OVERDUE = [
    task({ id: "o1", seq: 1, title: "장비 점검 보고서 갱신", dueDate: "2026-07-28", listId: "ship", listName: "제품 출하", groupName: "공장", isImportant: true }),
    task({ id: "o2", seq: 2, title: "대리점 계약서 회신", dueDate: "2026-08-25", listId: "sales", listName: "영업팀" }),
    task({ id: "o3", seq: 3, title: "기술문서 전달", dueDate: "2026-09-07" }),
  ];
  const strip = () => screen.queryByRole("region", { name: "지난 기한" });

  it("밀린 게 없으면 줄 자체가 없다", () => {
    show();
    expect(strip()).toBeNull();
  });

  it("접힌 채 수와 가장 오래된 날. 펼치면 오래된 순으로 목록 경로와 며칠 지났는지, 펼침은 쿠키에 남는다", () => {
    show({ overdue: OVERDUE });
    const s = strip()!;
    expect(s.textContent).toContain("지난 기한 3개");
    expect(s.textContent).toContain("가장 오래된 것 7월 28일");
    expect(s.querySelectorAll("[data-overdue-row]")).toHaveLength(0);

    fireEvent.click(within(s).getByRole("button", { name: /지난 기한 3개/ }));

    const rows = [...s.querySelectorAll("[data-overdue-row]")].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("장비 점검 보고서 갱신");
    expect(rows[0]).toContain("공장 › 제품 출하");
    expect(rows[0]).toContain("7월 28일 · 45일 지남");
    expect(rows[2]).toContain("9월 7일 · 4일 지남");
    expect(decodeURIComponent(document.cookie)).toContain('"overdueOpen":true');
  });

  it("줄을 누르면 상세 창, 동그라미는 완료만 — 보기 전용 목록은 잠긴다", async () => {
    show({ overdue: OVERDUE, prefs: { ...DEFAULT_PREFS, overdueOpen: true } });
    const s = strip()!;

    fireEvent.click(within(s).getByText("장비 점검 보고서 갱신"));
    expect(replace).toHaveBeenCalledWith("/calendar?task=o1", { scroll: false });
    replace.mockClear();

    fireEvent.click(within(s).getByRole("button", { name: "장비 점검 보고서 갱신 완료로 표시" }));
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledWith("o1", { isCompleted: true }));
    expect(replace).not.toHaveBeenCalled();

    expect((within(s).getByRole("button", { name: "대리점 계약서 회신 완료로 표시" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("달력에서 숨긴 목록의 작업은 세지 않는다 — 다 숨기면 줄도 없다", () => {
    show({ overdue: OVERDUE, prefs: { ...DEFAULT_PREFS, hidden: ["ship"] } });
    expect(strip()!.textContent).toContain("지난 기한 2개");
    cleanup();
    show({ overdue: OVERDUE, prefs: { ...DEFAULT_PREFS, hidden: ["ship", "sales", "inbox"] } });
    expect(strip()).toBeNull();
  });
});

describe("목록 경로 — 그룹 › 목록", () => {
  // 여러 목록이 섞이는 달력에서 어느 목록 작업인지 알 수 없었다(2026-09-12 요청).
  it("칩에 마우스를 올리면 제목과 경로, '+N개' 창의 줄에도 경로", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      task({ id: `p${i}`, seq: i + 1, title: `작업${i}`, dueDate: "2026-09-14", listId: "ship", listName: "제품 출하", groupName: "공장" }),
    );
    show({ tasks: five });

    const title = within(cell("2026-09-14")).getByRole("button", { name: "작업0" });
    expect(title.getAttribute("title")).toBe("작업0 — 공장 › 제품 출하");

    fireEvent.click(within(cell("2026-09-14")).getByRole("button", { name: "+2개" }));
    const pop = screen.getByRole("dialog", { name: "9월 14일 (월) 작업" });
    expect(within(pop).getAllByText("공장 › 제품 출하")).toHaveLength(5);
  });

  it("목록 거르기 창에도 경로", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /목록 전체/ }));
    expect(within(screen.getByRole("dialog", { name: "볼 목록" })).getByText("공장 › 제품 출하")).toBeTruthy();
  });
});
