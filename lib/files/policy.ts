/**
 * 첨부 파일 규칙. 디스크에 닿지 않는 순수 함수라 테스트로 못박을 수 있다.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_TASK = 20;
/** 프로젝트 메시지 한 건에 붙일 수 있는 파일 수 */
export const MAX_FILES_PER_MESSAGE = 10;

/**
 * 받지 않는 확장자.
 *
 * 형식을 열어 두되 실행되는 것만 막는다. 팀 안에서 쓰는 앱이라도 "받아서 두 번 누르면
 * 도는 것"을 서로 주고받게 두면, 한 사람이 속는 순간 전부에게 퍼진다.
 */
const BLOCKED_EXTENSIONS = new Set([
  "exe", "com", "scr", "pif", "msi", "msp", "cpl", "dll",
  "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta",
  "jar", "sh", "bash", "app", "lnk", "reg", "inf",
]);

/** 거절 사유의 번역 열쇠. 이름 공간까지 담아 부른 쪽이 그대로 번역한다. */
export type FileErrorKey =
  | "files.errors.empty"
  | "files.errors.tooLarge"
  | "files.errors.executable";

/**
 * 검사 결과.
 *
 * 이 파일은 화면과 서버가 함께 쓰는 순수 규칙이라 문구를 만들지 않는다 —
 * 거절은 번역 열쇠와 값으로 돌려주고, 부른 쪽이 자기 자리의 번역기로 문장을 만든다.
 */
export type FileCheck =
  | { ok: true; name: string }
  | { ok: false; key: FileErrorKey; values?: Record<string, string | number> };

/** 확장자 하나만 뽑는다. 여러 겹이면 마지막 것이 실행 여부를 정한다. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

/**
 * 보여 줄 이름을 다듬는다.
 *
 * 경로가 섞여 들어와도 마지막 조각만 쓴다. 디스크 이름은 따로 만들기 때문에
 * 이 값이 경로가 되는 일은 없지만, 화면과 내려받기 헤더에 그대로 나가므로
 * 줄바꿈·따옴표처럼 헤더를 망가뜨리는 문자는 여기서 걷어낸다.
 * (따옴표는 " 로 적는다 — 소스에 그대로 두면 scripts/check-i18n.ts 의 따옴표 세기가 어긋난다.)
 *
 * 이름이 통째로 사라진 파일에 붙일 이름은 부른 쪽이 정한다. 기본값은 어느 언어에서도
 * 읽히는 "file" 이다 — 파일 이름은 화면 문구가 아니라 데이터로 저장된다.
 */
export function cleanFileName(raw: string, fallback = "file"): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\r\n"\0]/g, "").trim();
  return (base || fallback).slice(0, 200);
}

export function checkFile(rawName: string, size: number, fallbackName?: string): FileCheck {
  const name = cleanFileName(rawName, fallbackName);

  if (size <= 0) return { ok: false, key: "files.errors.empty" };
  if (size > MAX_FILE_BYTES) {
    return { ok: false, key: "files.errors.tooLarge", values: { mb: Math.floor(MAX_FILE_BYTES / 1024 / 1024) } };
  }

  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, key: "files.errors.executable", values: { ext } };
  }

  return { ok: true, name };
}

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * 브라우저에 그대로 펼쳐 보여도 되는가.
 *
 * 그림 몇 가지만 허용한다. SVG 는 그림처럼 보이지만 스크립트를 품을 수 있어
 * 뺀다 — 우리 주소에서 남의 파일이 실행되는 통로가 되기 때문이다.
 */
export function isInlineImage(mimeType: string): boolean {
  return INLINE_IMAGE_TYPES.has(mimeType.toLowerCase());
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 클립보드 이미지에는 이름이 없다. 붙여넣은 시각으로 만든다.
 * 앞에 붙는 말은 부른 쪽이 `files.pastedImage` 로 번역해 넘긴다.
 */
export function pastedImageName(at: Date, mimeType: string, label = "Pasted image"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  return `${label} ${at.getMonth() + 1}-${at.getDate()} ${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}.${ext}`;
}
