import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// 过期数据清理间隔（24h）与审计保留天数，可用环境变量覆盖
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 180);

function scheduleCleanup(client: PrismaClient) {
  // 长驻单实例进程的轻量兜底：防止 Session/TrustedDevice/AuditLog 无限增长撑大 SQLite
  const timer = setInterval(() => {
    void (async () => {
      try {
        const auditCutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 3600 * 1000);
        const [sessions, devices, audits] = await Promise.all([
          client.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
          client.trustedDevice.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
          client.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
        ]);
        if (sessions.count || devices.count || audits.count) {
          console.log(
            `[cleanup] expired sessions=${sessions.count}, trustedDevices=${devices.count}, audits>${AUDIT_RETENTION_DAYS}d=${audits.count}`
          );
        }
      } catch (err) {
        console.warn("[cleanup] failed:", err);
      }
    })();
  }, CLEANUP_INTERVAL_MS);
  // 不阻止进程退出
  timer.unref?.();
}

async function initSqlitePragmas(client: PrismaClient) {
  try {
    // 仅在 SQLite 环境（或默认文件库）下执行 PRAGMA 优化
    await client.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
    await client.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
    await client.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  } catch {
    // 忽略非 SQLite 数据库驱动或已配置连接池的兼容错误
  }
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient();

  // 针对高并发读写与小配置服务器（如 2C2G）优化 SQLite：
  // 1. WAL 模式：读写分离不互斥，写操作走 WAL 日志缓冲，读操作并发无阻塞
  // 2. busy_timeout = 5000ms：多请求并发写入时自动重试等待，避免抛出 SQLITE_BUSY
  // 3. synchronous = NORMAL：WAL 模式下的黄金配置，兼具 ACID 安全性与吞吐性能
  void initSqlitePragmas(client);

  scheduleCleanup(client);

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

