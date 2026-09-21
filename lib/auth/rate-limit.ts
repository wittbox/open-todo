/**
 * 시도 횟수 제한 — 로그인·가입·비밀번호 재설정·메일 다시 보내기.
 *
 * 설치 하나에 앱 하나라서 메모리에 둔다(서버를 다시 켜면 비워진다). 여러 대로 늘리면
 * 대마다 따로 센다 — 그때는 Redis 같은 공용 저장소가 필요하다(README 보안 메모).
 *
 * 고정 창(window) 방식: 창이 시작된 뒤 windowMs 동안 limit 번까지.
 */

type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as { __rateLimit?: Map<string, Bucket> };
const store = (g.__rateLimit ??= new Map<string, Bucket>());

const MAX_KEYS = 50_000;

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

/** 한 번 센다. 한도를 넘었으면 ok: false 와 다시 해도 되는 때까지 남은 초. */
export function hitRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    if (store.size >= MAX_KEYS) prune(now);
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }
  if (b.count >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  b.count += 1;
  return { ok: true };
}

/** 여러 열쇠를 한꺼번에 — 하나라도 넘었으면 거절. 거절돼도 나머지는 센다(돌아가며 시도하는 것도 막히게). */
export function hitRateLimits(rules: { key: string; limit: number; windowMs: number }[], now = Date.now()): RateResult {
  let worst: RateResult = { ok: true };
  for (const r of rules) {
    const res = hitRateLimit(r.key, r.limit, r.windowMs, now);
    if (!res.ok && (worst.ok || res.retryAfterSec > worst.retryAfterSec)) worst = res;
  }
  return worst;
}

/** 성공한 로그인 뒤 그 이메일의 실패 횟수를 지운다. */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

function prune(now: number) {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
  // 그래도 넘치면(공격 중) 오래된 것부터 버린다 — 메모리를 지키는 쪽을 고른다.
  if (store.size >= MAX_KEYS) {
    const drop = store.size - MAX_KEYS / 2;
    let i = 0;
    for (const k of store.keys()) {
      if (i++ >= drop) break;
      store.delete(k);
    }
  }
}

/** 시험용 */
export function resetRateLimits(): void {
  store.clear();
}

const MIN = 60_000;

/** 한도 모음 — 한곳에서 본다. */
export const LIMITS = {
  loginIp: { limit: 20, windowMs: 15 * MIN },
  loginEmail: { limit: 10, windowMs: 15 * MIN },
  signupIp: { limit: 10, windowMs: 60 * MIN },
  /** 메일을 보내는 요청(확인 메일 다시 보내기·재설정·가입 확인) — 받는 주소마다 */
  mailPerMinute: { limit: 1, windowMs: MIN },
  mailPerHour: { limit: 5, windowMs: 60 * MIN },
  mailIp: { limit: 20, windowMs: 60 * MIN },
} as const;
