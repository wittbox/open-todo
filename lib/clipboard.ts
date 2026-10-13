/**
 * 글 복사(2026-10-13). 먼저 클립보드 API, 막히면 예전 방식(숨긴 입력칸을 골라 execCommand("copy")).
 *
 * 브라우저를 감싼 앱(웹뷰)이나 권한을 막아 둔 환경에서는 navigator.clipboard 가 거절된다. 예전 방식은 그 권한
 * 관문을 타지 않아 그런 곳에서도 된다.
 * 그림은 예전 방식으로 넣을 수 없다 — 글에만 쓴다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyByExecCommand(text);
  }
}

function copyByExecCommand(text: string): boolean {
  const t = document.createElement("textarea");
  t.value = text;
  t.setAttribute("readonly", "");
  t.style.position = "fixed";
  t.style.top = "0";
  t.style.left = "0";
  t.style.opacity = "0";
  const before = document.activeElement as HTMLElement | null;
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  t.remove();
  before?.focus?.();
  return ok;
}
