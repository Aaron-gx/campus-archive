import { encryptBytes } from "./e2ee";

/**
 * 在客户端使用 Canvas 旋转图片字节并生成新 Blob
 * @param bytes 原始（明文）图片字节
 * @param mime 原始 MIME 类型
 * @param angleDeg 旋转角度（如 90, 180, 270）
 * @param flipH 是否水平翻转
 */
export async function rotateImageBytes(
  bytes: Uint8Array,
  mime: string,
  angleDeg: number,
  flipH = false
): Promise<{ bytes: Uint8Array; mime: string; blob: Blob }> {
  const normAngle = ((angleDeg % 360) + 360) % 360;
  if (normAngle === 0 && !flipH) {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    return { bytes, mime, blob };
  }

  const inputBlob = new Blob([bytes as BlobPart], { type: mime });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布不可用");

  try {
    const bitmap = await createImageBitmap(inputBlob);
    const isPerp = normAngle === 90 || normAngle === 270;
    const w = isPerp ? bitmap.height : bitmap.width;
    const h = isPerp ? bitmap.width : bitmap.height;

    canvas.width = w;
    canvas.height = h;

    ctx.translate(w / 2, h / 2);
    ctx.rotate((normAngle * Math.PI) / 180);
    if (flipH) ctx.scale(-1, 1);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
  } catch {
    // 降级使用 HTMLImageElement
    const u = URL.createObjectURL(inputBlob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = u;
      });

      const isPerp = normAngle === 90 || normAngle === 270;
      const w = isPerp ? img.naturalHeight : img.naturalWidth;
      const h = isPerp ? img.naturalWidth : img.naturalHeight;

      canvas.width = w;
      canvas.height = h;

      ctx.translate(w / 2, h / 2);
      ctx.rotate((normAngle * Math.PI) / 180);
      if (flipH) ctx.scale(-1, 1);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    } finally {
      URL.revokeObjectURL(u);
    }
  }

  const outMime = mime === "image/png" ? "image/png" : "image/webp";
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outMime, 0.95));
  if (!blob && outMime === "image/webp") {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  }
  if (!blob) throw new Error("图像导出失败");

  const actualMime = blob.type || outMime;
  const outBytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes: outBytes, mime: actualMime, blob };
}

/**
 * 将旋转处理后的图片持久化保存到服务端
 * 若为 E2EE 加密文档，会在客户端先加密再上传
 */
export async function saveDocumentFile(
  docId: string,
  plainBytes: Uint8Array,
  mime: string,
  isE2ee: boolean
): Promise<{ ok: boolean; size: number }> {
  let bodyBytes = plainBytes;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "X-Mime-Type": mime,
  };

  if (isE2ee) {
    const encrypted = await encryptBytes(plainBytes);
    if (!encrypted) throw new Error("端到端加密未解锁");
    bodyBytes = encrypted;
    headers["X-E2EE"] = "1";
  }

  const res = await fetch(`/api/documents/${docId}/file`, {
    method: "PUT",
    headers,
    body: new Blob([bodyBytes as BlobPart]),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "保存文件失败");
  }

  return res.json();
}
