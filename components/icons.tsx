/**
 * 아이콘 세트. preview/index.html 의 SVG 심볼을 그대로 옮긴 것이다.
 * 색은 currentColor 를 따르고 크기는 size(px)로 준다.
 */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;

const PATHS: Record<string, React.ReactElement> = {
  sun: (
    <g {...S} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </g>
  ),
  star: <path {...S} strokeLinejoin="round" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" />,
  starFilled: <path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" />,
  calendar: (
    <g {...S}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </g>
  ),
  /** 칸이 보이는 달력 — 사이드바 '달력'. 기한 표시(calendar)와 구별한다. */
  calendarMonth: (
    <g {...S}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path strokeWidth={2.2} strokeLinecap="round" d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 16.5h.01M12 16.5h.01" />
    </g>
  ),
  /** 동그라미 느낌표 — 달력의 '지난 기한' 줄 */
  alert: (
    <g {...S} strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.5h.01" strokeWidth={2} />
    </g>
  ),
  home: <path {...S} strokeLinejoin="round" d="M4 10.5L12 4l8 6.5V20H4z" />,
  group: (
    <g {...S}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v14" />
    </g>
  ),
  list: <path {...S} strokeWidth={1.8} strokeLinecap="round" d="M5 8h14M5 12h14M5 16h9" />,
  chevronUp: <path {...S} strokeLinecap="round" d="M6 14l6-5 6 5" />,
  chevronDown: <path {...S} strokeLinecap="round" d="M6 10l6 5 6-5" />,
  chevronRight: <path {...S} strokeLinecap="round" d="M10 6l5 6-5 6" />,
  plus: <path {...S} strokeWidth={1.7} strokeLinecap="round" d="M12 5v14M5 12h14" />,
  search: (
    <g {...S}>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L20 20" />
    </g>
  ),
  groupPlus: (
    <g {...S}>
      <rect x="3.5" y="5" width="13" height="14" rx="2" />
      <path d="M8.5 5v14M19 8v7M22.5 11.5h-7" />
    </g>
  ),
  share: (
    <g {...S}>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 19c0-3.2 2.7-5 6-5 1.2 0 2.3.2 3.2.7M18 13v6M21 16h-6" />
    </g>
  ),
  person: (
    <g {...S}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
    </g>
  ),
  image: (
    <g {...S}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 16l4.5-4 4 3.4 3.5-3.4 5 4.6" />
    </g>
  ),
  dots: (
    <g fill="currentColor">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </g>
  ),
  check: <path {...S} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7" />,
  circle: <circle {...S} strokeWidth={1.5} cx="12" cy="12" r="9" />,
  note: (
    <g {...S} strokeLinejoin="round">
      <path d="M5 4h9l5 5v11H5z" />
      <path d="M14 4v5h5" />
    </g>
  ),
  trash: <path {...S} strokeLinecap="round" d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
  bell: (
    <g {...S}>
      <path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 20a2 2 0 004 0" />
    </g>
  ),
  repeat: <path {...S} strokeLinecap="round" d="M4 10a6 6 0 016-6h8M18 4l-3-3M18 4l-3 3M20 14a6 6 0 01-6 6H6M6 20l3 3M6 20l3-3" />,
  clip: <path {...S} strokeLinecap="round" d="M20 11l-8.5 8.5a4.6 4.6 0 01-6.5-6.5L13 4.5a3.2 3.2 0 014.5 4.5l-8 8a1.8 1.8 0 01-2.5-2.5l7.5-7.5" />,
  link: <path {...S} strokeLinecap="round" d="M10 14a4 4 0 006 .5l2.5-2.5a4 4 0 00-5.7-5.7L11.5 7.5M14 10a4 4 0 00-6-.5L5.5 12a4 4 0 005.7 5.7L12.5 16.5" />,
  x: <path {...S} strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />,
  /** 폰·태블릿 위 줄의 메뉴 열기 */
  menu: <path {...S} strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />,
  /** 사이드바 접기·고정 */
  sidebar: (
    <g {...S} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9 4.5v15M15.5 10l-2 2 2 2" />
    </g>
  ),
  /** 프로젝트(공개) */
  hash: <path {...S} strokeLinecap="round" d="M9 4L7 20M17 4l-2 16M4 9h17M3 15h17" />,
  /** 멘션 */
  at: (
    <g {...S} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.5 7.1" />
    </g>
  ),
  /** 고정된 메시지 */
  pin: <path {...S} strokeLinejoin="round" d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7" />,
  /** 답글·스레드 */
  reply: <path {...S} strokeLinecap="round" strokeLinejoin="round" d="M9 7L4 12l5 5M4 12h9a6 6 0 016 6" />,
  /** 보내기 */
  send: <path {...S} strokeLinejoin="round" d="M4 12l16-8-4 16-4-6z" />,
  /** 설정 */
  gear: (
    <g {...S} strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </g>
  ),
  /** 읽기 전용 — 공유받은 목록 줄 */
  lock: (
    <g {...S} strokeLinecap="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </g>
  ),
  edit: <path {...S} strokeLinejoin="round" d="M4 20l.8-4L16 4.8a2 2 0 013 2.6L8 18.6z" />,
  move: (
    <g {...S}>
      <rect x="3.5" y="5" width="10" height="14" rx="2" />
      <path d="M17 8l3 4-3 4M20 12h-7" />
    </g>
  ),
  out: (
    <g {...S}>
      <rect x="3.5" y="5" width="10" height="14" rx="2" />
      <path d="M20 8l-3 4 3 4M17 12h-7" />
    </g>
  ),
  print: (
    <g {...S}>
      <path d="M7 9V4h10v5M7 18H5a1 1 0 01-1-1v-6a2 2 0 012-2h12a2 2 0 012 2v6a1 1 0 01-1 1h-2" />
      <rect x="7" y="14" width="10" height="6" />
    </g>
  ),
  mail: (
    <g {...S}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </g>
  ),
  copy: (
    <g {...S}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6H6a2 2 0 00-2 2v9" />
    </g>
  ),
  ungroup: <rect {...S} strokeDasharray="3 2.4" x="4" y="5" width="16" height="14" rx="2" />,
  jump: <path {...S} strokeLinecap="round" d="M5 12h13M13 6.5l5.5 5.5L13 17.5" />,
  grip: (
    <g fill="currentColor">
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </g>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
