import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { appName, pageTitle } from "@/lib/brand-server";
import { HOME_PATH } from "@/lib/home";
import { internalPath } from "@/lib/http";
import { firstAdminWindowOpen, getInstanceSettings, signupScreenOpen } from "@/lib/auth/instance";
import { enabledProviders, providerFromSlug } from "@/lib/auth/oauth/config";
import { DEV_SEED_EMAIL, DEV_SEED_PASSWORD } from "@/lib/auth/dev";
import { AuthScreen, AuthTitle, Notice, OrDivider } from "@/components/auth/ui";
import { LoginForm } from "@/components/auth/forms";
import { ProviderButtons } from "@/components/auth/ProviderButtons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: await pageTitle(t("submit")) };
}

/** 로그인 화면 위 안내 띠 — ?notice=… (끊긴 세션, 제공자 로그인 결과) */
const SESSION_NOTICES = ["revoked", "disabled"] as const;
const PROVIDER_NOTICES = ["oauthFailed", "oauthCanceled", "oauthExists", "accountInUse", "alreadyLinked"] as const;
const SIGNUP_NOTICES = ["signupClosed", "domainNotAllowed", "inviteInvalid"] as const;

/**
 * 로그인 — 이메일·비밀번호가 위, 켜 둔 제공자(Google·카카오·네이버) 버튼이 아래.
 * 가입 정책이 초대만이면 "계정 만들기" 대신 초대 링크 안내를 보인다.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const returnTo = internalPath(typeof params.returnTo === "string" ? params.returnTo : HOME_PATH);
  const [t, tc, settings] = await Promise.all([getTranslations("auth"), getTranslations("common"), getInstanceSettings()]);
  const providers = enabledProviders();
  const [signupOpen, firstAdmin] = await Promise.all([signupScreenOpen(settings), firstAdminWindowOpen(settings)]);

  const via = typeof params.provider === "string" ? providerFromSlug(params.provider) : null;
  const providerName = via ? t(`providers.${via}.name`) : "";
  const sessionNotice = SESSION_NOTICES.find((n) => n === params.notice);
  const providerNotice = PROVIDER_NOTICES.find((n) => n === params.notice);
  const signupNotice = SIGNUP_NOTICES.find((n) => n === params.notice);
  const notice = sessionNotice
    ? t(`notice.${sessionNotice}`)
    : providerNotice
      ? t(`notice.${providerNotice}`, { provider: providerName })
      : signupNotice
        ? t(`errors.${signupNotice}`, { domains: settings.allowedDomains.join(", ") })
        : null;

  return (
    <AuthScreen below={signupOpen ? undefined : t("login.inviteOnly")}>
      <AuthTitle lead={tc("appDescription")}>{await appName()}</AuthTitle>
      {firstAdmin && (
        <div className="-mt-1 mb-3">
          <Notice>{t("notice.firstAdmin")}</Notice>
        </div>
      )}
      {notice && (
        <div className="-mt-1 mb-3">
          <Notice tone={providerNotice === "oauthCanceled" ? "info" : "warn"}>{notice}</Notice>
        </div>
      )}
      <LoginForm returnTo={returnTo} signupOpen={signupOpen} />
      {providers.length > 0 && (
        <>
          <OrDivider label={t("or")} />
          <ProviderButtons providers={providers} mode="login" query={{ returnTo: returnTo === HOME_PATH ? undefined : returnTo }} />
        </>
      )}
      {process.env.NODE_ENV === "development" && (
        <p className="mt-4 rounded border border-dashed border-side-border px-3 py-2 text-[11.5px] text-ink-2">
          {t("login.devHint", { email: DEV_SEED_EMAIL, password: DEV_SEED_PASSWORD })}
        </p>
      )}
    </AuthScreen>
  );
}
