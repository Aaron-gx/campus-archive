"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/format";
import { ensureDek, clearDek } from "@/lib/e2ee";
import { AutoLayoutCard } from "@/components/ui/auto-layout-card";
import { AlertBadge } from "@/components/ui/alert-badge";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

function getSafeRedirect(target: string | null): string {
  if (!target) return "/dashboard";
  if (
    target.startsWith("/") &&
    !target.startsWith("//") &&
    !target.startsWith("/\\") &&
    !target.includes(":")
  ) {
    return target;
  }
  return "/dashboard";
}

export function AuthCardContent({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(initialMode);

  // 登录状态
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // 注册状态
  const [regAccount, setRegAccount] = useState("");
  const [regNickname, setRegNickname] = useState("");
  const [regSchool, setRegSchool] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegPassword2, setShowRegPassword2] = useState(false);
  const [regAgree, setRegAgree] = useState(false);
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // 丝滑无刷新切换
  function switchMode(target: "login" | "register") {
    if (target === mode) return;
    setLoginError("");
    setRegError("");
    setMode(target);
    if (typeof window !== "undefined") {
      const redirect = params.get("redirect");
      const query = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
      window.history.pushState(null, "", (target === "login" ? "/login" : "/register") + query);
    }
  }

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        json: { account: loginAccount, password: loginPassword },
      });
      try {
        await ensureDek(loginPassword);
      } catch (dekErr) {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        clearDek();
        throw new Error(dekErr instanceof Error ? dekErr.message : "端到端密钥初始化失败");
      }
      window.location.href = getSafeRedirect(params.get("redirect"));
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "登录失败");
      setLoginLoading(false);
    }
  }

  async function onRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    if (regPassword !== regPassword2) {
      setRegError("两次输入的密码不一致");
      return;
    }
    if (!regAgree) {
      setRegError("请先同意隐私政策");
      return;
    }
    setRegLoading(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        json: {
          account: regAccount,
          password: regPassword,
          nickname: regNickname,
          school: regSchool,
        },
      });
      await api("/api/auth/login", {
        method: "POST",
        json: { account: regAccount, password: regPassword },
      });
      try {
        await ensureDek(regPassword);
      } catch (dekErr) {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        clearDek();
        throw new Error(dekErr instanceof Error ? dekErr.message : "端到端密钥初始化失败");
      }
      window.location.href = "/dashboard";
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "注册失败");
      setRegLoading(false);
    }
  }

  return (
    <AutoLayoutCard
      bannerImage="/workspace-banner.jpg"
      title={
        <div className="flex items-center justify-between mt-5 mb-4 px-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            {mode === "login" ? "登录" : "注册"}
          </h1>
          {/* Apple 风格丝滑分段选择器 */}
          <div className="relative flex items-center p-1 bg-[var(--card-alt)] rounded-xl border border-[var(--line)]">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={cn(
                "relative z-10 px-3.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer",
                mode === "login"
                  ? "text-[var(--ink)] font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {mode === "login" && (
                <motion.div
                  layoutId="auth-tab-pill"
                  className="absolute inset-0 bg-[var(--card)] rounded-lg shadow-sm"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">登录</span>
            </button>

            <button
              type="button"
              onClick={() => switchMode("register")}
              className={cn(
                "relative z-10 px-3.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer",
                mode === "register"
                  ? "text-[var(--ink)] font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              )}
            >
              {mode === "register" && (
                <motion.div
                  layoutId="auth-tab-pill"
                  className="absolute inset-0 bg-[var(--card)] rounded-lg shadow-sm"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10">注册</span>
            </button>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
          <Link href="/" className="hover:text-[var(--ink)] transition">
            返回首页
          </Link>
          <span>简册</span>
        </div>
      }
    >
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className="overflow-hidden"
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "login" ? (
            <motion.form
              key="login-form"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 14 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onSubmit={onLoginSubmit}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">
                  手机号 / 邮箱
                </label>
                <input
                  value={loginAccount}
                  onChange={(e) => setLoginAccount(e.target.value)}
                  placeholder="手机号或邮箱"
                  autoComplete="username"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1.5">
                  密码
                </label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    required
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowLoginPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {loginError && (
                <AlertBadge variant="error" label={loginError} className="w-full justify-center" />
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 shadow-sm cursor-pointer"
              >
                {loginLoading ? "登录中…" : "登录"}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] underline underline-offset-4 cursor-pointer"
                >
                  注册账号
                </button>
              </div>
            </motion.form>
          ) : (
            <motion.form
              key="register-form"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onSubmit={onRegisterSubmit}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1">
                  手机号 / 邮箱
                </label>
                <input
                  value={regAccount}
                  onChange={(e) => setRegAccount(e.target.value)}
                  placeholder="手机号或邮箱"
                  autoComplete="username"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1">
                  昵称
                </label>
                <input
                  value={regNickname}
                  onChange={(e) => setRegNickname(e.target.value)}
                  placeholder="怎么称呼你"
                  required
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1">
                  学校 / 单位
                </label>
                <input
                  value={regSchool}
                  onChange={(e) => setRegSchool(e.target.value)}
                  placeholder="选填"
                  className="w-full px-3.5 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1">
                    密码
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPassword ? "text" : "password"}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="至少 8 位"
                      autoComplete="new-password"
                      required
                      className="w-full pl-3.5 pr-8 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowRegPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    >
                      {showRegPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink-soft)] mb-1">
                    确认密码
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPassword2 ? "text" : "password"}
                      value={regPassword2}
                      onChange={(e) => setRegPassword2(e.target.value)}
                      placeholder="再次输入"
                      autoComplete="new-password"
                      required
                      className="w-full pl-3.5 pr-8 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--line-strong)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20 focus:border-[var(--blue)] transition-all"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowRegPassword2((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    >
                      {showRegPassword2 ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-xs text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={regAgree}
                  onChange={(e) => setRegAgree(e.target.checked)}
                  className="rounded border-[var(--line-strong)] text-[var(--blue)] focus:ring-[var(--blue)]"
                />
                <span>同意</span>
                <Link
                  href="/privacy"
                  target="_blank"
                  className="underline underline-offset-2 hover:text-[var(--ink)] font-medium"
                >
                  隐私政策
                </Link>
              </label>

              {regError && (
                <AlertBadge variant="error" label={regError} className="w-full justify-center" />
              )}

              <button
                type="submit"
                disabled={regLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 shadow-sm cursor-pointer"
              >
                {regLoading ? "注册中…" : "注册"}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-xs font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] underline underline-offset-4 cursor-pointer"
                >
                  已有账号？直接登录
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </AutoLayoutCard>
  );
}

export default function AuthCard({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-[390px] h-[520px] bg-[var(--card)] border border-[var(--line)] rounded-[30px] animate-pulse" />
      }
    >
      <AuthCardContent initialMode={initialMode} />
    </Suspense>
  );
}
