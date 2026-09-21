import { prisma } from "@/lib/db";
import { maxRole, ROLE_RANK, type Role } from "@/lib/permissions";
import { sortByOrder } from "@/lib/ordering";
import { arrangeShared, type SharedRow, type SharedTree } from "@/lib/shared-tree";
import { listSidebarProjects, type SidebarProject } from "@/lib/queries/project";

/**
 * 사이드바 한 번에 필요한 것 전부.
 * 목록마다 권한을 따로 조회하면 쿼리가 폭발하므로 공유 정보를 한 번만 읽고 메모리에서 합친다.
 */

export type SidebarList = {
  id: string;
  name: string;
  themeKey: string;
  order: string;
  groupId: string | null;
  isInbox: boolean;
  /** 나 말고 다른 사람도 보는 목록인지 (사이드바에 사람 아이콘) */
  isShared: boolean;
  /** 내가 소유자가 아니라 공유받아 보고 있는 목록인지 */
  isReceived: boolean;
  /** 공유받은 목록일 때 — 누가 가진 것인지 */
  ownerName: string | null;
  /** 공유받은 목록일 때 — 원래 어느 그룹에 있는 목록인지 (그룹이 없으면 null) */
  ownerGroupName: string | null;
  role: Role;
  openTaskCount: number;
};

export type SidebarGroup = {
  id: string;
  name: string;
  order: string;
  isCollapsed: boolean;
  isReceived: boolean;
  role: Role;
  lists: SidebarList[];
};

export type SidebarData = {
  user: { id: string; name: string; email: string; avatarColor: string; isAdmin: boolean };
  inboxListId: string | null;
  inboxOpenCount: number;
  /** 나를 담당자로 지정한 미완료 작업 수 */
  assignedCount: number;
  /** 읽지 않은 알림 수 */
  unreadCount: number;
  groups: SidebarGroup[];
  ungrouped: SidebarList[];
  /** 남이 나에게 공유해 준 목록. 내 것과 섞이지 않게 따로 모은다. */
  shared: SidebarList[];
  /** 공유된 목록을 주인의 그룹 아래로 묶은 것. 화면은 이것으로 그린다(lib/shared-tree.ts). */
  sharedTree: SharedTree<SidebarList>;
  /** 내가 멤버인 프로젝트(보관 제외)와 안 읽은 원글 수 */
  projects: SidebarProject[];
};

export async function getSidebarData(userId: string): Promise<SidebarData | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, avatarColor: true, role: true },
  });
  if (!row) return null;
  const { role, ...rest } = row;
  const user = { ...rest, isAdmin: role === "ADMIN" };

  const shares = await prisma.share.findMany({
    where: { granteeUserId: userId },
    select: { subjectType: true, subjectId: true, role: true },
  });
  const sharedGroupRole = new Map<string, Role>();
  const sharedListRole = new Map<string, Role>();
  for (const s of shares) {
    (s.subjectType === "GROUP" ? sharedGroupRole : sharedListRole).set(s.subjectId, s.role);
  }

  const [groups, lists] = await Promise.all([
    prisma.group.findMany({
      where: { OR: [{ ownerId: userId }, { id: { in: [...sharedGroupRole.keys()] } }] },
      select: { id: true, name: true, order: true, isCollapsed: true, ownerId: true },
    }),
    prisma.list.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { id: { in: [...sharedListRole.keys()] } },
          { groupId: { in: [...sharedGroupRole.keys()] } },
        ],
      },
      select: {
        id: true, name: true, themeKey: true, order: true,
        groupId: true, isInbox: true, ownerId: true,
        // 공유받은 목록에 "누가, 어느 그룹에서" 공유했는지 보여주기 위한 것.
        owner: { select: { name: true } },
        group: { select: { name: true, order: true } },
      },
    }),
  ]);

  const listIds = lists.map((l) => l.id);
  const groupIds = groups.map((g) => g.id);

  // 목록별 미완료 개수 + "이 목록에 나 말고 다른 사람도 있는지"를 각각 한 번에
  const [openCounts, assignedCount, unreadCount, otherShares, projects] = await Promise.all([
    prisma.task.groupBy({
      by: ["listId"],
      where: { listId: { in: listIds }, isCompleted: false },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: { listId: { in: listIds }, isCompleted: false, assigneeId: userId },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.share.findMany({
      where: {
        OR: [
          { subjectType: "LIST", subjectId: { in: listIds } },
          { subjectType: "GROUP", subjectId: { in: groupIds } },
        ],
      },
      select: { subjectType: true, subjectId: true },
    }),
    listSidebarProjects(userId),
  ]);

  const countByList = new Map(openCounts.map((c) => [c.listId, c._count._all]));
  const sharedListIds = new Set(otherShares.filter((s) => s.subjectType === "LIST").map((s) => s.subjectId));
  const sharedGroupIds = new Set(otherShares.filter((s) => s.subjectType === "GROUP").map((s) => s.subjectId));

  const groupRole = new Map<string, Role>();
  for (const g of groups) {
    groupRole.set(g.id, g.ownerId === userId ? "ADMIN" : (sharedGroupRole.get(g.id) ?? "VIEWER"));
  }

  function toSidebarList(l: (typeof lists)[number]): SidebarList {
    const isOwner = l.ownerId === userId;
    const role =
      isOwner
        ? ("ADMIN" as Role)
        : (maxRole(l.groupId ? sharedGroupRole.get(l.groupId) : null, sharedListRole.get(l.id)) ?? "VIEWER");
    return {
      id: l.id,
      name: l.name,
      themeKey: l.themeKey,
      order: l.order,
      groupId: l.groupId,
      isInbox: l.isInbox,
      isShared: sharedListIds.has(l.id) || (l.groupId ? sharedGroupIds.has(l.groupId) : false),
      isReceived: !isOwner,
      ownerName: isOwner ? null : l.owner.name,
      ownerGroupName: isOwner ? null : (l.group?.name ?? null),
      role,
      openTaskCount: countByList.get(l.id) ?? 0,
    };
  }

  const inbox = lists.find((l) => l.isInbox && l.ownerId === userId) ?? null;
  const visible = lists.filter((l) => !(l.isInbox && l.ownerId === userId));

  // 내가 소유한 것만 그룹 트리에 넣는다. 남이 공유해 준 것은 따로 모아
  // "공유된 목록"으로 보여준다 — 내 작업공간과 남의 것이 섞이지 않게.
  const visibleGroupIds = new Set(groups.filter((g) => g.ownerId === userId).map((g) => g.id));

  const byGroup = new Map<string, SidebarList[]>();
  const ungrouped: SidebarList[] = [];
  const shared: SidebarList[] = [];
  const sharedRows: SharedRow<SidebarList>[] = [];

  for (const l of visible) {
    const item = toSidebarList(l);

    if (item.isReceived) {
      // 공유받은 목록은 소유자의 그룹 이름을 라벨로만 달고, groupId 는 지운다.
      // 내 사이드바에서 옮길 수 있는 대상이 아니기 때문이다.
      const received = { ...item, groupId: null };
      shared.push(received);
      sharedRows.push({
        item: received,
        order: l.order,
        ownerName: l.owner.name,
        group: l.groupId && l.group ? { id: l.groupId, name: l.group.name, order: l.group.order } : null,
      });
    } else if (l.groupId && visibleGroupIds.has(l.groupId)) {
      const arr = byGroup.get(l.groupId) ?? [];
      arr.push(item);
      byGroup.set(l.groupId, arr);
    } else {
      ungrouped.push({ ...item, groupId: null });
    }
  }

  // 공유받은 그룹은 트리에 통째로 들어오지 않고, 그 안의 목록이 shared 로 간다.
  const ownGroups = groups.filter((g) => g.ownerId === userId);

  const sidebarGroups: SidebarGroup[] = sortByOrder(ownGroups).map((g) => ({
    id: g.id,
    name: g.name,
    order: g.order,
    isCollapsed: g.isCollapsed,
    isReceived: g.ownerId !== userId,
    role: groupRole.get(g.id) ?? "VIEWER",
    lists: sortByOrder(byGroup.get(g.id) ?? []),
  }));

  return {
    user,
    inboxListId: inbox?.id ?? null,
    inboxOpenCount: inbox ? (countByList.get(inbox.id) ?? 0) : 0,
    assignedCount,
    unreadCount,
    groups: sidebarGroups,
    ungrouped: sortByOrder(ungrouped),
    sharedTree: arrangeShared(sharedRows),
    projects,
    shared: shared.sort(
      (a, b) =>
        (a.ownerName ?? "").localeCompare(b.ownerName ?? "", "ko") ||
        a.name.localeCompare(b.name, "ko"),
    ),
  };
}

export function canManage(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.ADMIN;
}
