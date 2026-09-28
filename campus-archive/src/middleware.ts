import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwt } from "@/lib/jwt";

const SESSION_COOKIE = "session";

/**
 * 边缘中间件鉴权（第一道轻量级无状态门禁）
 * 架构设计说明（审查报告 2.1 纵深防御）：
 * 1. 中间件运行于 Edge 运行时，通过快速校验 JWT 签名与时效，将明显未登录的请求快速重定向至 /login，减轻服务端渲染压力。
 * 2. 真正的权威会话吊销校验（Session Revocation）下沉在服务端布局组件与 API 路由中：
 *    - `src/app/dashboard/layout.tsx` 强制执行 `getSessionUser()` 查验数据库 `prisma.session` 记录，已吊销/已改密会话立即重定向；
 *    - 所有 `/api/*` 接口均强制通过 `getSessionUser()` 验证数据库有效性，双重防线确保会话生命周期严格闭环。
 */
async function isLoggedIn(token?: string) {
  if (!token) return false;
  // 生产环境缺 AUTH_SECRET 时 fail-closed（与 auth.ts / crypto.ts 策略一致）
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") return false;
  try {
    await verifyJwt(token, secret ?? "dev-secret");
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  // 拦截 TRACE 与 TRACK 方法，防止 undici 抛出 TypeError 触发 500
  if (req.method === "TRACE" || req.method === "TRACK") {
    return new NextResponse(null, { status: 405 });
  }

  const { pathname } = req.nextUrl;

  // 全局 CSRF 跨站请求防御（面向所有 /api/* 的写操作 POST/PUT/PATCH/DELETE）
  const isApiMutation =
    pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);

  if (isApiMutation) {
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite === "cross-site") {
      return NextResponse.json({ error: "跨站请求已被拦截 (CSRF Protection)" }, { status: 403 });
    }

    const origin = req.headers.get("origin");
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        const currentHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
        if (originHost !== currentHost) {
          return NextResponse.json({ error: "非法跨域来源 (CSRF Protection)" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "非法来源标头" }, { status: 403 });
      }
    }
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith("/dashboard") && !(await isLoggedIn(token))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // 统一防缓存：杜绝承载凭证与档案元数据的 /api/* 响应被中间代理或共享缓存滞留
  if (pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
    res.headers.set("Pragma", "no-cache");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
