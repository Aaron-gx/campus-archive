import { signJwt, verifyJwt } from "./jwt";
import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

const SESSION_COOKIE = "session";
const SENSITIVE_COOKIE = "sensitive_ok";
const TRUSTED_COOKIE = "trusted_device";
// 二次验证有效期（秒）：查看敏感证件后 10 分钟内免再次输入密码
const SENSITIVE_TTL = 10 * 60;
// 信任设备有效期：30 天
const TRUSTED_TTL = 30 * 24 * 3600;

const isProd = process.env.NODE_ENV === "production";
// 生产环境在纯 HTTP IP 访问时不能设置 secure: true，否则现代浏览器会直接拒收 Cookie 导致无法登录。
// 仅在明确配置 COOKIE_SECURE=true（即已配置 SSL 证书/HTTPS 域名）时才启用 secure 标识。
const isCookieSecure = process.env.COOKIE_SECURE === "true";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s === "dev-secret" || s.includes("change-in-production")) {
    if (isProd) {
      // fail-closed：默认密钥公开可知，等于任何人都可伪造会话 JWT，宁可拒绝服务
      throw new Error(
        "[SECURITY] AUTH_SECRET 未配置（需 32 位以上随机字符串），服务拒绝在生产环境使用默认密钥"
      );
    }
    return s ?? "dev-secret";
  }
  return s;
}

export interface SessionUser {
  id: string;
  nickname: string;
  role: "admin" | "user";
  avatar?: string | null;
}

// 过期 Session/TrustedDevice 节流清理（每小时最多一次，随登录触发）
// SQLite 单文件场景下，放任过期记录堆积会拖慢查询与备份
let lastExpiredCleanup = 0;
function cleanupExpiredAsync() {
  if (Date.now() - lastExpiredCleanup < 60 * 60 * 1000) return;
  lastExpiredCleanup = Date.now();
  void Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    prisma.trustedDevice.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]).catch((err) => console.warn("cleanup expired sessions/devices failed:", err));
}

export async function createSession(userId: string) {
  const sid = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(sid);
  const ttl = 7 * 24 * 3600; // 会话默认有效期 7 天
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
  cleanupExpiredAsync();

  const token = await signJwt({ sub: userId, sid }, secret(), ttl);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isCookieSecure,
    path: "/",
    maxAge: ttl,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const payload = await verifyJwt<{ sub: string; sid?: string }>(token, secret());
      if (payload.sid) {
        const tokenHash = sha256(payload.sid);
        await prisma.session.deleteMany({ where: { tokenHash } });
        sensitiveSessionGrants.delete(payload.sid);
      }
    } catch {
      // 忽略无效令牌的解码错误
    }
  }
  store.delete(SESSION_COOKIE);
  store.delete(SENSITIVE_COOKIE);
  store.delete(TRUSTED_COOKIE); // 退出登录同时取消本设备的敏感免验
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = await verifyJwt<{ sub: string; sid?: string }>(token, secret());
    if (!payload.sid || !payload.sub) return null;
    const tokenHash = sha256(payload.sid);
    const session = await prisma.session.findFirst({
      where: { tokenHash, userId: payload.sub, expiresAt: { gt: new Date() } },
      include: {
        user: { select: { id: true, nickname: true, role: true, avatar: true } },
      },
    });
    if (!session || !session.user) return null;
    return {
      id: session.user.id,
      nickname: session.user.nickname,
      role: session.user.role === "admin" ? "admin" : "user",
      avatar: session.user.avatar ?? null,
    };
  } catch {
    return null;
  }
}

// 管理员守卫：返回管理员会话，未登录/无权限返回 null
export async function getAdminUser(): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (!session || session.role !== "admin") return null;
  return session;
}

// 服务端会话授权白名单（内存 Map：sid -> expiresAtMs）
// 绑定当前会话 sid，保证同一会话无论客户端是否透传 secondary cookie 均可稳定获得敏感权限
const sensitiveSessionGrants = new Map<string, number>();

function cleanupExpiredGrants() {
  const now = Date.now();
  sensitiveSessionGrants.forEach((exp, sid) => {
    if (exp <= now) sensitiveSessionGrants.delete(sid);
  });
}

// —— 敏感证件二次验证：验证密码后签发短时效令牌；可同时登记"信任此设备"（30 天） ——

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function grantSensitiveAccess(
  userId: string,
  opts?: { trustDevice?: boolean; label?: string }
): Promise<boolean> {
  const store = await cookies();
  // 敏感窗口令牌绑定当前会话 sid：会话被吊销（登出/改密/登出全部设备）时随之失效
  let sid: string | undefined;
  const sessionToken = store.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    try {
      const payload = await verifyJwt<{ sub?: string; sid?: string }>(sessionToken, secret());
      if (payload.sub === userId && payload.sid) sid = payload.sid;
    } catch {
      // 会话令牌异常
    }
  }

  // 必须绑定有效会话，否则拒绝虚假签发
  if (!sid) {
    return false;
  }

  // 1. 服务端持久化会话授权（10 分钟）
  cleanupExpiredGrants();
  sensitiveSessionGrants.set(sid, Date.now() + SENSITIVE_TTL * 1000);

  // 2. 签发客户端专用 Cookie
  const token = await signJwt({ sub: userId, scope: "sensitive", sid }, secret(), SENSITIVE_TTL);
  store.set(SENSITIVE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isCookieSecure,
    path: "/",
    maxAge: SENSITIVE_TTL,
  });

  if (opts?.trustDevice) {
    // cookie 存原始随机 token，数据库只存哈希；泄露库也无法伪造 cookie
    const raw = crypto.randomBytes(32).toString("hex");
    await prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        label: opts.label?.slice(0, 120) ?? null,
        expiresAt: new Date(Date.now() + TRUSTED_TTL * 1000),
      },
    });
    store.set(TRUSTED_COOKIE, raw, {
      httpOnly: true,
      sameSite: "lax",
      secure: isCookieSecure,
      path: "/",
      maxAge: TRUSTED_TTL,
    });
  }

  return true;
}

export async function hasSensitiveAccess(userId: string): Promise<boolean> {
  const store = await cookies();

  // 1) 检查服务端会话级授权（绑定 sid，解决客户端跨环境/子请求未透传 secondary cookie 的问题）
  const sessionToken = store.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    try {
      const payload = await verifyJwt<{ sub?: string; sid?: string }>(sessionToken, secret());
      if (payload.sub === userId && payload.sid) {
        const grantExp = sensitiveSessionGrants.get(payload.sid);
        if (grantExp && grantExp > Date.now()) {
          const session = await prisma.session.findFirst({
            where: { tokenHash: sha256(payload.sid), userId, expiresAt: { gt: new Date() } },
            select: { id: true },
          });
          if (session) return true;
        }
      }
    } catch {
      // 忽略
    }
  }

  // 2) 检查 10 分钟验证窗口 Cookie（令牌绑定会话，需会话仍有效）
  const token = store.get(SENSITIVE_COOKIE)?.value;
  if (token) {
    try {
      const payload = await verifyJwt<{ sub: string; scope?: string; sid?: string }>(token, secret());
      if (payload.sub === userId && payload.scope === "sensitive" && payload.sid) {
        const session = await prisma.session.findFirst({
          where: { tokenHash: sha256(payload.sid), userId, expiresAt: { gt: new Date() } },
          select: { id: true },
        });
        if (session) return true;
      }
    } catch {
      /* 过期则继续看信任设备 */
    }
  }

  // 3) 信任设备（30 天）
  const raw = store.get(TRUSTED_COOKIE)?.value;
  if (!raw) return false;
  const device = await prisma.trustedDevice.findFirst({
    where: { tokenHash: sha256(raw), userId, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(device);
}
