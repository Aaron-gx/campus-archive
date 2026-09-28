"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

const TARGET_PRESETS = [
  "校招求职",
  "升学保研",
  "出国申请",
  "评优表彰",
];

const CATEGORY_NAMES: Record<string, string> = {
  identity: "身份证件",
  certificate: "获奖证书",
  experience: "经历证明",
  photo: "活动照片",
  portfolio: "个人作品集",
};

interface MissingItem {
  name: string;
  categoryKey: string;
}

interface CheckResult {
  haveCount: number;
  missing: MissingItem[];
  status: "完备" | "良好" | "待补充";
}

export default function ArchiveCheckCard() {
  const [target, setTarget] = useState("校招求职");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");

  async function handleCheck() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/archive-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "自检失败");
      }
      if (data.skipped) {
        setError("未配置 API Key");
        return;
      }
      if (data.ok && data.data) {
        setResult(data.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "自检失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-xs space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold text-[var(--ink)]">档案自检</span>
          {result && (
            <span
              className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full ${
                result.status === "完备"
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                  : result.status === "良好"
                    ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                    : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
              }`}
            >
              {result.status}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCheck}
          disabled={loading}
          className="btn btn-ink !py-1.5 !px-3.5 !text-[12.5px] font-semibold !rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span>开始自检</span>
        </button>
      </div>

      {/* 预设目标选择 */}
      <div className="flex flex-wrap gap-1.5">
        {TARGET_PRESETS.map((p) => {
          const on = target === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setTarget(p)}
              className={`px-3 py-1 text-[12.5px] font-medium rounded-lg transition-colors cursor-pointer ${
                on
                  ? "bg-black/[0.08] dark:bg-white/[0.12] text-[var(--ink)] font-semibold"
                  : "bg-black/[0.02] dark:bg-white/[0.05] text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[12.5px] text-rose-600 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="pt-2 border-t border-[var(--line)] space-y-2">
          {result.missing.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-emerald-600 py-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>材料齐全</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-wider">
                待补充材料
              </div>
              <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--card-alt)]">
                {result.missing.map((item, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-[13px]"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-medium text-[var(--ink)] truncate">{item.name}</span>
                      <span className="text-[11px] text-[var(--ink-faint)] shrink-0">
                        {CATEGORY_NAMES[item.categoryKey] ?? item.categoryKey}
                      </span>
                    </div>
                    <Link
                      href={`/dashboard/category/${item.categoryKey}`}
                      className="text-[12px] font-medium text-[var(--blue)] hover:underline inline-flex items-center gap-0.5 shrink-0"
                    >
                      <span>去上传</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
