import { timingSafeEqual } from "node:crypto";

/**
 * `/api/cron/*` 의 열쇠 확인.
 *
 * `a === b` 는 다른 글자를 만나는 순간 멈춘다 — 응답 시간의 차이로 열쇠를 앞에서부터 한 글자씩
 * 맞혀 갈 수 있다. 길이와 내용 모두 상수 시간으로 비교한다.
 */
export function cronKeyOk(given: string | null | undefined): boolean {
  const expected = process.env.CRON_KEY;
  if (!expected) return false;

  const a = Buffer.from(given ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual 은 길이가 다르면 던진다. 길이가 새지 않게 같은 만큼 일하고 거짓을 돌려준다.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** 열쇠를 정해 두지 않은 설치에서는 cron 주소 자체를 닫는다. */
export function cronConfigured(): boolean {
  return Boolean(process.env.CRON_KEY);
}
