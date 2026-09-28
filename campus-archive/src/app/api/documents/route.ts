import { NextResponse } from "next/server";
import crypto from "crypto";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { encryptFile } from "@/lib/crypto";
import { saveFile, saveThumbnail } from "@/lib/storage";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, CERTIFICATE_LEVELS } from "@/lib/constants";
import { sanitizeUploadedFile, checkImageDimensions } from "@/lib/risk/file-sanitizer";
import { withSharpSlot } from "@/lib/sharp-slot";

// 针对 2C2G 服务器限制 sharp 并发与内存缓存，防止图片处理抢占全核 CPU 及内存暴涨
sharp.concurrency(1);
sharp.cache({ memory: 20, files: 5, items: 50 });

// 列出当前用户文档（可按主分类 key 或子分类 id 过滤，可搜索）
export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const categoryKey = url.searchParams.get("categoryKey");
  const categoryId = url.searchParams.get("categoryId");
  const q = url.searchParams.get("q")?.trim();

  const categoryIds: string[] = [];
  if (categoryId) {
    categoryIds.push(categoryId);
  } else if (categoryKey) {
    const main = await prisma.category.findUnique({ where: { key: categoryKey }, include: { children: true } });
    if (main) categoryIds.push(main.id, ...main.children.map((c) => c.id));
  }

    const documents = await prisma.document.findMany({
      where: {
        userId: session.id,
        ...(categoryIds.length ? { categoryId: { in: categoryIds } } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { note: { contains: q } },
                { fileName: { contains: q } },
                { certificate: { is: { name: { contains: q } } } },
                { certificate: { is: { org: { contains: q } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        note: true,
        meta: true,
        groupId: true,
        side: true,
        sideOrder: true,
        fileName: true,
        mimeType: true,
        size: true,
        isSensitive: true,
        e2ee: true,
        createdAt: true,
        categoryId: true,
        category: { select: { name: true, key: true, parent: { select: { name: true, key: true } } } },
        certificate: { select: { id: true, name: true, org: true, level: true, awardedAt: true } },
      },
    });

  // 敏感证件的元数据（标题/文件名/字段/备注/关联证书）在验证窗口/信任设备外一律脱敏降级，
  // 杜绝通过清单接口刺探用户敏感证件名细与真实凭证信息
  const anySensitive = documents.some((d) => d.isSensitive);
  const granted = anySensitive ? await hasSensitiveAccess(session.id) : false;
  const safeDocuments = documents.map((d) => {
    if (!d.isSensitive || granted) return { ...d, metaMasked: false, noteMasked: false };
    return {
      ...d,
      title: d.category?.name || "居民身份证",
      fileName: "已加密材料",
      certificate: null,
      meta: null,
      note: null,
      metaMasked: true,
      noteMasked: d.note !== null,
    };
  });

  return NextResponse.json({ documents: safeDocuments, sensitiveGranted: granted });
}

// 上传文档：multipart/form-data
// 字段: file, categoryId, title, note, isSensitive, withCertificate,
//       certName, certOrg, certLevel, certAwardedAt
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 1. 前置请求体大小防御：防止超大 payload 耗尽服务器内存
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE + 64 * 1024) {
    return NextResponse.json({ error: "上传文件过大，单文件上限 20MB" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 multipart/form-data" }, { status: 400 });
  }

  try {
    const file = form.get("file");
    const categoryId = String(form.get("categoryId") ?? "");
    const rawTitle = String(form.get("title") ?? "").trim();
    const title = rawTitle.replace(/[-·_\s]+(正面|反面|人像面|国徽面|主页|副页|首页|本人页|注册页|签注|签注面|签证页|信息面|签发信息面|个人信息面|个人信息页|资料页)$/, "").trim() || rawTitle;
    const note = String(form.get("note") ?? "").trim() || null;
    const withCertificate = String(form.get("withCertificate") ?? "") === "true";
    // 结构化识别字段：E2ET 密文信封直接存储（服务器无法解读）；
    // 明文 JSON 则做合法性校验
    let meta: string | null = null;
    const metaRaw = String(form.get("meta") ?? "").trim();
    if (metaRaw.startsWith("E2ET:")) {
      meta = metaRaw.slice(0, 8000);
    } else if (metaRaw) {
      try {
        const parsed = JSON.parse(metaRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = metaRaw.length > 4000 ? JSON.stringify(parsed).slice(0, 4000) : metaRaw;
        }
      } catch {
        // 格式不合法则忽略，不影响上传
      }
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      return NextResponse.json({ error: "仅支持 JPG/PNG/WebP/HEIC 图片和 PDF 文件" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件大小不能超过 20MB" }, { status: 413 });
    }

    // 2. 单用户总存储空间配额限制（1GB）
    const MAX_USER_STORAGE = 1024 * 1024 * 1024;
    const currentUsage = await prisma.document.aggregate({
      where: { userId: session.id },
      _sum: { size: true },
    });
    if ((currentUsage._sum.size ?? 0) + file.size > MAX_USER_STORAGE) {
      return NextResponse.json({ error: "个人存储配额已满（上限 1GB）" }, { status: 413 });
    }

    // 校验分类归属：允许传主分类（自动落到第一个子类）或子分类
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { children: true, parent: true },
    });
    if (!category) {
      return NextResponse.json({ error: "分类不存在" }, { status: 400 });
    }
    // 主分类下有子类时，未指定子类则拒绝（前端会强制选择）
    if (category.children.length > 0) {
      return NextResponse.json({ error: "请选择具体子分类" }, { status: 400 });
    }
    const leaf = category;
    // 身份证件类强制敏感加密，用户不可关闭
    const sensitiveByCategory = leaf.parent?.sensitive ?? leaf.sensitive;
    const isSensitive =
      sensitiveByCategory || String(form.get("isSensitive") ?? "") === "true";

    // 读取并处理文件
    // 端到端加密上传（x-e2ee: 1）：客户端已在本地加密，服务器只存密文——
    // 不做 sharp 压缩、不做服务端加密，仅校验信封格式
    const isE2ee = req.headers.get("x-e2ee") === "1";

    if (isSensitive && !isE2ee) {
      return NextResponse.json(
        { error: "敏感证件材料必须经过客户端端到端加密", code: "E2EE_REQUIRED" },
        { status: 400 }
      );
    }
    const raw = Buffer.from(await file.arrayBuffer());
    let mimeType = file.type;

    // 若客户端未提供准确 mimeType，根据扩展名推断
    if (!mimeType || mimeType === "application/octet-stream") {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "pdf") mimeType = "application/pdf";
      else if (ext === "webp") mimeType = "image/webp";
    }

    // 内容安全与真实魔数准入审查
    const sanitizeResult = sanitizeUploadedFile(raw, mimeType, isE2ee);
    if (!sanitizeResult.valid) {
      return NextResponse.json({ error: sanitizeResult.error || "文件安全审查未通过" }, { status: 400 });
    }
    if (sanitizeResult.detectedMime && sanitizeResult.detectedMime !== "application/x-e2ee-envelope") {
      mimeType = sanitizeResult.detectedMime;
    }

    let thumbBuf: Buffer | null = null;
    if (!isE2ee && mimeType !== "application/pdf") {
      // 图片格式合法性校验、防炸弹检测并生成预览缩略图，原图 raw 1:1 无损保存
      try {
        const meta = await sharp(raw, { limitInputPixels: 16 * 1024 * 1024, sequentialRead: true }).metadata();
        if (meta.width && meta.height) {
          const dimCheck = checkImageDimensions(meta.width, meta.height);
          if (!dimCheck.safe) {
            return NextResponse.json({ error: dimCheck.error }, { status: 400 });
          }
        }
        thumbBuf = await withSharpSlot(() =>
          sharp(raw, { limitInputPixels: 16 * 1024 * 1024, sequentialRead: true })
            .rotate()
            .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer()
        );
      } catch (imgErr) {
        console.warn("sharp image process failed:", imgErr);
        return NextResponse.json({ error: "图片文件损坏或不受支持" }, { status: 400 });
      }
    }

    // 证书类可选同时建立结构化记录（先校验再落盘，避免孤儿文件）
    let certData: {
      name: string;
      org: string;
      level: string;
      awardedAt: Date;
    } | null = null;
    if (withCertificate) {
      const name = String(form.get("certName") ?? "").trim() || title;
      const org = String(form.get("certOrg") ?? "").trim();
      const level = String(form.get("certLevel") ?? "").trim();
      const awardedAtRaw = String(form.get("certAwardedAt") ?? "");
      if (!org || !CERTIFICATE_LEVELS.includes(level as (typeof CERTIFICATE_LEVELS)[number]) || !awardedAtRaw) {
        return NextResponse.json({ error: "证书信息不完整（需填写颁发单位、级别、时间）" }, { status: 400 });
      }
      certData = { name, org, level, awardedAt: new Date(awardedAtRaw) };
    }

    // 校验 groupId 归属：若该组已有文档，必须全部属于当前用户，防止跨用户分组污染与越权
    const rawGroupId = String(form.get("groupId") ?? "").trim() || null;
    let groupId: string | null = null;
    if (rawGroupId) {
      const existingGroupDoc = await prisma.document.findFirst({
        where: { groupId: rawGroupId },
        select: { userId: true },
      });
      if (existingGroupDoc && existingGroupDoc.userId !== session.id) {
        return NextResponse.json({ error: "非法分组标识" }, { status: 403 });
      }
      groupId = rawGroupId;
    }

    const storedName = `${crypto.randomUUID()}${isSensitive && !isE2ee ? ".enc" : ""}`;
    // e2ee 文件已是客户端密文，不再叠加服务端加密
    const finalBuffer =
      isE2ee ? raw : isSensitive ? encryptFile(session.id, raw).data : raw;
    await saveFile(session.id, storedName, finalBuffer);

    // 非敏感文件异步存储缩略图，加速列表视图
    if (thumbBuf && !isSensitive) {
      void saveThumbnail(session.id, storedName, thumbBuf).catch(() => {});
    }

    const document = await prisma.document.create({
      data: {
        userId: session.id,
        categoryId: leaf.id,
        title: title || file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        storedName,
        mimeType,
        size: finalBuffer.length,
        isSensitive,
        e2ee: isE2ee,
        note,
        meta,
        // 证件组：正反面/主副页同组（同组在列表合并为一张卡片）
        groupId,
        side: String(form.get("side") ?? "").trim() || null,
        sideOrder: Number(form.get("sideOrder") ?? "") >= 0 ? Number(form.get("sideOrder")) : null,
        ...(certData
          ? { certificate: { create: { userId: session.id, ...certData } } }
          : {}),
      },
      include: { certificate: true },
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (e) {
    console.error("upload error", e);
    return NextResponse.json({ error: "上传失败，请稍后重试" }, { status: 500 });
  }
}
