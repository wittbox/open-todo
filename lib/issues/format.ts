import type { IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";

/**
 * 이슈의 번호·순서·거르기 — 서버와 화면이 함께 쓰는 순수 함수. 이름표(상태·우선순위)는 번역 파일(issues.json)에 있다.
 *
 * 번호는 "약어-번호"(BUG-23). 약어는 프로젝트 설정에서 정한다: 영문 대문자로 시작하는 2~6자(대문자·숫자).
 * 작업 번호(#330)와 모양이 달라 섞이지 않는다.
 */

export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const REF_RE = /^([A-Z][A-Z0-9]{1,5})-(\d{1,9})$/;

export function issueRef(key: string | null, number: number): string {
  return key ? `${key}-${number}` : `#${number}`;
}

/** "BUG-23" → { key, number }. 소문자로 들어와도 받는다(주소에 손으로 칠 때). */
export function parseIssueRef(raw: string): { key: string; number: number } | null {
  const m = REF_RE.exec(raw.trim().toUpperCase());
  if (!m) return null;
  const number = Number(m[2]);
  return number > 0 ? { key: m[1], number } : null;
}

/** 약어 다듬기 — 공백 빼고 대문자로. 맞지 않으면 null. */
export function normalizeIssueKey(raw: string): string | null {
  const k = raw.trim().toUpperCase();
  return ISSUE_KEY_RE.test(k) ? k : null;
}

/* ── 상태 ── */

export const STATUSES: IssueStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

/** '열림' 탭에 드는 상태 — 해결됨은 보고자 확인을 기다리므로 아직 열린 쪽이다. */
export function isOpenStatus(s: IssueStatus): boolean {
  return s !== "CLOSED";
}

/* ── 우선순위 ── */

export const PRIORITIES: IssuePriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

/* ── 라벨 색 ── */

export const LABEL_COLORS = {
  gray: { bg: "#edebe9", fg: "#3b3a39" },
  red: { bg: "#fde7e9", fg: "#a4262c" },
  orange: { bg: "#fff1e6", fg: "#c75000" },
  yellow: { bg: "#fff4ce", fg: "#7a5a00" },
  green: { bg: "#dff6dd", fg: "#0b6a0b" },
  teal: { bg: "#eef6f3", fg: "#0f7b6c" },
  blue: { bg: "#eff6fc", fg: "#2564cf" },
  purple: { bg: "#f3eefa", fg: "#5c2e91" },
} as const;
export type LabelColor = keyof typeof LABEL_COLORS;
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export function labelColor(key: string): { bg: string; fg: string } {
  return LABEL_COLORS[key as LabelColor] ?? LABEL_COLORS.gray;
}

/* ── 기본값 ── */

/** 처음 켤 때 만들어 두는 라벨 — 이름은 켠 사람의 언어로(issues.defaults.label*) */
export const DEFAULT_LABELS: { key: "labelBug" | "labelImprovement" | "labelQuestion"; color: LabelColor }[] = [
  { key: "labelBug", color: "red" },
  { key: "labelImprovement", color: "yellow" },
  { key: "labelQuestion", color: "blue" },
];

/* ── 목록: 거르기·정렬 ── */

export type IssueListRow = {
  number: number;
  title: string;
  body: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  labelIds: string[];
  updatedAt: string;
};

export type IssueFilter = {
  state: "open" | "closed" | "all";
  /** "me" 는 부른 쪽이 내 id 로 바꿔 넣는다. "none" = 담당자 없음 */
  assignee?: string | null;
  labelId?: string | null;
  priority?: IssuePriority | null;
  q?: string;
};

const STATUS_RANK: Record<IssueStatus, number> = { IN_PROGRESS: 0, OPEN: 1, RESOLVED: 2, CLOSED: 3 };
const PRIORITY_RANK: Record<IssuePriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * 거르고 정렬한다. 검색은 제목·본문·번호(BUG-23, 23)를 본다.
 * 정렬: 상태(진행 중 → 열림 → 해결됨 → 닫힘) → 우선순위 → 최근 갱신.
 * 진행 중을 맨 위에 두는 것은 "지금 누가 무엇을 하고 있나" 가 먼저 보이게.
 */
export function filterIssues<T extends IssueListRow>(rows: T[], f: IssueFilter, key: string | null): T[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const qNumber = q ? (parseIssueRef(q)?.number ?? (/^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null)) : null;
  const out = rows.filter((r) => {
    if (f.state === "open" && !isOpenStatus(r.status)) return false;
    if (f.state === "closed" && r.status !== "CLOSED") return false;
    if (f.assignee === "none" ? r.assigneeId != null : f.assignee && r.assigneeId !== f.assignee) return false;
    if (f.labelId && !r.labelIds.includes(f.labelId)) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (q) {
      if (qNumber != null && r.number === qNumber) return true;
      const hay = `${issueRef(key, r.number)} ${r.title} ${r.body}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
  );
}

export function countByState(rows: { status: IssueStatus }[]): { open: number; closed: number } {
  let open = 0;
  for (const r of rows) if (isOpenStatus(r.status)) open++;
  return { open, closed: rows.length - open };
}

/* ── 활동 기록 문구 ── */

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * 바뀐 기록 한 줄 — "상태: 열림 → 진행 중". 값은 저장된 그대로 오고(상태·우선순위는 열쇠, 담당자는 사람 id,
 * 라벨은 이름, 기한은 날짜) 여기서 사람이 읽는 말로 바꾼다. `t` 는 issues 묶음의 번역 함수. 댓글은 본문을 따로 그린다.
 */
export function describeEvent(
  e: { kind: string; fromValue: string | null; toValue: string | null },
  t: T,
  nameOf: (userId: string) => string,
  dateLabel: (ymd: string) => string,
): string {
  const none = t("event.none");
  const v = (x: string | null, f: (s: string) => string) => (x ? f(x) : none);
  const status = (s: string) => t(`status.${s}`);
  const priority = (s: string) => t(`priority.${s}`);
  switch (e.kind) {
    case "CREATED":
      return t("event.created");
    case "STATUS":
      return t("event.status", { from: v(e.fromValue, status), to: v(e.toValue, status) });
    case "PRIORITY":
      return t("event.priority", { from: v(e.fromValue, priority), to: v(e.toValue, priority) });
    case "ASSIGNEE":
      if (!e.toValue) return t("event.unassigned", { name: v(e.fromValue, nameOf) });
      return e.fromValue
        ? t("event.reassigned", { from: nameOf(e.fromValue), to: nameOf(e.toValue) })
        : t("event.assigned", { name: nameOf(e.toValue) });
    case "LABELS":
      return t("event.labels", { from: e.fromValue ?? none, to: e.toValue ?? none });
    case "TITLE":
      return t("event.title", { from: e.fromValue ?? "", to: e.toValue ?? "" });
    case "DUE":
      return t("event.due", { from: v(e.fromValue, dateLabel), to: v(e.toValue, dateLabel) });
    default:
      return "";
  }
}
