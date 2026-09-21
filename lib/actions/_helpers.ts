import { prisma } from "@/lib/db";
import { orderBetween } from "@/lib/ordering";
import { PermissionError } from "@/lib/permissions";
import { UnauthenticatedError } from "@/lib/session";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";

/**
 * 실패 사유.
 *
 * 화면이 문구만으로 판단하지 않도록 코드로 준다. 특히 unauthenticated 는
 * "이 화면은 이미 남의 것이 됐다"는 뜻이라 오류 한 줄이 아니라 로그인으로 보내야 한다 —
 * 2026-09-09 에 세션이 끊긴 채 열려 있던 화면에서 드래그가 조용히 되돌아갔고,
 * 멀쩡한 기능이 고장 난 것으로 신고됐다.
 */
export type ActionFailure = "unauthenticated" | "forbidden" | "unknown";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionFailure; errorKey?: string };

/**
 * 사용자에게 보여 줄 거절. "소유자는 먼저 소유권을 넘겨야 합니다" 같은 규칙 위반이다.
 * 예기치 못한 오류(Error)와 달리 로그에 남기지 않는다.
 *
 * 번역 키로 만들면(`ActionError.key("errors.x", { n })`) run() 이 요청한 사람의 언어로 바꿔 돌려주고
 * `errorKey` 도 함께 준다. 문구로 만든 것은 그대로 나간다(아직 옮기지 않은 곳).
 */
export class ActionError extends Error {
  readonly key?: string;
  readonly values?: Record<string, string | number>;

  constructor(message: string, key?: string, values?: Record<string, string | number>) {
    super(message);
    this.name = "ActionError";
    this.key = key;
    this.values = values;
  }

  static key(key: string, values?: Record<string, string | number>): ActionError {
    return new ActionError(key, key, values);
  }
}

type LooseTranslator = (key: string, values?: Record<string, string | number>) => string;

/** 지금 요청한 사람의 언어로 번역한다. 요청 밖(시험)이면 설치 기본 언어. */
async function requestTranslator(): Promise<LooseTranslator> {
  const { locale } = await getRequestPrefs();
  return translatorFor(locale) as unknown as LooseTranslator;
}

/** 서버 액션의 예외를 클라이언트가 쓰기 좋은 형태로 바꾼다. 예기치 못한 오류는 서버 로그에만 남긴다. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      const t = await requestTranslator();
      return { ok: false, error: t("errors.unauthenticated"), code: "unauthenticated", errorKey: "errors.unauthenticated" };
    }
    if (e instanceof PermissionError) {
      // 기본 문구면 번역하고, 따로 적은 사유("보관된 프로젝트는 읽기 전용입니다" 등)는 그대로 둔다.
      if (e.isDefault) {
        const t = await requestTranslator();
        return { ok: false, error: t("errors.forbidden"), code: "forbidden", errorKey: "errors.forbidden" };
      }
      return { ok: false, error: e.message, code: "forbidden" };
    }
    if (e instanceof ActionError) {
      if (e.key) {
        const t = await requestTranslator();
        return { ok: false, error: t(e.key, e.values), code: "unknown", errorKey: e.key };
      }
      return { ok: false, error: e.message, code: "unknown" };
    }
    console.error("[action]", e);
    const t = await requestTranslator();
    return { ok: false, error: t("errors.generic"), code: "unknown", errorKey: "errors.generic" };
  }
}

export function cleanName(raw: string, fallback: string): string {
  const t = raw.trim().replace(/\s+/g, " ").slice(0, 100);
  return t.length > 0 ? t : fallback;
}

/**
 * 드래그 결과를 순서 문자열로 바꾼다.
 * 클라이언트는 "이 두 항목 사이"만 알려주고 실제 값은 서버가 DB에서 읽어 계산한다.
 */
export async function orderBetweenLists(
  prevId: string | null,
  nextId: string | null,
): Promise<string> {
  const [prev, next] = await Promise.all([
    prevId ? prisma.list.findUnique({ where: { id: prevId }, select: { order: true } }) : null,
    nextId ? prisma.list.findUnique({ where: { id: nextId }, select: { order: true } }) : null,
  ]);
  return orderBetween(prev?.order ?? null, next?.order ?? null);
}

export async function orderBetweenTasks(
  prevId: string | null,
  nextId: string | null,
): Promise<string> {
  const [prev, next] = await Promise.all([
    prevId ? prisma.task.findUnique({ where: { id: prevId }, select: { order: true } }) : null,
    nextId ? prisma.task.findUnique({ where: { id: nextId }, select: { order: true } }) : null,
  ]);
  return orderBetween(prev?.order ?? null, next?.order ?? null);
}

export async function orderBetweenGroups(
  prevId: string | null,
  nextId: string | null,
): Promise<string> {
  const [prev, next] = await Promise.all([
    prevId ? prisma.group.findUnique({ where: { id: prevId }, select: { order: true } }) : null,
    nextId ? prisma.group.findUnique({ where: { id: nextId }, select: { order: true } }) : null,
  ]);
  return orderBetween(prev?.order ?? null, next?.order ?? null);
}

/** 그룹/목록은 Share 에 FK가 없으므로 삭제할 때 직접 정리한다. */
export async function deleteSharesFor(subjectType: "GROUP" | "LIST", subjectId: string) {
  await prisma.share.deleteMany({ where: { subjectType, subjectId } });
  await prisma.shareInvite.deleteMany({ where: { subjectType, subjectId } });
}
