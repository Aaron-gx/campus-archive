"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SensitiveVerifyModal from "@/components/SensitiveVerifyModal";
import Toggle from "@/components/Toggle";
import { api, formatBytes, formatDate } from "@/lib/format";
import { Check, Download, Loader2, AlertCircle, Sparkles, ShieldCheck } from "lucide-react";
import { drawVisibleWatermark, embedBlindWatermark, computeSha256Hex } from "@/lib/risk/watermark";

const CATEGORIES = [
  { key: "identity", name: "身份证件", accent: "#0071E3" },
  { key: "certificate", name: "获奖证书", accent: "#FF9500" },
  { key: "experience", name: "经历证明", accent: "#34C759" },
  { key: "photo", name: "活动照片", accent: "#AF52DE" },
  { key: "portfolio", name: "个人作品集", accent: "#FF2D55" },
];

interface ExportRecord {
  id: string;
  categoryKeys: string;
  fileName: string;
  size: number;
  verifyCode?: string | null;
  sha256?: string | null;
  watermarkText?: string | null;
  createdAt: string;
}

// 本机打包所需的文档字段（与 /api/documents 返回结构对应）
interface ExportDoc {
  id: string;
  title: string;
  fileName?: string | null;
  mimeType: string;
  e2ee: boolean;
  isSensitive: boolean;
  side?: string | null;
  createdAt: string;
  category: { name: string; parent?: { name: string } | null };
}

const PRESETS = [
  { name: "全量归档包", keys: CATEGORIES.map((c) => c.key) },
  { name: "入职与资质包", keys: ["identity", "certificate", "experience"] },
  { name: "办事审核包", keys: ["identity", "certificate"] },
];

const KEY_NAMES: Record<string, string> = {
  identity: "身份证件",
  certificate: "获奖证书",
  experience: "经历证明",
  photo: "活动照片",
  portfolio: "个人作品集",
};

export default function ExportPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(["certificate", "experience"]));
  const [includeCerts, setIncludeCerts] = useState(true);
  const [includeE2ee, setIncludeE2ee] = useState(true); // e2ee 材料在本机解密后打包
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [aiGoal, setAiGoal] = useState("");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReason, setAiReason] = useState("");

  const handleAiSuggest = useCallback(async () => {
    if (!aiGoal.trim() || aiSuggesting) return;
    setAiSuggesting(true);
    setAiReason("");
    setError("");
    try {
      const res = await fetch("/api/ai/export-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: aiGoal.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "推荐失败");
      }
      if (data.skipped) {
        setError("未配置 API Key");
        return;
      }
      if (data.ok && data.data?.suggested?.length) {
        setSelected(new Set(data.data.suggested));
        if (data.data.reason) {
          setAiReason(data.data.reason);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "推荐失败");
    } finally {
      setAiSuggesting(false);
    }
  }, [aiGoal, aiSuggesting]);

  const loadRecords = useCallback(async () => {
    try {
      const data = await api<{ records: ExportRecord[] }>("/api/export");
      setRecords(data.records ?? []);
    } catch {
      /* 历史加载失败不阻塞页面 */
    }
  }, []);

  const loadCategoryCounts = useCallback(async () => {
    try {
      const data = await api<{ categories: { key: string; count: number }[] }>("/api/categories");
      const counts: Record<string, number> = {};
      for (const c of data.categories ?? []) {
        counts[c.key] = c.count;
      }
      setCatCounts(counts);
    } catch {
      /* 分类计数加载失败不阻塞页面 */
    }
  }, []);

  useEffect(() => {
    loadRecords();
    loadCategoryCounts();
  }, [loadRecords, loadCategoryCounts]);

  const selectedDocCount = useMemo(() => {
    return Array.from(selected).reduce((acc, key) => acc + (catCounts[key] || 0), 0);
  }, [selected, catCounts]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function sanitize(name: string) {
    return name.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 80);
  }

  function csvCell(value: unknown) {
    const s = String(value ?? "").replace(/\r\n?/g, " ");
    const guarded = /^[=+\-@\t]/.test(s) ? "'" + s : s;
    return `"${guarded.replace(/"/g, '""')}"`;
  }

  // 服务端打包（e2ee 材料不包含，服务器无法解密）
  async function serverExport() {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKeys: Array.from(selected), includeCertificates: includeCerts }),
    });
    if (res.status === 403) {
      const data = await res.json();
      if (data.code === "SENSITIVE_VERIFY_REQUIRED") {
        setVerifyOpen(true);
        return;
      }
      throw new Error(data.error ?? "导出失败");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "导出失败");
    }
    const blob = await res.blob();
    downloadBlob(blob, res.headers.get("Content-Disposition"));
    await loadRecords();
  }

  // 本机打包：e2ee 材料在浏览器内解密后放入 zip（内容不经过服务器明文）
  async function clientExport() {
    const keys = Array.from(selected);
    // 汇总所选分类的文件清单
    const lists = await Promise.all(
      keys.map((k) => api<{ documents: ExportDoc[] }>(`/api/documents?categoryKey=${k}`))
    );
    const docs = lists.flatMap((l) => l.documents);
    if (docs.length === 0) throw new Error("所选分类暂无文件，先去上传吧");

    // 敏感材料需要先过二次验证（文件接口有门禁）
    if (docs.some((d) => d.isSensitive)) {
      const { granted } = await api<{ granted: boolean }>("/api/auth/sensitive-verify");
      if (!granted) {
        setVerifyOpen(true);
        return;
      }
    }

    // 向服务端申请防伪存证票据（服务端校验材料归属并签发官方编号与权威材料摘要）
    const ticketRes = await api<{ verifyCode: string; manifestSummary: string; ticket: string }>(
      "/api/export/ticket",
      {
        method: "POST",
        body: JSON.stringify({
          categoryKeys: keys,
          watermarkText: enableWatermark && watermarkText.trim() ? watermarkText.trim() : undefined,
        }),
      }
    );
    const { verifyCode, ticket } = ticketRes;

    const JSZip = (await import("jszip")).default;
    const { fetchFileBytes } = await import("@/lib/e2ee");
    const zip = new JSZip();
    const manifest: string[] = ["分类,标题,子类,敏感加密,上传时间"];
    let skipped = 0;

    for (const d of docs) {
      try {
        let bytes: Uint8Array;
        if (d.e2ee) {
          ({ bytes } = await fetchFileBytes(d.id, d.mimeType));
        } else {
          const res = await fetch(`/api/documents/${d.id}/file`);
          if (!res.ok) throw new Error("fetch failed");
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        const mainCat = d.category.parent?.name ?? d.category.name;
        const sub = d.category.parent ? d.category.name : "未分类";
        const origExt = (d.fileName?.split(".").pop() || "").toLowerCase();
        let ext =
          d.mimeType === "application/pdf"
            ? "pdf"
            : origExt === "png" || d.mimeType.includes("png")
              ? "png"
              : "jpg";

        // 若为历史 WebP 数据，在前端 Canvas 解码并以高画质 JPG 输出，彻底解决外部网站格式受限
        const isWebp =
          d.mimeType.includes("webp") ||
          origExt === "webp" ||
          (bytes.length >= 12 &&
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x45 &&
            bytes[10] === 0x42 &&
            bytes[11] === 0x50);

        if (isWebp) {
          try {
            const blob = new Blob([bytes as BlobPart], { type: "image/webp" });
            const imgBitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            canvas.width = imgBitmap.width;
            canvas.height = imgBitmap.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(imgBitmap, 0, 0);
              const jpgBlob = await new Promise<Blob | null>((res) =>
                canvas.toBlob(res, "image/jpeg", 0.95)
              );
              if (jpgBlob) {
                bytes = new Uint8Array(await jpgBlob.arrayBuffer());
                ext = "jpg";
              }
            }
          } catch (e) {
            console.warn("Client transcode failed:", e);
          }
        }

        // 防伪水印与数字盲水印处理
        if (enableWatermark && watermarkText.trim() && ext !== "pdf") {
          try {
            const imgBlob = new Blob([bytes as BlobPart], { type: ext === "png" ? "image/png" : "image/jpeg" });
            const imgBitmap = await createImageBitmap(imgBlob);
            const canvas = document.createElement("canvas");
            canvas.width = imgBitmap.width;
            canvas.height = imgBitmap.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(imgBitmap, 0, 0);
              drawVisibleWatermark(ctx, canvas.width, canvas.height, watermarkText.trim());
              embedBlindWatermark(ctx, canvas.width, canvas.height, `${verifyCode}:${d.id}`);
              const watermarkedBlob = await new Promise<Blob | null>((res) =>
                canvas.toBlob(res, "image/jpeg", 0.95)
              );
              if (watermarkedBlob) {
                bytes = new Uint8Array(await watermarkedBlob.arrayBuffer());
                ext = "jpg";
              }
            }
          } catch (wmErr) {
            console.warn("Watermark render failed:", wmErr);
          }
        }

        const date = d.createdAt.slice(0, 10).replace(/-/g, "");
        const sideSuffix = d.side ? `_${sanitize(d.side)}` : "";
        zip.file(`${sanitize(mainCat)}/${date}_${sanitize(d.title)}${sideSuffix}.${ext}`, bytes);
        manifest.push(
          [csvCell(mainCat), csvCell(d.title), csvCell(sub), csvCell(d.isSensitive ? "是" : "否"), csvCell(d.createdAt.slice(0, 10))].join(",")
        );
      } catch {
        skipped += 1;
      }
    }

    if (includeCerts) {
      try {
        const { certificates } = await api<{
          certificates: { name: string; org: string; level: string; awardedAt: string; note?: string | null }[];
        }>("/api/certificates");
        if (certificates.length) {
          const { decryptText } = await import("@/lib/e2ee");
          const rows = ["证书名称,颁发单位,级别,获得时间,备注"];
          for (const c of certificates) {
            let clearNote = c.note ?? "";
            if (clearNote.startsWith("E2ET:")) {
              clearNote = await decryptText(clearNote).catch(() => "");
            }
            rows.push([csvCell(c.name), csvCell(c.org), csvCell(c.level), csvCell(c.awardedAt.slice(0, 10)), csvCell(clearNote)].join(","));
          }
          zip.file("证书汇总.csv", "\uFEFF" + rows.join("\r\n"));
        }
      } catch {
        /* 证书清单失败不阻塞打包 */
      }
    }
    zip.file("材料清单.csv", "\uFEFF" + manifest.join("\r\n"));

    // 生成不可篡改存证核验证书
    zip.file(
      "档案核验证书.txt",
      `档案核验证书\n` +
      `========================================\n` +
      `核验编号：${verifyCode}\n` +
      `归档时间：${new Date().toLocaleString("zh-CN")}\n` +
      `材料份数：${docs.length} 份\n` +
      `防伪用途：${enableWatermark && watermarkText.trim() ? watermarkText.trim() : "标准归档"}\n` +
      `查验网址：/verify?code=${verifyCode}\n` +
      `========================================\n` +
      `重要提示：本压缩包在生成时计算了唯一不可篡改存证指纹。\n` +
      `任何对包内文件的添加、删除或修改都将导致存证校验失败。\n`
    );

    if (skipped > 0) {
      zip.file("说明.txt", `有 ${skipped} 份材料未能读取（可能端到端加密未解锁，请重新登录后重试）。\n`);
    }

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    // 计算归档包 SHA-256 存证哈希（兼容纯 HTTP 与 HTTPS 环境）
    const sha256 = await computeSha256Hex(await blob.arrayBuffer());

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const fileName = `简册归档包_${stamp}.zip`;
    downloadBlob(blob, null, fileName);

    // 记录导出历史 + 存证指纹（服务端使用有效票据验证并入库，保证存证不可伪造）
    await fetch("/api/export/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket,
        fileName,
        size: blob.size,
        sha256,
      }),
    }).catch(() => {});
    await loadRecords();
  }

  function downloadBlob(blob: Blob, disposition: string | null, fallbackName?: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const match = disposition?.match(/filename\*=UTF-8''(.+)/);
    a.href = url;
    a.download = match ? decodeURIComponent(match[1]) : fallbackName ?? "简册归档包.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function doExport() {
    setExporting(true);
    setError("");
    try {
      if (includeE2ee) {
        await clientExport();
      } else {
        await serverExport();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部标题与快捷场景 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[var(--line)]">
        <div className="flex items-baseline gap-2.5">
          <h1 className="panel-title">导出打包</h1>
          <span className="text-[13.5px] text-[var(--ink-soft)]">
            <span className="font-mono">{records.length}</span> 次归档记录
          </span>
        </div>

        {/* 快捷场景分段控制 (macOS Segmented Control) */}
        <div className="inline-flex p-1 rounded-xl bg-[var(--card-alt)] border border-[var(--line)]">
          {PRESETS.map((preset) => {
            const on =
              preset.keys.length === selected.size &&
              preset.keys.every((k) => selected.has(k));
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => setSelected(new Set(preset.keys))}
                className={`px-3.5 py-1.5 text-[13px] font-medium rounded-lg transition-all cursor-pointer ${
                  on
                    ? "bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 两栏工作区：左侧配置，右侧历史记录 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左侧：打包范围与设置 */}
        <div className="lg:col-span-7 space-y-4">
          {/* 目标推荐 */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--ink-soft)] uppercase tracking-wider px-1">
              目标推荐
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-2.5 shadow-xs space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder="输入目标（如：研究生复试、入职体检、出国签证）"
                  className="flex-1 bg-[var(--input-bg)] border border-[var(--line)] rounded-xl px-3 py-1.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--blue)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAiSuggest();
                  }}
                />
                <button
                  type="button"
                  onClick={handleAiSuggest}
                  disabled={aiSuggesting || !aiGoal.trim()}
                  className="btn btn-ink !py-1.5 !px-3.5 !text-[12.5px] font-semibold !rounded-xl flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-40"
                >
                  {aiSuggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>推荐</span>
                </button>
              </div>
              {aiReason && (
                <div className="text-[12px] text-[var(--blue)] px-1 font-medium">
                  {aiReason}
                </div>
              )}
            </div>
          </div>

          {/* 材料分类选择 (Apple Inset Grouped List) */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--ink-soft)] uppercase tracking-wider px-1">
              选择分类
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] shadow-xs overflow-hidden">
              {CATEGORIES.map((cat) => {
                const on = selected.has(cat.key);
                return (
                  <div
                    key={cat.key}
                    onClick={() => toggle(cat.key)}
                    className="px-4 py-3 flex items-center justify-between hover:bg-[var(--card-alt)] cursor-pointer select-none transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: cat.accent }}
                      />
                      <span className="text-[14.5px] font-semibold text-[var(--ink)]">
                        {cat.name}
                      </span>
                      <span className="text-[13px] text-[var(--ink-faint)] ml-1">
                        <span className="font-mono">{catCounts[cat.key] ?? 0}</span> 份材料
                      </span>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0 ${
                        on
                          ? "bg-[var(--blue)] text-white shadow-xs"
                          : "border border-[var(--line-strong)] bg-[var(--input-bg)]"
                      }`}
                    >
                      {on && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 打包配置 (Apple Inset Grouped List) */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-[var(--ink-soft)] uppercase tracking-wider px-1">
              打包配置
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] shadow-xs overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-[14px] font-medium text-[var(--ink)]">
                  附带证书总目 CSV 清单
                </span>
                <Toggle checked={includeCerts} onChange={setIncludeCerts} />
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-[14px] font-medium text-[var(--ink)]">
                  包含加密材料
                </span>
                <Toggle checked={includeE2ee} onChange={setIncludeE2ee} />
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-[14px] font-medium text-[var(--ink)]">
                  防伪溯源水印
                </span>
                <Toggle checked={enableWatermark} onChange={setEnableWatermark} />
              </div>
              {enableWatermark && (
                <div className="px-4 py-3 bg-[var(--card-alt)] flex items-center gap-3">
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="水印文字，如：仅供入职审核使用"
                    className="w-full text-[13.5px] px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--input-bg)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--blue)] shadow-2xs"
                  />
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 text-[13px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 操作栏 */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="text-[13.5px] text-[var(--ink-soft)] pl-1">
              已选 <span className="font-semibold font-mono text-[var(--ink)]">{selected.size}</span> 个分类 · 包含 <span className="font-semibold font-mono text-[var(--ink)]">{selectedDocCount}</span> 份材料
            </div>
            <button
              type="button"
              onClick={doExport}
              disabled={exporting || selected.size === 0}
              className="btn btn-ink flex items-center justify-center gap-2 !py-2.5 !px-5 !text-[14px] font-semibold !rounded-xl disabled:opacity-40 shrink-0 cursor-pointer"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在生成…</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>打包导出</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 右侧：导出历史记录 */}
        <div className="lg:col-span-5 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-semibold text-[var(--ink-soft)] uppercase tracking-wider">
              最近导出
            </span>
            <span className="text-[12px] text-[var(--ink-faint)]">
              <span className="font-mono">{records.length}</span> 条记录
            </span>
          </div>

          {records.length === 0 ? (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-12 text-center text-[14px] text-[var(--ink-faint)] shadow-xs">
              暂无导出记录
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] shadow-xs overflow-hidden">
              {records.slice(0, 8).map((r) => (
                <div key={r.id} className="p-3.5 hover:bg-[var(--card-alt)] transition-colors space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13.5px] font-semibold text-[var(--ink)] truncate" title={r.fileName}>
                      {r.fileName}
                    </span>
                    <span className="font-mono text-[12px] text-[var(--ink-faint)] shrink-0">
                      {formatBytes(r.size)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[12.5px] text-[var(--ink-soft)]">
                    <span className="truncate">
                      {r.categoryKeys
                        .split(",")
                        .map((k) => KEY_NAMES[k] ?? k)
                        .join(" · ")}
                    </span>
                    <span className="font-mono text-[12px] text-[var(--ink-faint)] shrink-0">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  {r.verifyCode && (
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--line-subtle)] text-[12px]">
                      <span className="text-[var(--ink-faint)] font-mono">
                        核验码：{r.verifyCode}
                      </span>
                      <a
                        href={`/verify?code=${r.verifyCode}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--blue)] hover:underline font-medium"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>查验</span>
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SensitiveVerifyModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onSuccess={() => {
          setVerifyOpen(false);
          doExport();
        }}
      />
    </div>
  );
}
