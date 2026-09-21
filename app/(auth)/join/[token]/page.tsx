import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { appName } from "@/lib/brand-server";
import { findInvitation } from "@/lib/auth/invitations";
import { enabledProviders } from "@/lib/auth/oauth/config";
import { AuthScreen, AuthTitle, Notice, OrDivider } from "@/components/auth/ui";
import { SignupForm } from "@/components/auth/forms";
import { ProviderButtons } from "@/components/auth/ProviderButtons";

export async function generateMetadata(): Promise<Metadata> {
  const [t, app] = await Promise.all([getTranslations("auth.join"), appName()]);
  // 주소에 초대 토큰이 있다 — 다른 사이트로 넘어갈 때 Referer 로 새지 않게.
  return { title: t("title", { app }), referrer: "no-referrer" };
}

/** 가입 초대 링크. 초대만 모드에서 가입하는 길이다. */
export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const [t, format, invitation, app] = await Promise.all([getTranslations("auth"), getFormatter(), findInvitation(token), appName()]);
  const loginLink = (
    <>
      {t("signup.haveAccount")}{" "}
      <Link href="/login" className="text-link hover:underline">
        {t("signup.loginLink")}
      </Link>
    </>
  );

  if (!invitation) {
    return (
      <AuthScreen below={loginLink}>
        <AuthTitle>{t("join.invalidTitle")}</AuthTitle>
        <Notice tone="error">{t("join.invalidBody")}</Notice>
      </AuthScreen>
    );
  }

  const date = format.dateTime(invitation.expiresAt, { month: "long", day: "numeric" });
  const providers = enabledProviders();
  return (
    <AuthScreen below={loginLink}>
      <AuthTitle
        lead={invitation.inviterName ? t("join.invitedBy", { name: invitation.inviterName, date }) : t("join.validUntil", { date })}
      >
        {t("join.title", { app })}
      </AuthTitle>
      <SignupForm invite={token} lockedEmail={invitation.email} lockedLabel={t("join.lockedEmail")} />
      {providers.length > 0 && (
        <>
          <OrDivider label={t("or")} />
          <ProviderButtons providers={providers} mode="signup" query={{ invite: token }} />
        </>
      )}
    </AuthScreen>
  );
}
