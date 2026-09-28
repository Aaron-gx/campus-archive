"use client";

import React, { useEffect, useState } from "react";
import { ThinkingOrb as BaseOrb, type ThinkingOrbProps } from "thinking-orbs";

/**
 * 思考球体微组件 (Thinking Orb)
 * 来源：orbs.jakubantalik.com / beautifului.dev
 * 面向 AI 与复杂识别任务的点阵球体加载指示器，支持纯 2D Canvas 与自动深浅色适配
 */
export default function ThinkingOrb(props: ThinkingOrbProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    const s = props.size === 64 ? 64 : 20;
    return <span style={{ display: "inline-block", width: s, height: s }} />;
  }

  return <BaseOrb {...props} />;
}
