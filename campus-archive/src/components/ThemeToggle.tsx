"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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

    function handleThemeChange(e: Event) {
      const customEvent = e as CustomEvent<{ theme: "light" | "dark" }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      }
    }

    window.addEventListener("campus_theme_changed", handleThemeChange);
    return () => window.removeEventListener("campus_theme_changed", handleThemeChange);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("campus_theme", next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
    window.dispatchEvent(new CustomEvent("campus_theme_changed", { detail: { theme: next } }));
  }

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="切换主题"
        className={`p-2 rounded-xl text-[#586380] dark:text-[var(--ink-soft)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${className}`}
      >
        <span className="w-4 h-4 inline-block" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "切换至浅色模式" : "切换至夜间模式"}
      className={`p-2 rounded-xl text-[#586380] dark:text-[var(--ink-soft)] hover:text-[#4255ff] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${className}`}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-amber-400 transition-transform duration-200 rotate-0 hover:rotate-45" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-200 hover:-rotate-12" />
      )}
    </button>
  );
}
