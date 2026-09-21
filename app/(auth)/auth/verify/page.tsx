import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { peekToken } from "@/lib/auth/tokens";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { AuthScreen, AuthTitle, Notice } from "@/components/auth/ui";
import { VerifyForm } from "@/components/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.verify");
  return { title: await pageTitle(t("title")), referrer: "no-referrer" };
}

/**
 * 가입 확인 메일의 링크. 열기만 해서는 아무 일도 없고, 버튼을 눌러야 가입이 끝난다 —
 * 메일 보안 검사기가 링크를 미리 열어 보는 것만으로 토큰이 쓰이지 않게.
 */
export default async function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");
  const password = typeof token === "string" ? await peekToken("VERIFY_EMAIL", token) : null;
  const oauth = !password && typeof token === "string" ? await peekToken("OAUTH_SIGNUP", token) : null;
  const pending = password ?? oauth;

  if (!pending || typeof token !== "string") {
    return (
      <AuthScreen>
        <AuthTitle>{t("verify.title")}</AuthTitle>
        <Notice tone="error">{t("errors.linkInvalid")}</Notice>
      </AuthScreen>
    );
  }

  // 제공자 가입이면 어느 제공자 계정이 붙는지 알린다 — 남이 시작한 가입의 링크를 누르지 않게.
  const provider = (oauth?.data as { provider?: AuthProvider } | null)?.provider;
  const lead = provider ? t("verify.bodyOAuth", { provider: t(`providers.${provider}.name`) }) : t("verify.body");
  return (
    <AuthScreen>
      <AuthTitle lead={lead}>{pending.email}</AuthTitle>
      <VerifyForm token={token} kind={oauth ? "oauth" : "password"} />
    </AuthScreen>
  );
}
