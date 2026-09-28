// 同步 OCR 静态资源到 public/：
// - onnxruntime-web 的 wasm 运行时（版本随 npm 变化，须与包版本一致，故由脚本复制）
// - PP-OCRv6 模型与字典不随 npm 版本变化，手动放置在 public/models/ocr/，缺失时仅提示
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const ortOut = join(root, "public", "ort");

for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  cpSync(join(ortDist, f), join(ortOut, f));
}
console.log("[sync-ocr-assets] ort wasm ->", ortOut);

const models = ["PP-OCRv6_tiny_det.ort", "PP-OCRv6_tiny_rec.ort", "ppocrv6_tiny_dict.txt"];
const missing = models.filter((f) => !existsSync(join(root, "public", "models", "ocr", f)));
if (missing.length) {
  console.warn(`[sync-ocr-assets] 缺少模型文件: ${missing.join(", ")}（身份证识别将不可用）`);
  console.warn(
    "  下载地址: https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main 下",
    "detection/ort/PP-OCRv6_tiny_det.ort、recognition/ort/PP-OCRv6_tiny_rec.ort、recognition/ppocrv6_tiny_dict.txt",
    "放到 public/models/ocr/"
  );
}
