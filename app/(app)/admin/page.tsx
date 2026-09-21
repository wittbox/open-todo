import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { isAdmin } from "@/lib/auth/roles";
import { getInstanceOverview, listInvitations, listUsers } from "@/lib/queries/admin";
import { Banner, Card } from "@/components/admin/ui";
import { SignupPolicyForm } from "@/components/admin/SignupPolicyForm";
import { InvitePanel } from "@/components/admin/InvitePanel";
import { UserTable } from "@/components/admin/UserTable";
import { InstallNameForm } from "@/components/admin/InstallNameForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: await pageTitle(t("title")) };
}

/**
 * 관리자 화면 — 가입 정책, 초대 링크(관리자만), 사용자, 설치 상태.
 * 관리자가 아니면 화면이 아예 없는 것으로 본다(권한 있음을 알리지 않는다).
 */
export default async function AdminPage() {
  const meId = await requireUserId();
  if (!(await isAdmin(meId))) notFound();

  const [t, overview, users, invites] = await Promise.all([
    getTranslations("admin"),
    getInstanceOverview(),
    listUsers(),
    listInvitations(),
  ]);

  return (
    <main className="flex-1 overflow-y-auto bg-pane-bg px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      <div className="flex flex-col gap-5">
        <Card title={t("signup.title")}>
          <SignupPolicyForm policy={overview.signupPolicy} domains={overview.allowedDomains} />
        </Card>

        <Card title={t("invites.title")} aside={t("invites.adminOnly")}>
          {!overview.mailConfigured && <Banner tone="warn">{t("instance.mailOffHint")}</Banner>}
          <InvitePanel invites={invites} mailConfigured={overview.mailConfigured} />
        </Card>

        <Card title={t("users.title")} aside={t("instance.peopleCount", { count: overview.userCount, admins: overview.adminCount, disabled: overview.disabledCount })}>
          <UserTable users={users} meId={meId} />
        </Card>

        <Card title={t("instance.title")}>
          <InstallNameForm name={overview.appName} fallback={overview.appNameFallback} />
          <dl className="mt-5 text-[13px]">
            <Row label={t("instance.mail")}>
              {overview.mailConfigured ? <span className="text-[#0b6a0b]">{t("instance.mailOn")}</span> : <span className="text-danger">{t("instance.mailOff")}</span>}
            </Row>
            <Row label={t("instance.defaults")}>
              {overview.defaultLocale} · {overview.timeZone}
            </Row>
            <Row label={t("instance.holidays")}>
              {overview.holidayRegion === "none" ? t("instance.holidaysNone") : t("instance.holidaysKr")}
            </Row>
          </dl>
          <p className="mt-3 text-[11.5px] text-ink-3">{t("instance.envNote")}</p>
        </Card>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0">
      <dt className="w-[180px] shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
