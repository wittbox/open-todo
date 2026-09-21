import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HOME_PATH } from "@/lib/home";

/**
 * 없는 항목과 권한 없는 항목에 똑같이 쓰는 화면.
 * 구분해서 알려주면 일련번호나 id를 훑어 남의 데이터 존재 여부를 알아낼 수 있다.
 */
export async function NotFoundPane() {
  const t = await getTranslations("tasks");
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center bg-pane-bg px-8 text-center">
      <h1 className="text-lg font-semibold">{t("notFound.title")}</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-2">{t("notFound.body")}</p>
      <Link
        href={HOME_PATH}
        className="mt-6 rounded border border-side-border bg-white px-4 py-2 text-sm hover:bg-side-hover"
      >
        {t("notFound.home")}
      </Link>
    </section>
  );
}
