"use client";

/**
 * 芯片单选组：替代原生 <select>。
 * 选项多时自动换行；选中项实心高亮，未选项描边。
 */
export default function ChipGroup({
  value,
  options,
  onChange,
  name,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  /** 无障碍标签（不显示） */
  name?: string;
}) {
  return (
    <div className="chip-group" role="radiogroup" aria-label={name}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`chip-select ${value === opt.value ? "on" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
