import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { HOME_PATH, RETIRED_VIEWS } from "./lib/home";

const nextConfig: NextConfig = {
  // Docker 이미지에 node_modules 전체를 넣지 않기 위해 standalone 으로 빌드한다.
  output: "standalone",

  // 달력으로 합친 옛 화면. 로그인 관문(proxy)보다 먼저 돌고, ?task= 같은 쿼리는 그대로 따라간다.
  // 307(임시) — 308 은 브라우저가 영영 기억해서 나중에 화면을 되살려도 못 돌아온다.
  async redirects() {
    return RETIRED_VIEWS.map((source) => ({ source, destination: HOME_PATH, permanent: false }));
  },

  // 보고서 PDF 렌더러는 글꼴 파일을 fs 로 읽고 wasm 레이아웃 엔진을 품고 있어
  // 번들러가 싸 매면 깨진다. 서버에서 node_modules 그대로 부른다.
  serverExternalPackages: ["@react-pdf/renderer"],

  // standalone 은 import 로 닿는 파일만 담는다. 글꼴은 경로 문자열로만 읽으므로
  // 따로 적어 두지 않으면 운영 이미지에서 빠지고, PDF 의 한글이 전부 네모가 된다.
  outputFileTracingIncludes: {
    "/api/reports/**": ["./assets/fonts/**/*"],
  },
};

// 번역·언어 설정은 i18n/request.ts (URL 에 언어를 넣지 않는다).
export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
