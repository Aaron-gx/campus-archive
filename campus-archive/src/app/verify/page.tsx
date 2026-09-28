"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, Search, ShieldCheck, FileArchive } from "lucide-react";
import { computeSha256Hex } from "@/lib/risk/watermark";

interface VerificationData {
  verifyCode: string;
  sha256: string;
  manifestSummary: string;
  watermarkText?: string;
  checkCount: number;
  createdAt: string;
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationData | null>(null);
  const [error, setError] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [fileName, setFileName] = useState("");

  const verifyCode = async (targetCode: string, targetHash?: string) => {
    if (!targetCode.trim() && !targetHash) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: targetCode.trim() || undefined,
          sha256: targetHash || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setError(data.error || "核验未通过");
      } else {
        setResult(data.data);
      }
    } catch {
      setError("核验网络异常");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const qCode = searchParams.get("code");
    if (qCode) {
      setCode(qCode);
      verifyCode(qCode);
    }
  }, [searchParams]);

  // 处理直接拖入 ZIP 计算 SHA-256 存证校验
  const handleZipFile = async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const hex = await computeSha256Hex(await file.arrayBuffer());
      setFileHash(hex);
      await verifyCode(code, hex);
    } catch {
      setError("文件指纹计算失败");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-[var(--card)] rounded-3xl shadow-sm border border-[var(--line)] p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] pb-4">
          <div className="w-9 h-9 rounded-xl bg-[var(--card-alt)] flex items-center justify-center text-[#0071E3]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">档案验真中心</h1>
        </div>

        {/* 凭证查询表单 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verifyCode(code, fileHash);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">
              存证编号
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CA-YYYYMM-XXXX-XXXX"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-[var(--ink)] focus:border-[#0071E3] focus:ring-1 focus:ring-[#0071E3] outline-none text-sm font-mono tracking-wider transition uppercase"
              />
              <button
                type="submit"
                disabled={loading || (!code.trim() && !fileHash)}
                className="absolute right-1.5 px-3.5 py-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-medium rounded-lg transition disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{loading ? "核验中" : "核验"}</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">
              归档包文件比对
            </label>
            <label className="flex flex-col items-center justify-center border border-dashed border-[var(--line-strong)] hover:border-[#0071E3] rounded-2xl p-4 cursor-pointer transition bg-[var(--card-alt)] hover:bg-[var(--card)]">
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleZipFile(e.target.files[0]);
                }}
              />
              <FileArchive className="w-6 h-6 text-[var(--ink-soft)] mb-1" />
              <span className="text-xs font-medium text-[var(--ink)]">
                {fileName ? fileName : "选择或拖入归档包 (.zip)"}
              </span>
              {fileHash && (
                <span className="text-[10.5px] font-mono text-[var(--ink-soft)] mt-1 max-w-[280px] truncate">
                  SHA-256: {fileHash}
                </span>
              )}
            </label>
          </div>
        </form>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="font-medium leading-relaxed">{error}</div>
          </div>
        )}

        {/* 验真成功卡片 */}
        {result && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-emerald-500/15">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">已核验 · 存证有效</span>
              </div>
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                核验 {result.checkCount} 次
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-soft)]">核验编号</span>
                <span className="font-mono font-semibold text-[var(--ink)] select-all">
                  {result.verifyCode}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-soft)]">归档时间</span>
                <span className="text-[var(--ink)]">{new Date(result.createdAt).toLocaleString("zh-CN")}</span>
              </div>

              {result.manifestSummary && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-[var(--ink-soft)] shrink-0">材料摘要</span>
                  <span className="text-[var(--ink)] text-right font-medium">{result.manifestSummary}</span>
                </div>
              )}

              {result.watermarkText && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ink-soft)]">防伪用途</span>
                  <span className="text-[var(--ink)] font-medium">{result.watermarkText}</span>
                </div>
              )}

              <div className="pt-2 border-t border-[var(--line)] space-y-1">
                <span className="text-[var(--ink-soft)] block text-[11px]">存证指纹 (SHA-256)</span>
                <div className="font-mono text-[11px] text-[var(--ink)] bg-[var(--card-alt)] p-2 rounded-lg border border-[var(--line)] break-all select-all leading-relaxed">
                  {result.sha256}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--paper)]" />}>
      <VerifyContent />
    </Suspense>
  );
}
