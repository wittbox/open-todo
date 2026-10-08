import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { parseIssueRef } from "@/lib/issues/format";
import { resolveIssueRef } from "@/lib/queries/issues";
import { NotFoundPane } from "@/components/list-view/NotFoundPane";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("issues");
  return { title: await pageTitle(t("list.label")) };
}

/**
 * 이슈 딥링크 — /i/BUG-23. 그 프로젝트의 이슈 탭으로 보낸다.
 * 없는 번호와 볼 수 없는 번호는 같은 화면이다(작업 딥링크 /t/번호 와 같은 규칙).
 */
export default async function IssueLinkPage({ params }: PageProps<"/i/[ref]">) {
  const userId = await requireUserId();
  const { ref } = await params;
  const parsed = parseIssueRef(decodeURIComponent(ref));
  const found = parsed ? await resolveIssueRef(userId, parsed.key, parsed.number) : null;
  if (!found) return <NotFoundPane />;
  redirect(`/projects/${found.projectId}?tab=issues&issue=${found.number}`);
}
