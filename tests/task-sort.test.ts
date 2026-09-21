import { describe, expect, it } from "vitest";
import { sortTasks } from "@/lib/task-sort";

const t = (
  title: string,
  order: string,
  extra: { dueDate?: string | null; isImportant?: boolean; createdAt?: string } = {},
) => ({
  title,
  order,
  dueDate: extra.dueDate ?? null,
  isImportant: extra.isImportant ?? false,
  createdAt: extra.createdAt ?? "2026-08-01T00:00:00.000Z",
});

const names = (arr: { title: string }[]) => arr.map((x) => x.title);

describe("sortTasks", () => {
  it("MANUAL 은 order 문자열 순서", () => {
    const list = [t("c", "a2"), t("a", "a0"), t("b", "a1")];
    expect(names(sortTasks(list, "MANUAL"))).toEqual(["a", "b", "c"]);
  });

  it("IMPORTANCE 는 별표를 앞으로, 같으면 수동 순서", () => {
    const list = [t("일반1", "a0"), t("중요1", "a1", { isImportant: true }), t("중요2", "a2", { isImportant: true })];
    expect(names(sortTasks(list, "IMPORTANCE"))).toEqual(["중요1", "중요2", "일반1"]);
  });

  it("DUE_DATE 는 빠른 기한부터, 기한 없는 것은 맨 뒤", () => {
    const list = [t("없음", "a0"), t("나중", "a1", { dueDate: "2026-08-20" }), t("곧", "a2", { dueDate: "2026-08-10" })];
    expect(names(sortTasks(list, "DUE_DATE"))).toEqual(["곧", "나중", "없음"]);
  });

  it("기한이 같으면 수동 순서로 갈라 결과가 흔들리지 않는다", () => {
    const list = [t("두번째", "a1", { dueDate: "2026-08-10" }), t("첫번째", "a0", { dueDate: "2026-08-10" })];
    expect(names(sortTasks(list, "DUE_DATE"))).toEqual(["첫번째", "두번째"]);
  });

  it("ALPHABETICAL 은 한글 자모 순서", () => {
    const list = [t("하늘", "a0"), t("가방", "a1"), t("나무", "a2")];
    expect(names(sortTasks(list, "ALPHABETICAL"))).toEqual(["가방", "나무", "하늘"]);
  });

  it("CREATED_AT 은 최근에 만든 것부터", () => {
    const list = [
      t("오래된", "a0", { createdAt: "2026-08-01T00:00:00.000Z" }),
      t("최근", "a1", { createdAt: "2026-08-09T00:00:00.000Z" }),
    ];
    expect(names(sortTasks(list, "CREATED_AT"))).toEqual(["최근", "오래된"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    const list = [t("b", "a1"), t("a", "a0")];
    sortTasks(list, "MANUAL");
    expect(names(list)).toEqual(["b", "a"]);
  });
});
