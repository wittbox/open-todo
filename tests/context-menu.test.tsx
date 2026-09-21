// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "@/components/ui/menu";

/**
 * 컨텍스트 메뉴가 자기 항목을 실제로 실행하는지.
 *
 * 이 파일이 없어서 "우클릭 메뉴의 모든 액션이 아무 반응 없음" 버그가 배포까지 갔다.
 * 원인은 바깥 클릭 감지가 document 의 mousedown 을 듣는데 메뉴 항목을 누른
 * mousedown 까지 바깥으로 쳐서 메뉴가 먼저 닫히고, 버튼이 사라진 뒤에 click 이
 * 도착한 것이었다. 그래서 여기서는 click 만 쏘지 않는다 —
 * 브라우저와 같은 mousedown → mouseup → click 순서를 그대로 쏜다.
 */

afterEach(cleanup);

const items = (onSelect: () => void) => [
  { label: "새 목록", icon: "list" as const, onSelect },
  { kind: "separator" as const },
  { label: "그룹 해제", danger: true, onSelect: () => {} },
  { label: "미구현", pending: "2차", onSelect: () => {} },
];

function setup() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<ContextMenu anchor={{ x: 10, y: 10 }} items={items(onSelect)} onClose={onClose} />);
  return { onSelect, onClose };
}

/** 브라우저가 실제로 보내는 순서. */
function realClick(el: Element) {
  fireEvent.mouseDown(el, { bubbles: true });
  fireEvent.mouseUp(el, { bubbles: true });
  fireEvent.click(el, { bubbles: true });
}

/** 바깥 클릭 리스너는 다음 틱에 붙는다(메뉴를 연 클릭이 곧바로 닫지 않도록). */
const listenerAttached = () => new Promise((r) => setTimeout(r, 0));

describe("컨텍스트 메뉴", () => {
  it("항목을 누르면 onSelect 가 불리고 메뉴가 닫힌다", async () => {
    const { onSelect, onClose } = setup();
    await listenerAttached();

    realClick(screen.getByRole("menuitem", { name: "새 목록" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("항목 위의 mousedown 은 메뉴를 닫지 않는다 — 닫히면 click 이 갈 곳이 없다", async () => {
    const { onClose } = setup();
    await listenerAttached();

    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "새 목록" }), { bubbles: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("메뉴 안 빈 곳을 눌러도 닫지 않는다", async () => {
    const { onClose } = setup();
    await listenerAttached();

    fireEvent.mouseDown(document.querySelector('[role="menu"] .h-px')!, { bubbles: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("바깥을 누르면 닫는다", async () => {
    const { onClose, onSelect } = setup();
    await listenerAttached();

    fireEvent.mouseDown(document.body, { bubbles: true });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("메뉴를 연 그 클릭에는 닫히지 않는다", () => {
    const { onClose } = setup();
    // 리스너가 붙기 전(같은 틱)에 도착한 mousedown
    fireEvent.mouseDown(document.body, { bubbles: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc 로 닫는다", async () => {
    const { onClose } = setup();
    await listenerAttached();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("미구현 항목은 눌러도 아무 일이 없다", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        anchor={{ x: 0, y: 0 }}
        items={[{ label: "미구현", pending: "2차", onSelect }]}
        onClose={onClose}
      />,
    );
    await listenerAttached();

    realClick(screen.getByRole("menuitem", { name: /미구현/ }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("서브메뉴를 여는 항목은 메뉴를 닫지 않는다", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        anchor={{ x: 0, y: 0 }}
        items={[{ label: "다음 위치로 이동", submenu: true, onSelect }]}
        onClose={onClose}
      />,
    );
    await listenerAttached();

    realClick(screen.getByRole("menuitem", { name: /다음 위치로 이동/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("언마운트 후에는 document 리스너가 남지 않는다", async () => {
    const { onClose } = setup();
    await listenerAttached();
    cleanup();

    fireEvent.mouseDown(document.body, { bubbles: true });

    expect(onClose).not.toHaveBeenCalled();
  });
});
