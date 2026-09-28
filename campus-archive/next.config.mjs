/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["framer-motion", "thinking-orbs", "@remixicon/react", "lucide-react"],
  async headers() {
    const isHttps = process.env.COOKIE_SECURE === "true";
      const isDev = process.env.NODE_ENV !== "production";
      const scriptSrc = isDev
        ? "'self' 'unsafe-eval' 'unsafe-inline' blob:"
        : "'self' 'wasm-unsafe-eval' 'unsafe-inline' blob:";

      const securityHeaders = [
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        ...(isHttps
          ? [
              {
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              },
            ]
          : []),
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src ${scriptSrc}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' blob: https://api.github.com https:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      ];

    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, max-age=0, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // onnxruntime-web 主入口默认是 jsep 构建（WebGPU 版，运行时还要拉取 28MB 的
    // .jsep.wasm）；OCR 只用 WASM 后端，统一重定向到纯 WASM 构建，
    // ppu-paddle-ocr 内部的 "onnxruntime-web" 导入同样被覆盖
    config.resolve.alias["onnxruntime-web$"] = "onnxruntime-web/wasm";

    // ort 的 .mjs 是 ESM（含 import.meta / await import），webpack 需按 ESM 处理，
    // 否则 SWC/Terser 按 script 解析会报语法错误（生产构建失败）
    config.module.rules.push({
      test: /onnxruntime-web[/\\]dist[/\\].*\.mjs$/,
      type: "javascript/esm",
    });
    // 关键：禁用 webpack 对 `new URL(..., import.meta.url)` 的转换。
    // webpack 5 默认会重写该构造（生成运行时 asset 引用），在 Web Worker 里
    // 产物不是字符串，ort 内部对它调用 .replace 会抛 "url.replace is not a function"。
    // 保留原生执行后 ort 自身的 c?.href ?? c 逻辑能正确拿到 URL 字符串。
    config.module.parser = {
      ...(config.module.parser ?? {}),
      javascript: { ...(config.module.parser?.javascript ?? {}), url: false },
    };
    return config;
  },
};

export default nextConfig;
