"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clearDek, isUnlocked } from "@/lib/e2ee";
import { formatBytes } from "@/lib/format";
import { useAppleViewTransition } from "@/components/motion";
import { Sun, Moon } from "lucide-react";

const STORAGE_QUOTA = 5 * 1024 * 1024 * 1024; // 5GB

const CATEGORY_NAV = [
  {
    key: "identity",
    label: "身份证件",
    color: "#0071E3",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="11" r="1.8" />
        <path d="M14 9.5h4M14 12.5h3" />
      </>
    ),
  },
  {
    key: "certificate",
    label: "获奖证书",
    color: "#FF9500",
    icon: <path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.2l5-.7L12 3z" />,
  },
  {
    key: "experience",
    label: "经历证明",
    color: "#34C759",
    icon: (
      <>
        <rect x="3" y="8" width="18" height="12" rx="2" />
        <path d="M8 8V6a2 2 0 012-2h4a2 2 0 012 2v2" />
      </>
    ),
  },
  {
    key: "photo",
    label: "活动照片",
    color: "#AF52DE",
    icon: (
      <>
        <rect x="3" y="6.5" width="18" height="13" rx="2" />
        <circle cx="12" cy="13" r="3.2" />
        <path d="M8.5 6.5L10 4h4l1.5 2.5" />
      </>
    ),
  },
  {
    key: "portfolio",
    label: "个人作品集",
    color: "#FF2D55",
    icon: <path d="M3 7l3-3h5l1 2h9v11a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />,
  },
];

const MANAGE_NAV = [
  {
    href: "/dashboard/certificates",
    label: "证书总目",
    color: "#FF9500",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 10h16M11 10v10" />
      </>
    ),
  },
  {
    href: "/dashboard/export",
    label: "导出打包",
    color: "#5E5CE6",
    icon: (
      <>
        <path d="M12 4v11m0 0l-3.5-3.5M12 15l3.5-3.5M5 19h14" />
      </>
    ),
  },
  {
    href: "/dashboard/workshop",
    label: "图片工坊",
    color: "#30B0C7",
    icon: (
      <>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
        <line x1="16" y1="5" x2="22" y2="5" />
        <line x1="19" y1="2" x2="19" y2="8" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </>
    ),
  },
  {
    href: "/dashboard/settings",
    label: "账户设置",
    color: "#8E8E93",
    icon: (
      <>
        <path d="M4 8h8M17 8h3M4 16h3M11 16h9" />
        <circle cx="15" cy="8" r="2" />
        <circle cx="9" cy="16" r="2" />
      </>
    ),
  },
];

const PAGE_TITLES: Record<string, { title: string }> = {
  "/dashboard": { title: "工作台" },
  "/dashboard/certificates": { title: "证书总目" },
  "/dashboard/export": { title: "导出打包" },
  "/dashboard/workshop": { title: "图片工坊" },
  "/dashboard/settings": { title: "账户设置" },
  "/dashboard/users": { title: "人员管理" },
  "/dashboard/logs": { title: "系统日志" },
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

export default function DashboardShell({
  nickname,
  isAdmin,
  avatar,
  children,
}: {
  nickname: string;
  isAdmin?: boolean;
  avatar?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [currentAvatar, setCurrentAvatar] = useState<string | null>(avatar ?? null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const contentRef = useRef<HTMLDivElement>(null);

  // 主题加载与切换
  useEffect(() => {
    try {
      const saved = localStorage.getItem("campus_theme") as "light" | "dark" | null;
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const initial = prefersDark ? "dark" : "light";
        setTheme(initial);
        document.documentElement.setAttribute("data-theme", initial);
      }
    } catch {}
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("campus_theme", next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
  }

  // 端到端密钥守卫
  useEffect(() => {
    if (!isUnlocked()) {
      fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        clearDek();
        window.location.href = "/login";
      });
    }
  }, [pathname]);

  useEffect(() => {
    setCurrentAvatar(avatar ?? null);
  }, [avatar]);

  // 监听头像实时更新
  useEffect(() => {
    function handleAvatarUpdate(e: Event) {
      const customEvent = e as CustomEvent<{ avatar: string | null }>;
      setCurrentAvatar(customEvent.detail?.avatar ?? null);
    }
    window.addEventListener("user_avatar_changed", handleAvatarUpdate);
    return () => window.removeEventListener("user_avatar_changed", handleAvatarUpdate);
  }, []);

  // 恢复边栏收起偏好
  useEffect(() => {
    try {
      const saved = localStorage.getItem("campus_sidebar_collapsed");
      if (saved === "1") setCollapsed(true);
    } catch {}
  }, []);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("campus_sidebar_collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  // 仅内容区做 macOS 风格淡入切换
  useAppleViewTransition(contentRef, [pathname]);

  // 聚光灯动效
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest(".doc-card") as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
        target.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
      }
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // 分类实时计数 + 存储占用
  useEffect(() => {
    function refreshCounts() {
      fetch("/api/categories")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.categories) return;
          const map: Record<string, number> = {};
          for (const c of d.categories) map[c.key] = c.count;
          setCounts(map);
        })
        .catch(() => {});
      fetch("/api/account")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.user && setStorageUsed(d.user.storageUsed))
        .catch(() => {});
    }

    refreshCounts();
    window.addEventListener("documents_updated", refreshCounts);
    return () => window.removeEventListener("documents_updated", refreshCounts);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearDek();
    router.push("/login");
    router.refresh();
  }

  // 顶栏标题
  const categoryKey = pathname.startsWith("/dashboard/category/")
    ? pathname.split("/")[3]
    : null;
  const head =
    (categoryKey && CATEGORY_NAV.find((c) => c.key === categoryKey)
      ? { title: CATEGORY_NAV.find((c) => c.key === categoryKey)!.label }
      : PAGE_TITLES[pathname]) ?? { title: "简册" };

  const storagePct = storageUsed != null ? Math.min(100, (storageUsed / STORAGE_QUOTA) * 100) : 0;
  const avatarSrc = currentAvatar || "/avatar.png";

  return (
    <div className="mac-window">
      {/* 侧边栏（原生纯 CSS 驱动） */}
      <aside className={`mac-side ${collapsed ? "collapsed" : ""}`}>
        <div className="mac-brand">
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0" title="简册 · 工作台">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="简册" className="mac-brand-mark" />
            <div className="brand-text min-w-0">
              <strong>简册</strong>
            </div>
          </Link>
        </div>

        <div className="mac-label">工作台</div>
        <Link
          href="/dashboard"
          className={`mac-item ${isActive(pathname, "/dashboard") ? "active" : ""}`}
          style={{ "--ic": "#0071E3" } as React.CSSProperties}
          title="总览"
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 11l8-6 8 6v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z" />
          </svg>
          <span className="item-label">总览</span>
        </Link>

        <div className="mac-label">分类</div>
        {CATEGORY_NAV.map((item) => {
          const href = `/dashboard/category/${item.key}`;
          return (
            <Link
              key={item.key}
              href={href}
              className={`mac-item ${pathname === href ? "active" : ""}`}
              style={{ "--ic": item.color } as React.CSSProperties}
              title={item.label}
            >
              <svg viewBox="0 0 24 24">{item.icon}</svg>
              <span className="item-label">{item.label}</span>
              <span className="n">{counts[item.key] ?? 0}</span>
            </Link>
          );
        })}

        <div className="mac-label">管理</div>
        {MANAGE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mac-item ${isActive(pathname, item.href) ? "active" : ""}`}
            style={{ "--ic": item.color } as React.CSSProperties}
            title={item.label}
          >
            <svg viewBox="0 0 24 24">{item.icon}</svg>
            <span className="item-label">{item.label}</span>
          </Link>
        ))}
        {isAdmin && (
          <>
            <Link
              href="/dashboard/users"
              className={`mac-item ${isActive(pathname, "/dashboard/users") ? "active" : ""}`}
              style={{ "--ic": "#0071E3" } as React.CSSProperties}
              title="人员管理"
            >
              <svg viewBox="0 0 24 24">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
                <circle cx="16.5" cy="9" r="2.6" />
                <path d="M15.8 14.7c2.7.3 4.3 1.7 4.7 4.3" />
              </svg>
              <span className="item-label">人员管理</span>
            </Link>
            <Link
              href="/dashboard/logs"
              className={`mac-item ${isActive(pathname, "/dashboard/logs") ? "active" : ""}`}
              style={{ "--ic": "#30B0C7" } as React.CSSProperties}
              title="系统日志"
            >
              <svg viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="item-label">系统日志</span>
            </Link>
          </>
        )}

        <div className="mac-foot">
          <div className="st">
            <span>存储空间</span>
            <span>{storageUsed != null ? `${formatBytes(storageUsed)} / 5 GB` : "—"}</span>
          </div>
          <div className="mac-bar">
            <i style={{ transform: `scaleX(${storagePct / 100})` }} />
          </div>
          {/* 用户信息 + 退出 */}
          <div className="mac-foot-user">
            <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 border border-[var(--line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSrc}
                alt={nickname}
                className="w-full h-full object-cover"
              />
            </div>
            <span className="name">{nickname}</span>
            <button type="button" className="logout-btn" onClick={logout} title="退出登录">
              退出
            </button>
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="mac-main">
        {/* 移动端横向导航 */}
        <nav className="mobile-nav">
          <Link href="/dashboard" className={isActive(pathname, "/dashboard") ? "active" : ""}>
            总览
          </Link>
          {CATEGORY_NAV.map((item) => {
            const href = `/dashboard/category/${item.key}`;
            return (
              <Link key={item.key} href={href} className={pathname === href ? "active" : ""}>
                {item.label} {counts[item.key] ?? 0}
              </Link>
            );
          })}
          {MANAGE_NAV.map((item) => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""}>
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/dashboard/users" className={isActive(pathname, "/dashboard/users") ? "active" : ""}>
              人员管理
            </Link>
          )}
        </nav>

        {/* 桌面端 macOS 统一顶栏 */}
        <div className="mac-topbar justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className="sidebar-toggle-btn hidden md:inline-flex"
              title={collapsed ? "展开边栏" : "收起边栏"}
              aria-label={collapsed ? "展开边栏" : "收起边栏"}
            >
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M9 4v16" />
              </svg>
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
                {head.title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line)] transition active:scale-95 cursor-pointer"
            title={theme === "dark" ? "浅色模式" : "深色模式"}
            aria-label={theme === "dark" ? "浅色模式" : "深色模式"}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 stroke-[1.8]" />
            ) : (
              <Moon className="w-4 h-4 stroke-[1.8]" />
            )}
          </button>
        </div>

        <div className="mac-content" ref={contentRef}>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}
