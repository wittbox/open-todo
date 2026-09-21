"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { addDays, dateOnlyToString, isSameDateOnly, todayDateOnly } from "@/lib/date";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";

/**
 * 달력.
 *
 * 브라우저 기본 <input type="date"> 를 쓰지 않는 이유가 둘 있다.
 *  1. 달을 넘기는 동안 change 가 나서, 그걸 듣고 닫는 화면에서는 달력이 사라졌다
 *  2. 생김새가 브라우저마다 다르다 — 이 앱에서 그 자리만 남의 UI였다
 *
 * 날짜는 UTC 자정 기준 date-only 다 (lib/date.ts 규약). 그래서 찍을 때도 늘 `timeZone: "UTC"` 다.
 */

/** "2026년 9월" · "September 2026" */
const MONTH_TITLE = { year: "numeric", month: "long", timeZone: "UTC" } as const;

/** 요일 머리글 — "일" · "Sun" */
const WEEKDAY = { weekday: "short", timeZone: "UTC" } as const;

/** 요일 이름을 언어에 맞춰 찍기 위한 한 주. 2026-02-01 이 일요일이다. */
const WEEK_REF = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 1, 1 + i)));

function monthStartOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function shiftMonth(d: Date, by: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + by, 1));
}

export function Calendar({
  value,
  onPick,
  onClear,
  clearLabel,
}: {
  value: Date | null;
  onPick: (date: Date) => void;
  onClear?: () => void;
  /** 비우면 "지우기". 무엇을 지우는지 밝히고 싶은 곳에서만 준다. */
  clearLabel?: string;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const today = todayDateOnly(new Date(), useTimeZone());
  const [month, setMonth] = useState(() => monthStartOf(value ?? today));

  // 앞뒤 달의 날짜까지 채워 6주를 항상 같은 높이로 그린다.
  const gridStart = addDays(month, -month.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="px-2.5 pb-2.5 pt-1">
      <div className="flex items-center gap-1 pb-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={t("prevMonth")}
          className="grid h-6 w-6 place-items-center rounded text-ink-2 hover:bg-side-hover"
        >
          <Icon name="chevronRight" size={14} className="rotate-180" />
        </button>
        <span className="flex-1 text-center text-[13px] font-semibold">{format.dateTime(month, MONTH_TITLE)}</span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label={t("nextMonth")}
          className="grid h-6 w-6 place-items-center rounded text-ink-2 hover:bg-side-hover"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK_REF.map((w) => (
          <span key={w.getUTCDay()} className="py-0.5 text-[11px] text-ink-3">
            {format.dateTime(w, WEEKDAY)}
          </span>
        ))}

        {days.map((d) => {
          const outside = d.getUTCMonth() !== month.getUTCMonth();
          const selected = value != null && isSameDateOnly(d, value);
          const isToday = isSameDateOnly(d, today);
          const weekday = d.getUTCDay();

          return (
            <button
              key={dateOnlyToString(d)}
              type="button"
              onClick={() => onPick(d)}
              className={[
                "rounded py-1 text-[12.5px]",
                selected
                  ? "bg-link text-white"
                  : outside
                    ? "text-[#c8c6c4] hover:bg-side-hover"
                    : weekday === 0
                      ? "text-danger hover:bg-side-hover"
                      : weekday === 6
                        ? "text-link hover:bg-side-hover"
                        : "hover:bg-side-hover",
                isToday && !selected ? "shadow-[inset_0_0_0_1px_#2564cf] text-link" : "",
              ].join(" ")}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 text-xs">
        {onClear ? (
          <button type="button" onClick={onClear} className="text-danger hover:underline">
            {clearLabel ?? t("clear")}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            setMonth(monthStartOf(today));
            onPick(today);
          }}
          className="text-link hover:underline"
        >
          {t("today")}
        </button>
      </div>
    </div>
  );
}
