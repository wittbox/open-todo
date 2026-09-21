import { getTranslations } from "next-intl/server";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { SLUG } from "@/lib/auth/oauth/config";

/**
 * Google·카카오·네이버 버튼 — 각 제공자 안내서의 색과 로고.
 * 열쇠가 설정된 제공자만 넘어온다. 누르면 /auth/<제공자>/start 로 간다.
 */

const STYLE: Record<AuthProvider, string> = {
  GOOGLE: "border border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f8f8f8]",
  KAKAO: "bg-[#FEE500] text-black/85 hover:brightness-95",
  NAVER: "bg-[#03C75A] text-white hover:brightness-95",
};

export function ProviderLogo({ provider, size = 18 }: { provider: AuthProvider; size?: number }) {
  if (provider === "GOOGLE") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    );
  }
  if (provider === "KAKAO") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path fill="#000" d="M12 3.2C6.6 3.2 2.2 6.6 2.2 10.9c0 2.7 1.8 5.1 4.5 6.5l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1 1 .1 1.4.1 5.4 0 9.8-3.4 9.8-7.8S17.4 3.2 12 3.2z" />
      </svg>
    );
  }
  return (
    <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" aria-hidden>
      <path fill="#fff" d="M15.6 12.6 8.1 2H2v20h6.4V11.4L15.9 22H22V2h-6.4z" />
    </svg>
  );
}

export async function ProviderButtons({
  providers,
  mode,
  query,
}: {
  providers: AuthProvider[];
  mode: "login" | "signup";
  /** start 로 넘길 것(returnTo, invite) */
  query?: Record<string, string | undefined>;
}) {
  if (providers.length === 0) return null;
  const t = await getTranslations("auth.providers");
  const qs = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return (
    <div className="flex flex-col gap-2">
      {providers.map((p) => (
        <a
          key={p}
          href={`/auth/${SLUG[p]}/start${qs ? `?${qs}` : ""}`}
          className={`relative flex h-10 items-center justify-center rounded-md text-[13.5px] font-semibold ${STYLE[p]}`}
        >
          <span className="absolute left-3.5 flex w-[18px] justify-center">
            <ProviderLogo provider={p} />
          </span>
          {t(`${p}.${mode}`)}
        </a>
      ))}
    </div>
  );
}
