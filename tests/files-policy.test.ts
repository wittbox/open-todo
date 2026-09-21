import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  checkFile,
  cleanFileName,
  extensionOf,
  formatBytes,
  isInlineImage,
  pastedImageName,
} from "@/lib/files/policy";

/**
 * 첨부 규칙.
 *
 * 두 가지가 이 파일의 이유다.
 *  1. 받아서 두 번 누르면 도는 것을 서로 주고받게 두지 않는다
 *  2. 브라우저가 우리 주소에서 남의 파일을 페이지로 실행하지 못하게 한다
 */

describe("확장자", () => {
  it("마지막 것을 본다 — 여러 겹으로 감춰도 실행되는 것은 마지막이다", () => {
    expect(extensionOf("보고서.pdf")).toBe("pdf");
    expect(extensionOf("사진.png.exe")).toBe("exe");
    expect(extensionOf("이름없음")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("경로가 섞여 있어도 파일 이름만 본다", () => {
    expect(extensionOf("C:\\Users\\me\\a.txt")).toBe("txt");
    expect(extensionOf("../../etc/passwd")).toBe("");
  });
});

describe("이름 다듬기", () => {
  it("경로를 떼고 마지막 조각만 남긴다", () => {
    expect(cleanFileName("C:\\temp\\보고서.xlsx")).toBe("보고서.xlsx");
    expect(cleanFileName("../../../etc/passwd")).toBe("passwd");
  });

  it("헤더를 망가뜨리는 문자를 걷어낸다", () => {
    expect(cleanFileName('a"b\r\nc.txt')).toBe("abc.txt");
  });

  it("빈 이름은 대체한다 — 기본값은 어느 말에서도 읽히는 file", () => {
    expect(cleanFileName("")).toBe("file");
    expect(cleanFileName("   ")).toBe("file");
    expect(cleanFileName("", "파일")).toBe("파일");
  });
});

describe("받을지 말지", () => {
  it("보통 파일은 받는다", () => {
    for (const n of ["보고서.pdf", "사진.png", "자료.xlsx", "설계.dwg", "묶음.zip"]) {
      expect(checkFile(n, 1000).ok, n).toBe(true);
    }
  });

  it("실행 파일은 막고, 거절은 번역 열쇠로 돌려준다", () => {
    for (const n of ["setup.exe", "a.bat", "b.ps1", "c.vbs", "d.jar", "e.sh", "f.cmd", "g.js"]) {
      const r = checkFile(n, 1000);
      expect(r.ok, n).toBe(false);
      expect(!r.ok && r.key, n).toBe("files.errors.executable");
    }
  });

  it("대문자 확장자도 막는다", () => {
    expect(checkFile("SETUP.EXE", 1000).ok).toBe(false);
  });

  it("이름을 겹쳐 감춰도 막는다", () => {
    expect(checkFile("보고서.pdf.exe", 1000).ok).toBe(false);
  });

  it("크기 한도를 지킨다", () => {
    expect(checkFile("a.pdf", MAX_FILE_BYTES).ok).toBe(true);
    const tooBig = checkFile("a.pdf", MAX_FILE_BYTES + 1);
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.key).toBe("files.errors.tooLarge");
    expect(!tooBig.ok && tooBig.values).toEqual({ mb: 25 });
    const empty = checkFile("a.pdf", 0);
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.key).toBe("files.errors.empty");
  });

  it("통과하면 다듬은 이름을 돌려준다", () => {
    const r = checkFile("C:\\tmp\\보 고서.pdf", 10);
    expect(r.ok && r.name).toBe("보 고서.pdf");
  });
});

describe("펼쳐 보여도 되는가", () => {
  it("흔한 그림만 허용한다", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isInlineImage(t), t).toBe(true);
    }
  });

  it("SVG 는 그림처럼 보여도 막는다 — 스크립트를 품을 수 있다", () => {
    expect(isInlineImage("image/svg+xml")).toBe(false);
  });

  it("문서·HTML 은 받게 한다", () => {
    for (const t of ["text/html", "application/pdf", "application/octet-stream", ""]) {
      expect(isInlineImage(t), t).toBe(false);
    }
  });
});

describe("보조", () => {
  it("크기를 사람이 읽는 단위로", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("붙여넣은 이미지에 시각으로 이름을 만든다 — 앞말은 부르는 쪽이 번역해 넘긴다", () => {
    const at = new Date(2026, 7, 11, 12, 30, 5);
    expect(pastedImageName(at, "image/png", "붙여넣은 이미지")).toBe("붙여넣은 이미지 8-11 12-30-05.png");
    expect(pastedImageName(at, "image/png")).toBe("Pasted image 8-11 12-30-05.png");
    expect(pastedImageName(at, "image/jpeg")).toMatch(/\.jpeg$/);
  });
});
