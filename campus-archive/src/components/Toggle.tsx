"use client";

/** 滑动开关：替代原生 checkbox */
export default function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="toggle">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle-track ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}
