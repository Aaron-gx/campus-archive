import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { formatBytes, formatDate } from "@/lib/format";
import { groupDocs } from "@/lib/document-group";
import { getGithubRepoCountCached } from "@/lib/github";
import Link from "next/link";
import ArchiveCheckCard from "@/components/ArchiveCheckCard";
import { checkDocGroupExpiry } from "@/lib/expiry";

export const dynamic = "force-dynamic";

function parseDocMeta(meta: string | null): { label: string; value: string }[] {
  if (!meta || meta.startsWith("E2ET:")) return [];
  try {
    const parsed: unknown = JSON.parse(meta);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { fields?: unknown }).fields)) {
      return ((parsed as { fields: unknown }).fields as unknown[]).filter(
        (f): f is { label: string; value: string } =>
          !!f && typeof f === "object" && typeof (f as { label?: unknown }).label === "string" && typeof (f as { value?: unknown }).value === "string"
      );
    }
  } catch {
    /* 忽略不合法数据 */
  }
  return [];
}

const CATEGORY_META: Record<
  string,
  {
    accent: string;
    gradient: string;
    badgeBg: string;
    iconSvg: React.ReactNode;
  }
> = {
  identity: {
    accent: "#0071E3",
    gradient: "linear-gradient(135deg, #0071E3, #5AC8FA)",
    badgeBg: "bg-blue-500/10 text-[#0071E3] dark:text-[#0A84FF] border border-blue-500/20",
    iconSvg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[2]">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="11" r="1.8" />
        <path d="M14 9.5h4M14 12.5h3" />
      </svg>
    ),
  },
  certificate: {
    accent: "#FF9500",
    gradient: "linear-gradient(135deg, #FF9500, #FFCC00)",
    badgeBg: "bg-amber-500/10 text-[#D97706] dark:text-[#FF9F0A] border border-amber-500/20",
    iconSvg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[2]">
        <path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.2l5-.7L12 3z" />
      </svg>
    ),
  },
  experience: {
    accent: "#34C759",
    gradient: "linear-gradient(135deg, #34C759, #30D158)",
    badgeBg: "bg-emerald-500/10 text-[#059669] dark:text-[#30D158] border border-emerald-500/20",
    iconSvg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[2]">
        <rect x="3" y="8" width="18" height="12" rx="2" />
        <path d="M8 8V6a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
    ),
  },
  photo: {
    accent: "#AF52DE",
    gradient: "linear-gradient(135deg, #AF52DE, #DA8FFF)",
    badgeBg: "bg-purple-500/10 text-[#7C3AED] dark:text-[#BF5AF2] border border-purple-500/20",
    iconSvg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[2]">
        <rect x="3" y="6.5" width="18" height="13" rx="2" />
        <circle cx="12" cy="13" r="3.2" />
        <path d="M8.5 6.5L10 4h4l1.5 2.5" />
      </svg>
    ),
  },
  portfolio: {
    accent: "#FF2D55",
    gradient: "linear-gradient(135deg, #FF2D55, #FF375F)",
    badgeBg: "bg-rose-500/10 text-[#E11D48] dark:text-[#FF375F] border border-rose-500/20",
    iconSvg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[2]">
        <path d="M3 7l3-3h5l1 2h9v11a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />
      </svg>
    ),
  },
};

export default async function DashboardPage() {
  const session = await getSessionUser();
  if (!session) return null;

  const [categories, allDocsRaw, certCount, recentRaw, githubCount] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: "asc" },
      include: { children: true },
    }),
    prisma.document.findMany({
      where: { userId: session.id },
      select: { id: true, categoryId: true, size: true, isSensitive: true, createdAt: true, groupId: true, title: true },
    }),
    prisma.certificate.count({ where: { userId: session.id } }),
    prisma.document.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { category: { include: { parent: true } } },
    }),
    // GitHub 计数：缓存优先、后台填充，不阻塞整页渲染（外部网络慢时首页仍秒开）
    getGithubRepoCountCached(),
  ]);

  // 按证件性质聚合（正反多面材料合并为一个证件）
  const allDocGroups = groupDocs(allDocsRaw);
  const recentGroups = groupDocs(recentRaw).slice(0, 6);

  // 按主分类聚合
  const mainIdToKey = new Map(categories.map((c) => [c.id, c.key]));
  const childToMain = new Map<string, string>();
  for (const cat of categories) for (const child of cat.children) childToMain.set(child.id, cat.key);
  const statByCat = new Map<string, { count: number; size: number }>();
  let totalSize = 0;
  let encryptedCount = 0;
  for (const g of allDocGroups) {
    const mainKey = mainIdToKey.get(g.main.categoryId) ?? childToMain.get(g.main.categoryId);
    if (!mainKey) continue;
    const stat = statByCat.get(mainKey) ?? { count: 0, size: 0 };
    stat.count += 1;
    for (const d of g.docs) {
      stat.size += d.size;
      totalSize += d.size;
    }
    statByCat.set(mainKey, stat);
    if (g.docs.some((d) => d.isSensitive)) encryptedCount += 1;
  }
  if (githubCount > 0) {
    const pStat = statByCat.get("portfolio") ?? { count: 0, size: 0 };
    pStat.count += githubCount;
    statByCat.set("portfolio", pStat);
  }
  const filled = categories.filter((c) => (statByCat.get(c.key)?.count ?? 0) > 0).length;
  const lastDate = recentGroups[0]?.main.createdAt;
  const encryptedPct = allDocGroups.length > 0 ? Math.round((encryptedCount / allDocGroups.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 顶部操作条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--line)]">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[17px] font-semibold text-[var(--ink)]">总览</span>
          <span className="text-[13px] text-[var(--ink-soft)] font-mono">
            {allDocGroups.length} 份材料 · {certCount} 条证书
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/dashboard/export"
            className="btn btn-ghost !py-1.5 !px-3.5 !rounded-xl text-[13px] font-medium shrink-0 whitespace-nowrap"
          >
            导出打包
          </Link>
          <Link
            href="/dashboard/category/identity"
            className="btn btn-ink !py-1.5 !px-4 !rounded-xl text-[13px] font-medium shrink-0 whitespace-nowrap"
          >
            ＋ 上传材料
          </Link>
        </div>
      </div>

      {/* 统计 Widget 网格 */}
      <div className="index-grid">
        {/* 材料总量 */}
        <div
          className="index-widget"
          style={{ "--widget-accent": "#0071E3", "--widget-spot": "rgba(0,113,227,0.12)" } as React.CSSProperties}
        >
          <div className="index-widget-icon" style={{ background: "linear-gradient(135deg, #0071E3, #5AC8FA)" }}>
            <svg viewBox="0 0 24 24">
              <path d="M3 7l3-3h5l1 2h9v11a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />
            </svg>
          </div>
          <div className="k">材料总量</div>
          <div className="v mono text-[#0071E3] dark:text-[#0A84FF]">
            {allDocGroups.length}
            <small className="text-[var(--ink-faint)]">份</small>
          </div>
          <div className="k" style={{ marginTop: -4 }}>
            包含证书 {certCount} 条
          </div>
        </div>

        {/* 分类覆盖 */}
        <div
          className="index-widget"
          style={{ "--widget-accent": "#34C759", "--widget-spot": "rgba(52,199,89,0.12)" } as React.CSSProperties}
        >
          <div className="index-widget-icon" style={{ background: "linear-gradient(135deg, #34C759, #30D158)" }}>
            <svg viewBox="0 0 24 24">
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div className="k">分类覆盖</div>
          <div className="v mono text-[#2e7d32] dark:text-[#30D158]">
            {filled}
            <small className="text-[var(--ink-faint)]">/ {categories.length} 类</small>
          </div>
          <div className="bar">
            <span style={{ width: `${(filled / Math.max(1, categories.length)) * 100}%` }} />
          </div>
        </div>

        {/* 加密保护 */}
        <div
          className="index-widget"
          style={{ "--widget-accent": "#FF9500", "--widget-spot": "rgba(255,149,0,0.12)" } as React.CSSProperties}
        >
          <div className="index-widget-icon" style={{ background: "linear-gradient(135deg, #FF9500, #FFCC00)" }}>
            <svg viewBox="0 0 24 24">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
          </div>
          <div className="k">加密保护</div>
          <div className="v mono text-[#d97706] dark:text-[#FF9F0A]">
            {encryptedCount}
            <small className="text-[var(--ink-faint)]">份</small>
          </div>
          <div className="k" style={{ marginTop: -4 }}>
            覆盖率 {encryptedPct}%
          </div>
        </div>

        {/* 占用空间 */}
        <div
          className="index-widget"
          style={{ "--widget-accent": "#AF52DE", "--widget-spot": "rgba(175,82,222,0.12)" } as React.CSSProperties}
        >
          <div className="index-widget-icon" style={{ background: "linear-gradient(135deg, #AF52DE, #DA8FFF)" }}>
            <svg viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <div className="k">占用空间</div>
          <div className="v mono text-[#7c3aed] dark:text-[#BF5AF2]" style={{ fontSize: 22 }}>
            {formatBytes(totalSize)}
          </div>
          <div className="k" style={{ marginTop: -4 }}>
            {allDocsRaw.length} 个存储文件
          </div>
        </div>
      </div>

      {/* 五大分类 */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="panel-title" style={{ fontSize: 18 }}>五大分类</div>
          <span className="text-[12.5px] font-mono text-[var(--ink-faint)]">
            {categories.length} 个核心分类
          </span>
        </div>

        <div className="doc-grid">
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat.key] ?? {
              accent: "var(--ink)",
              gradient: "linear-gradient(135deg, #0071E3, #5AC8FA)",
              iconSvg: null,
            };
            const stat = statByCat.get(cat.key) ?? { count: 0, size: 0 };
            return (
              <Link
                key={cat.key}
                href={`/dashboard/category/${cat.key}`}
                className="doc-card group"
                style={{ "--accent": meta.accent } as React.CSSProperties}
              >
                <div className="flex items-center justify-between mb-2">
                  <div
                    className="ico-tile !mb-0"
                    style={{ background: meta.gradient, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}
                  >
                    {meta.iconSvg}
                  </div>
                  <span className="chip !py-1 !px-2.5 !text-[11.5px] font-mono">
                    {cat.children.length} 个子类
                  </span>
                </div>

                <div className="fname" style={{ fontSize: 16 }}>
                  {cat.name}
                </div>

                <div className="fmeta mono" style={{ color: "var(--ink-soft)", fontWeight: 500, fontSize: 12.5 }}>
                  {String(stat.count).padStart(2, "0")} 份材料 · {formatBytes(stat.size)}
                </div>

                <div className="foot !mt-3.5 !pt-2.5 border-t border-[var(--line)]">
                  <span className="text-[12px] text-[var(--ink-soft)]">
                    进入分类
                  </span>
                  <span
                    className="text-[13px] font-semibold transition-transform group-hover:translate-x-1 inline-flex items-center gap-1"
                    style={{ color: "var(--accent)" }}
                  >
                    <span>→</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* 最近归档 */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="panel-title" style={{ fontSize: 18 }}>最近归档</div>
          {lastDate && (
            <span className="text-[12.5px] font-mono text-[var(--ink-faint)]">
              最近更新 {formatDate(lastDate)}
            </span>
          )}
        </div>

        {recentGroups.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">＋</div>
            <b>暂无归档材料</b>
            <div style={{ marginTop: 16 }}>
              <Link href="/dashboard/category/identity" className="btn btn-ink">
                上传材料
              </Link>
            </div>
          </div>
        ) : (
          <div className="cert-table-wrap">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>材料名称</th>
                  <th>所属分类</th>
                  <th>归档日期</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {recentGroups.map((g) => {
                  const doc = g.main;
                  const isSensitive = g.docs.some((d) => d.isSensitive);
                  const groupExp = checkDocGroupExpiry(
                    g.docs.flatMap((d) => parseDocMeta(d.meta))
                  );
                  return (
                    <tr key={g.key}>
                      <td className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-semibold text-[var(--ink)]">
                            {g.title}
                          </span>
                          {g.hasMultiple && (
                            <span className="text-[10.5px] font-mono text-[var(--ink-soft)] bg-black/[0.04] px-1.5 py-0.5 rounded">
                              {g.docs.length} 面
                            </span>
                          )}
                          {groupExp.status === "expired" && (
                            <span className="inline-flex items-center text-[10.5px] font-semibold text-rose-600 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded-full">
                              已过期
                            </span>
                          )}
                          {groupExp.status === "expiring" && (
                            <span className="inline-flex items-center text-[10.5px] font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded-full">
                              即将到期
                            </span>
                          )}
                          {isSensitive && (
                            <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-amber-700 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded-md">
                              🔒 已加密
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                        {(() => {
                          const pKey = doc.category.parent?.key ?? doc.category.key;
                          const meta = CATEGORY_META[pKey];
                          return (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-semibold ${
                                meta
                                  ? meta.badgeBg
                                  : "bg-black/[0.035] dark:bg-white/[0.06] text-[var(--ink-soft)]"
                              }`}
                            >
                              {doc.category.parent?.name ?? doc.category.name}
                              {doc.category.parent ? ` · ${doc.category.name}` : ""}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="mono" style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/dashboard/category/${doc.category.parent?.key ?? doc.category.key}`}
                          className="link-btn text-[12.5px] font-medium"
                          style={{ color: "var(--blue)" }}
                        >
                          查看 →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 档案自检 */}
      <ArchiveCheckCard />
    </div>
  );
}
