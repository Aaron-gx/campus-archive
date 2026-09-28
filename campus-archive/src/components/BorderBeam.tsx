"use client";

import React from "react";

interface BorderBeamProps {
  className?: string;
  duration?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
  style?: React.CSSProperties;
}

/**
 * 边框光束组件 (Border Beam)
 * 参考 beam.jakubantalik.com
 * 在卡片/插槽边框周围平滑巡航的高光光束
 */
export default function BorderBeam({
  className = "",
  duration = 4,
  borderWidth = 1.5,
  colorFrom = "#0071e3",
  colorTo = "#af52de",
  style,
}: BorderBeamProps) {
  return (
    <div
      aria-hidden="true"
      className={`border-beam-container pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit] ${className}`}
      style={{
        padding: `${borderWidth}px`,
        ...style,
      }}
    >
      <div
        className="border-beam-glow"
        style={{
          animationDuration: `${duration}s`,
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 270deg, ${colorFrom} 315deg, ${colorTo} 360deg)`,
        }}
      />
    </div>
  );
}
