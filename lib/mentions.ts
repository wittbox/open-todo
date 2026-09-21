/**
 * 멘션 토큰 규칙. 순수 함수 — DB 없이 시험한다.
 *
 * 본문에는 `<@userId>` / `<@all>` 토큰이 들어온다. 입력창의 자동완성에서 고른 사람만 토큰이 되고,
 * 손으로 친 `@홍길동` 은 평문이다 — 서버는 이름으로 사람을 추측하지 않는다(동명이인).
 *
 * 저장할 때 토큰을 검사한다:
 *  - 멤버의 토큰 → 멘션(자기 자신은 뺀다), 알림 대상
 *  - 멤버가 아닌 사람의 토큰 → 평문 `@이름` 으로 바꾼다(비공개 프로젝트의 청중을 넓히지 않는다)
 *  - 모르는 id → 지운다
 *  - `<@all>` → 전체 멘션. 토큰은 남긴다
 */

export const MENTION_RE = /<@(all|[a-z0-9]{20,32})>/g;
export const MAX_MENTIONS = 20;

export type Mentions = {
  /** 알림 받을 멤버 id (작성자 제외, 중복 제거, 등장 순) */
  userIds: string[];
  all: boolean;
  /** 비멤버·모르는 토큰을 평문으로 바꾼 본문 */
  body: string;
  /** 20명 넘게 불렀으면 그 수. 부른 쪽이 거절한다 */
  tooMany: number | null;
};

export function extractMentions(
  body: string,
  input: {
    /** 프로젝트 멤버 id → 이름 */
    members: Map<string, string>;
    /** 멤버가 아니지만 실제로 있는 사람 id → 이름 (평문으로 바꿀 때 쓴다) */
    known?: Map<string, string>;
    authorId: string;
  },
): Mentions {
  const ids: string[] = [];
  let all = false;
  const out = body.replace(MENTION_RE, (token, id: string) => {
    if (id === "all") {
      all = true;
      return token;
    }
    if (input.members.has(id)) {
      if (id !== input.authorId && !ids.includes(id)) ids.push(id);
      return token;
    }
    const name = input.known?.get(id);
    return name ? `@${name}` : "";
  });
  return { userIds: ids, all, body: out, tooMany: ids.length > MAX_MENTIONS ? ids.length : null };
}

/** 본문에 든 토큰의 id 만 뽑는다(all 제외). 이름을 찾아 둘 때 쓴다. */
export function tokenIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) if (m[1] !== "all") ids.add(m[1]);
  return [...ids];
}

/**
 * 입력창의 표시 글 → 저장할 본문. 자동완성으로 고른 사람의 `@이름` 만 `<@id>` 로 바꾼다.
 * 같은 이름이 둘 이상 골라졌을 수 있으니(동명이인) 고른 순서대로 한 번씩만 바꾼다.
 */
export function encodeMentions(display: string, picks: { name: string; id: string }[]): string {
  let out = display;
  for (const p of picks) {
    const token = p.id === "all" ? "<@all>" : `<@${p.id}>`;
    const needle = `@${p.name}`;
    const i = out.indexOf(needle);
    if (i < 0) continue;
    out = out.slice(0, i) + token + out.slice(i + needle.length);
  }
  return out;
}
