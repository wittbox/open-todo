import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { getUserPrefs } from "@/lib/prefs";
import { enabledProviders } from "@/lib/auth/oauth/config";
import { Card } from "@/components/admin/ui";
import { LoginMethods, ProfileForm } from "@/components/settings/SettingsForms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: await pageTitle(t("title")) };
}

/** 내 설정 — 언어·시간대·소속·아침 요약 메일, 비밀번호, 연결된 계정. */
export default async function SettingsPage() {
  const userId = await requireUserId();
  const [t, user, prefs] = await Promise.all([
    getTranslations("settings"),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, department: true, dailyMail: true, passwordHash: true, accounts: { select: { provider: true, email: true } } },
    }),
    getUserPrefs(userId),
  ]);

  // 시간대 목록은 서버에서 한 번 만든다(브라우저마다 다르게 보이지 않게).
  const timeZones = Intl.supportedValuesOf("timeZone");
  if (!timeZones.includes(prefs.timeZone)) timeZones.unshift(prefs.timeZone);

  return (
    <main className="flex-1 overflow-y-auto bg-pane-bg px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      <div className="flex flex-col gap-5">
        <Card title={t("profile.title")}>
          <ProfileForm
            initial={{
              name: user.name,
              department: user.department ?? "",
              locale: prefs.locale,
              timeZone: prefs.timeZone,
              dailyMail: user.dailyMail,
            }}
            timeZones={timeZones}
          />
        </Card>

        <Card title={t("login.title")}>
          <LoginMethods hasPassword={Boolean(user.passwordHash)} linked={user.accounts} available={enabledProviders()} />
        </Card>
      </div>
    </main>
  );
}
