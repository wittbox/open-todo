/**
 * 앱의 첫 화면. 주소 없이 들어오거나, 로그인 뒤 돌아갈 곳이 없거나, 이상한 돌아갈 곳을 받았을 때 간다.
 *
 * 2026-09-16 에 '오늘 할 일 · 중요 · 계획된 일정' 을 달력으로 합치면서 /today 에서 바꿨다.
 * 서버(라우트·리다이렉트)와 브라우저(세션 만료 처리)가 함께 쓰므로 아무것도 import 하지 않는다.
 */
export const HOME_PATH = "/calendar";

/** 합쳐져 없어진 화면들. next.config 가 첫 화면으로 넘긴다 — 즐겨찾기·메일 속 옛 주소가 깨지지 않게. */
export const RETIRED_VIEWS = ["/today", "/important", "/planned"] as const;
