/**
 * 基于内存滑动窗口的轻量级限流器
 * 专为 2C2G 等小规格服务器优化：
 * - 零外部依赖（无需 Redis）
 * - 内存极低：仅存储时间戳队列
 * - 自动定时淘汰过期桶，防止内存泄露
 */

import { NextResponse } from "next/server";

interface RateLimitConfig {
  windowMs: number; // 窗口时长（毫秒）
  max: number;      // 窗口内最大允许请求数
}

interface ClientRecord {
  timestamps: number[];
  lastSeen: number;
}

class MemoryRateLimiter {
  private records = new Map<string, ClientRecord>();
  private lastCleanup = Date.now();
  private cleanupIntervalMs = 60 * 1000; // 每分钟自动清理一次过期记录

  constructor() {}

  private cleanup(now: number, maxWindowMs: number) {
    if (now - this.lastCleanup < this.cleanupIntervalMs) return;
    this.lastCleanup = now;

    // 清理超过 10 分钟未活动的客户端记录
    const expireThreshold = now - Math.max(maxWindowMs, 10 * 60 * 1000);
    this.records.forEach((rec, key) => {
      if (rec.lastSeen < expireThreshold) {
        this.records.delete(key);
      }
    });
  }

  /**
   * 检查请求是否被限流
   * @param key 标识（如 `login:${ip}`）
   * @param config 规则
   * @returns { success: boolean, remaining: number, resetMs: number }
   */
  public check(key: string, config: RateLimitConfig): { success: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    this.cleanup(now, config.windowMs);

    let rec = this.records.get(key);
    if (!rec) {
      rec = { timestamps: [], lastSeen: now };
      this.records.set(key, rec);
    }

    rec.lastSeen = now;

    // 剔除当前滑动窗口之外的时间戳
    const windowStart = now - config.windowMs;
    rec.timestamps = rec.timestamps.filter((ts) => ts > windowStart);

    if (rec.timestamps.length >= config.max) {
      const oldest = rec.timestamps[0];
      const resetMs = oldest ? Math.max(0, oldest + config.windowMs - now) : config.windowMs;
      return { success: false, remaining: 0, resetMs };
    }

    rec.timestamps.push(now);
    return {
      success: true,
      remaining: config.max - rec.timestamps.length,
      resetMs: config.windowMs,
    };
  }

  /**
   * 只读检查当前滑动窗口内的请求记录，不增加计数
   * @param key 标识
   * @param windowMs 窗口时长（毫秒）
   */
  public peek(key: string, windowMs: number): { count: number; resetMs: number } {
    const now = Date.now();
    const rec = this.records.get(key);
    if (!rec) return { count: 0, resetMs: 0 };

    const windowStart = now - windowMs;
    const valid = rec.timestamps.filter((ts) => ts > windowStart);
    rec.timestamps = valid;

    if (valid.length === 0) return { count: 0, resetMs: 0 };
    const oldest = valid[0];
    const resetMs = oldest ? Math.max(0, oldest + windowMs - now) : windowMs;
    return { count: valid.length, resetMs };
  }

  /**
   * 重置指定 key 的限流计数（如登录成功后清除失败计数）
   */
  public reset(key: string) {
    this.records.delete(key);
  }
}

// 单例共享（注：基于内存运行，单进程单实例有效）
export const rateLimiter = new MemoryRateLimiter();

function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  // IPv4 or IPv6
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip);
}

export function getClientIp(req: Request): string {
  // 1. 优先获取 server-entry 注入的不可伪造的底层 Socket 对端物理 IP
  const socketIp = req.headers.get("x-socket-ip")?.trim();

  // 2. 仅在明确配置 TRUST_PROXY=true 时（如已部署标准 Nginx/Cloudflare 反代网关），
  // 才解析代理标头，且严格取代理链最右侧可信跳，杜绝客户端前置伪造 XFF
  if (process.env.TRUST_PROXY === "true") {
    const cfIp = req.headers.get("cf-connecting-ip")?.trim();
    if (cfIp && isValidIp(cfIp)) return cfIp;

    const realIp = req.headers.get("x-real-ip")?.trim();
    if (realIp && isValidIp(realIp)) return realIp;

    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      const rightmost = parts[parts.length - 1];
      if (rightmost && isValidIp(rightmost)) return rightmost;
    }
  }

  if (socketIp && isValidIp(socketIp)) return socketIp;
  return "127.0.0.1";
}

/**
 * AI 外部调用限流（防成本滥用 DoS）
 * 分级控制：每分钟突发限流 + 每日总配额（24小时滑动窗口）
 * @param userId 当前登录用户
 * @param action 接口标识（用于区分不同 AI 功能的配额）
 * @param maxPerMin 每分钟允许次数
 * @param maxPerDay 每日允许总次数（默认 200 次）
 * @returns null 表示通过；返回 NextResponse 则表示应直接返回的限流响应
 */
export function checkAiRateLimit(
  userId: string,
  action: string,
  maxPerMin: number = 20,
  maxPerDay: number = 200
): ReturnType<typeof NextResponse.json> | null {
  // 1. 每分钟突发限流
  const minKey = `ai:${action}:${userId}`;
  const minLimit = rateLimiter.check(minKey, { windowMs: 60 * 1000, max: maxPerMin });
  if (!minLimit.success) {
    return NextResponse.json(
      { error: "AI 请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(minLimit.resetMs / 1000)) },
      }
    );
  }

  // 2. 每日总配额防成本滥用 (24小时滑动窗口)
  const dayKey = `ai:daily:${userId}`;
  const dayLimit = rateLimiter.check(dayKey, { windowMs: 24 * 60 * 60 * 1000, max: maxPerDay });
  if (!dayLimit.success) {
    return NextResponse.json(
      { error: "今日 AI 调用次数已达上限，请明日再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(dayLimit.resetMs / 1000)) },
      }
    );
  }

  return null;
}
