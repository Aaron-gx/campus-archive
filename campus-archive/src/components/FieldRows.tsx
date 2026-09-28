"use client";

import { checkFieldExpiry } from "@/lib/expiry";

/**
 * 证件识别字段编辑行：OCR 识别出的结构化信息逐行展示，
 * 每个字段一个输入框，用户可直接修正后随档案保存。
 * 证号类字段带校验徽标（ok / repair / warn），等宽字体展示。
 * 到期字段（如已过期/即将到期）实时标注。
 */
export interface EditableField {
  label: string;
  value: string;
  badge?: "ok" | "warn" | "repair";
}

export default function FieldRows({
  fields,
  onChange,
  emptyHint = "暂无识别字段",
}: {
  fields: EditableField[];
  onChange: (next: EditableField[]) => void;
  emptyHint?: string;
}) {
  if (fields.length === 0) {
    return <div className="fields-empty">{emptyHint}</div>;
  }
  const update = (i: number, value: string) => {
    const next = fields.map((f, idx) => (idx === i ? { ...f, value } : f));
    onChange(next);
  };
  const remove = (i: number) => {
    onChange(fields.filter((_, idx) => idx !== i));
  };
  return (
    <div className="field-rows">
      {fields.map((f, i) => {
        const exp = checkFieldExpiry(f.label, f.value, fields);
        return (
        <div key={`${f.label}-${i}`} className={`field-row ${f.value.length > 16 ? "field-row-wide" : ""}`}>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="field-row-label">{f.label}</span>
            {exp.status === "expired" && (
              <span className="text-[10px] font-semibold text-[#ff3b30] bg-[#ff3b30]/10 border border-[#ff3b30]/25 px-1 py-0.2 rounded">
                已过期
              </span>
            )}
            {exp.status === "expiring" && (
              <span className="text-[10px] font-semibold text-[#d97706] bg-[#fef3c7] border border-[#fde68a] px-1 py-0.2 rounded">
                即将到期
              </span>
            )}
          </div>
          <div className="field-row-input-wrap">
            <input
              value={f.value}
              onChange={(e) => update(i, e.target.value)}
              className={`field-row-input ${/号码|证号|学号|户号|编号|签注号/.test(f.label) ? "mono" : ""} ${
                exp.status === "expired" ? "!border-red-300" : ""
              }`}
              aria-label={f.label}
            />
            {f.badge === "ok" && <span className="field-badge ok" title="校验通过">✓</span>}
            {f.badge === "repair" && <span className="field-badge repair" title="已自动纠正一位，请核对">✓*</span>}
            {f.badge === "warn" && <span className="field-badge warn" title="校验未通过，请核对">!</span>}
            <button
              type="button"
              className="field-row-del"
              title="删除此字段"
              onClick={() => remove(i)}
            >
              ✕
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
