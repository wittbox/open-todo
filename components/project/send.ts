import { postMessage } from "@/lib/actions/message";
import { runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import type { MessageItem } from "@/lib/queries/project";
import type { Translate } from "@/lib/projects/format";

/**
 * 메시지 보내기. 파일이 없으면 서버 액션, 있으면 multipart 라우트.
 * 어느 길이든 같은 ActionResult 로 돌려줘 화면이 한 가지로 다룬다 —
 * 401 은 unauthenticated 로 옮겨 세션 만료 처리(handledAuthFailure)가 그대로 먹는다.
 *
 * 훅을 쓸 수 없는 모듈이라 부르는 화면이 `projects` 번역기를 넘겨 준다.
 */
export async function sendMessage(input: {
  projectId: string;
  body: string;
  parentId?: string | null;
  files: File[];
}, t: Translate): Promise<ActionResult<MessageItem>> {
  if (input.files.length === 0) {
    return runAction(() => postMessage(input.projectId, input.body, input.parentId ?? null));
  }

  const fd = new FormData();
  fd.set("body", input.body);
  if (input.parentId) fd.set("parentId", input.parentId);
  for (const f of input.files) fd.append("files", f, f.name);

  let res: Response;
  try {
    res = await fetch(`/api/projects/${input.projectId}/messages`, { method: "POST", body: fd });
  } catch {
    return { ok: false, error: t("send.failed"), code: "unknown" };
  }
  if (res.status === 401) return { ok: false, error: t("send.unauthenticated"), code: "unauthenticated" };
  const data = (await res.json().catch(() => ({}))) as { message?: MessageItem; error?: string };
  if (!res.ok || !data.message) {
    return { ok: false, error: data.error ?? t("send.failedShort"), code: res.status === 403 || res.status === 404 ? "forbidden" : "unknown" };
  }
  return { ok: true, data: data.message };
}
