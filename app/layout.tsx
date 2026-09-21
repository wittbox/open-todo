import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { appName } from "@/lib/brand-server";
import { BrandProvider } from "@/components/brand";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: await appName(), description: t("appDescription") };
}

/**
 * 언어·시간대·번역은 i18n/request.ts 가 정하고, 여기서 브라우저 쪽에 그대로 내려 준다
 * (next-intl 4 의 NextIntlClientProvider 는 서버에서 그리면 설정을 물려받는다).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, name] = await Promise.all([getLocale(), appName()]);
  // 브라우저 확장(한글 뷰어 등)이 <html> 에 속성을 붙여 수화 경고가 나는 것만 끈다 — 이 요소 하나의 속성에만 해당한다.
  return (
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <body className="flex h-full flex-col overflow-hidden bg-white">
        <NextIntlClientProvider>
          <BrandProvider name={name}>{children}</BrandProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
