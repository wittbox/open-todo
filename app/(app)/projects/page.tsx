import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { listProjectsDirectory, type ProjectCard } from "@/lib/queries/project";
import { joinProject } from "@/lib/actions/project";
import { Icon } from "@/components/icons";
import { NewProjectButton } from "@/components/project/NewProjectButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: await pageTitle(t("title")) };
}

/** 프로젝트 디렉터리 — 내 것, 참여할 수 있는 공개 프로젝트, 보관된 것. */
export default async function ProjectsPage() {
  const userId = await requireUserId();
  const [t, { mine, open, archived }] = await Promise.all([
    getTranslations("projects"),
    listProjectsDirectory(userId),
  ]);

  return (
    <main className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-7 md:py-7">
        <div className="flex items-center gap-3">
          <Icon name="hash" size={22} className="text-ink-2" />
          <h1 className="text-[22px] font-semibold">{t("title")}</h1>
          <span className="flex-1" />
          <NewProjectButton />
        </div>

        <Section title={t("directory.mine", { count: mine.length })}>
          {mine.length === 0 ? (
            <p className="text-sm text-ink-2">{t("directory.mineEmpty")}</p>
          ) : (
            <Cards>{mine.map((p) => <Card key={p.id} p={p} />)}</Cards>
          )}
        </Section>

        <Section title={t("directory.open", { count: open.length })}>
          {open.length === 0 ? (
            <p className="text-sm text-ink-2">{t("directory.openEmpty")}</p>
          ) : (
            <Cards>
              {open.map((p) => (
                <Card key={p.id} p={p} join />
              ))}
            </Cards>
          )}
        </Section>

        {archived.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-[13px] text-ink-2">
              {t("directory.archived", { count: archived.length })}
            </summary>
            <div className="mt-2">
              <Cards>
                {archived.map((p) => (
                  <Card key={p.id} p={p} />
                ))}
              </Cards>
            </div>
          </details>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Cards({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

async function Card({ p, join }: { p: ProjectCard; join?: boolean }) {
  const t = await getTranslations("projects");
  const body = (
    <>
      <div className="flex items-center gap-1.5 font-semibold">
        <Icon name={p.isPublic ? "hash" : "lock"} size={14} className="text-ink-2" />
        <span className="truncate">{p.name}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 flex-1 text-[12.5px] text-ink-2">
        {p.purpose || (p.isPublic ? "" : t("directory.privatePlaceholder"))}
      </p>
      <div className="mt-2 flex items-center text-xs text-ink-3">
        {t("directory.memberCount", { count: p.memberCount })}
        {p.archivedAt && <span className="ml-2">{t("directory.archivedMark")}</span>}
        {p.unread > 0 && <span className="ml-auto rounded-full bg-[#c2185b] px-1.5 text-[11px] font-semibold text-white">{p.unread}</span>}
        {join && (
          <form
            action={async () => {
              "use server";
              const res = await joinProject(p.id);
              if (res.ok) redirect(`/projects/${p.id}`);
            }}
            className="ml-auto"
          >
            <button type="submit" className="h-[26px] rounded border border-link px-2.5 text-[12.5px] text-link hover:bg-[#eff4fc]">
              {t("join.action")}
            </button>
          </form>
        )}
      </div>
    </>
  );
  const cls = `flex min-h-[96px] flex-col rounded-md border border-[#e1dfdd] bg-white px-3.5 py-3 ${p.archivedAt ? "opacity-60" : ""}`;
  return join ? <div className={cls}>{body}</div> : <Link href={`/projects/${p.id}`} className={`${cls} hover:border-link`}>{body}</Link>;
}
