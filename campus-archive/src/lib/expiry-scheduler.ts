import { prisma } from "@/lib/prisma";
import { checkDocGroupExpiry, type ExpiryResult } from "@/lib/expiry";

export interface DocumentExpiryAlert {
  docId: string;
  title: string;
  categoryKey: string;
  categoryName: string;
  status: "expired" | "expiring";
  label: "已过期" | "即将到期";
  diffDays?: number;
  expiryDateStr?: string;
}

export interface UserExpirySummary {
  expiredCount: number;
  expiringCount: number;
  alerts: DocumentExpiryAlert[];
}

/**
 * 纯本地离线规则引擎：扫描用户档案的有效期限
 * 零 LLM Token 消耗、零网络外发、毫秒级响应
 */
export async function getUserExpiryAlerts(userId: string): Promise<UserExpirySummary> {
  const documents = await prisma.document.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      meta: true,
      isSensitive: true,
      category: {
        select: {
          key: true,
          name: true,
        },
      },
    },
  });

  const alerts: DocumentExpiryAlert[] = [];
  const now = new Date();

  for (const doc of documents) {
    if (!doc.meta) continue;

    // E2ET 密文信封（端到端加密）服务端无法解密，遵循零知识安全原则跳过服务端分析
    if (doc.meta.startsWith("E2ET:")) continue;

    try {
      const parsed = JSON.parse(doc.meta);
      const fields: Array<{ label: string; value: string }> = Array.isArray(parsed?.fields)
        ? parsed.fields
        : [];

      if (fields.length > 0) {
        const res: ExpiryResult = checkDocGroupExpiry(fields, now);
        if (res.status === "expired" || res.status === "expiring") {
          alerts.push({
            docId: doc.id,
            title: doc.title,
            categoryKey: doc.category.key,
            categoryName: doc.category.name,
            status: res.status,
            label: res.label as "已过期" | "即将到期",
            diffDays: res.diffDays,
            expiryDateStr: res.expiryDateStr,
          });
        }
      }
    } catch {
      // 忽略损坏的 meta JSON
    }
  }

  // 排序：已过期在前，即将到期按剩余天数升序
  alerts.sort((a, b) => {
    if (a.status === "expired" && b.status !== "expired") return -1;
    if (a.status !== "expired" && b.status === "expired") return 1;
    return (a.diffDays ?? 0) - (b.diffDays ?? 0);
  });

  const expiredCount = alerts.filter((a) => a.status === "expired").length;
  const expiringCount = alerts.filter((a) => a.status === "expiring").length;

  return {
    expiredCount,
    expiringCount,
    alerts,
  };
}
