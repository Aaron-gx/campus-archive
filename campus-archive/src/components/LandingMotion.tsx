"use client";

import gsap from "gsap";
import { prefersReducedMotion, useIsomorphicLayoutEffect } from "@/components/motion";

/**
 * 落地页入场编排（GSAP）— Apple WWDC 级别
 *
 * 入场序列（Hero 首屏）：
 *   Badge → Title → Text → Actions → 视窗卡片外壳 → 文件行错开浮入
 *   全部使用 power3.out，时间紧凑重叠（-=0.3），有弹性但不夸张
 *
 * 滚动 reveal：
 *   向上浮入 y:28→0 + opacity:0→1，比单纯 fade 有明确方向感
 *
 * 鼠标视差：
 *   背景三层光晕随鼠标偏移，各层系数不同（深浅视差）
 *
 * 减弱动效偏好时全部跳过，内容直接呈现。
 */
export default function LandingMotion() {
  useIsomorphicLayoutEffect(() => {
    (window as unknown as Record<string, unknown>).__animBooted = true;
    if (prefersReducedMotion()) return;

    let cleanupExtras: (() => void) | null = null;

    const ctx = gsap.context(() => {
      // ── Hero 入场序列 ──────────────────────────────────────────
      const title = document.querySelector<HTMLElement>("[data-hero-title]");
      const actions = document.querySelectorAll<HTMLElement>("[data-hero-actions] > *");
      const card = document.querySelector<HTMLElement>("[data-hero-card]");
      const rows = document.querySelectorAll<HTMLElement>("[data-hero-doc-row]");

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // 标题：弹簧感浮入
      if (title) {
        tl.fromTo(
          title,
          { opacity: 0, y: 20, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, clearProps: "transform" }
        );
      }

      // CTA 按钮组：错开出现
      if (actions.length > 0) {
        tl.fromTo(
          actions,
          { opacity: 0, y: 14, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.4, stagger: 0.06, clearProps: "transform" },
          "-=0.28"
        );
      }

      // 视窗卡片外壳：轻微纵深感
      if (card) {
        tl.fromTo(
          card,
          { opacity: 0, y: 24, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out", clearProps: "transform" },
          "-=0.28"
        );
      }

      // 卡片内文件行：错开浮入
      if (rows.length > 0) {
        tl.fromTo(
          rows,
          { opacity: 0, x: -10 },
          { opacity: 1, x: 0, duration: 0.36, stagger: 0.07, ease: "power2.out", clearProps: "transform" },
          "-=0.3"
        );
      }

      // ── 滚动 Reveal（向上浮入）──────────────────────────────────
      const pending = new Set<HTMLElement>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) if (en.isIntersecting) reveal(en.target as HTMLElement);
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.04 }
      );

      function reveal(el: HTMLElement) {
        if (!pending.delete(el)) return;
        io.unobserve(el);
        gsap.fromTo(
          el,
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: 0.6, ease: "power3.out", clearProps: "transform" }
        );
      }

      // 兜底：已在视口内或被快速滚过的元素直接浮现
      function checkPending() {
        pending.forEach((el) => {
          if (el.getBoundingClientRect().top < window.innerHeight * 0.9) reveal(el);
        });
      }

      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        pending.add(el);
        io.observe(el);
      });

      const raf = requestAnimationFrame(checkPending);
      window.addEventListener("scroll", checkPending, { passive: true });

      // ── 背景光晕离屏暂停 ──────────────────────────────────────
      const blobs = gsap.utils.toArray<HTMLElement>(".lp-blob, .lp-blob-2, .lp-blob-3");
      const heroSection = document.querySelector<HTMLElement>("[data-hero-section]");

      function syncBlobs() {
        if (!heroSection || !blobs.length) return;
        const state = heroSection.getBoundingClientRect().bottom > 0 ? "running" : "paused";
        blobs.forEach((b) => (b.style.animationPlayState = state));
      }
      window.addEventListener("scroll", syncBlobs, { passive: true });
      syncBlobs();

      // ── 鼠标视差：背景光晕随鼠标轻微偏移 ──────────────────────
      // 三层光晕各有不同系数，营造深度感
      const blobEls = document.querySelectorAll<HTMLElement>(".lp-blob, .lp-blob-2, .lp-blob-3");
      const parallaxCoeffs = [0.018, 0.028, 0.014]; // 各层偏移系数
      let mouseX = 0;
      let mouseY = 0;
      let rafId: number;

      function onMouseMove(e: MouseEvent) {
        mouseX = e.clientX - window.innerWidth / 2;
        mouseY = e.clientY - window.innerHeight / 2;
      }

      function animateParallax() {
        blobEls.forEach((el, i) => {
          const coeff = parallaxCoeffs[i] ?? 0.02;
          const tx = mouseX * coeff;
          const ty = mouseY * coeff;
          gsap.to(el, {
            x: tx,
            y: ty,
            duration: 2.2,
            ease: "power1.out",
            overwrite: "auto",
          });
        });
        rafId = requestAnimationFrame(animateParallax);
      }

      window.addEventListener("mousemove", onMouseMove, { passive: true });
      rafId = requestAnimationFrame(animateParallax);

      cleanupExtras = () => {
        cancelAnimationFrame(raf);
        cancelAnimationFrame(rafId);
        window.removeEventListener("scroll", checkPending);
        window.removeEventListener("scroll", syncBlobs);
        window.removeEventListener("mousemove", onMouseMove);
        io.disconnect();
      };
    });

    return () => {
      cleanupExtras?.();
      ctx.revert();
    };
  }, []);

  return null;
}
