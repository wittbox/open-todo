import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { AuthScreen, AuthTitle } from "@/components/auth/ui";
import { ForgotForm } from "@/components/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgot");
  return { title: await pageTitle(t("title")) };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthScreen>
      <AuthTitle lead={t("body")}>{t("title")}</AuthTitle>
      <ForgotForm />
    </AuthScreen>
  );
}
