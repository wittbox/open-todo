// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NewGroupPopover, NewListPopover } from "@/components/sidebar/CreatePopover";

/**
 * 사이드바 아래 '새 그룹' · '새 목록' 풍선.
 * 이름이 비면 '만들기' 가 잠기고, 목록은 늘 그룹 안 — 그룹이 없으면 같은 풍선에서 그룹 이름도 받는다.
 */

afterEach(cleanup);

const anchor = { left: 200, right: 300, top: 700, bottom: 744, width: 100, height: 44, x: 200, y: 700 } as DOMRect;
const createBtn = () => screen.getByRole("button", { name: "만들기" }) as HTMLButtonElement;
const GROUPS = [
  { id: "g1", name: "제품 개발" },
  { id: "g2", name: "품질" },
];

describe("새 그룹 풍선", () => {
  it("이름을 써야 '만들기' 가 눌리고, Enter 로 만든다(앞뒤 공백은 뺀다)", () => {
    const onCreate = vi.fn();
    render(<NewGroupPopover anchor={anchor} onCreate={onCreate} onClose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "그룹 이름" });
    expect(document.activeElement).toBe(input);
    expect(createBtn().disabled).toBe(true);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  인허가 " } });
    expect(createBtn().disabled).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(onCreate).toHaveBeenCalledWith("인허가");
  });

  it("Esc · 바깥 누름 · 취소로 닫힌다. 아래 버튼을 누른 것은 바깥으로 치지 않는다(다시 누르면 버튼이 닫는다)", () => {
    const onClose = vi.fn();
    render(
      <>
        <button data-create-anchor="">새 그룹</button>
        <p>바깥</p>
        <NewGroupPopover anchor={anchor} onCreate={() => {}} onClose={onClose} />
      </>,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "새 그룹" }));
    fireEvent.mouseDown(screen.getByRole("textbox", { name: "그룹 이름" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByText("바깥"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("새 목록 풍선", () => {
  it("기본 그룹이 골라져 있고, 내 그룹들 + '새 그룹…' 이 나온다", () => {
    const onCreate = vi.fn();
    render(<NewListPopover anchor={anchor} groups={GROUPS} defaultGroupId="g2" onCreate={onCreate} onClose={() => {}} />);
    const select = screen.getByRole("combobox", { name: "들어갈 그룹" }) as HTMLSelectElement;
    expect(select.value).toBe("g2");
    expect([...select.options].map((o) => o.textContent)).toEqual(["제품 개발", "품질", "＋ 새 그룹…"]);
    expect(screen.queryByRole("textbox", { name: "새 그룹 이름" })).toBeNull();

    const name = screen.getByRole("textbox", { name: "목록 이름" });
    expect(createBtn().disabled).toBe(true);
    fireEvent.change(name, { target: { value: "심사 준비" } });
    fireEvent.submit(name.closest("form")!);
    expect(onCreate).toHaveBeenCalledWith("심사 준비", { groupId: "g2" });
  });

  it("'새 그룹…' 을 고르면 그룹 이름 칸이 열리고, 둘 다 써야 만든다", () => {
    const onCreate = vi.fn();
    render(<NewListPopover anchor={anchor} groups={GROUPS} defaultGroupId="g1" onCreate={onCreate} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "목록 이름" }), { target: { value: "주간 회의" } });
    fireEvent.change(screen.getByRole("combobox", { name: "들어갈 그룹" }), { target: { value: "__new__" } });
    const groupName = screen.getByRole("textbox", { name: "새 그룹 이름" });
    expect(createBtn().disabled).toBe(true);
    fireEvent.change(groupName, { target: { value: "회의" } });
    fireEvent.submit(groupName.closest("form")!);
    expect(onCreate).toHaveBeenCalledWith("주간 회의", { newGroupName: "회의" });
  });

  it("그룹이 하나도 없으면 고를 것 대신 그룹 이름 칸 — 한 번에 그룹과 목록을 만든다", () => {
    const onCreate = vi.fn();
    render(<NewListPopover anchor={anchor} groups={[]} defaultGroupId={null} onCreate={onCreate} onClose={() => {}} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/아직 그룹이 없어 같이 만듭니다/)).toBeTruthy();
    // 목록 이름 칸이 먼저 커서를 받는다
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "목록 이름" }));

    fireEvent.change(screen.getByRole("textbox", { name: "목록 이름" }), { target: { value: "할 일" } });
    expect(createBtn().disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "새 그룹 이름" }), { target: { value: "개인" } });
    fireEvent.click(createBtn());
    expect(onCreate).toHaveBeenCalledWith("할 일", { newGroupName: "개인" });
  });
});
