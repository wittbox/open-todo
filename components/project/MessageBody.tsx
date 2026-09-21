"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * 메시지 본문 그리기.
 *
 * 본문은 평문이다. 정규식으로 조각내 React 노드로만 만든다 — HTML 로 넣지 않는다.
 *  - <@userId> / <@all>: 멘션. 이름은 메시지에 딸려 온 목록에서 찾고, 없으면 "알 수 없음".
 *  - #1042: 작업 링크. 앞이 글자·숫자면(코드#77) 아니다. 여기서 조회하지 않는다 —
 *    /t/1042 가 없음·권한 없음을 이미 처리한다.
 *  - http(s)://…: 링크. 새 창, rel 로 우리 창을 넘기지 않는다.
 */

const TOKEN_RE = /<@(all|[a-z0-9]{20,32})>|(^|[^\p{L}\p{N}_#])#(\d{1,9})(?!\d)|https?:\/\/[^\s<>"']+/gu;

export function MessageBody({
  body,
  mentions,
  meId,
  meName,
  className,
}: {
  body: string;
  mentions: { userId: string; name: string }[];
  meId: string;
  /** 나를 부른 토큰에 붙일 이름. 없으면 "나". */
  meName?: string;
  className?: string;
}) {
  const t = useTranslations("projects");
  const names = new Map(mentions.map((m) => [m.userId, m.name]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of body.matchAll(TOKEN_RE)) {
    const start = match.index;
    if (match[1] !== undefined) {
      pushText(body.slice(last, start));
      const id = match[1];
      const me = id === meId || id === "all";
      const label =
        id === "all"
          ? t("message.mentionAll")
          : id === meId
            ? (meName ?? t("message.mentionMe"))
            : (names.get(id) ?? t("message.unknownUser"));
      parts.push(
        <span
          key={key++}
          data-mention={id}
          className={`rounded px-0.5 font-semibold ${me ? "bg-[#fff4ce] text-[#7a5a00]" : "bg-[#eff4fc] text-[#1b4b9b]"}`}
        >
          @{label}
        </span>,
      );
      last = start + match[0].length;
    } else if (match[3] !== undefined) {
      // 앞 글자(공백 등)는 그대로 두고 #번호만 링크로.
      pushText(body.slice(last, start) + match[2]);
      const seq = match[3];
      parts.push(
        <Link key={key++} href={`/t/${seq}`} className="text-link hover:underline">
          #{seq}
        </Link>,
      );
      last = start + match[0].length;
    } else {
      pushText(body.slice(last, start));
      const url = match[0];
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
          {url}
        </a>,
      );
      last = start + url.length;
    }
  }
  pushText(body.slice(last));

  function pushText(t: string) {
    if (t) parts.push(t);
  }

  return <div className={`whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] ${className ?? ""}`}>{parts}</div>;
}
