"use client";

import { useEffect, useLayoutEffect } from "react";
import gsap from "gsap";

// SSR 安全的 useLayoutEffect：客户端在绘制前执行（避免入场前闪一帧终态），服务端退化为 useEffect
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// 统一动画语汇：只动 transform/opacity，强 ease-out，结束后清除内联样式
// 不偏好减弱动效的用户直接跳过（内容保持可见，因为 gsap.from 起始态由 JS 设置）
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 苹果原生视窗切换动效（macOS Crossfade & Subtle Spring）
 * 模拟 macOS Finder / System Settings 的瞬间丝滑淡入，摒弃生硬的向上位移跳动
 */
export function useAppleViewTransition(
  scopeRef: React.RefObject<HTMLElement>,
  deps: unknown[] = [],
  { duration = 0.18 }: { duration?: number } = {}
) {
  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    const scope = scopeRef.current;
    if (!scope) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        scope,
        { opacity: 0.35 },
        {
          opacity: 1,
          duration,
          ease: "power2.out",
          overwrite: "auto",
          clearProps: "opacity,transform",
        }
      );
    }, scope);

    return () => {
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * 兼容旧调用的轻量过渡（已全面移除向上位移，改为 Apple 级丝滑纯净 Crossfade）
 */
export function useStaggerEntrance(
  scopeRef: React.RefObject<HTMLElement>,
  _selector?: string,
  deps: unknown[] = []
) {
  useAppleViewTransition(scopeRef, deps, { duration: 0.16 });
}
