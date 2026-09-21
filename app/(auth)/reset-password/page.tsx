import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { resetLinkEmail } from "@/lib/auth/flows";
import { AuthScreen, AuthTitle, Notice } from "@/components/auth/ui";
import { ResetForm } from "@/components/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  // 주소에 재설정 토큰이 있다 — Referer 로 새지 않게.
  return { title: await pageTitle(t("title")), referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");
  const email = typeof token === "string" ? await resetLinkEmail(token) : null;

  if (!email || typeof token !== "string") {
    return (
      <AuthScreen>
        <AuthTitle>{t("reset.invalidTitle")}</AuthTitle>
        <Notice tone="error">
          {t("errors.linkInvalid")}{" "}
          <Link href="/forgot-password" className="underline">
            {t("reset.again")}
          </Link>
        </Notice>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthTitle lead={email}>{t("reset.title")}</AuthTitle>
      <ResetForm token={token} email={email} />
    </AuthScreen>
  );
}
