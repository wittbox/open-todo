import { prisma } from "@/lib/db";
import { getListRole, maxRole, type Role } from "@/lib/permissions";

/**
 * 어떤 목록을 볼 수 있는 사람들.
 *
 * 담당자를 고를 때와, 담당 지정이 아직 유효한지 확인할 때 같은 규칙을 쓴다.
 * "볼 수 있는 사람" 이 기준이라 읽기 권한자도 들어간다 — 팀장이 확인용으로
 * 담당자로 지정되는 경우가 있다.
 */

export type ListMember = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: Role;
  isOwner: boolean;
};

export async function getListMembers(listId: string): Promise<ListMember[]> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      groupId: true,
      owner: { select: { id: true, name: true, email: true, avatarColor: true } },
    },
  });
  if (!list) return [];

  const shares = await prisma.share.findMany({
    where: {
      OR: [
        { subjectType: "LIST", subjectId: listId },
        ...(list.groupId ? [{ subjectType: "GROUP" as const, subjectId: list.groupId }] : []),
      ],
    },
    select: {
      role: true,
      grantee: { select: { id: true, name: true, email: true, avatarColor: true } },
    },
  });

  // 그룹과 목록으로 두 번 공유된 사람은 한 번만, 높은 권한으로 담는다.
  const byUser = new Map<string, ListMember>();
  byUser.set(list.owner.id, { ...list.owner, role: "ADMIN", isOwner: true });

  for (const s of shares) {
    const prev = byUser.get(s.grantee.id);
    if (prev?.isOwner) continue;
    byUser.set(s.grantee.id, {
      ...s.grantee,
      role: maxRole(prev?.role, s.role) ?? s.role,
      isOwner: false,
    });
  }

  return [...byUser.values()].sort(
    (a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name, "ko"),
  );
}

/** 담당자로 지정할 수 있는 사람인지. 목록을 볼 수 없으면 지정할 수 없다. */
export async function canBeAssigned(userId: string, listId: string): Promise<boolean> {
  return (await getListRole(userId, listId)) !== null;
}
