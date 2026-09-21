import { prisma } from "@/lib/db";

/**
 * 프로젝트 시험이 쓰는 공용 픽스처.
 *
 * 소유자·관리자·멤버·외부인, 공개·비공개·보관 프로젝트 하나씩. 접두사로 자기 것만 만들고,
 * 끝나면 사용자를 지운다 — 프로젝트는 소유자에, 나머지는 프로젝트에 cascade 로 딸려 사라진다.
 */
export type ProjectFixture = Awaited<ReturnType<typeof createProjectFixture>>;

export async function createProjectFixture(tag: string) {
  const p = `${tag}-${process.pid}-${Date.now()}`;
  const user = (key: string, name: string) =>
    prisma.user.create({ data: { email: `${key}-${p}@x.test`, name } });

  const owner = await user("own", "소유자");
  const admin = await user("adm", "관리자");
  const member = await user("mem", "멤버");
  const stranger = await user("str", "외부인");

  const make = (name: string, isPublic: boolean, archived = false) =>
    prisma.project.create({
      data: {
        name: `${name}-${p}`, purpose: "시험용", isPublic, ownerId: owner.id,
        archivedAt: archived ? new Date() : null,
        members: {
          create: [
            { userId: owner.id, role: "ADMIN" },
            { userId: admin.id, role: "ADMIN" },
            { userId: member.id, role: "MEMBER" },
          ],
        },
      },
    });

  const pub = await make("공개", true);
  const priv = await make("비공개", false);
  const archived = await make("보관", true, true);

  return { p, owner, admin, member, stranger, pub, priv, archived };
}

export async function destroyProjectFixture(f: ProjectFixture) {
  await prisma.user.deleteMany({ where: { id: { in: [f.owner.id, f.admin.id, f.member.id, f.stranger.id] } } });
}
