import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/lib/session-token";

/**
 * 첨부 사진의 임시 공개 링크(2026-10-13).
 *
 * 이슈를 Claude Code 용으로 복사할 때 본문 사진을 Claude Code 가 직접 받아 보게 하려는 것.
 * 로그인 없이 열리는 대신: 그 파일 하나만, 정해진 시각까지만(24시간), 서명이 맞을 때만.
 * DB 에 아무것도 남기지 않는다 — 열쇠는 SESSION_SECRET 에서 갈라 낸 HMAC 이라 서버 비밀값을 바꾸면 모두 무효가 된다.
 * 되돌릴 수는 없다(만료를 기다리거나 파일을 지운다).
 */

export const FILE_LINK_TTL_SEC = 24 * 60 * 60;

function sign(fileId: string, exp: number): string {
  // 세션 서명과 섞이지 않게 용도 이름을 앞에 둔다
  return createHmac("sha256", sessionSecret()).update(`file-link:v1:${fileId}:${exp}`).digest("base64url");
}

/** `/api/shared-file/<id>?e=<만료 초>&s=<서명>` — 앞에 주소(origin)를 붙여 쓴다 */
export function sharedFilePath(fileId: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = nowSec + FILE_LINK_TTL_SEC;
  return `/api/shared-file/${encodeURIComponent(fileId)}?e=${exp}&s=${sign(fileId, exp)}`;
}

/** 서명이 맞고 아직 만료 전인가 */
export function verifyFileLink(fileId: string, expRaw: string | null, sig: string | null, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!expRaw || !sig || !/^\d{1,12}$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (exp < nowSec || exp > nowSec + FILE_LINK_TTL_SEC + 60) return false;
  const want = Buffer.from(sign(fileId, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
