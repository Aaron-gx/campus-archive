import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "简册",
    template: "%s | 简册",
  },
  description:
    "个人证件与重要资料整理库：身份证件、资质证书、重要证明、票据资产，分类归档、本地加密、结构化识别、高效速查、一键导出。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

import { AlertToastContainer } from "@/components/ui/alert-toast";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首帧绘制前标记 JS 可用：配合 CSS 预隐藏入场元素，避免闪现终态；
            3 秒内 GSAP 未就绪则移除标记，保证内容永远可见 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('js-anim');setTimeout(function(){if(!window.__animBooted)document.documentElement.classList.remove('js-anim')},3000);(function(){try{var t=localStorage.getItem('campus_theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();",
          }}
        />
      </head>
      <body className="antialiased">
        {children}
        <AlertToastContainer />
      </body>
    </html>
  );
}
