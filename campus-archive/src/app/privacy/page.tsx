import type { Metadata } from "next";
import PrivacyContent from "./PrivacyContent";

export const metadata: Metadata = {
  title: "隐私政策 · 简册",
  description: "简册平台个人信息保护与数据安全政策：端到端加密、本地端侧处理、十分钟受控查验与物理彻底销毁机制。",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}

