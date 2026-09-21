import { requireUserId } from "@/lib/session";
import { getListView, getTaskDetail } from "@/lib/queries/list";
import { ListView } from "@/components/list-view/ListView";
import { DetailPane } from "@/components/detail-pane/DetailPane";
import { NotFoundPane } from "@/components/list-view/NotFoundPane";

export default async function ListPage({ params, searchParams }: PageProps<"/list/[listId]">) {
  const { listId } = await params;
  const q = await searchParams;
  const userId = await requireUserId();

  // 없는 목록과 권한 없는 목록은 같은 화면으로 처리한다.
  const view = await getListView(userId, listId);
  if (!view) return <NotFoundPane />;

  const selectedId = typeof q.task === "string" ? q.task : null;
  // 다른 목록의 작업 id가 들어오면 무시한다.
  const detail = selectedId ? await getTaskDetail(userId, selectedId) : null;
  const showDetail = detail && detail.listId === listId ? detail : null;

  return (
    <>
      <ListView view={view} />
      {showDetail && <DetailPane key={showDetail.id} task={showDetail} canWrite={view.canWrite} />}
    </>
  );
}
