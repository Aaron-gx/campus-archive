"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export interface AutoLayoutCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  bannerImage?: string;
  badge?: React.ReactNode;
  title?: React.ReactNode;
  footer?: React.ReactNode;
}

export function AutoLayoutCard({
  className,
  bannerImage = "/workspace-banner.jpg",
  badge,
  title,
  footer,
  children,
  ...props
}: AutoLayoutCardProps) {
  return (
    <div
      className={cn(
        "w-full max-w-[390px] bg-[var(--card)] rounded-[30px] p-4 sm:p-5 shadow-[0_20px_50px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.03)] border border-[var(--line)] transition-all",
        className
      )}
      {...props}
    >
      {/* 顶部横幅 */}
      {bannerImage && (
        <div className="relative w-full h-44 rounded-[20px] overflow-hidden bg-[var(--card-alt)] flex-shrink-0">
          <Image
            src={bannerImage}
            alt={typeof title === "string" ? title : "Banner"}
            fill
            className="object-cover"
            priority
          />
          {badge && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-2xl bg-[var(--card)] shadow-[0_4px_16px_rgba(0,0,0,0.12)] border border-[var(--line)] flex items-center justify-center p-2.5 z-10 transition-transform duration-300 hover:scale-105">
              {badge}
            </div>
          )}
        </div>
      )}

      {/* 标题 */}
      {title && (
        typeof title === "string" ? (
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)] mt-5 mb-4 px-1">
            {title}
          </h1>
        ) : (
          title
        )
      )}

      {/* 主体内容 */}
      <div className="px-1">{children}</div>

      {/* 底部元信息区域 */}
      {footer && (
        <div className="pt-4 mt-5 border-t border-[var(--line)] px-1 text-xs text-[var(--ink-soft)]">
          {footer}
        </div>
      )}
    </div>
  );
}

export function AutoLayoutCardDemo() {
  return (
    <div
      className="min-h-screen bg-[#edeae5] flex items-center justify-center p-6"
      style={{ backgroundImage: "url('/texture-wall.png')" }}
    >
      <AutoLayoutCard
        bannerImage="/workspace-banner.jpg"
        title="Auto-layout Interaction"
        footer={
          <div className="space-y-0.5 text-xs text-neutral-500">
            <div>www.config.com</div>
            <div>Last update 2024</div>
          </div>
        }
      >
        <p className="text-sm text-neutral-600">Card content preview</p>
      </AutoLayoutCard>
    </div>
  );
}
