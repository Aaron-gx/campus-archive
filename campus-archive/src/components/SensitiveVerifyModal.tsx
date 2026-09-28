"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { ensureDek, healDekWithVaultPassword } from "@/lib/e2ee";

export default function SensitiveVerifyModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [needVaultPwd, setNeedVaultPwd] = useState(false);
  const [vaultPassword, setVaultPassword] = useState("");
  const [showVaultPassword, setShowVaultPassword] = useState(false);

  function resetForm() {
    setPassword("");
    setShowPassword(false);
    setVaultPassword("");
    setShowVaultPassword(false);
    setNeedVaultPwd(false);
    setTrust(false);
    setError("");
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (needVaultPwd) {
        await healDekWithVaultPassword(vaultPassword, password);
        resetForm();
        onSuccess();
        return;
      }

      const res = await fetch("/api/auth/sensitive-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          trustDevice: trust,
          label: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "验证失败");

      try {
        await ensureDek(password);
      } catch {
        setNeedVaultPwd(true);
        return;
      }

      resetForm();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleCancel} maxWidth={380}>
      <button
        type="button"
        className="modal-close-btn"
        onClick={handleCancel}
        aria-label="关闭"
      >
        ✕
      </button>
      <form onSubmit={submit} autoComplete="off" data-lpignore="true">
        <div className="flex items-center gap-2.5 mb-4">
          <span
            className="flex items-center justify-center rounded-[10px]"
            style={{ width: 36, height: 36, background: "var(--blue)", color: "#fff", fontSize: 16 }}
          >
            🔒
          </span>
          <div>
            <h3 className="modal-title">二次验证</h3>
          </div>
        </div>

        {!needVaultPwd ? (
          <>
            <div className="relative mb-3">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="登录密码"
                autoFocus
                required
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                style={{
                  WebkitTextSecurity: showPassword ? "none" : "disc",
                } as React.CSSProperties}
                className="input pr-10"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 hover:text-gray-600 px-1 select-none"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
            <label
              className="flex items-center gap-2 text-[12.5px] mb-3 cursor-pointer"
              style={{ color: "var(--ink-soft)" }}
            >
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
              信任此设备（30天）
            </label>
            {error && <div className="alert-error mb-3">{error}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={handleCancel} className="btn btn-ghost flex-1">
                取消
              </button>
              <button type="submit" disabled={loading} className="btn btn-ink flex-1">
                {loading ? "验证中…" : "确认身份"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="relative mb-3">
              <input
                type="text"
                value={vaultPassword}
                onChange={(e) => setVaultPassword(e.target.value)}
                placeholder="原建档密码"
                autoFocus
                required
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                style={{
                  WebkitTextSecurity: showVaultPassword ? "none" : "disc",
                } as React.CSSProperties}
                className="input pr-10"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 hover:text-gray-600 px-1 select-none"
                onClick={() => setShowVaultPassword((v) => !v)}
                tabIndex={-1}
              >
                {showVaultPassword ? "🙈" : "👁️"}
              </button>
            </div>
            {error && <div className="alert-error mb-3">{error}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={handleCancel} className="btn btn-ghost flex-1">
                取消
              </button>
              <button type="submit" disabled={loading} className="btn btn-ink flex-1">
                {loading ? "处理中…" : "同步解锁"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
