"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDate } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import { showToast } from "@/components/ui/alert-toast";
import ImageViewer, { type ViewerDoc } from "@/components/ImageViewer";
import {
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  Search,
  X,
} from "lucide-react";

interface Certificate {
  id: string;
  name: string;
  org: string;
  level: string;
  awardedAt: string;
  note: string | null;
  documentId: string | null;
  document?: {
    id: string;
    title: string;
    isSensitive: boolean;
    mimeType?: string;
    fileName?: string;
    size?: number;
    e2ee?: boolean;
    side?: string | null;
    meta?: string | null;
    note?: string | null;
    createdAt?: string;
  } | null;
}

const LEVELS = ["国际级", "国家级", "省级", "市级", "校级", "院级", "其他"];

interface LevelBadgeStyle {
  pill: string;
  dot: string;
}

function getLevelBadgeStyle(level: string): LevelBadgeStyle {
  switch (level) {
    case "国际级":
    case "国家级":
      return {
        pill: "bg-amber-500/10 text-amber-700 border-amber-500/25",
        dot: "bg-amber-500",
      };
    case "省级":
      return {
        pill: "bg-indigo-500/10 text-indigo-700 border-indigo-500/25",
        dot: "bg-indigo-500",
      };
    case "市级":
      return {
        pill: "bg-blue-500/10 text-blue-700 border-blue-500/25",
        dot: "bg-blue-500",
      };
    case "校级":
      return {
        pill: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
        dot: "bg-emerald-500",
      };
    case "院级":
      return {
        pill: "bg-teal-500/10 text-teal-700 border-teal-500/25",
        dot: "bg-teal-500",
      };
    default:
      return {
        pill: "bg-slate-500/10 text-slate-700 border-slate-500/25",
        dot: "bg-slate-400",
      };
  }
}

export default function CertificatesPage() {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 新增弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", org: "", level: "校级", awardedAt: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // 独立编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Certificate | null>(null);
  const [editForm, setEditForm] = useState({ name: "", org: "", level: "校级", awardedAt: "", note: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [generatingBullet, setGeneratingBullet] = useState(false);
  const [resumeBullet, setResumeBullet] = useState("");
  const [copiedBullet, setCopiedBullet] = useState(false);

  // 删除确认弹窗
  const [confirmCert, setConfirmCert] = useState<Certificate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ certificates: Certificate[] }>("/api/certificates");
      const { decryptText } = await import("@/lib/e2ee");
      const list = await Promise.all(
        (data.certificates ?? []).map(async (c) => ({
          ...c,
          note: c.note?.startsWith("E2ET:") ? await decryptText(c.note).catch(() => c.note) : c.note,
        }))
      );
      setCerts(list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 关键指标计算
  const stats = useMemo(() => {
    const total = certs.length;
    const national = certs.filter((c) => c.level === "国际级" || c.level === "国家级").length;
    const provincial = certs.filter((c) => c.level === "省级" || c.level === "市级").length;
    const school = certs.filter((c) => c.level === "校级" || c.level === "院级" || c.level === "其他").length;
    const levelCounts: Record<string, number> = {};
    for (const c of certs) {
      levelCounts[c.level] = (levelCounts[c.level] ?? 0) + 1;
    }
    return { total, national, provincial, school, levelCounts };
  }, [certs]);

  // 过滤后的证书列表
  const filteredCerts = useMemo(() => {
    return certs.filter((c) => {
      if (level && c.level !== level) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchOrg = c.org.toLowerCase().includes(q);
        const matchNote = c.note ? c.note.toLowerCase().includes(q) : false;
        if (!matchName && !matchOrg && !matchNote) return false;
      }
      return true;
    });
  }, [certs, level, query]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const viewerDocs: ViewerDoc[] = useMemo(() => {
    return filteredCerts
      .filter((c) => c.documentId && c.document)
      .map((c) => ({
        id: c.document!.id,
        title: c.document!.title || c.name,
        fileName: c.document!.fileName || `${c.name}.jpg`,
        mimeType: c.document!.mimeType || "image/jpeg",
        size: c.document!.size || 0,
        e2ee: !!c.document!.e2ee,
        isSensitive: !!c.document!.isSensitive,
        side: c.document!.side,
        meta: c.document!.meta,
        note: c.note || c.document!.note,
        createdAt: c.document!.createdAt,
        categoryName: "荣誉证书",
        certificate: {
          id: c.id,
          name: c.name,
          org: c.org,
          level: c.level,
          awardedAt: c.awardedAt,
          note: c.note,
        },
      }));
  }, [filteredCerts]);

  const openViewerForCert = (cert: Certificate) => {
    if (!cert.documentId) return;
    const idx = viewerDocs.findIndex((vd) => vd.id === cert.documentId);
    if (idx >= 0) {
      setViewerIndex(idx);
    }
  };

  async function addCert(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      let noteToSave = form.note.trim() || null;
      if (noteToSave) {
        const { encryptText } = await import("@/lib/e2ee");
        const enc = await encryptText(noteToSave);
        if (enc) noteToSave = enc;
      }
      await api("/api/certificates", { method: "POST", json: { ...form, note: noteToSave } });
      setAddOpen(false);
      setForm({ name: "", org: "", level: "校级", awardedAt: "", note: "" });
      await load();
      showToast.success("登记成功");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function generateResumeBullet() {
    if (generatingBullet || !editForm.name) return;
    setGeneratingBullet(true);
    try {
      const res = await fetch("/api/ai/resume-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "certificate",
          title: editForm.name,
          org: editForm.org,
          level: editForm.level,
          date: editForm.awardedAt,
          note: editForm.note,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast.error(data.error || "生成失败");
        return;
      }
      if (data.ok && data.data?.bullet) {
        setResumeBullet(data.data.bullet);
      }
    } catch {
      showToast.error("生成失败");
    } finally {
      setGeneratingBullet(false);
    }
  }

  function startEdit(cert: Certificate) {
    setEditTarget(cert);
    setEditForm({
      name: cert.name,
      org: cert.org,
      level: cert.level,
      awardedAt: cert.awardedAt.slice(0, 10),
      note: cert.note ?? "",
    });
    setEditError("");
    setResumeBullet("");
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    setEditError("");
    try {
      let noteToSave = editForm.note.trim() || null;
      if (noteToSave) {
        const { encryptText } = await import("@/lib/e2ee");
        const enc = await encryptText(noteToSave);
        if (enc) noteToSave = enc;
      }
      await api(`/api/certificates/${editTarget.id}`, { method: "PATCH", json: { ...editForm, note: noteToSave } });
      setEditOpen(false);
      setEditTarget(null);
      setResumeBullet("");
      await load();
      showToast.success("修改成功");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  }

  function removeCert(cert: Certificate) {
    setConfirmCert(cert);
  }

  async function executeRemoveCert() {
    if (!confirmCert) return;
    setDeleting(true);
    try {
      await api(`/api/certificates/${confirmCert.id}`, { method: "DELETE" });
      setConfirmCert(null);
      await load();
      window.dispatchEvent(new Event("documents_updated"));
      showToast.success("删除成功");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作与搜索栏 (macOS 统一工具栏) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="panel-title">
            证书总目
          </h1>
          <span className="text-[13.5px] text-[var(--ink-soft)] font-mono">
            {certs.length} 项
          </span>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* 搜索框 */}
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索证书…"
              className="pl-9 pr-8 py-2 text-[13.5px] rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--blue)] w-full sm:w-60 transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink)] p-0.5"
                aria-label="清除搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 登记证书按钮 */}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="btn btn-ink flex items-center gap-1.5 !py-2 !px-4 !rounded-xl text-[13.5px] font-medium cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>登记证书</span>
          </button>
        </div>
      </div>

      {/* 紧凑分段控制器 (Segmented Control) */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--card-alt)] border border-[var(--line)] overflow-x-auto no-scrollbar max-w-full">
        <button
          type="button"
          onClick={() => setLevel("")}
          className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer ${
            !level
              ? "bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold"
              : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
          }`}
        >
          全部
          <span className="ml-1.5 font-mono text-[11.5px] opacity-70">{stats.total}</span>
        </button>
        {LEVELS.map((l) => {
          const count = stats.levelCounts[l] ?? 0;
          const active = level === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                active
                  ? "bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
            >
              {l}
              {count > 0 && (
                <span className="ml-1.5 font-mono text-[11.5px] opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* 数据列表 */}
      {loading && certs.length === 0 ? (
        <div className="py-20 text-center text-[14px] text-[var(--ink-faint)]">
          加载中…
        </div>
      ) : filteredCerts.length === 0 ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-14 text-center shadow-xs">
          <div className="text-[14.5px] font-medium text-[var(--ink-soft)]">
            {certs.length === 0 ? "暂无证书记录" : "无匹配记录"}
          </div>
          {certs.length === 0 && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-3.5 btn btn-ink !py-2 !px-4 !rounded-xl inline-flex items-center gap-1.5 text-[13.5px] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>登记证书</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* 桌面端标准表格 (字号与全站一致：标题14.5px，内容13.5px) */}
          <div className="hidden md:block rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-xs overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--card-alt)]/90 border-b border-[var(--line)] text-[13px] font-medium text-[var(--ink-soft)]">
                  <th className="py-3 px-4 font-medium">证书名称</th>
                  <th className="py-3 px-4 font-medium">颁发单位</th>
                  <th className="py-3 px-4 font-medium w-28">级别</th>
                  <th className="py-3 px-4 font-medium w-32">获得时间</th>
                  <th className="py-3 px-4 font-medium">备注</th>
                  <th className="py-3 px-4 font-medium text-right w-28">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] text-[13.5px]">
                {filteredCerts.map((cert) => {
                  const badge = getLevelBadgeStyle(cert.level);
                  return (
                    <tr key={cert.id} className="hover:bg-black/[0.02] transition-colors group">
                      <td className="py-3 px-4">
                        <span className="font-semibold text-[14px] text-[var(--ink)] truncate block max-w-xs lg:max-w-md">
                          {cert.name}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[var(--ink-soft)] text-[13.5px] truncate max-w-[200px]">
                        {cert.org || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium border ${badge.pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          <span>{cert.level}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[var(--ink-soft)] mono text-[13px]">
                        {cert.awardedAt ? formatDate(cert.awardedAt) : "—"}
                      </td>
                      <td className="py-3 px-4 text-[var(--ink-faint)] text-[13px] truncate max-w-[160px]">
                        {cert.note || "—"}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1 opacity-75 group-hover:opacity-100 transition-opacity">
                          {cert.documentId ? (
                            <button
                              type="button"
                              onClick={() => openViewerForCert(cert)}
                              className="p-1.5 rounded-lg text-[var(--blue)] hover:bg-blue-500/10 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="查看原件"
                              aria-label="查看原件"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </button>
                          ) : (
                            <span className="text-[12px] text-[var(--ink-faint)] px-1">未关联</span>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(cert)}
                            className="p-1.5 rounded-lg text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-black/5 transition-colors inline-flex items-center justify-center"
                            title="编辑"
                            aria-label="编辑"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCert(cert)}
                            className="p-1.5 rounded-lg text-[var(--ink-soft)] hover:text-[var(--stamp)] hover:bg-rose-500/10 transition-colors inline-flex items-center justify-center"
                            title="删除"
                            aria-label="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 移动端紧凑分组列表 (iOS Inset Grouped List 风格) */}
          <div className="md:hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] shadow-xs overflow-hidden">
            {filteredCerts.map((cert) => {
              const badge = getLevelBadgeStyle(cert.level);
              return (
                <div key={cert.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-[14.5px] text-[var(--ink)] truncate">
                      {cert.name}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium border shrink-0 ${badge.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                      <span>{cert.level}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[13px] text-[var(--ink-soft)]">
                    <span className="truncate max-w-[200px]">{cert.org}</span>
                    <span className="mono">{cert.awardedAt ? formatDate(cert.awardedAt) : "—"}</span>
                  </div>

                  {cert.note && (
                    <div className="text-[12.5px] text-[var(--ink-faint)] truncate">
                      {cert.note}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1.5 text-[13px]">
                    {cert.documentId ? (
                      <button
                        type="button"
                        onClick={() => openViewerForCert(cert)}
                        className="text-[var(--blue)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>查看原件</span>
                      </button>
                    ) : (
                      <span className="text-[var(--ink-faint)] text-[12px]">未关联原件</span>
                    )}
                    <div className="flex items-center gap-3 font-medium">
                      <button
                        type="button"
                        onClick={() => startEdit(cert)}
                        className="text-[var(--ink-soft)] hover:text-[var(--ink)] cursor-pointer"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCert(cert)}
                        className="text-[var(--stamp)] hover:underline cursor-pointer"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 登记弹窗 */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} maxWidth={480}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setAddOpen(false)}
          aria-label="关闭"
        >
          ✕
        </button>
        <form onSubmit={addCert}>
          <h3 className="modal-title mb-4">登记证书</h3>
          <div className="space-y-3.5">
            <div>
              <label className="label">证书名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="证书名称"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">颁发单位 *</label>
              <input
                value={form.org}
                onChange={(e) => setForm({ ...form, org: e.target.value })}
                placeholder="颁发单位"
                required
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">级别 *</label>
                <select
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: e.target.value })}
                  className="input"
                >
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">获得时间 *</label>
                <input
                  type="date"
                  value={form.awardedAt}
                  onChange={(e) => setForm({ ...form, awardedAt: e.target.value })}
                  required
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="label">备注</label>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="备注"
                className="input"
              />
            </div>
            {formError && <div className="alert-error">{formError}</div>}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="btn btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-ink flex-1 font-semibold"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={editOpen} onClose={() => { setEditOpen(false); setResumeBullet(""); }} maxWidth={480}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => { setEditOpen(false); setResumeBullet(""); }}
          aria-label="关闭"
        >
          ✕
        </button>
        <form onSubmit={saveEdit}>
          <h3 className="modal-title mb-4">编辑证书</h3>
          <div className="space-y-3.5">
            <div>
              <label className="label">证书名称 *</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="证书名称"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">颁发单位 *</label>
              <input
                value={editForm.org}
                onChange={(e) => setEditForm({ ...editForm, org: e.target.value })}
                placeholder="颁发单位"
                required
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">级别 *</label>
                <select
                  value={editForm.level}
                  onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}
                  className="input"
                >
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">获得时间 *</label>
                <input
                  type="date"
                  value={editForm.awardedAt}
                  onChange={(e) => setEditForm({ ...editForm, awardedAt: e.target.value })}
                  required
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="label">备注</label>
              <input
                value={editForm.note}
                onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                placeholder="备注"
                className="input"
              />
            </div>

            <div className="p-3 rounded-xl bg-[#0071E3]/[0.03] border border-[#0071E3]/15 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--ink)]">简历表达</span>
                <button
                  type="button"
                  onClick={generateResumeBullet}
                  disabled={generatingBullet || !editForm.name}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0071E3] hover:underline disabled:opacity-50 cursor-pointer"
                >
                  {generatingBullet ? "生成中…" : resumeBullet ? "重新生成" : "生成"}
                </button>
              </div>
              {resumeBullet ? (
                <div className="flex items-start justify-between gap-2 p-2 rounded-lg bg-[var(--card)] border border-[var(--line-strong)] text-[12.5px] leading-relaxed">
                  <span className="text-[var(--ink)]">{resumeBullet}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(resumeBullet);
                      setCopiedBullet(true);
                      setTimeout(() => setCopiedBullet(false), 1800);
                    }}
                    className="text-[11px] font-medium text-[#0071E3] hover:underline shrink-0 px-1 pt-0.5"
                  >
                    {copiedBullet ? "已复制" : "复制"}
                  </button>
                </div>
              ) : null}
            </div>

            {editError && <div className="alert-error">{editError}</div>}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setEditOpen(false); setResumeBullet(""); }}
                className="btn btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="btn btn-ink flex-1 font-semibold"
              >
                {editSaving ? "保存中…" : "保存修改"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!confirmCert}
        danger
        icon="🏅"
        title="删除证书记录？"
        description={
          confirmCert
            ? `确定删除证书「${confirmCert.name}」吗？`
            : undefined
        }
        confirmText="确认删除"
        cancelText="取消"
        loading={deleting}
        onClose={() => setConfirmCert(null)}
        onConfirm={executeRemoveCert}
      />

      {/* 专属全新工作区图片查看器 */}
      {viewerIndex !== null && viewerDocs.length > 0 && (
        <ImageViewer
          docs={viewerDocs}
          index={viewerIndex}
          onIndex={(i) => setViewerIndex(i)}
          onClose={() => setViewerIndex(null)}
          onDownload={(vd) => {
            const a = document.createElement("a");
            a.href = `/api/documents/${vd.id}/file?download=1`;
            a.download = vd.title || "certificate";
            a.click();
          }}
        />
      )}
    </div>
  );
}
