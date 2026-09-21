import { describe, expect, it } from "vitest";
import { maxRole, projectRoleToRole, resolveEffectiveRole, satisfies } from "@/lib/permissions";

/**
 * 권한 계산이 틀리면 남의 할 일이 새는 보안 결함이 된다.
 * DB에 닿지 않는 순수 계산부를 여기서 고정한다.
 */

describe("maxRole", () => {
  it("가장 높은 권한을 고른다", () => {
    expect(maxRole("VIEWER", "EDITOR")).toBe("EDITOR");
    expect(maxRole("ADMIN", "VIEWER")).toBe("ADMIN");
    expect(maxRole("EDITOR", "EDITOR")).toBe("EDITOR");
  });

  it("null / undefined 는 무시한다", () => {
    expect(maxRole(null, "VIEWER", undefined)).toBe("VIEWER");
    expect(maxRole(null, undefined)).toBeNull();
    expect(maxRole()).toBeNull();
  });
});

describe("resolveEffectiveRole", () => {
  it("소유자는 항상 ADMIN", () => {
    expect(resolveEffectiveRole({ isOwner: true })).toBe("ADMIN");
    expect(resolveEffectiveRole({ isOwner: true, groupRole: "VIEWER" })).toBe("ADMIN");
  });

  it("그룹 권한이 하위 목록으로 상속된다", () => {
    expect(resolveEffectiveRole({ isOwner: false, groupRole: "EDITOR" })).toBe("EDITOR");
  });

  it("목록에 직접 준 권한이 그룹 권한보다 높으면 그쪽이 이긴다", () => {
    expect(resolveEffectiveRole({ isOwner: false, groupRole: "VIEWER", listRole: "ADMIN" })).toBe("ADMIN");
  });

  it("그룹 권한이 더 높으면 목록 권한으로 낮아지지 않는다", () => {
    expect(resolveEffectiveRole({ isOwner: false, groupRole: "ADMIN", listRole: "VIEWER" })).toBe("ADMIN");
  });

  it("아무 공유도 없으면 null", () => {
    expect(resolveEffectiveRole({ isOwner: false })).toBeNull();
    expect(resolveEffectiveRole({ isOwner: false, groupRole: null, listRole: null })).toBeNull();
  });
});

describe("projectRoleToRole", () => {
  it("멤버는 글을 쓰니 EDITOR, 관리자는 ADMIN — 프로젝트에 읽기 전용 역할은 없다", () => {
    expect(projectRoleToRole("MEMBER")).toBe("EDITOR");
    expect(projectRoleToRole("ADMIN")).toBe("ADMIN");
  });
});

describe("satisfies", () => {
  it("VIEWER 는 읽기만 된다", () => {
    expect(satisfies("VIEWER", "read")).toBe(true);
    expect(satisfies("VIEWER", "write")).toBe(false);
    expect(satisfies("VIEWER", "manage")).toBe(false);
  });

  it("EDITOR 는 작업 편집까지, 목록 관리는 안 된다", () => {
    expect(satisfies("EDITOR", "read")).toBe(true);
    expect(satisfies("EDITOR", "write")).toBe(true);
    expect(satisfies("EDITOR", "manage")).toBe(false);
  });

  it("ADMIN 은 전부 된다", () => {
    expect(satisfies("ADMIN", "read")).toBe(true);
    expect(satisfies("ADMIN", "write")).toBe(true);
    expect(satisfies("ADMIN", "manage")).toBe(true);
  });

  it("권한 없음(null)은 읽기도 막는다", () => {
    expect(satisfies(null, "read")).toBe(false);
    expect(satisfies(null, "write")).toBe(false);
    expect(satisfies(null, "manage")).toBe(false);
  });
});
