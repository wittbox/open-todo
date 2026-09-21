import Link from "next/link";
import { redirect } from "next/navigation";
import { HOME_PATH } from "@/lib/home";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { acceptInvite } from "@/lib/actions/share";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("share.invite");
  return { title: await pageTitle(t("navTitle")) };
}

/**
 * 초대 링크 도착 지점. 로그인은 proxy.ts 가 강제하므로 여기서는 수락만 다룬다.
 * 수락은 부작용이 있으므로 자동으로 하지 않고 버튼을 눌러야 진행된다.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const t = await getTranslations("share");
  const { token } = await params;
  await requireUserId();

  const invite = await prisma.shareInvite.findUnique({
    where: { token },
    select: {
      subjectType: true,
      subjectId: true,
      role: true,
      expiresAt: true,
      createdBy: { select: { name: true } },
    },
  });

  const valid = invite != null && invite.expiresAt > new Date();

  const name = !valid
    ? null
    : invite.subjectType === "GROUP"
      ? (await prisma.group.findUnique({ where: { id: invite.subjectId }, select: { name: true } }))?.name
      : (await prisma.list.findUnique({ where: { id: invite.subjectId }, select: { name: true } }))?.name;

  async function accept() {
    "use server";
    const res = await acceptInvite(token);
    if (!res.ok) return;
    redirect(res.data.listId ? `/list/${res.data.listId}` : HOME_PATH);
  }



  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-pane-bg px-4 md:px-8">
      <div className="w-full max-w-md rounded-lg border border-side-border bg-white p-6 text-center md:p-8">
        {!valid || !name ? (
          <>
            <h1 className="text-lg font-semibold">{t("invite.invalidTitle")}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {t("invite.invalidBody")}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">
              {t("invite.heading", { subject: t(`subject.${invite.subjectType}`) })}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              {t.rich(invite.subjectType === "GROUP" ? "invite.bodyGroup" : "invite.bodyList", {
                inviter: invite.createdBy.name,
                name,
                role: t(`roles.${invite.role}`),
                b: (chunks: React.ReactNode) => <b className="text-ink">{chunks}</b>,
              })}
            </p>
            <form action={accept} className="mt-6">
              <button className="h-9 w-full rounded bg-link text-sm font-medium text-white hover:brightness-95">
                {t("invite.join")}
              </button>
            </form>
          </>
        )}

        <Link href={HOME_PATH} className="mt-4 inline-block text-sm text-link hover:underline">
          {t("invite.toCalendar")}
        </Link>
      </div>
    </section>
  );
}
