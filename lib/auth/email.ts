/**
 * 이메일 주소 다루기.
 *
 * 저장·비교는 늘 소문자로 한다(DB 에도 CHECK 가 있다). 대소문자만 다른 두 계정이 생기면
 * 로그인·초대·공유가 엉뚱한 사람에게 간다.
 */

const MAX_LENGTH = 254;

/**
 * 앞뒤 공백을 떼고 소문자로. 모양이 이메일이 아니면 null.
 * 완벽한 RFC 검사는 하지 않는다 — 확인 메일이 실제로 닿는지가 진짜 검사다.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/** "kim@example.com" → "example.com" */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** 허용 도메인 목록 한 줄 정리 — "@Example.com " → "example.com". 모양이 틀리면 null. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}
