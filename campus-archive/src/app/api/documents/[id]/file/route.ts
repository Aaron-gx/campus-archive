import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { encryptFile, decryptFile } from "@/lib/crypto";
import { readFile, saveFile, readThumbnail, saveThumbnail, readFileStream } from "@/lib/storage";
import sharp from "sharp";
import { withSharpSlot } from "@/lib/sharp-slot";
import { logAudit } from "@/lib/audit";
import { rateLimiter } from "@/lib/rate-limit";

// 查看文件内容：敏感文件需先通过二次验证（10 分钟窗口 / 信任设备）
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const isDownload = url.searchParams.get("download") === "1";
  const isThumb = url.searchParams.get("thumb") === "1" || url.searchParams.get("thumbnail") === "1";

  // 反拖库与反爬频控：缩略图允许网格高并发浏览 (300次/分)，原件下载/查看限制 120次/分
  const limitKey = isThumb ? `thumb:user:${session.id}` : `download:user:${session.id}`;
  const maxRequests = isThumb ? 300 : 120;
  const dlLimit = rateLimiter.check(limitKey, { windowMs: 60 * 1000, max: maxRequests });
  if (!dlLimit.success) {
    return NextResponse.json(
      { error: "文件请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(dlLimit.resetMs / 1000)) } }
    );
  }

  const doc = await prisma.document.findFirst({
    where: { id: params.id, userId: session.id },
  });
  if (!doc) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  if (doc.isSensitive && !(await hasSensitiveAccess(session.id))) {
    return NextResponse.json(
      { error: "敏感文件需要二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
      { status: 403 }
    );
  }

  if (doc.isSensitive) {
    await logAudit(session.id, isDownload ? "download" : "view", {
      docId: doc.id,
      docTitle: doc.title,
      req,
    });
  }

  // —— 无需服务端解密/转码的场景走流式，避免整包读入内存 ——
  const isWebpSource =
    doc.mimeType === "image/webp" ||
    (doc.fileName?.toLowerCase().endsWith(".webp") ?? false);
  // 是否需要服务端 sharp 处理：缩略图生成 / 下载时 webp→jpg 转码
  const needSharp =
    (isThumb && !doc.e2ee && doc.mimeType.startsWith("image/")) ||
    (isDownload && !doc.e2ee && isWebpSource);

  if (!doc.e2ee && !doc.isSensitive && !needSharp) {
    // 普通文件（PDF / 已转好格式的图片）直接流式下发
    try {
      const stream = readFileStream(session.id, doc.storedName);
      const origExt = (doc.fileName?.split(".").pop() || "").toLowerCase();
      const safeExt =
        doc.mimeType === "application/pdf"
          ? "pdf"
          : doc.mimeType === "image/png" || origExt === "png"
            ? "png"
            : "jpg";
      const inlineName = `${doc.title}.${safeExt}`;
      const downloadName = doc.fileName || `${doc.title}.${safeExt}`;
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          "Content-Type": doc.mimeType,
          "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(
            isDownload ? downloadName : inlineName
          )}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return NextResponse.json({ error: "文件数据丢失，请联系管理员" }, { status: 410 });
    }
  }

  let data: Buffer;
  try {
    data = await readFile(session.id, doc.storedName);
  } catch {
    return NextResponse.json({ error: "文件数据丢失，请联系管理员" }, { status: 410 });
  }
  if (doc.e2ee) {
    // 端到端加密：服务器只存密文，原样下发，由持有密钥的客户端解密
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(data.byteLength),
        "X-E2EE": "1",
        "X-Original-Type": doc.mimeType,
        "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (doc.isSensitive) {
    try {
      data = decryptFile(session.id, data);
    } catch {
      return NextResponse.json({ error: "文件解密失败" }, { status: 500 });
    }
  }

  if (isThumb && !doc.e2ee && doc.mimeType.startsWith("image/")) {
    const cachedThumb = await readThumbnail(session.id, doc.storedName);
    if (cachedThumb) {
      const bytes = new Uint8Array(cachedThumb);
      return new Response(bytes, {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, max-age=604800, stale-while-revalidate=86400",
          "X-Thumbnail": "1",
        },
      });
    }

    try {
      const thumbBuf = await withSharpSlot(() =>
        sharp(data)
          .rotate()
          .resize({ width: 440, height: 440, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 4 })
          .toBuffer()
      );

      void saveThumbnail(session.id, doc.storedName, thumbBuf).catch(() => {});

      const bytes = new Uint8Array(thumbBuf);
      return new Response(bytes, {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, max-age=604800, stale-while-revalidate=86400",
          "X-Thumbnail": "1",
        },
      });
    } catch {
      // 降级原样返回
    }
  }

  const download = url.searchParams.get("download") === "1";
  let outputMime = doc.mimeType;

  // 若用户请求下载且存储文件为 WebP，为了外部系统兼容（学信网/研招网等），转为高质量 JPG
  if (
    download &&
    !doc.e2ee &&
    (doc.mimeType === "image/webp" ||
      (data.length >= 12 &&
        data.subarray(0, 4).toString("ascii") === "RIFF" &&
        data.subarray(8, 12).toString("ascii") === "WEBP"))
  ) {
    try {
      data = await withSharpSlot(() => sharp(data).jpeg({ quality: 95 }).toBuffer());
      outputMime = "image/jpeg";
    } catch {}
  }

  const origExt = (doc.fileName?.split(".").pop() || "").toLowerCase();
  const safeExt =
    outputMime === "application/pdf"
      ? "pdf"
      : outputMime === "image/png" || origExt === "png"
        ? "png"
        : "jpg";

  const downloadName = doc.fileName
    ? doc.fileName.toLowerCase().endsWith(".webp")
      ? doc.fileName.replace(/\.webp$/i, ".jpg")
      : doc.fileName
    : `${doc.title}.${safeExt}`;
  const inlineName = `${doc.title}.${safeExt}`;

  const bytes = new Uint8Array(data);
  return new Response(bytes, {
    headers: {
      "Content-Type": outputMime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(
        download ? downloadName : inlineName
      )}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// 更新文件内容（例如旋转后保存）
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const doc = await prisma.document.findFirst({
    where: { id: params.id, userId: session.id },
  });
  if (!doc) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  if (doc.isSensitive && !(await hasSensitiveAccess(session.id))) {
    return NextResponse.json(
      { error: "敏感文件需要二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
      { status: 403 }
    );
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
  }
  const rawBytes = Buffer.from(new Uint8Array(buf));

  const isE2ee = req.headers.get("x-e2ee") === "1" || doc.e2ee;
  if (isE2ee) {
    if (rawBytes.length < 20 || rawBytes.subarray(0, 4).toString("ascii") !== "E2E1") {
      return NextResponse.json({ error: "E2EE 信封格式不正确" }, { status: 400 });
    }
  }

  let finalBuffer: Buffer = rawBytes;
  if (!doc.e2ee && doc.isSensitive) {
    finalBuffer = encryptFile(session.id, rawBytes).data;
  }

  await saveFile(session.id, doc.storedName, finalBuffer);

  // 清除旧缩略图缓存，确保重新生成最新缩略图
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    await fs.unlink(path.join(process.cwd(), "storage", session.id, `thumb_${doc.storedName}.webp`));
  } catch {}

  const newMime =
    req.headers.get("x-mime-type") ||
    (isE2ee ? doc.mimeType : req.headers.get("content-type") || doc.mimeType);

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      size: finalBuffer.length,
      mimeType: newMime,
    },
  });

  if (doc.isSensitive) {
    await logAudit(session.id, "edit", {
      docId: doc.id,
      docTitle: doc.title,
      detail: "rotate",
      req,
    });
  }

  return NextResponse.json({ ok: true, size: finalBuffer.length });
}
