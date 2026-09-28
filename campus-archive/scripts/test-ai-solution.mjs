import { getMaterialSensitivity, assertCloudAllowed, sanitizeAiGeneratedTitle } from "../src/lib/ai-router.ts";
import { isVisionModel } from "../src/lib/ai-config.ts";

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    pass++;
  } else {
    console.error(`  ✗ ${message}`);
    fail++;
  }
}

console.log("=== 1. 隐私分级路由层隔离测试 (ai-router) ===");
assert(getMaterialSensitivity("identity") === "LOCAL", "identity 识别为 LOCAL 本地通道");
assert(getMaterialSensitivity("identity-idcard") === "LOCAL", "identity-idcard 识别为 LOCAL 本地通道");
assert(getMaterialSensitivity("identity-passport") === "LOCAL", "identity-passport 识别为 LOCAL 本地通道");
assert(getMaterialSensitivity("identity-household") === "LOCAL", "identity-household 识别为 LOCAL 本地通道");
assert(getMaterialSensitivity("certificate") === "CLOUD", "certificate 识别为 CLOUD 云端通道");
assert(getMaterialSensitivity("certificate-award") === "CLOUD", "certificate-award 识别为 CLOUD 云端通道");
assert(getMaterialSensitivity("experience-intern") === "CLOUD", "experience-intern 识别为 CLOUD 云端通道");
assert(getMaterialSensitivity("photo-ceremony") === "CLOUD", "photo-ceremony 识别为 CLOUD 云端通道");
assert(getMaterialSensitivity("portfolio-code") === "CLOUD", "portfolio-code 识别为 CLOUD 云端通道");

console.log("\n=== 2. 身份数据外发熔断断言测试 (assertCloudAllowed) ===");
let identityBlocked = false;
try {
  assertCloudAllowed("identity-idcard");
} catch (e) {
  identityBlocked = true;
}
assert(identityBlocked, "身份类材料外发被底层路由硬熔断拦截");

let certAllowed = false;
try {
  assertCloudAllowed("certificate-award");
  certAllowed = true;
} catch (e) {
  certAllowed = false;
}
assert(certAllowed, "非敏感材料允许正常调用云端通道");

console.log("\n=== 3. AGENTS.md Rule 3 规范命名清洗断言 (sanitizeAiGeneratedTitle) ===");
assert(
  sanitizeAiGeneratedTitle("全国大学生数学建模竞赛一等奖-正面") === "全国大学生数学建模竞赛一等奖",
  "清洗 -正面 后缀成功"
);
assert(
  sanitizeAiGeneratedTitle("机动车驾驶证-副页") === "机动车驾驶证",
  "清洗 -副页 后缀成功"
);
assert(
  sanitizeAiGeneratedTitle("居民户口簿 · 本人页") === "居民户口簿",
  "清洗 · 本人页 后缀成功"
);
assert(
  sanitizeAiGeneratedTitle("往来港澳通行证 · 签注") === "往来港澳通行证",
  "清洗 · 签注 后缀成功"
);
assert(
  sanitizeAiGeneratedTitle("标题：腾讯科技实习证明") === "腾讯科技实习证明",
  "清洗多余说明前缀成功"
);

console.log("\n=== 4. DeepSeek 多模态模型族识别断言 (isVisionModel) ===");
assert(isVisionModel("deepseek-vl"), "精准识别 deepseek-vl");
assert(isVisionModel("deepseek-vl2"), "精准识别 deepseek-vl2");
assert(isVisionModel("deepseek-ai/deepseek-vl2"), "精准识别 deepseek-ai/deepseek-vl2");
assert(isVisionModel("deepseek-vision"), "精准识别 deepseek-vision");
assert(isVisionModel("qwen-vl-max"), "兼容识别 qwen-vl-max");
assert(isVisionModel("gpt-4o"), "兼容识别 gpt-4o");
assert(!isVisionModel("deepseek-chat"), "文本模型 deepseek-chat 不误判为多模态");

console.log("\n==========================================");
console.log(`测试结果：通过 ${pass} 项 / 失败 ${fail} 项`);

if (fail > 0) {
  process.exit(1);
}
