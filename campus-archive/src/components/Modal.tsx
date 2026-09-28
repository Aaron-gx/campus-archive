"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { prefersReducedMotion, useIsomorphicLayoutEffect } from "@/components/motion";

/**
 * 弹窗容器：入场走 CSS rise（0.24s 上浮），出场用镜像曲线下沉淡出（0.18s power2.in）
 * 后再卸载 —— 出入同路径对称。关闭途中被重新打开时终止退场并复位。
 * 减弱动效偏好下瞬时关闭。
 */
export default function Modal({
  open,
  onClose,
  maxWidth = 420,
  zIndex,
  children,
}: {
  open: boolean;
  onClose: () => void;
  maxWidth?: number;
  zIndex?: number;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevOpen = useRef(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useIsomorphicLayoutEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = open;
    if (!mounted) return;
    const overlay = overlayRef.current;
    const card = cardRef.current;

    if (wasOpen && !open) {
      if (prefersReducedMotion() || !overlay || !card) {
        setMounted(false);
        return;
      }
      gsap.to(card, { opacity: 0, scale: 0.95, duration: 0.15, ease: "power2.in" });
      gsap.to(overlay, {
        opacity: 0,
        duration: 0.15,
        ease: "power2.in",
        onComplete: () => setMounted(false),
      });
    } else if (!wasOpen && open && overlay && card) {
      // 出场途中被重新打开：终止退场并复位到已打开状态
      gsap.killTweensOf([overlay, card]);
      gsap.set([overlay, card], { clearProps: "opacity,transform,scale" });
    }
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      style={zIndex ? { zIndex } : undefined}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-card" ref={cardRef} style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}
