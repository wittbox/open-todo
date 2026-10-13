"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LABEL_COLOR_KEYS, labelColor } from "@/lib/issues/format";
import type { IssueLabelItem } from "@/lib/queries/issues";

/**
 * 이슈 라벨 고르기(2026-10-13).
 *
 * ‘고치기’ → ‘다 됐음’ 대신 라벨을 늘 펼쳐 두고 누르면 붙고, 다시 누르면 떨어진다. 붙은 것은 색에 ✓,
 * 안 붙은 것은 흰 칩에 테두리. 끝에 ‘＋ 새 라벨’ — 이름과 색을 정하면 만들고 바로 붙인다(onCreate 가 있을 때만).
 * 고칠 수 없으면(readOnly) 붙은 라벨만 보인다.
 */
export function LabelPicker({
  labels,
  selected,
  onToggle,
  onCreate,
  readOnly = false,
  disabled = false,
}: {
  labels: IssueLabelItem[];
  selected: string[];
  onToggle: (id: string) => void;
  /** 새 라벨 만들고 붙이기. 성공하면 true(입력칸을 닫는다). 없으면 ‘＋ 새 라벨’ 이 없다. */
  onCreate?: (name: string, color: string) => Promise<boolean>;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("issues");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("gray");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (readOnly) {
    const on = labels.filter((l) => selected.includes(l.id));
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {on.map((l) => (
          <Chip key={l.id} name={l.name} color={l.color} on />
        ))}
        {on.length === 0 && <span className="text-ink-3">{t("pane.none")}</span>}
      </span>
    );
  }

  function open() {
    // 아직 안 쓴 색을 먼저 골라 둔다 — 라벨끼리 구별되게
    const used = new Set(labels.map((l) => l.color));
    setColor(LABEL_COLOR_KEYS.find((k) => k !== "gray" && !used.has(k)) ?? "gray");
    setName("");
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function submit() {
    const v = name.trim();
    if (!v || busy || !onCreate) return;
    setBusy(true);
    const ok = await onCreate(v, color);
    setBusy(false);
    if (ok) setAdding(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((l) => {
          const on = selected.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(l.id)}
              className="rounded-full disabled:cursor-default"
            >
              <Chip name={l.name} color={l.color} on={on} />
            </button>
          );
        })}
        {onCreate && !adding && (
          <button
            type="button"
            onClick={open}
            disabled={disabled}
            className="rounded-full border border-dashed border-[#b3cdf0] px-2 text-[12px] leading-[20px] text-link hover:bg-[#eff6fc]"
          >
            {t("labelPicker.newLabel")}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-2">
          <input
            ref={inputRef}
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
              }
            }}
            placeholder={t("labelPicker.newLabelName")}
            aria-label={t("labelPicker.newLabelName")}
            className="w-full rounded border border-[#e1dfdd] bg-white px-2 py-1 text-[13px] outline-none focus:border-link"
          />
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label={t("labelPicker.labelColor")}>
            {LABEL_COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={color === k}
                aria-label={k}
                onClick={() => setColor(k)}
                className={`h-[18px] w-[18px] rounded-full border border-black/10 ${color === k ? "outline-2 outline-offset-2 outline-link" : ""}`}
                style={{ background: labelColor(k).bg }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-1.5 text-[12.5px]">
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-[#e1dfdd] bg-white px-2.5 py-0.5 hover:bg-[#f3f2f1]">
              {t("labelPicker.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim() || busy}
              className="rounded bg-link px-2.5 py-0.5 text-white disabled:opacity-50"
            >
              {t("labelPicker.createAndAttach")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 붙은 라벨은 색에 ✓, 안 붙은 라벨은 흰 칩에 테두리 */
function Chip({ name, color, on }: { name: string; color: string; on: boolean }) {
  const c = labelColor(color);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[12px] leading-[20px] ${
        on ? "border-transparent" : "border-[#e1dfdd] bg-white text-ink-2 hover:border-ink-3"
      }`}
      style={on ? { background: c.bg, color: c.fg } : undefined}
    >
      {on && <span className="text-[10px]">✓</span>}
      {name}
    </span>
  );
}
