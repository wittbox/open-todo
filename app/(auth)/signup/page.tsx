import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { firstAdminWindowOpen, getInstanceSettings, signupScreenOpen } from "@/lib/auth/instance";
import { enabledProviders } from "@/lib/auth/oauth/config";
import { AuthScreen, AuthTitle, OrDivider } from "@/components/auth/ui";
import { SignupForm } from "@/components/auth/forms";
import { ProviderButtons } from "@/components/auth/ProviderButtons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: await pageTitle(t("title")) };
}

/** 초대 없이 가입 — 가입 정책이 "누구나" 나 "허용 도메인" 일 때만 열린다. */
export default async function SignupPage() {
  const settings = await getInstanceSettings();
  if (!(await signupScreenOpen(settings))) redirect("/login");
  const t = await getTranslations("auth");
  const providers = enabledProviders();
  const firstAdmin = await firstAdminWindowOpen(settings);
  const domains = !firstAdmin && settings.signupPolicy === "DOMAIN" ? settings.allowedDomains.join(", ") : null;

  return (
    <AuthScreen
      below={
        <>
          {t("signup.haveAccount")}{" "}
          <Link href="/login" className="text-link hover:underline">
            {t("signup.loginLink")}
          </Link>
        </>
      }
    >
      <AuthTitle lead={firstAdmin ? t("notice.firstAdmin") : domains ? t("signup.domainHint", { domains }) : undefined}>
        {t("signup.title")}
      </AuthTitle>
      <SignupForm />
      {providers.length > 0 && (
        <>
          <OrDivider label={t("or")} />
          <ProviderButtons providers={providers} mode="signup" />
        </>
      )}
    </AuthScreen>
  );
}
