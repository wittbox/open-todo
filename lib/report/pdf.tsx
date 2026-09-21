import path from "node:path";
import type { ReactNode } from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReportContent, ReportGroup, ReportTask } from "@/lib/report/aggregate";
import { DEFAULT_TZ } from "@/lib/tz";
import { translatorFor } from "@/i18n/server";
import type { AppLocale } from "@/i18n/locales";
import { DEFAULT_APP_NAME } from "@/lib/brand";

/**
 * 주간보고서 PDF. 메일 본문과 같은 내용을 A4 로 굳힌다.
 *
 * 웹 화면(render.tsx)·메일(email.ts)·PDF(여기) 세 렌더러는 마크업을 공유하지 않는다.
 * 그래도 내용이 갈라지지 않는 이유는 입력이 하나이기 때문이다 — 셋 다 발행 스냅샷
 * (ReportContent)만 받는다. 모양만 매체에 맞춘다.
 *
 * 크롬(헤드리스 브라우저)을 쓰지 않는다. 운영 이미지가 alpine 이라 크롬을 넣으면
 * 이미지가 몇 배로 커지고, 이 보고서는 표 몇 개라 순수 JS 레이아웃으로 충분하다.
 */

const ACCENT = "#4f52b2";
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

let fontsReady = false;

/** 한글이 깨지지 않도록 글꼴을 문서에 넣는다. 쓴 글자만 담기므로 파일은 가볍다. */
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Pretendard",
    fonts: [
      { src: path.join(FONT_DIR, "Pretendard-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Pretendard-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 기본 줄바꿈 규칙은 영어용이라 띄어쓰기 없는 한글 덩어리를 한 줄에 밀어 넣는다.
  // 한글이 섞인 낱말은 글자 사이 어디서든 끊을 수 있게 하고, 영어·숫자는 그대로 둔다.
  Font.registerHyphenationCallback((word) =>
    /[ㄱ-힝]/.test(word) ? Array.from(word).flatMap((c) => [c, ""]) : [word], // i18n-ok: 한글 글자 단위 줄바꿈
  );
  fontsReady = true;
}

const s = StyleSheet.create({
  page: {
    fontFamily: "Pretendard",
    fontSize: 10,
    color: "#201f1e",
    // 둘째 쪽부터 위가 종이 끝에 붙지 않게. 첫 쪽의 색 띠는 음수 여백으로 위에 붙인다.
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 48,
  },
  band: { backgroundColor: ACCENT, marginTop: -36, marginHorizontal: -40, paddingHorizontal: 40, paddingVertical: 20, marginBottom: 16 },
  title: { color: "#ffffff", fontSize: 16, fontWeight: 700 },
  meta: { color: "#d6d7f0", fontSize: 9.5, marginTop: 5 },
  summary: { fontSize: 10.5, color: "#444444", lineHeight: 1.6, marginBottom: 6 },
  section: { marginTop: 14 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    borderBottomWidth: 1.5,
    borderBottomColor: ACCENT,
    paddingBottom: 4,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: ACCENT },
  sectionCount: { fontSize: 9, color: "#888888", marginLeft: 6 },
  groupHead: { fontSize: 9, color: "#888888", marginTop: 8, marginBottom: 2 },
  row: { paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#edebe9" },
  line: { flexDirection: "row", alignItems: "flex-start" },
  seq: { width: 38, textAlign: "right", paddingRight: 8, fontFamily: "Courier", fontSize: 9, color: "#2564cf", paddingTop: 1 },
  taskTitle: { flex: 1, fontSize: 10.5 },
  right: { fontSize: 9, color: "#666666", paddingLeft: 8, paddingTop: 1 },
  steps: { marginLeft: 38, fontSize: 9, color: "#666666", marginTop: 2, lineHeight: 1.5 },
  // Pretendard 에는 기울임꼴이 없다. 코멘트는 왼쪽 선과 색으로 구분한다.
  comment: {
    marginLeft: 38,
    marginTop: 3,
    paddingLeft: 6,
    borderLeftWidth: 1.5,
    borderLeftColor: "#c8c6c4",
    fontSize: 9.5,
    color: "#605e5c",
    lineHeight: 1.5,
  },
  empty: { marginTop: 30, textAlign: "center", color: "#888888", fontSize: 10.5 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#dddddd",
    paddingTop: 6,
    fontSize: 8.5,
    color: "#999999",
  },
});

function metaOf(t: ReportTask): string {
  return [t.assignee, t.stepTotal > 0 ? `${t.stepDone}/${t.stepTotal}` : null, t.dueLabel]
    .filter(Boolean)
    .join(" · ");
}

function Row({ t }: { t: ReportTask }) {
  const right = metaOf(t);
  return (
    // 한 줄이 쪽 경계에서 반으로 잘리지 않게 한다.
    <View style={s.row} wrap={false}>
      <View style={s.line}>
        <Text style={s.seq}>#{t.seq}</Text>
        <Text style={s.taskTitle}>{t.title}</Text>
        {right ? <Text style={s.right}>{right}</Text> : null}
      </View>
      {t.steps.length > 0 ? <Text style={s.steps}>- {t.steps.join(" · ")}</Text> : null}
      {t.comment ? <Text style={s.comment}>{t.comment}</Text> : null}
    </View>
  );
}

/**
 * 묶음 하나.
 *
 * 제목이 쪽 끝에 홀로 남지 않도록 제목과 첫 줄을 쪼갤 수 없는 한 덩어리(wrap={false})로
 * 묶는다 — 들어갈 자리가 없으면 덩어리째 다음 쪽으로 넘어간다. 구간의 첫 묶음이면
 * 구간 제목('예정' 등)까지 같은 덩어리에 넣는다.
 *
 * 예전에는 minPresenceAhead(뒤에 이만큼 자리가 있어야 한다)로 막으려 했는데 듣지 않았다.
 * '예정' 제목과 파란 줄만 1쪽 끝에 남고 내용은 2쪽으로 넘어갔다(2026-09-11 신고).
 */
function Group({ g, lead }: { g: ReportGroup; lead?: ReactNode }) {
  const [first, ...rest] = g.tasks;
  return (
    <View>
      <View wrap={false}>
        {lead}
        <Text style={s.groupHead}>{g.owner ? `${g.path} · ${g.owner}` : g.path}</Text>
        {first ? <Row t={first} /> : null}
      </View>
      {rest.map((t) => (
        <Row key={t.id} t={t} />
      ))}
    </View>
  );
}

export type ReportPdfOptions = {
  authorName: string;
  officeName?: string;
  /** 발행 시각. 아래쪽에 찍어 여러 장이 흩어져도 어느 판인지 알 수 있게 한다. */
  issuedAt: Date;
  /** 글을 적을 작성자 언어. 없으면 한국어. */
  locale?: AppLocale;
  /** 발행일을 찍을 작성자 시간대. 없으면 서울. */
  timeZone?: string;
  /** 이 설치의 이름. 없으면 기본 이름. */
  app?: string;
};

function ReportDocument({ content, opts }: { content: ReportContent; opts: ReportPdfOptions }) {
  const t = translatorFor(opts.locale ?? content.locale ?? "ko");
  const sections = content.sections.filter((x) => x.groups.length > 0);
  const issued = opts.issuedAt.toLocaleDateString("sv-SE", { timeZone: opts.timeZone ?? DEFAULT_TZ });
  const app = opts.app ?? DEFAULT_APP_NAME;

  return (
    <Document title={content.title} author={opts.authorName} creator={app} producer={app}>
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <Text style={s.title}>{content.title}</Text>
          <Text style={s.meta}>
            {[content.rangeLabel, opts.authorName, opts.officeName].filter(Boolean).join("  ·  ")}
          </Text>
        </View>

        {content.summary.trim() ? <Text style={s.summary}>{content.summary.trim()}</Text> : null}

        {sections.length === 0 ? <Text style={s.empty}>{t("reports.body.empty")}</Text> : null}

        {sections.map((sec) => {
          const head = (
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>{sec.label}</Text>
              <Text style={s.sectionCount}>{t("reports.body.count", { count: sec.groups.reduce((n, g) => n + g.tasks.length, 0) })}</Text>
            </View>
          );
          return (
            <View key={sec.key} style={s.section}>
              {sec.groups.map((g, i) => (
                <Group key={`${g.owner ?? ""} ${g.path}`} g={g} lead={i === 0 ? head : undefined} />
              ))}
            </View>
          );
        })}

        <View style={s.footer} fixed>
          <Text>{t("reports.mail.issued", { app, date: issued })}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(content: ReportContent, opts: ReportPdfOptions): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportDocument content={content} opts={opts} />);
}

// 파일 이름 규칙은 보내기 창(브라우저)도 써야 해서 따로 둔다.
export { reportPdfFileName } from "@/lib/report/filename";
