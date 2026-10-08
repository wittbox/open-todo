import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { getProjectView, getThread } from "@/lib/queries/project";
import { ProjectView } from "@/components/project/ProjectView";
import { ThreadPane } from "@/components/project/ThreadPane";
import { JoinPane } from "@/components/project/JoinPane";
import { NotFoundPane } from "@/components/list-view/NotFoundPane";
import { IssuesView } from "@/components/issues/IssuesView";
import { IssuePane } from "@/components/issues/IssuePane";
import { getIssueDetail, issueStamp, listIssues } from "@/lib/queries/issues";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: await pageTitle(t("title")) };
}

/**
 * 프로젝트 대화 화면.
 * 멤버가 아니면: 공개·미보관이면 참여 안내, 아니면 없는 주소와 같은 화면(비공개는 존재도 안 보인다).
 * `?thread=` 는 오른쪽에 스레드 창. `?msg=` 는 이 프로젝트의 메시지일 때만 듣고, 답글이면 원글의 스레드로 보낸다.
 * `?tab=issues` 는 이슈 목록(이슈를 켠 프로젝트만), `&issue=23` 은 오른쪽에 그 이슈.
 */
export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();

  const view = await getProjectView(userId, id);
  if (!view) return <NotFoundPane />;
  if (view.kind === "joinable") return <JoinPane project={view} />;

  if (q.tab === "issues" && view.issues.enabled) {
    const n = typeof q.issue === "string" && /^\d{1,9}$/.test(q.issue) ? Number(q.issue) : null;
    // 표시를 목록보다 먼저 잰다 — 그 사이에 바뀐 것은 다음 확인에서 잡힌다(놓치지 않는 쪽으로).
    const stamp = await issueStamp(id);
    const [issues, detail] = await Promise.all([listIssues(userId, id), n ? getIssueDetail(userId, id, n) : null]);
    return (
      <>
        <IssuesView key={view.id} project={view} issues={issues ?? []} selected={detail ? detail.number : null} meId={userId} stamp={stamp} />
        {detail && (
          <IssuePane
            key={detail.id}
            issue={detail}
            issueKey={view.issues.key}
            labels={view.issues.labels}
            members={view.members}
            meId={userId}
            isAdmin={view.myRole === "ADMIN"}
            readOnly={view.archivedAt != null}
          />
        )}
      </>
    );
  }

  const msgId = typeof q.msg === "string" ? q.msg : null;
  const threadId = typeof q.thread === "string" ? q.thread : null;
  if (msgId && !threadId) {
    const m = await prisma.message.findFirst({ where: { id: msgId, projectId: id }, select: { parentId: true } });
    if (m?.parentId) redirect(`/projects/${id}?thread=${m.parentId}&msg=${msgId}`);
  }

  // 다른 프로젝트의 메시지 id 가 들어오면 무시한다(getThread 가 null).
  const thread = threadId ? await getThread(userId, id, threadId) : null;
  const meName = view.members.find((m) => m.isMe)?.name;

  return (
    <>
      <ProjectView key={view.id} initial={view} meId={userId} />
      {thread && (
        <ThreadPane
          key={thread.parent.id}
          projectId={view.id}
          parent={thread.parent}
          replies={thread.replies}
          members={view.members.filter((m) => !m.isMe)}
          meId={userId}
          meName={meName}
          issueKey={view.issues.enabled ? view.issues.key : null}
          readOnly={view.archivedAt != null}
        />
      )}
    </>
  );
}
