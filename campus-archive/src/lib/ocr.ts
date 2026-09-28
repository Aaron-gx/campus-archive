// OCR 客户端封装：懒加载 Web Worker（连带模型资源只在真正识别时才下载）
//
// 用法：const text = await ocrImage(file)  → 交给 parseIdCardText() 解析字段

export interface OcrResult {
  text: string;
  confidence: number;
  angle: 0 | 90 | 180 | 270;
}

type OcrResponse =
  | { id: number; ok: true; text: string; confidence: number; angle?: 0 | 90 | 180 | 270 }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (r: OcrResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/ocr.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<OcrResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.ok) {
        p.resolve({
          text: e.data.text,
          confidence: e.data.confidence,
          angle: e.data.angle ?? 0,
        });
      } else {
        p.reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      pending.forEach((p) => {
        clearTimeout(p.timer);
        p.reject(new Error(`OCR 模块加载失败：${e?.message ?? "未知错误"}`));
      });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** 识别一张图片，返回按行拼接的文本与探测到的正向旋转角度。首次调用包含模型加载（本地文件，秒级）。 */
export function ocrImage(file: File | Blob, timeoutMs = 90_000): Promise<OcrResult> {
  const w = getWorker();
  const id = ++seq;
  return file.arrayBuffer().then(
    (bytes) =>
      new Promise<OcrResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("识别超时，请重试或手动填写"));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        w.postMessage({ id, bytes }, [bytes]);
      })
  );
}

/** 将竖图或旋转过的图片真正转正并生成新的 File 对象 */
export async function rotateImageFile(file: File, angleDeg: number): Promise<File> {
  if (angleDeg === 0 || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const isPerp = angleDeg === 90 || angleDeg === 270;
    const w = isPerp ? bitmap.height : bitmap.width;
    const h = isPerp ? bitmap.width : bitmap.height;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.translate(w / 2, h / 2);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();

    const mime = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mime, 0.95);
    });
    if (!blob) return file;
    return new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
  } catch (err) {
    console.warn("图片自动转正失败，保留原图:", err);
    return file;
  }
}
