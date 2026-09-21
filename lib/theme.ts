/**
 * 목록 테마 / 배경 토큰. preview/styles.css 의 값과 동일하게 유지한다.
 * 진한 테마 = 목록, 연한 테마 = 스마트 뷰.
 */

export type ThemeKey = "blue" | "purple" | "red" | "green" | "teal" | "pink";

/** 문구는 화면이 `tasks.theme.<키>` 로 읽는다. 여기에는 색만 둔다. */
export type Theme = {
  key: ThemeKey;
  /** 본문 배경 */
  accent: string;
  /** 본문 위 글자색 */
  on: string;
  /** 보조 글자색 (메타, 완료 항목) */
  onMuted: string;
  /** 작업 행 배경 / 호버 */
  row: string;
  rowHover: string;
  /** 기한 지난 표시. 배경이 진한지 연한지에 따라 달라야 읽힌다. */
  overdue: string;
};

const ON_DARK_OVERDUE = "#ffc7c2";
const ON_LIGHT_OVERDUE = "#a4262c";

const DARK_ROW = { row: "rgba(255,255,255,.10)", rowHover: "rgba(255,255,255,.16)", overdue: ON_DARK_OVERDUE };

export const THEMES: Record<ThemeKey, Theme> = {
  blue: { key: "blue", accent: "#2564cf", on: "#ffffff", onMuted: "#d4e2f7", ...DARK_ROW },
  purple: { key: "purple", accent: "#4f52b2", on: "#ffffff", onMuted: "#dcdcf0", ...DARK_ROW },
  red: { key: "red", accent: "#a4373a", on: "#ffffff", onMuted: "#f0d3d4", ...DARK_ROW },
  green: { key: "green", accent: "#0f7b6c", on: "#ffffff", onMuted: "#cfe8e3", ...DARK_ROW },
  teal: { key: "teal", accent: "#03787c", on: "#ffffff", onMuted: "#c9e6e7", ...DARK_ROW },
  pink: { key: "pink", accent: "#b4009e", on: "#ffffff", onMuted: "#f3d1ee", ...DARK_ROW },
};

export const DEFAULT_THEME: ThemeKey = "blue";

export function getTheme(key: string | null | undefined): Theme {
  return THEMES[(key as ThemeKey) ?? DEFAULT_THEME] ?? THEMES[DEFAULT_THEME];
}

/** 스마트 뷰는 연한 배경 + 진한 글자를 쓴다. */
const SOFT_ROW = { row: "rgba(255,255,255,.62)", rowHover: "rgba(255,255,255,.82)", overdue: ON_LIGHT_OVERDUE };

export const SMART_VIEW_THEMES = {
  /** 달력이 쓴다. 이름은 '계획된 일정' 화면이 있던 때의 것이다. */
  planned: { accent: "#fdf3ec", on: "#a4373a", onMuted: "#8a4b3c", ...SOFT_ROW },
  assigned: { accent: "#eef6f3", on: "#0f7b6c", onMuted: "#3f6f66", ...SOFT_ROW },
  tasks: { accent: "#4f52b2", on: "#ffffff", onMuted: "#dcdcf0", ...DARK_ROW },
} as const;

export type SmartView = keyof typeof SMART_VIEW_THEMES;

/**
 * 배경 사진. 실제 이미지는 public/backgrounds/ 에 넣는다.
 * 문구는 화면이 `tasks.background.<키>` 로 읽는다.
 */
export const BACKGROUND_KEYS = ["tower", "forest", "desk"] as const;

export type BackgroundKey = (typeof BACKGROUND_KEYS)[number];
