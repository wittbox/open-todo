import { MENTION_RE } from "@/lib/mentions";
import { formatBytes, isInlineImage } from "@/lib/files/policy";
import type { Translate } from "@/lib/projects/format";
import type { IssueDetail } from "@/lib/queries/issues";

/**
 * 이슈 → Claude Code 프롬프트(2026-10-13). 순수 함수 — DB 없이 시험한다.
 *
 * 머리말 + 본문만(댓글·바뀐 기록 없음), 끝에 ‘요청’ 단락을 두지 않는다(지시는 사람이 붙여 넣은 뒤 쓴다).
 * 본문 사진은 24시간 임시 링크로(Claude Code 가 직접 받아 본다). 본문의 ‘## 소제목’ 은 그대로 마크다운 소제목이 되고,
 * 멘션 토큰은 @이름 으로 바꾼다. 머리말 글은 복사하는 사람의 언어(issues 묶음의 t).
 */

export type PromptImage = { name: string; size: number; url: string };

export function buildIssuePrompt(input: {
  issue: Pick<
    IssueDetail,
    "ref" | "title" | "body" | "status" | "priority" | "labelIds" | "dueDate" | "createdAt" | "assignee" | "reporter" | "people" | "attachments"
  >;
  projectName: string;
  labels: { id: string; name: string }[];
  /** 이슈 주소(https://…/i/BUG-3) */
  url: string;
  /** 본문 사진의 임시 링크 — 비어 있으면 사진 칸이 없다 */
  images: PromptImage[];
  /** useTranslations("issues") / translatorFor(locale) 의 issues 묶음 */
  t: Translate;
}): string {
  const { issue, t } = input;
  const names = new Map(issue.people.map((p) => [p.userId, p.name]));
  const labelNames = input.labels.filter((l) => issue.labelIds.includes(l.id)).map((l) => l.name);
  const body = issue.body
    .replace(MENTION_RE, (_t, id: string) => (id === "all" ? `@${t("prompt.everyone")}` : `@${names.get(id) ?? t("pane.unknown")}`))
    .replace(/\r\n/g, "\n")
    .trim();

  const meta = [
    `- ${t("prompt.project")}: ${input.projectName} · ${t("prompt.status")}: ${t(`status.${issue.status}`)} · ${t("prompt.priority")}: ${t(`priority.${issue.priority}`)}` +
      (labelNames.length ? ` · ${t("prompt.labels")}: ${labelNames.join(", ")}` : ""),
    `- ${t("prompt.reporter")}: ${issue.reporter?.name ?? t("pane.unknown")} · ${t("prompt.assignee")}: ${issue.assignee?.name ?? t("prompt.nobody")}` +
      (issue.dueDate ? ` · ${t("prompt.due")}: ${issue.dueDate}` : "") +
      ` · ${t("prompt.opened")}: ${issue.createdAt.slice(0, 10)}`,
    `- ${t("prompt.link")}: ${input.url}`,
  ];

  const out = [`# ${issue.ref} ${issue.title}`, "", ...meta, "", body || t("prompt.noBody")];

  if (input.images.length) {
    out.push("", `## ${t("prompt.photos")}`);
    for (const im of input.images) out.push(`- ${im.name} (${formatBytes(im.size)}): ${im.url}`);
  }
  // 펼쳐 볼 수 있는 그림이 아닌 첨부는 이름만 — 링크를 만들지 않는다
  const others = issue.attachments.filter((a) => !isInlineImage(a.mimeType));
  if (others.length) {
    out.push("", `## ${t("prompt.otherFiles")}`);
    for (const a of others) out.push(`- ${a.name} (${formatBytes(a.size)})`);
  }
  return out.join("\n") + "\n";
}
