/**
 * 대한민국 관공서 공휴일 — 달력의 빨간 날.
 *
 * 음력 공휴일(설날·추석·부처님오신날)과 대체공휴일은 해마다 날짜가 달라 계산하지 않고
 * 표로 둔다. 출처는 우주항공청·한국천문연구원 월력요항(2026년, 2027년). 2026년부터
 * 노동절(5/1)과 제헌절(7/17)이 관공서 공휴일이다.
 *
 * 다음 해 월력요항은 보통 6월 말에 나온다. 해가 바뀌기 전에 한 해씩 채운다 —
 * tests/calendar.test.ts 가 올해 표가 없으면 실패해서 알려 준다.
 *
 * 표에는 이름이 아니라 열쇠를 둔다. 보이는 이름은 보는 사람의 언어로 `calendar.holidays.<열쇠>`
 * 에서 꺼낸다(달력 컴포넌트가 옮긴다).
 *
 * 이 표는 보여 주기만 한다. 공휴일에 기한을 두는 것을 막지 않는다.
 */

/** 공휴일 이름의 열쇠 — messages/<언어>/calendar.json 의 `holidays` 아래에 있다. */
export type HolidayKey =
  | "newYear"
  | "seollal"
  | "seollalHoliday"
  | "independenceMovement"
  | "substitute"
  | "labor"
  | "children"
  | "buddha"
  | "localElection"
  | "memorial"
  | "constitution"
  | "liberation"
  | "chuseok"
  | "chuseokHoliday"
  | "nationalFoundation"
  | "hangul"
  | "christmas";

const SUB = "substitute" as const;

const TABLE: Record<number, Record<string, HolidayKey>> = {
  2026: {
    "01-01": "newYear",
    "02-16": "seollalHoliday",
    "02-17": "seollal",
    "02-18": "seollalHoliday",
    "03-01": "independenceMovement",
    "03-02": SUB,
    "05-01": "labor",
    "05-05": "children",
    "05-24": "buddha",
    "05-25": SUB,
    "06-03": "localElection",
    "06-06": "memorial",
    "07-17": "constitution",
    "08-15": "liberation",
    "08-17": SUB,
    "09-24": "chuseokHoliday",
    "09-25": "chuseok",
    "09-26": "chuseokHoliday",
    "10-03": "nationalFoundation",
    "10-05": SUB,
    "10-09": "hangul",
    "12-25": "christmas",
  },
  2027: {
    "01-01": "newYear",
    // 설날(2/7)이 일요일이라 연휴 뒤 2/9 가 대체공휴일이다.
    "02-06": "seollalHoliday",
    "02-07": "seollal",
    "02-08": "seollalHoliday",
    "02-09": SUB,
    "03-01": "independenceMovement",
    "05-01": "labor",
    "05-03": SUB,
    "05-05": "children",
    "05-13": "buddha",
    "06-06": "memorial",
    "07-17": "constitution",
    "07-19": SUB,
    "08-15": "liberation",
    "08-16": SUB,
    "09-14": "chuseokHoliday",
    "09-15": "chuseok",
    "09-16": "chuseokHoliday",
    "10-03": "nationalFoundation",
    "10-04": SUB,
    "10-09": "hangul",
    "10-11": SUB,
    "12-25": "christmas",
    "12-27": SUB,
  },
};

/** 표가 있는 해 */
export const HOLIDAY_YEARS: number[] = Object.keys(TABLE).map(Number);

/**
 * 공휴일을 어느 나라 것으로 보일지 — 설치 설정(`HOLIDAY_REGION`).
 * `kr`(기본) 또는 `none`(달력에 공휴일을 표시하지 않음). 나라를 늘리려면 표를 추가하고 여기에 한 줄 넣는다.
 */
export type HolidayRegion = "kr" | "none";

export function holidayRegion(): HolidayRegion {
  return process.env.HOLIDAY_REGION?.trim().toLowerCase() === "none" ? "none" : "kr";
}

/**
 * "YYYY-MM-DD" 가 공휴일이면 그 이름의 열쇠, 아니면 null.
 * 브라우저에서도 부르므로 지역은 인자로 받는다(환경 변수는 서버에만 있다).
 */
export function holidayName(date: string, region: HolidayRegion = "kr"): HolidayKey | null {
  if (region === "none") return null;
  return TABLE[Number(date.slice(0, 4))]?.[date.slice(5, 10)] ?? null;
}

/** 표에 든 날 전부 ("YYYY-MM-DD" → 열쇠). 시험에서 표 자체를 훑을 때 쓴다. */
export function allHolidays(): [string, HolidayKey][] {
  return Object.entries(TABLE).flatMap(([y, days]) =>
    Object.entries(days).map(([md, key]) => [`${y}-${md}`, key] as [string, HolidayKey]),
  );
}
