import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { NotFoundPane } from "@/components/list-view/NotFoundPane";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: await pageTitle(t("notFound.metaTitle")) };
}

/** /t/{seq} 가 실패했을 때 도착하는 곳. 사유는 일부러 구분하지 않는다. */
export default function TaskNotFoundPage() {
  return <NotFoundPane />;
}
