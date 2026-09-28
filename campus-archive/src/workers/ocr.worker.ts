// 身份证 OCR Worker：PaddleOCR 模型在浏览器本地推理，图片字节不离开设备
//
// 资源全部自托管（public/models/ocr + public/ort），运行时不依赖任何外网，
// 与应用的端到端加密定位一致。
import * as ort from "onnxruntime-web";
import { PaddleOcrService } from "ppu-paddle-ocr/web";

// ppu 默认把 wasm 路径指向 jsDelivr CDN（国内不可达），改为本地
ort.env.wasm.wasmPaths = "/ort/";

let service: PaddleOcrService | null = null;
let ready: Promise<void> | null = null;

function ensureService(): Promise<void> {
  if (!ready) {
    service ??= new PaddleOcrService({
      model: {
        detection: "/models/ocr/PP-OCRv6_tiny_det.ort",
        recognition: "/models/ocr/PP-OCRv6_tiny_rec.ort",
        charactersDictionary: "/models/ocr/ppocrv6_tiny_dict.txt",
      },
      // 固定 WASM 后端：只需自托管 14MB 的 ort-wasm-simd-threaded 文件；
      // WebGPU 需额外 28MB 的 jsep 变体，对单张证件的提速不值
      session: { executionProviders: ["wasm"] },
    });
    ready = service.initialize();
  }
  return ready;
}

type OcrRequest = { id: number; bytes: ArrayBuffer };
type OcrResponse =
  | { id: number; ok: true; text: string; confidence: number; angle: 0 | 90 | 180 | 270 }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<OcrRequest>) => void) | null;
  postMessage(msg: OcrResponse, transfer?: Transferable[]): void;
};

/** 计算 OCR 识别文本的质量得分 */
function scoreOcrText(text: string): number {
  if (!text) return 0;
  let score = 0;

  // 1. 中文字符数量（每个汉字 2 分）
  const cjkMatches = text.match(/[\u4e00-\u9fff]/g);
  if (cjkMatches) {
    score += cjkMatches.length * 2;
  }

  // 2. 证件高频关键词（每个匹配 20 分）
  const docKeywords = [
    /往来港澳/,
    /往来台湾/,
    /通行证/,
    /出入境/,
    /国家移民管理局|移民局/,
    /居民身份证/,
    /公民身份号码/,
    /中华人民共和国/,
    /机动车驾驶证/,
    /准驾车型/,
    /有效期限|有效期至/,
    /出生日期/,
    /签发机关|签发地点/,
    /Card\s*No/i,
    /Date\s*of\s*Birth/i,
    /Valid\s*Until/i,
    /Place\s*of\s*Issue/i,
    /Authority/i,
  ];
  for (const kw of docKeywords) {
    if (kw.test(text)) score += 20;
  }

  // 3. 典型证号匹配（每个匹配 40 分）
  if (/[CWLMH]\s*\d{8}/i.test(text)) score += 40;
  if (/[1-9]\d{5}(?:19|20)\d{6}[\dXx]/.test(text)) score += 40;

  return score;
}

/** 旋转 ImageBitmap 并返回 ArrayBuffer（同时限制单边尺寸不超过 1920 以提高性能和降低内存） */
async function rotateBitmapToBuffer(
  bitmap: ImageBitmap,
  angleDeg: 0 | 90 | 180 | 270
): Promise<ArrayBuffer> {
  const isPerp = angleDeg === 90 || angleDeg === 270;
  let targetW = isPerp ? bitmap.height : bitmap.width;
  let targetH = isPerp ? bitmap.width : bitmap.height;

  const maxDim = Math.max(targetW, targetH);
  let scale = 1;
  if (maxDim > 1920) {
    scale = 1920 / maxDim;
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("OffscreenCanvas 2d context unavailable");

  c2d.save();
  c2d.translate(targetW / 2, targetH / 2);
  c2d.rotate((angleDeg * Math.PI) / 180);
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  c2d.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  c2d.restore();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  return await blob.arrayBuffer();
}

/** 智能方向识别：在竖图或倒置图时自动探测最佳角度 */
async function recognizeWithAutoRotation(
  svc: PaddleOcrService,
  bytes: ArrayBuffer
): Promise<{ text: string; confidence: number; angle: 0 | 90 | 180 | 270 }> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    const res = await svc.recognize(bytes);
    return { text: res.text, confidence: res.confidence, angle: 0 };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    const blob = new Blob([bytes]);
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(blob);
    }

    const isPortrait = bitmap.height > bitmap.width;

    if (isPortrait) {
      // 竖版照片必定旋转了 90° 或 270° 成为横卡。
      // 必须同时比对 90° 与 270°，因为倒置 180° 时也可能有少量对称字符误判出微弱分数。
      // 对比两者得分，得分更高（正向）的才是真正的正向！
      const buf90 = await rotateBitmapToBuffer(bitmap, 90);
      const res90 = await svc.recognize(buf90);
      const score90 = scoreOcrText(res90.text);

      const buf270 = await rotateBitmapToBuffer(bitmap, 270);
      const res270 = await svc.recognize(buf270);
      const score270 = scoreOcrText(res270.text);

      if (score90 >= 30 || score270 >= 30) {
        if (score270 > score90) {
          return { text: res270.text, confidence: res270.confidence, angle: 270 };
        } else {
          return { text: res90.text, confidence: res90.confidence, angle: 90 };
        }
      }

      // 如果 90° 和 270° 得分都很低，可能是竖版文档（如 A4 纸、户口本单页竖排等），测试 0° 与 180°
      const buf0 = Math.max(bitmap.width, bitmap.height) <= 1920 ? bytes : await rotateBitmapToBuffer(bitmap, 0);
      const res0 = await svc.recognize(buf0);
      const score0 = scoreOcrText(res0.text);

      const buf180 = await rotateBitmapToBuffer(bitmap, 180);
      const res180 = await svc.recognize(buf180);
      const score180 = scoreOcrText(res180.text);

      const all = [
        { ...res90, score: score90, angle: 90 as const },
        { ...res270, score: score270, angle: 270 as const },
        { ...res0, score: score0, angle: 0 as const },
        { ...res180, score: score180, angle: 180 as const },
      ];
      all.sort((a, b) => b.score - a.score);
      const best = all[0];
      return { text: best.text, confidence: best.confidence, angle: best.angle };
    } else {
      // 横版照片
      const buf0 = Math.max(bitmap.width, bitmap.height) <= 1920 ? bytes : await rotateBitmapToBuffer(bitmap, 0);
      const res0 = await svc.recognize(buf0);
      const score0 = scoreOcrText(res0.text);
      if (score0 >= 50) {
        return { text: res0.text, confidence: res0.confidence, angle: 0 };
      }

      // 若得分较低，测试倒置 180°
      const buf180 = await rotateBitmapToBuffer(bitmap, 180);
      const res180 = await svc.recognize(buf180);
      const score180 = scoreOcrText(res180.text);
      if (score180 > score0 && score180 >= 50) {
        return { text: res180.text, confidence: res180.confidence, angle: 180 };
      }

      // 依然较低则测试 90 与 270
      const buf90 = await rotateBitmapToBuffer(bitmap, 90);
      const res90 = await svc.recognize(buf90);
      const score90 = scoreOcrText(res90.text);

      const buf270 = await rotateBitmapToBuffer(bitmap, 270);
      const res270 = await svc.recognize(buf270);
      const score270 = scoreOcrText(res270.text);

      const all = [
        { ...res0, score: score0, angle: 0 as const },
        { ...res180, score: score180, angle: 180 as const },
        { ...res90, score: score90, angle: 90 as const },
        { ...res270, score: score270, angle: 270 as const },
      ];
      all.sort((a, b) => b.score - a.score);
      const best = all[0];
      return { text: best.text, confidence: best.confidence, angle: best.angle };
    }
  } catch {
    const res = await svc.recognize(bytes);
    return { text: res.text, confidence: res.confidence, angle: 0 };
  } finally {
    bitmap?.close();
  }
}

ctx.onmessage = async (ev: MessageEvent<OcrRequest>) => {
  const { id, bytes } = ev.data;
  try {
    try {
      await ensureService();
    } catch (initErr) {
      ready = null; // 初始化失败（如资源瞬时不可达），下次调用重试
      throw initErr;
    }
    const result = await recognizeWithAutoRotation(service!, bytes);
    ctx.postMessage({
      id,
      ok: true,
      text: result.text,
      confidence: result.confidence,
      angle: result.angle,
    });
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
