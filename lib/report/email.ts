import type { ReportContent } from "@/lib/report/aggregate";
import { translatorFor } from "@/i18n/server";
import { DEFAULT_APP_NAME } from "@/lib/brand";

/**
 * 메일 본문. preview/email.html 과 같은 규칙을 지킨다.
 *   - table 레이아웃 + 전부 인라인 스타일 (외부 CSS·웹폰트·flex·grid 금지)
 *   - 배경색과 글자색을 명시해 다크 모드에서 반전되지 않게
 *   - 폭 600px 고정
 * 웹 렌더러와 같은 ReportContent 를 입력으로 받으므로 내용이 갈라지지 않는다.
 *
 * 링크는 넣지 않는다. 메일은 전달되고 인쇄되고 오래 남는데, 그 안의 주소는
 * 받은 사람이 통제할 수 없는 곳까지 따라간다. 작업 번호(#1042)는 회의에서
 * 지칭하는 용도로 평문으로만 남긴다.
 */

const ACCENT = "#4f52b2";
// 글꼴 이름은 번역 대상이 아니다. 한국어 윈도우의 메일 클라이언트가 이 이름으로 찾는다. i18n-ok: font name
const FONT = "'Malgun Gothic','맑은 고딕',Arial,sans-serif"; // i18n-ok: 글꼴 이름

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderReportEmailHtml(
  content: ReportContent,
  opts: { authorName: string; officeName?: string; app?: string },
): string {
  const app = opts.app ?? DEFAULT_APP_NAME;
  // 보고서 메일은 발행본의 언어로 나간다(작성자 언어).
  const t = translatorFor(content.locale ?? "ko");
  const sections = content.sections
    .filter((s) => s.groups.length > 0)
    .map((s) => {
      const rows = s.groups
        .map((g) => {
          const heading = g.owner ? `${g.path} · ${g.owner}` : g.path;
          const head = `<tr><td colspan="3" style="padding:12px 0 4px; font-size:12px; color:#888888;">${esc(heading)}</td></tr>`;
          const items = g.tasks
            .map((t) => {
              const meta = [t.assignee, t.stepTotal > 0 ? `${t.stepDone}/${t.stepTotal}` : null, t.dueLabel]
                .filter(Boolean)
                .join(" · ");
              const extra = [
                t.steps.length > 0 ? `└ ${esc(t.steps.join(" · "))}` : null,
                t.comment ? esc(t.comment) : null,
              ].filter(Boolean);

              return (
                `<tr>` +
                // 번호는 오른쪽에 붙여 제목 시작을 줄마다 맞춘다. align 속성이라 오래된
                // 메일 클라이언트에서도 통한다.
                `<td width="44" align="right" valign="top" style="padding:6px 8px 6px 0; font-size:13px; color:#666666; font-family:Consolas,monospace; white-space:nowrap;">#${t.seq}</td>` +
                `<td valign="top" style="padding:6px 0; font-size:13px; color:#201f1e;">${esc(t.title)}</td>` +
                `<td width="120" align="right" valign="top" style="padding:6px 0; font-size:12px; color:#666666; white-space:nowrap;">${esc(meta)}</td>` +
                `</tr>` +
                extra
                  .map(
                    (line) =>
                      `<tr><td></td><td colspan="2" style="padding:0 0 6px; font-size:12px; color:#888888;">${line}</td></tr>`,
                  )
                  .join("")
              );
            })
            .join("");
          return head + items;
        })
        .join("");

      return (
        `<tr><td style="padding:18px 28px 0;">` +
        `<div style="font-size:14px; font-weight:bold; color:${ACCENT}; border-bottom:2px solid ${ACCENT}; padding-bottom:6px;">${esc(s.label)}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};">${rows}</table>` +
        `</td></tr>`
      );
    })
    .join("");

  const summary = content.summary.trim()
    ? `<tr><td style="padding:22px 28px 8px;"><div style="font-size:13px; color:#444444; line-height:1.8;">${esc(
        content.summary,
      ).replace(/\n/g, "<br>")}</div></td></tr>`
    : "";


  return `<!DOCTYPE html>
<html lang="${content.locale ?? "ko"}"><head><meta charset="utf-8"><title>${esc(content.title)}</title></head>
<body style="margin:0; padding:0; background-color:#f3f2f1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f2f1;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border:1px solid #dddddd; font-family:${FONT};">
  <tr><td style="background-color:${ACCENT}; padding:20px 28px;">
    <div style="color:#ffffff; font-size:19px; font-weight:bold; line-height:1.3;">${esc(content.title)}</div>
    <div style="color:#d6d7f0; font-size:13px; padding-top:6px;">${esc(content.rangeLabel)} &nbsp;·&nbsp; ${esc(
      opts.authorName,
    )}${opts.officeName ? ` &nbsp;·&nbsp; ${esc(opts.officeName)}` : ""}</div>
  </td></tr>
  ${summary}
  ${sections}
  <tr><td style="padding:26px 28px 24px;">
    <div style="padding-top:16px; border-top:1px solid #eeeeee; font-size:12px; color:#888888; line-height:1.8;">
      ${esc(t("reports.mail.footerNote", { app }))}
    </div>
  </td></tr>
</table>
<div style="width:600px; max-width:600px; padding-top:12px; font-size:11px; color:#888888; font-family:${FONT}; text-align:center;">
  ${esc(t("reports.mail.sentBy", { name: opts.authorName, app }))}
</div>
</td></tr>
</table>
</body></html>`;
}

/** 메일 클라이언트가 HTML 을 못 읽을 때 쓰는 대체 본문 */
export function renderReportText(content: ReportContent): string {
  const lines: string[] = [content.title, content.rangeLabel, ""];
  if (content.summary.trim()) lines.push(content.summary.trim(), "");

  for (const s of content.sections) {
    if (s.groups.length === 0) continue;
    lines.push(`■ ${s.label}`);
    for (const g of s.groups) {
      lines.push(`  ${g.owner ? `${g.path} · ${g.owner}` : g.path}`);
      for (const t of g.tasks) {
        const meta = [t.assignee, t.stepTotal > 0 ? `${t.stepDone}/${t.stepTotal}` : null, t.dueLabel]
          .filter(Boolean)
          .join(" · ");
        lines.push(`    #${t.seq}  ${t.title}${meta ? `  (${meta})` : ""}`);
        if (t.comment) lines.push(`        ${t.comment}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
