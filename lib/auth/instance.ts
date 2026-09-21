import { prisma } from "@/lib/db";
import type { SignupPolicy } from "@/app/generated/prisma/enums";
import { emailDomain, normalizeEmail } from "@/lib/auth/email";

/**
 * 설치 설정(가입 정책)과 **첫 관리자 창**.
 *
 * 갓 올린 서버에는 아무도 없다. 그 상태에서는 초대해 줄 사람도 없으므로 가입을 한 번 열어 주고,
 * 처음 만들어진 사용자가 관리자가 된다. 그 창은 사용자가 생기는 순간 닫히고 다시 열리지 않는다
 * (`InstanceSettings.setupCompletedAt`). 원자적으로 한 명만 차지한다.
 *
 * 공개 인터넷에 먼저 올려 두고 자리를 비우면 남이 그 창을 쓸 수 있다. `ADMIN_BOOTSTRAP_EMAIL` 을 적어 두면
 * 그 주소만 쓸 수 있고, 관리자가 없는 동안에는 서버 로그에 경고가 찍힌다.
 */
export type InstanceSettingsView = {
  /** 관리자가 지은 이 설치의 이름. 비어 있으면 APP_NAME 환경 변수·기본 이름을 쓴다(lib/brand-server.ts). */
  appName: string | null;
  signupPolicy: SignupPolicy;
  allowedDomains: string[];
  setupCompletedAt: Date | null;
};

const DEFAULTS: InstanceSettingsView = { appName: null, signupPolicy: "INVITE_ONLY", allowedDomains: [], setupCompletedAt: null };

export async function getInstanceSettings(): Promise<InstanceSettingsView> {
  const row = await prisma.instanceSettings.findUnique({
    where: { id: "singleton" },
    select: { appName: true, signupPolicy: true, allowedDomains: true, setupCompletedAt: true },
  });
  return row ?? DEFAULTS;
}

/** `.env` 로 첫 관리자 주소를 못박아 둔 경우 */
export function bootstrapEmail(): string | null {
  return normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
}

/** 아직 아무도 없는 설치인가 — 첫 관리자 창이 열려 있는지 */
export async function firstAdminWindowOpen(settings?: InstanceSettingsView): Promise<boolean> {
  const s = settings ?? (await getInstanceSettings());
  if (s.setupCompletedAt) return false;
  return (await prisma.user.count()) === 0;
}

export type SignupCheck = { ok: true } | { ok: false; reason: "signupClosed" | "domainNotAllowed"; domains: string[] };

const CLOSED: SignupCheck = { ok: false, reason: "signupClosed", domains: [] };

/**
 * 초대 없이 이 이메일로 가입할 수 있는가. 이메일은 **확인된** 것이어야 한다 — 부르는 쪽이 지킨다
 * (이메일·비밀번호 가입은 확인 링크를 누를 때, 제공자 가입은 제공자가 확인해 준 주소일 때만 부른다).
 */
export function checkOpenSignup(settings: InstanceSettingsView, email: string): SignupCheck {
  switch (settings.signupPolicy) {
    case "OPEN":
      return { ok: true };
    case "DOMAIN":
      return settings.allowedDomains.includes(emailDomain(email))
        ? { ok: true }
        : { ok: false, reason: "domainNotAllowed", domains: settings.allowedDomains };
    default:
      return CLOSED;
  }
}

/**
 * 가입 정책 + 첫 관리자 창까지 본 판정. 초대 없이 가입하는 모든 길이 이것을 쓴다.
 */
export async function checkSignup(email: string): Promise<SignupCheck> {
  const settings = await getInstanceSettings();
  if (await firstAdminWindowOpen(settings)) {
    const only = bootstrapEmail();
    return !only || only === email ? { ok: true } : CLOSED;
  }
  return checkOpenSignup(settings, email);
}

/** 로그인 화면에 "계정 만들기" 를 보일지 */
export function signupFormOpen(settings: InstanceSettingsView): boolean {
  return settings.signupPolicy === "OPEN" || (settings.signupPolicy === "DOMAIN" && settings.allowedDomains.length > 0);
}

/** 첫 관리자 창이면 정책과 상관없이 가입 화면을 연다. */
export async function signupScreenOpen(settings?: InstanceSettingsView): Promise<boolean> {
  const s = settings ?? (await getInstanceSettings());
  return (await firstAdminWindowOpen(s)) || signupFormOpen(s);
}
