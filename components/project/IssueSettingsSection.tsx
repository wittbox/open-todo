"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { BTN_CLASS, INPUT_CLASS } from "@/components/project/Dialog";
import { deleteLabelAction, saveLabelAction } from "@/lib/actions/issue";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { LABEL_COLOR_KEYS, labelColor } from "@/lib/issues/format";
import type { IssueSettings } from "@/lib/queries/issues";

export type IssueSettingsDraft = { enabled: boolean; key: string; template: string };

/**
 * 프로젝트 설정의 '이슈' 칸. 켜기·약어·템플릿은 설정 창의 '저장' 과 함께 저장되고,
 * 라벨은 더하고 지우는 즉시 저장된다(다른 이슈에 바로 쓸 수 있게).
 */
export function IssueSettingsSection({
  projectId,
  settings,
  draft,
  onDraft,
}: {
  projectId: string;
  settings: IssueSettings;
  draft: IssueSettingsDraft;
  onDraft: (d: IssueSettingsDraft) => void;
}) {
  const router = useRouter();
  const t = useTranslations("issues");
  const [pending, startTransition] = useTransition();
  const [labelName, setLabelName] = useState("");
  const [labelColorKey, setLabelColorKey] = useState<string>("gray");
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string; code: "unauthenticated" | "forbidden" | "unknown" }>, then?: () => void) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) {
        if (!handledAuthFailure(res)) setError(res.error);
        return;
      }
      setError(null);
      then?.();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 rounded border border-[#e1dfdd] px-3 py-2.5">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            // 처음 켤 때 템플릿 칸이 비어 있으면 버그 템플릿을 보여 준다 — 저장 전에 고칠 수 있게.
            const template = enabled && !settings.enabled && !draft.template.trim() ? t("defaults.template") : draft.template;
            onDraft({ ...draft, enabled, template });
          }}
        />
        {t("settings.enable")}
        <span className="text-xs font-normal text-ink-2">{t("settings.enableHint")}</span>
      </label>

      {draft.enabled && (
        <>
          <label className="mt-3 block text-xs text-ink-2">
            {t("settings.key")} <span className="text-ink-3">{t("settings.keyHint")}</span>
          </label>
          <input
            value={draft.key}
            disabled={settings.keyLocked}
            onChange={(e) => onDraft({ ...draft, key: e.target.value.toUpperCase() })}
            maxLength={6}
            placeholder="BUG"
            className={`${INPUT_CLASS} mt-1 w-40 font-mono uppercase disabled:bg-pane-bg`}
          />
          {settings.keyLocked && <p className="mt-1 text-[11.5px] text-ink-3">{t("settings.keyLocked", { key: settings.key ?? "" })}</p>}

          <label className="mt-3 block text-xs text-ink-2">{t("settings.template")}</label>
          <textarea
            value={draft.template}
            onChange={(e) => onDraft({ ...draft, template: e.target.value })}
            rows={7}
            placeholder={t("defaults.template")}
            className="mt-1 w-full resize-y rounded border border-[#8a8886] px-2.5 py-2 font-mono text-[12.5px] outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]"
          />

          <div className="mt-3 text-xs text-ink-2">{t("settings.labels")} {settings.labels.length === 0 && <span className="text-ink-3">{t("settings.labelsFirst")}</span>}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {settings.labels.map((l) => {
              const c = labelColor(l.color);
              return (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]" style={{ background: c.bg, color: c.fg }}>
                  {l.name}
                  <button
                    type="button"
                    aria-label={t("settings.deleteLabel", { name: l.name })}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t("settings.confirmDeleteLabel", { name: l.name }))) act(() => deleteLabelAction(projectId, l.id));
                    }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              );
            })}
          </div>
          {settings.enabled && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={labelName}
                onChange={(e) => setLabelName(e.target.value)}
                maxLength={30}
                placeholder={t("settings.newLabel")}
                aria-label={t("settings.newLabelName")}
                className={`${INPUT_CLASS} !h-8 w-36`}
              />
              <span className="flex gap-1" role="radiogroup" aria-label={t("settings.labelColor")}>
                {LABEL_COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={labelColorKey === k}
                    aria-label={k}
                    onClick={() => setLabelColorKey(k)}
                    className={`h-5 w-5 rounded-full border ${labelColorKey === k ? "ring-2 ring-link ring-offset-1" : ""}`}
                    style={{ background: labelColor(k).bg, borderColor: labelColor(k).fg }}
                  />
                ))}
              </span>
              <button
                type="button"
                disabled={!labelName.trim() || pending}
                onClick={() => act(() => saveLabelAction(projectId, { name: labelName, color: labelColorKey }), () => setLabelName(""))}
                className={`${BTN_CLASS} !h-8 !px-3`}
              >
                {t("settings.add")}
              </button>
            </div>
          )}
          {error && <p className="mt-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}
