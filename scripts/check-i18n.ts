import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 화면에 보이는 글이 번역 파일 밖에 남아 있는지 본다.
 *
 *   npm run check:i18n
 *
 * 주석은 한국어로 쓴다(코드를 읽는 사람을 위한 것이라 번역하지 않는다). 그래서 주석을 먼저 지우고,
 * 남은 곳(문자열·JSX 글)에 한글이 있으면 알린다. 예외는 아래 ALLOW 에 이유와 함께 적는다.
 */

const ROOTS = ["app", "components", "lib", "i18n", "proxy.ts", "instrumentation.ts", "instrumentation-node.ts"];

const ALLOW = [
  // 번역 파일 자체
  "messages",
  // 만들어진 Prisma 클라이언트
  join("app", "generated"),
  // 언어 이름은 늘 그 언어로 적는다("한국어")
  join("i18n", "locales.ts"),
];

const HANGUL = /[가-힣]/;

/** 글꼴 이름·한글 코드 범위처럼 번역할 수 없는 한글은 줄 끝에 이 표시를 남긴다. */
const OPT_OUT = "i18n-ok";

function sources(path: string): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return /\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => sources(join(path, name)));
}

/** 주석을 지운다(문자열 안의 // 는 남긴다). */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const skipped = code.slice(i, end === -1 ? code.length : end + 2);
      // 줄 번호가 밀리지 않게 줄바꿈만 남긴다.
      out += skipped.replace(/[^\n]/g, " ");
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const cwd = process.cwd();
const found: string[] = [];

for (const root of ROOTS) {
  for (const file of sources(join(cwd, root))) {
    const rel = relative(cwd, file);
    if (ALLOW.some((a) => rel === a || rel.startsWith(a + sep))) continue;
    const source = readFileSync(file, "utf8");
    // 표시는 주석에 남기므로 주석을 지우기 전 줄에서 찾는다.
    const raw = source.split("\n");
    const lines = stripComments(source).split("\n");
    lines.forEach((line, n) => {
      const text = line.trim();
      // 주석 지우기가 정규식 안의 따옴표에 걸려 어긋날 때가 있다 — 한 줄짜리 주석은 여기서 한 번 더 거른다.
      if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return;
      if (raw[n]?.includes(OPT_OUT)) return;
      if (HANGUL.test(line)) found.push(`${rel}:${n + 1}: ${text.slice(0, 120)}`);
    });
  }
}

if (found.length > 0) {
  console.error(`번역 파일 밖에 한글이 ${found.length}곳 남아 있습니다:\n`);
  for (const line of found) console.error("  " + line);
  console.error("\n화면에 보이는 글은 messages/<언어>/ 로 옮기고 useTranslations·getTranslations 로 읽으세요.");
  process.exit(1);
}
console.log("번역 파일 밖 한글 없음");
