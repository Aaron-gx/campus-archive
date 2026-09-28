"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Camera,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Laptop,
  ShieldAlert,
  Loader2,
  FileText,
  Award,
  HardDrive,
  Cpu,
  KeyRound,
  LogOut,
  User,
} from "lucide-react";
import { api, formatBytes, formatDateCn } from "@/lib/format";
import { rewrapDekData, clearDek } from "@/lib/e2ee";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import { showToast } from "@/components/ui/alert-toast";

interface AuditEntry {
  id: string;
  action: string;
  docTitle: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

interface TrustedDeviceEntry {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
}

interface AccountInfo {
  id: string;
  nickname: string;
  role?: string;
  avatar?: string | null;
  phone: string | null;
  email: string | null;
  school: string | null;
  createdAt: string;
  documentCount: number;
  certificateCount: number;
  storageUsed: number;
  auditLogs?: AuditEntry[];
  trustedDevices?: TrustedDeviceEntry[];
}

const ACTION_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  login: { label: "登录", color: "#10b981", bg: "#ecfdf5" },
  logout: { label: "登出", color: "#64748b", bg: "#f1f5f9" },
  view: { label: "查看", color: "#0071e3", bg: "#e8f2fd" },
  download: { label: "下载", color: "#34c759", bg: "#ebf9ee" },
  export: { label: "导出", color: "#5e5ce6", bg: "#efeffd" },
  verify: { label: "身份验证", color: "#ff9500", bg: "#fff6e8" },
  delete: { label: "删除", color: "#ff3b30", bg: "#fdeeed" },
  edit: { label: "编辑", color: "#32ade6", bg: "#eaf6fc" },
};

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [nickname, setNickname] = useState("");
  const [school, setSchool] = useState("");
  const [savedProfile, setSavedProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // 头像上传与移除
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  // 修改密码
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showNewPwd2, setShowNewPwd2] = useState(false);
  const [pwdMsg, setPwdMsg] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  // 账号注销
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 智能解析设置
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiMsg, setAiMsg] = useState("");
  const [aiTestMsg, setAiTestMsg] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);

  // 信任设备
  const [confirmRevokeDevice, setConfirmRevokeDevice] = useState<TrustedDeviceEntry | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  // 安全审计日志弹窗
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("all");

  function formatLogTime(iso: string) {
    try {
      const d = new Date(iso);
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      return `${month}-${day} ${hours}:${mins}`;
    } catch {
      return iso;
    }
  }

  function formatFullTime(iso: string) {
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      const secs = String(d.getSeconds()).padStart(2, "0");
      return `${y}-${month}-${day} ${hours}:${mins}:${secs}`;
    } catch {
      return iso;
    }
  }

  useEffect(() => {
    api<{ user: AccountInfo }>("/api/account")
      .then(({ user }) => {
        setInfo(user);
        setNickname(user.nickname);
        setSchool(user.school ?? "");
      })
      .catch(() => router.push("/login"));

    api<{ config: { hasKey: boolean; maskedKey: string; baseUrl: string; model: string; isCustom: boolean } }>(
      "/api/account/ai-config"
    )
      .then(({ config }) => {
        setAiBaseUrl(config.baseUrl);
        setAiApiKey(config.maskedKey);
        setAiModel(config.model);
      })
      .catch(() => {});
  }, [router]);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await api<{ ok: boolean; avatar: string }>("/api/account/avatar", {
        method: "POST",
        body: fd,
      });
      setInfo((prev) => (prev ? { ...prev, avatar: res.avatar } : prev));
      window.dispatchEvent(new CustomEvent("user_avatar_changed", { detail: { avatar: res.avatar } }));
      showToast.success("头像已更新");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setRemovingAvatar(true);
    try {
      await api("/api/account/avatar", { method: "DELETE" });
      setInfo((prev) => (prev ? { ...prev, avatar: null } : prev));
      window.dispatchEvent(new CustomEvent("user_avatar_changed", { detail: { avatar: null } }));
      showToast.success("已恢复默认头像");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "恢复默认失败");
    } finally {
      setRemovingAvatar(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api("/api/account", { method: "PATCH", json: { nickname, school } });
      setInfo((prev) => (prev ? { ...prev, nickname, school } : prev));
      setSavedProfile(true);
      showToast.success("基本资料已保存");
      router.refresh();
      setTimeout(() => setSavedProfile(false), 2000);
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg("");
    if (newPassword !== newPassword2) {
      setPwdMsg("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < 8) {
      setPwdMsg("新密码需至少 8 位");
      return;
    }
    setChangingPwd(true);
    try {
      let newWrappedKey: string | undefined;
      const rewrapped = await rewrapDekData(oldPassword, newPassword);
      if (rewrapped?.wrappedKey) {
        newWrappedKey = rewrapped.wrappedKey;
      }

      await api("/api/account", {
        method: "PUT",
        json: { oldPassword, newPassword, newWrappedKey },
      });

      clearDek();
      showToast.success("密码已修改，请重新登录");
      router.push("/login");
    } catch (err) {
      setPwdMsg(err instanceof Error ? err.message : "修改失败");
    } finally {
      setChangingPwd(false);
    }
  }

  async function testAi() {
    setAiTestMsg("");
    setAiTesting(true);
    try {
      const res = await api<{ ok: boolean; message?: string; error?: string }>("/api/account/ai-config/test", {
        method: "POST",
        json: { apiKey: aiApiKey, baseUrl: aiBaseUrl, model: aiModel },
      });
      setAiTestMsg(res.message ? `${res.message} ✓` : "连接成功 ✓");
    } catch (err) {
      setAiTestMsg(err instanceof Error ? err.message : "连接失败");
    } finally {
      setAiTesting(false);
    }
  }

  async function saveAi(e?: React.FormEvent) {
    e?.preventDefault();
    setAiMsg("");
    setAiSaving(true);
    try {
      const res = await api<{
        ok: boolean;
        config: { hasKey: boolean; maskedKey: string; baseUrl: string; model: string; isCustom: boolean };
      }>("/api/account/ai-config", {
        method: "POST",
        json: { apiKey: aiApiKey, baseUrl: aiBaseUrl, model: aiModel },
      });
      setAiBaseUrl(res.config.baseUrl);
      setAiApiKey(res.config.maskedKey);
      setAiModel(res.config.model);
      setAiMsg("已保存 ✓");
      showToast.success("智能解析配置已保存");
      setTimeout(() => setAiMsg(""), 2500);
    } catch (err) {
      setAiMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setAiSaving(false);
    }
  }

  async function executeRevokeDevice() {
    if (!confirmRevokeDevice) return;
    setRevoking(true);
    try {
      await api("/api/auth/trusted-devices", { method: "DELETE", json: { id: confirmRevokeDevice.id } });
      const { user } = await api<{ user: AccountInfo }>("/api/account");
      setInfo(user);
      setConfirmRevokeDevice(null);
      showToast.success("已移除设备");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "移除失败");
    } finally {
      setRevoking(false);
    }
  }

  async function revokeAll() {
    setRevokingAll(true);
    try {
      await api("/api/auth/revoke-all", { method: "POST" });
      clearDek();
      showToast.info("已退出所有设备");
      router.push("/login");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "操作失败");
      setRevokingAll(false);
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDeleteMsg("");
    setDeleting(true);
    try {
      await api("/api/account", { method: "DELETE", json: { password: deletePassword, confirm: deleteConfirm } });
      showToast.info("账户已注销");
      router.push("/");
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : "注销失败");
    } finally {
      setDeleting(false);
    }
  }

  if (!info) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#667085]">
        <Loader2 className="w-6 h-6 animate-spin text-[#0071e3]" />
        <span className="text-xs">加载中…</span>
      </div>
    );
  }

  const avatarSrc = info.avatar || "/avatar.png";

  return (
    <div className="max-w-[1200px] mx-auto pb-12">
      {/* ═══ 顶部英雄卡片：用户个人资料与核心指标 ═══ */}
      <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6">
        {/* 左侧：头像与身份标识 */}
        <div className="flex items-center gap-3.5 sm:gap-5">
          <div
            className="relative group cursor-pointer flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
            title="点击更换头像"
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-[var(--card-alt)] border border-[var(--line)] shadow-sm relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarSrc} alt={info.nickname} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[11px] font-medium select-none">
                <Camera className="w-5 h-5 mb-1 stroke-[1.8]" />
                <span>更换头像</span>
              </div>
              {uploadingAvatar && (
                <div className="absolute inset-0 bg-[var(--card)]/85 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#0071e3]" />
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/jpg"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)]">{info.nickname}</span>
              <span className="text-[10.5px] sm:text-[11px] px-2 sm:px-2.5 py-0.5 rounded-full font-semibold bg-[#0071e3]/10 text-[#0071e3]">
                {info.role === "admin" ? "管理员" : "标准账户"}
              </span>
              <span className="text-[10.5px] sm:text-[11px] px-2 sm:px-2.5 py-0.5 rounded-full font-mono font-medium text-[var(--ink-soft)] bg-[var(--card-alt)] border border-[var(--line)]">
                {info.phone ?? info.email}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-[var(--ink-soft)]">
              <span>建档日期：{formatDateCn(info.createdAt)}</span>
              {info.avatar && (
                <button
                  type="button"
                  disabled={removingAvatar}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAvatar();
                  }}
                  className="text-[#e03131] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3 stroke-[2]" />
                  <span>{removingAvatar ? "恢复中…" : "恢复默认头像"}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：统计指标 */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 flex-shrink-0">
          <div className="px-2.5 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-[var(--card-alt)] border border-[var(--line)] text-center min-w-0 flex-1">
            <div className="flex items-center justify-center gap-1 text-[11px] sm:text-xs text-[var(--ink-soft)] mb-1 font-medium">
              <FileText className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#0071e3]" />
              <span>材料数</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-[var(--ink)] font-mono">
              {info.documentCount}
              <small className="text-xs font-normal ml-0.5 text-[var(--ink-soft)]">份</small>
            </div>
          </div>

          <div className="px-2.5 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-[var(--card-alt)] border border-[var(--line)] text-center min-w-0 flex-1">
            <div className="flex items-center justify-center gap-1 text-[11px] sm:text-xs text-[var(--ink-soft)] mb-1 font-medium">
              <Award className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#ff9500]" />
              <span>证书总目</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-[var(--ink)] font-mono">
              {info.certificateCount}
              <small className="text-xs font-normal ml-0.5 text-[var(--ink-soft)]">条</small>
            </div>
          </div>

          <div className="px-2.5 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-[var(--card-alt)] border border-[var(--line)] text-center min-w-0 flex-1">
            <div className="flex items-center justify-center gap-1 text-[11px] sm:text-xs text-[var(--ink-soft)] mb-1 font-medium">
              <HardDrive className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#af52de]" />
              <span>已用空间</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-[var(--ink)] font-mono truncate">{formatBytes(info.storageUsed)}</div>
          </div>
        </div>
      </div>

      {/* ═══ 双栏响应式模块化网格 ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左栏：个人资料、密码与智能引擎 */}
        <div className="lg:col-span-7 space-y-6">
          {/* 基本资料 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[var(--line)]">
              <User className="w-4 h-4 text-[#0071e3]" />
              <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">基本资料</h2>
            </div>
            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">昵称</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    required
                    className="w-full h-10 px-3.5 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">单位 / 学校</label>
                  <input
                    type="text"
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    placeholder="选填"
                    className="w-full h-10 px-3.5 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                {savedProfile && (
                  <span className="text-xs font-medium text-[#12b76a] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> 已保存
                  </span>
                )}
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0077ed] disabled:opacity-50 transition cursor-pointer"
                >
                  {savingProfile ? "正在保存…" : "保存"}
                </button>
              </div>
            </form>
          </div>

          {/* 修改密码 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[var(--line)]">
              <KeyRound className="w-4 h-4 text-[#ff9500]" />
              <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">修改密码</h2>
            </div>
            <form onSubmit={changePassword} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">当前密码</label>
                  <div className="relative">
                    <input
                      type={showOldPwd ? "text" : "password"}
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full h-10 pl-3.5 pr-9 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-sm text-[var(--ink)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowOldPwd(!showOldPwd)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      {showOldPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">新密码</label>
                  <div className="relative">
                    <input
                      type={showNewPwd ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="至少 8 位"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full h-10 pl-3.5 pr-9 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowNewPwd(!showNewPwd)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">确认新密码</label>
                  <div className="relative">
                    <input
                      type={showNewPwd2 ? "text" : "password"}
                      value={newPassword2}
                      onChange={(e) => setNewPassword2(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="w-full h-10 pl-3.5 pr-9 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-sm text-[var(--ink)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowNewPwd2(!showNewPwd2)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      {showNewPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {pwdMsg && (
                <div className="text-xs font-medium text-[#f04438] bg-[#fef3f2] dark:bg-[#fef3f2]/10 border border-[#fee4e2] dark:border-[#f04438]/20 px-3 py-2 rounded-lg">
                  {pwdMsg}
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={changingPwd}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0077ed] disabled:opacity-50 transition cursor-pointer"
                >
                  {changingPwd ? "正在修改…" : "确认修改"}
                </button>
              </div>
            </form>
          </div>

          {/* 智能解析 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[var(--line)]">
              <Cpu className="w-4 h-4 text-[#af52de]" />
              <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">智能解析</h2>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">接口地址</label>
                  <input
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full h-10 px-3.5 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-xs font-mono text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">模型名称</label>
                  <input
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="deepseek-chat"
                    className="w-full h-10 px-3.5 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-xs font-mono text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">API Key</label>
                <div className="relative">
                  <input
                    type={showAiKey ? "text" : "password"}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    className="w-full h-10 pl-3.5 pr-9 rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-xs font-mono text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowAiKey(!showAiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    {showAiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {aiTestMsg && (
                <div
                  className={`text-xs font-medium px-3 py-2 rounded-lg border ${
                    aiTestMsg.includes("✓")
                      ? "text-[#027a48] bg-[#ecfdf3] dark:bg-[#ecfdf3]/10 border-[#d1fadf] dark:border-[#027a48]/20"
                      : "text-[#b42318] bg-[#fef3f2] dark:bg-[#fef3f2]/10 border-[#fee4e2] dark:border-[#b42318]/20"
                  }`}
                >
                  {aiTestMsg}
                </div>
              )}

              {aiMsg && (
                <div
                  className={`text-xs font-medium px-3 py-2 rounded-lg border ${
                    aiMsg.includes("✓")
                      ? "text-[#027a48] bg-[#ecfdf3] dark:bg-[#ecfdf3]/10 border-[#d1fadf] dark:border-[#027a48]/20"
                      : "text-[#b42318] bg-[#fef3f2] dark:bg-[#fef3f2]/10 border-[#fee4e2] dark:border-[#b42318]/20"
                  }`}
                >
                  {aiMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={aiTesting}
                  onClick={testAi}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--card-alt)] text-[var(--ink)] hover:bg-[var(--line)] border border-[var(--line)] disabled:opacity-50 transition cursor-pointer"
                >
                  {aiTesting ? "正在测试…" : "测试连接"}
                </button>
                <button
                  type="button"
                  disabled={aiSaving}
                  onClick={() => saveAi()}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0077ed] disabled:opacity-50 transition cursor-pointer"
                >
                  {aiSaving ? "正在保存…" : "保存配置"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 右栏：信任设备、最近操作与隐私数据 */}
        <div className="lg:col-span-5 space-y-6">
          {/* 信任设备 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--line)]">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-[#0071e3]" />
                <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">
                  信任设备 ({info.trustedDevices?.length ?? 0})
                </h2>
              </div>
              <button
                type="button"
                disabled={revokingAll}
                onClick={revokeAll}
                className="text-xs font-semibold text-[#d92d20] hover:text-[#b42318] hover:underline disabled:opacity-50 transition cursor-pointer flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{revokingAll ? "退出中…" : "退出所有设备"}</span>
              </button>
            </div>

            {(info.trustedDevices?.length ?? 0) === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--ink-faint)]">暂无记录</div>
            ) : (
              <div className="space-y-2.5">
                {info.trustedDevices?.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 rounded-xl p-3 bg-[var(--card-alt)] border border-[var(--line)]"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#0071e3]/10 text-[#0071e3] flex-shrink-0">
                      <Laptop className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--ink)] truncate">
                        {(d.label ?? "未知设备").replace(/\(.*?\)/g, "").slice(0, 40) || "未知设备"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--ink-soft)]">
                        至 {new Date(d.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeDevice(d)}
                      className="text-xs font-semibold text-[#d92d20] hover:bg-[#fee4e2]/20 px-2 py-1 rounded-lg transition cursor-pointer flex-shrink-0"
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 最近操作审计 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--line)]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--ink-soft)]" />
                <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">
                  最近操作 ({info.auditLogs?.length ?? 0})
                </h2>
              </div>
              {(info.auditLogs?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setAuditModalOpen(true)}
                  className="text-xs font-semibold text-[#0071e3] hover:underline cursor-pointer"
                >
                  查看全部
                </button>
              )}
            </div>

            {(info.auditLogs?.length ?? 0) === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--ink-faint)]">暂无记录</div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                {info.auditLogs?.slice(0, 15).map((log) => {
                  const badge = ACTION_BADGES[log.action] ?? {
                    label: log.action,
                    color: "#475467",
                    bg: "#f2f4f7",
                  };
                  return (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-2 text-xs py-2 px-3 rounded-lg bg-[var(--card-alt)] border border-[var(--line)]"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="px-2 py-0.5 rounded-md font-semibold text-[11px] flex-shrink-0"
                          style={{ color: badge.color, backgroundColor: badge.bg }}
                        >
                          {badge.label}
                        </span>
                        <span className="font-medium text-[var(--ink)] truncate">
                          {log.docTitle ?? log.detail ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {log.ip && (
                          <span
                            className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--card)] text-[var(--ink-soft)] border border-[var(--line)]"
                            title={`访问 IP: ${log.ip}`}
                          >
                            {log.ip}
                          </span>
                        )}
                        <span
                          className="font-mono text-[11px] text-[var(--ink-faint)]"
                          title={formatFullTime(log.createdAt)}
                        >
                          {formatLogTime(log.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 账户注销与隐私 */}
          <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--line)]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#f04438]" />
                <h2 className="font-bold text-[15px] tracking-tight text-[var(--ink)]">数据与隐私</h2>
              </div>
              <Link
                href="/privacy"
                target="_blank"
                className="text-xs font-semibold text-[#0071e3] hover:underline"
              >
                《隐私政策》
              </Link>
            </div>

            {!deleteOpen ? (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-[#d92d20] bg-[#fef3f2] dark:bg-[#fef3f2]/10 hover:bg-[#fee4e2] dark:hover:bg-[#fee4e2]/20 border border-[#fee4e2] dark:border-[#f04438]/20 transition cursor-pointer"
              >
                注销账户并删除全部数据
              </button>
            ) : (
              <form
                onSubmit={deleteAccount}
                className="space-y-3 rounded-xl p-4 bg-[#fef3f2] dark:bg-[#fef3f2]/10 border border-[#fee4e2] dark:border-[#f04438]/20"
              >
                <div className="text-xs font-bold text-[#b42318] dark:text-[#f87171]">确认注销账户？此操作不可恢复。</div>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="输入登录密码确认"
                  required
                  autoComplete="off"
                  className="w-full h-9 px-3 rounded-lg border border-[#fecdca]/30 bg-[var(--input-bg)] text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[#f04438]/20"
                />
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder='输入"注销"确认'
                  required
                  className="w-full h-9 px-3 rounded-lg border border-[#fecdca]/30 bg-[var(--input-bg)] text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[#f04438]/20"
                />

                {deleteMsg && (
                  <div className="text-xs font-medium text-[#b42318] dark:text-[#f87171] bg-[var(--card)] p-2 rounded-lg border border-[#fecdca]/40">
                    {deleteMsg}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteOpen(false);
                      setDeleteMsg("");
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-[var(--card)] border border-[var(--line-strong)] text-[var(--ink)] hover:bg-[var(--card-alt)] transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={deleting}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-[#d92d20] text-white hover:bg-[#b42318] disabled:opacity-50 transition cursor-pointer"
                  >
                    {deleting ? "正在注销…" : "确认注销"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={!!confirmRevokeDevice}
        danger
        icon="💻"
        title="移除信任设备？"
        description={
          confirmRevokeDevice ? `确定移除设备「${confirmRevokeDevice.label || "此设备"}」吗？` : undefined
        }
        confirmText="确认移除"
        cancelText="取消"
        loading={revoking}
        onClose={() => setConfirmRevokeDevice(null)}
        onConfirm={executeRevokeDevice}
      />

      {/* 审计日志弹窗 */}
      <Modal open={auditModalOpen} onClose={() => setAuditModalOpen(false)} maxWidth={580}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setAuditModalOpen(false)}
          aria-label="关闭"
        >
          ✕
        </button>
        <div>
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--line)]">
            <h3 className="modal-title">安全审计日志</h3>
            <span className="text-xs font-mono text-[var(--ink-soft)]">
              共 {info?.auditLogs?.length ?? 0} 条
            </span>
          </div>

          {/* 动作筛选标签 */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-3 border-b border-[var(--line)]">
            {[
              { key: "all", label: "全部" },
              { key: "login", label: "登录" },
              { key: "verify", label: "身份验证" },
              { key: "view", label: "查看" },
              { key: "download", label: "下载" },
              { key: "edit", label: "编辑" },
              { key: "delete", label: "删除" },
              { key: "export", label: "导出" },
            ].map((filter) => {
              const active = auditActionFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setAuditActionFilter(filter.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer shrink-0 ${
                    active
                      ? "bg-[#0071e3] text-white"
                      : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:bg-[var(--line)] border border-[var(--line)]"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {/* 日志列表 */}
          {(() => {
            const filtered = (info?.auditLogs ?? []).filter((l) =>
              auditActionFilter === "all" ? true : l.action === auditActionFilter
            );
            if (filtered.length === 0) {
              return <div className="py-12 text-center text-xs text-[var(--ink-faint)]">暂无记录</div>;
            }
            return (
              <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                {filtered.map((log) => {
                  const badge = ACTION_BADGES[log.action] ?? {
                    label: log.action,
                    color: "#475467",
                    bg: "#f2f4f7",
                  };
                  return (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-3 text-xs p-2.5 rounded-xl bg-[var(--card-alt)] border border-[var(--line)]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          className="px-2 py-0.5 rounded-md font-semibold text-[11px] shrink-0"
                          style={{ color: badge.color, backgroundColor: badge.bg }}
                        >
                          {badge.label}
                        </span>
                        <span className="font-medium text-[var(--ink)] truncate">
                          {log.docTitle ?? log.detail ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {log.ip && (
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-[var(--card)] text-[var(--ink-soft)] border border-[var(--line)] shadow-2xs">
                            {log.ip}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-[var(--ink-faint)]">
                          {formatFullTime(log.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div className="pt-4 mt-4 border-t border-[var(--line)] flex justify-end">
            <button
              type="button"
              onClick={() => setAuditModalOpen(false)}
              className="btn btn-ghost px-5 !text-xs cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
