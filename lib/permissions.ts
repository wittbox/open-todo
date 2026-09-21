import { prisma } from "@/lib/db";
import { ProjectRole, ShareRole, ShareSubjectType } from "@/app/generated/prisma/enums";

/**
 * 권한 계산은 이 파일 하나만 통과하게 한다.
 * 모든 서버 액션 / 라우트 핸들러는 데이터를 만지기 전에 assertCan()을 부른다.
 *
 * 규칙
 *  - 소유자는 항상 ADMIN
 *  - 목록의 유효 권한 = max(소유자 여부, 소속 그룹 공유 권한, 목록 자체 공유 권한)
 *  - 권한이 전혀 없으면 null (= 존재조차 알려주지 않는다)
 */

export type Role = ShareRole;

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
};

/** read: 조회 · write: 작업/세부단계 편집 · manage: 이름변경·삭제·이동·공유 */
export type Action = "read" | "write" | "manage";

const REQUIRED: Record<Action, Role> = {
  read: "VIEWER",
  write: "EDITOR",
  manage: "ADMIN",
};

export class PermissionError extends Error {
  readonly status = 403;
  /** 따로 사유를 적지 않았는지 — 그러면 run() 이 요청한 사람의 언어로 바꾼다. */
  readonly isDefault: boolean;
  constructor(message?: string) {
    super(message ?? "Not found, or no access.");
    this.name = "PermissionError";
    this.isDefault = message === undefined;
  }
}

/* ── 순수 계산부 (DB 없이 테스트 가능) ─────────────────────────── */

export function maxRole(...roles: (Role | null | undefined)[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (!r) continue;
    if (!best || ROLE_RANK[r] > ROLE_RANK[best]) best = r;
  }
  return best;
}

export function resolveEffectiveRole(input: {
  isOwner: boolean;
  groupRole?: Role | null;
  listRole?: Role | null;
}): Role | null {
  if (input.isOwner) return "ADMIN";
  return maxRole(input.groupRole, input.listRole);
}

export function satisfies(role: Role | null, action: Action): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[REQUIRED[action]];
}

/* ── DB 조회부 ─────────────────────────────────────────────────── */

async function shareRoleFor(
  userId: string,
  subjectType: ShareSubjectType,
  subjectId: string,
): Promise<Role | null> {
  const share = await prisma.share.findUnique({
    where: {
      subjectType_subjectId_granteeUserId: {
        subjectType,
        subjectId,
        granteeUserId: userId,
      },
    },
    select: { role: true },
  });
  return share?.role ?? null;
}

export async function getGroupRole(userId: string, groupId: string): Promise<Role | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) return null;
  if (group.ownerId === userId) return "ADMIN";
  return shareRoleFor(userId, "GROUP", groupId);
}

export async function getListRole(userId: string, listId: string): Promise<Role | null> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { ownerId: true, groupId: true },
  });
  if (!list) return null;
  if (list.ownerId === userId) return "ADMIN";

  const [groupRole, listRole] = await Promise.all([
    list.groupId ? shareRoleFor(userId, "GROUP", list.groupId) : Promise.resolve(null),
    shareRoleFor(userId, "LIST", listId),
  ]);

  return resolveEffectiveRole({ isOwner: false, groupRole, listRole });
}

/** 작업은 소속 목록의 권한을 그대로 따른다. */
export async function getTaskRole(userId: string, taskId: string): Promise<Role | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { listId: true },
  });
  if (!task) return null;
  return getListRole(userId, task.listId);
}

/** 프로젝트 역할 → 공용 Role. MEMBER 는 글을 쓸 수 있으니 EDITOR, ADMIN 은 그대로. */
export function projectRoleToRole(role: ProjectRole): Role {
  return role === "ADMIN" ? "ADMIN" : "EDITOR";
}

/**
 * 프로젝트는 멤버만 본다. 공개 프로젝트라도 참여하기 전에는 null —
 * 공개 여부는 디렉터리에 보이느냐와 스스로 참여할 수 있느냐에만 관여한다.
 * 소유자는 언제나 ADMIN 행을 갖지만, 행이 없어도 소유자면 ADMIN 으로 본다(그룹과 같은 방어).
 */
export async function getProjectRole(userId: string, projectId: string): Promise<Role | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) return null;
  if (project.ownerId === userId) return "ADMIN";
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return m ? projectRoleToRole(m.role) : null;
}

export type Target =
  | { kind: "group"; id: string }
  | { kind: "list"; id: string }
  | { kind: "task"; id: string }
  | { kind: "project"; id: string };

export async function getEffectiveRole(userId: string, target: Target): Promise<Role | null> {
  switch (target.kind) {
    case "group":
      return getGroupRole(userId, target.id);
    case "list":
      return getListRole(userId, target.id);
    case "task":
      return getTaskRole(userId, target.id);
    case "project":
      return getProjectRole(userId, target.id);
  }
}

/**
 * 권한이 없으면 던진다. 항목이 없을 때와 권한이 없을 때 메시지를 같게 두는 것은 의도적이다.
 * 구분해서 알려주면 일련번호를 훑어 남의 작업 존재 여부를 알아낼 수 있다.
 */
export async function assertCan(userId: string, action: Action, target: Target): Promise<Role> {
  const role = await getEffectiveRole(userId, target);
  if (!satisfies(role, action)) throw new PermissionError();
  return role as Role;
}
