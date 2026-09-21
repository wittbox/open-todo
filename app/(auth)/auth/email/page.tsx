import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { PENDING_COOKIE, readPending } from "@/lib/auth/oauth/tx";
import { findInvitation } from "@/lib/auth/invitations";
import { AuthScreen, AuthTitle, Notice } from "@/components/auth/ui";
import { OAuthEmailForm } from "@/components/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.oauthEmail");
  return { title: await pageTitle(t("title")) };
}

/**
 * 이메일을 확인해 주지 않는 제공자(네이버, 비즈 앱이 아닌 카카오)로 처음 온 사람 — 쓸 이메일을 적는다.
 * 확인 링크를 누르기 전에는 사용자가 생기지 않는다. 다음부터는 제공자 버튼 한 번으로 들어온다.
 */
export default async function OAuthEmailPage() {
  const t = await getTranslations("auth");
  const pending = await readPending((await cookies()).get(PENDING_COOKIE)?.value);

  if (!pending) {
    return (
      <AuthScreen>
        <AuthTitle>{t("oauthEmail.title")}</AuthTitle>
        <Notice tone="error">
          {t("oauthEmail.expired")}{" "}
          <Link href="/login" className="underline">
            {t("login.submit")}
          </Link>
        </Notice>
      </AuthScreen>
    );
  }

  // 주소가 정해진 초대로 왔으면 그 주소로 고정한다.
  const invitation = pending.invite ? await findInvitation(pending.invite) : null;
  return (
    <AuthScreen>
      <AuthTitle lead={t("oauthEmail.lead", { provider: t(`providers.${pending.provider}.name`) })}>{t("oauthEmail.title")}</AuthTitle>
      <OAuthEmailForm
        suggestedEmail={invitation?.email ?? pending.suggestedEmail}
        lockedEmail={Boolean(invitation?.email)}
        name={pending.name}
        lockedLabel={t("join.lockedEmail")}
      />
    </AuthScreen>
  );
}
