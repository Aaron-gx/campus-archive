"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Search,
  RefreshCw,
  Copy,
  Check,
  Globe,
  Activity,
  ShieldCheck,
  Database,
  ChevronLeft,
  ChevronRight,
  User as UserIcon,
} from "lucide-react";
import { api } from "@/lib/format";
import { showToast } from "@/components/ui/alert-toast";

interface UserSummary {
  id: string;
  nickname: string;
  account: string;
  school: string | null;
  role: string;
  avatar: string | null;
}

interface AuditLogItem {
  id: string;
  action: string;
  docId: string | null;
  docTitle: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
  user: UserSummary;
}

interface AuditStats {
  totalLogs: number;
  todayLogs: number;
  todayIps: number;
  verifyCount: number;
}

interface UserOption {
  id: string;
  nickname: string;
  account: string;
  role: string;
}

interface LogsApiResponse {
  logs: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: AuditStats;
  users: UserOption[];
}

const ACTION_MAP: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  login: { label: "登录", color: "#10b981", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.25)" },
  logout: { label: "登出", color: "#9ca3af", bg: "rgba(156, 163, 175, 0.12)", border: "rgba(156, 163, 175, 0.25)" },
  verify: { label: "身份验证", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.25)" },
  view: { label: "查看", color: "#0071e3", bg: "rgba(0, 113, 227, 0.12)", border: "rgba(0, 113, 227, 0.25)" },
  download: { label: "下载", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.25)" },
  edit: { label: "编辑", color: "#06b6d4", bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.25)" },
  delete: { label: "删除", color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.25)" },
  export: { label: "导出", color: "#f97316", bg: "rgba(249, 115, 22, 0.12)", border: "rgba(249, 115, 22, 0.25)" },
};

function formatFullTime(isoStr: string) {
  try {
    const d = new Date(isoStr);
    const YYYY = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const HH = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
  } catch {
    return isoStr;
  }
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [stats, setStats] = useState<AuditStats>({
    totalLogs: 0,
    todayLogs: 0,
    todayIps: 0,
    verifyCount: 0,
  });
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  // 筛选状态
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (actionFilter && actionFilter !== "all") params.set("action", actionFilter);
      if (userFilter && userFilter !== "all") params.set("userId", userFilter);
      params.set("page", String(page));
      params.set("pageSize", "25");

      const res = await api<LogsApiResponse>(`/api/admin/logs?${params.toString()}`);
      setLogs(res.logs);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setStats(res.stats);
      if (res.users && res.users.length > 0) {
        setUserOptions(res.users);
      }
    } catch (err) {
      showToast({ label: err instanceof Error ? err.message : "获取审计日志失败", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [q, actionFilter, userFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 复制 IP 功能
  function handleCopyIp(ip: string) {
    if (!ip) return;
    navigator.clipboard.writeText(ip).then(() => {
      setCopiedIp(ip);
      showToast({ label: `已复制 IP: ${ip}`, variant: "success" });
      setTimeout(() => setCopiedIp(null), 2000);
    }).catch(() => {
      showToast({ label: "复制失败", variant: "error" });
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQ(searchInput.trim());
  }

  return (
    <div className="space-y-6 max-w-[1240px] mx-auto pb-16">
      {/* 顶部指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--ink-soft)] font-medium">全站日志总数</div>
            <div className="text-xl font-bold text-[var(--ink)] tracking-tight mt-0.5">
              {stats.totalLogs.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#10b981]/10 text-[#10b981] flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--ink-soft)] font-medium">今日操作</div>
            <div className="text-xl font-bold text-[var(--ink)] tracking-tight mt-0.5">
              {stats.todayLogs.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#06b6d4]/10 text-[#06b6d4] flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--ink-soft)] font-medium">今日活跃 IP</div>
            <div className="text-xl font-bold text-[var(--ink)] tracking-tight mt-0.5">
              {stats.todayIps.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--ink-soft)] font-medium">身份二次验证</div>
            <div className="text-xl font-bold text-[var(--ink)] tracking-tight mt-0.5">
              {stats.verifyCount.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* 筛选与检索控制区 */}
      <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
        {/* 操作类型快速分类 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[var(--line)]">
          {[
            { key: "all", label: "全部" },
            { key: "login", label: "登录" },
            { key: "verify", label: "身份验证" },
            { key: "view", label: "查看" },
            { key: "download", label: "下载" },
            { key: "edit", label: "编辑" },
            { key: "delete", label: "删除" },
            { key: "export", label: "导出" },
          ].map((item) => {
            const active = actionFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setActionFilter(item.key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition cursor-pointer shrink-0 ${
                  active
                    ? "bg-[#0071e3] text-white shadow-2xs"
                    : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:bg-[var(--card)] border border-[var(--line)]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* 综合过滤工具栏 */}
        <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
          <form
            onSubmit={handleSearchSubmit}
            className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md"
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[var(--ink-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索用户、账号、IP、材料名称..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-[var(--card-alt)] border border-[var(--line)] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition text-[var(--ink)]"
              />
            </div>
            <button
              type="submit"
              className="btn btn-secondary !py-2 !px-3.5 !text-xs cursor-pointer shrink-0"
            >
              搜索
            </button>
          </form>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {/* 用户选择下拉 */}
            <select
              value={userFilter}
              onChange={(e) => {
                setUserFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 text-xs rounded-xl bg-[var(--card-alt)] border border-[var(--line)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 cursor-pointer"
            >
              <option value="all">全部用户</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nickname} ({u.account})
                </option>
              ))}
            </select>

            {/* 刷新按钮 */}
            <button
              type="button"
              onClick={() => fetchLogs()}
              disabled={loading}
              className="p-2 rounded-xl bg-[var(--card-alt)] text-[var(--ink-soft)] hover:bg-[var(--card)] border border-[var(--line)] transition cursor-pointer shrink-0 disabled:opacity-50"
              title="刷新日志"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 日志数据表格 */}
      <div className="rounded-2xl bg-[var(--card)] border border-[var(--line)] shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="py-24 text-center text-xs text-[#98a2b3]">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="py-24 text-center text-xs text-[#98a2b3]">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--card-alt)] border-b border-[var(--line)] text-[var(--ink-soft)] font-semibold text-[11.5px]">
                  <th className="py-3 px-4 w-[170px]">操作时间</th>
                  <th className="py-3 px-4 w-[200px]">操作主体</th>
                  <th className="py-3 px-4 w-[110px]">操作类型</th>
                  <th className="py-3 px-4 min-w-[200px]">目标材料 / 明细</th>
                  <th className="py-3 px-4 w-[160px] text-right">客户端 IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {logs.map((log) => {
                  const badge = ACTION_MAP[log.action] ?? {
                    label: log.action,
                    color: "#475467",
                    bg: "#f2f4f7",
                    border: "#e4e7ec",
                  };
                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-[var(--card-alt)] transition-colors"
                    >
                      {/* 时间 */}
                      <td className="py-3 px-4 font-mono text-[11px] text-[var(--ink-faint)] whitespace-nowrap">
                        {formatFullTime(log.createdAt)}
                      </td>

                      {/* 用户 */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-[var(--card-alt)] border border-[var(--line)] flex items-center justify-center shrink-0 text-[var(--ink-soft)] text-xs font-bold overflow-hidden">
                            {log.user.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={log.user.avatar}
                                alt={log.user.nickname}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              log.user.nickname.charAt(0) || <UserIcon className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-[var(--ink)] truncate max-w-[100px]">
                                {log.user.nickname}
                              </span>
                              {log.user.role === "admin" && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#0071e3]/10 text-[#0071e3]">
                                  管理员
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--ink-faint)] truncate max-w-[130px]">
                              {log.user.account}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 操作类型 */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className="px-2.5 py-1 rounded-md font-semibold text-[11px] border"
                          style={{
                            color: badge.color,
                            backgroundColor: badge.bg,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* 目标 / 明细 */}
                      <td className="py-3 px-4">
                        <div className="text-[var(--ink)] font-medium truncate max-w-[340px]">
                          {log.docTitle ?? log.detail ?? "—"}
                        </div>
                        {log.docTitle && log.detail && (
                          <div className="text-[11px] text-[var(--ink-faint)] truncate max-w-[340px] mt-0.5">
                            {log.detail}
                          </div>
                        )}
                      </td>

                      {/* 客户端 IP */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {log.ip ? (
                          <button
                            type="button"
                            onClick={() => handleCopyIp(log.ip!)}
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-md bg-[var(--card-alt)] text-[var(--ink-soft)] border border-[var(--line)] hover:bg-[var(--card)] transition cursor-pointer"
                            title="点击复制 IP"
                          >
                            <span>{log.ip}</span>
                            {copiedIp === log.ip ? (
                              <Check className="w-3 h-3 text-[#10b981]" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 text-[var(--ink-faint)]" />
                            )}
                          </button>
                        ) : (
                          <span className="text-[var(--ink-faint)] text-[11px] font-mono">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 底部分页栏 */}
        <div className="py-3 px-4 border-t border-[var(--line)] flex items-center justify-between text-xs text-[var(--ink-soft)] bg-[var(--card-alt)]">
          <div>
            共 <span className="font-semibold text-[var(--ink)]">{total}</span> 条记录
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--card)] disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
              title="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-medium text-[11.5px] px-2">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--card)] disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
              title="下一页"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
