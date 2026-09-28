import { NextResponse } from "next/server";
import { Readable } from "stream";
import archiver from "archiver";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { decryptFile } from "@/lib/crypto";
import { readFile, readFileStream } from "@/lib/storage";
import { MAIN_CATEGORY_KEYS } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { rateLimiter } from "@/lib/rate-limit";
import crypto from "crypto";
import { generateVerifyCode } from "@/lib/risk/watermark";
import { withSharpSlot } from "@/lib/sharp-slot";
import { signExportRecord } from "@/lib/export-ticket";

export const runtime = "nodejs";

// 防单用户导出请求打爆内存/带宽：每用户 10 分钟最多 1 次打包
const EXPORT_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 1 };
// 总大小闸门：所选分类文件总量超过该值时拒绝整包导出（512MB 堆单实例的内存保护）
const EXPORT_MAX_TOTAL_BYTES = 300 * 1024 * 1024;

function sanitize(name: string) {
  return name.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 80);
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

// CSV 单元格转义：换行破坏行结构；= + - @ 开头的值在 Excel/WPS 中会被当作公式执行
function csvCell(value: string) {
  const s = String(value).replace(/\r\n?/g, " ");
  const guarded = /^[=+\-@\t]/.test(s) ? "'" + s : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// 按类别打包导出：POST { categoryKeys: string[], includeCertificates?: boolean }
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const limit = rateLimiter.check(`export:user:${session.id}`, EXPORT_RATE_LIMIT);
  if (!limit.success) {
    return NextResponse.json(
      { error: "导出过于频繁，请 10 分钟后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.resetMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }
  const keys: string[] = Array.isArray(body.categoryKeys) ? body.categoryKeys : [];
  const includeCertificates = body.includeCertificates !== false;

  const validKeys = keys.filter((k) => (MAIN_CATEGORY_KEYS as readonly string[]).includes(k));
  if (validKeys.length === 0) {
    return NextResponse.json({ error: "请至少选择一个分类" }, { status: 400 });
  }

  const categories = await prisma.category.findMany({
    where: { key: { in: validKeys }, parentId: null },
    include: { children: true },
  });

  const categoryIds = categories.flatMap((c) => [c.id, ...c.children.map((x) => x.id)]);
  const documents = await prisma.document.findMany({
    where: { userId: session.id, categoryId: { in: categoryIds } },
    orderBy: { createdAt: "asc" },
  });

  // 含敏感证件的导出必须先通过二次验证
  const hasSensitive = documents.some((d) => d.isSensitive);
  if (hasSensitive && !(await hasSensitiveAccess(session.id))) {
    return NextResponse.json(
      { error: "导出包含敏感证件，请先完成二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
      { status: 403 }
    );
  }
  if (documents.length === 0) {
    return NextResponse.json({ error: "所选分类暂无文件，先去上传吧" }, { status: 400 });
  }

  // 总大小闸门：在开始打包前拦截，避免大体积归档耗尽单实例堆内存
  const totalBytes = documents.reduce((s, d) => s + d.size, 0);
  if (totalBytes > EXPORT_MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `所选分类共 ${(totalBytes / 1024 / 1024).toFixed(0)}MB，超过单次导出上限 ${(
          EXPORT_MAX_TOTAL_BYTES / 1024 / 1024
        ).toFixed(0)}MB，请分批选择分类导出`,
      },
      { status: 413 }
    );
  }

  const certificates = includeCertificates
    ? await prisma.certificate.findMany({
        where: { userId: session.id },
        orderBy: { awardedAt: "desc" },
      })
    : [];

  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const zipName = `简册归档包_${stamp}.zip`;
  const verifyCode = generateVerifyCode();

  const archive = archiver("zip", { zlib: { level: 6 } });
  const hasher = crypto.createHash("sha256");
  archive.on("data", (chunk: Buffer) => hasher.update(chunk));
  archive.on("warn", (err) => console.warn("zip warn", err));
  archive.on("error", (err) => console.error("zip error", err));

  const manifestRows: string[] = ["分类,标题,子类,备注,敏感加密,上传时间"];
  const allCategories = await prisma.category.findMany();
  const catById = new Map(allCategories.map((c) => [c.id, c]));
  let e2eeSkipped = 0;

  for (const doc of documents) {
    // 端到端加密文件：服务器没有密钥，无法解密打包
    if (doc.e2ee) {
      e2eeSkipped += 1;
      continue;
    }
    try {
      const cat = catById.get(doc.categoryId);
      const mainCat =
        categories.find((c) => c.key === (cat?.parentId ? catById.get(cat.parentId)?.key : cat?.key)) ??
        categories[0];
      const subName = cat?.parentId ? cat.name : "未分类";
      const origExt = (doc.fileName?.split(".").pop() || "").toLowerCase();
      let ext =
        doc.mimeType === "application/pdf"
          ? "pdf"
          : origExt === "png" || doc.mimeType === "image/png"
            ? "png"
            : "jpg";

      const t = doc.createdAt;
      const dateStr = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
      const sideSuffix = doc.side ? `_${sanitize(doc.side)}` : "";

      if (doc.mimeType === "application/pdf" && !doc.isSensitive) {
        const zipPath = `${sanitize(mainCat.name)}/${dateStr}_${sanitize(doc.title)}${sideSuffix}.${ext}`;
        archive.append(readFileStream(session.id, doc.storedName), { name: zipPath });
      } else if (
        // 非敏感、且存储内容与 mimeType 一致（上传时已魔数嗅探覆盖）的普通图片 → 流式，避免整包读内存
        !doc.isSensitive &&
        (doc.mimeType === "image/png" || doc.mimeType === "image/jpeg") &&
        origExt !== "webp"
      ) {
        const zipPath = `${sanitize(mainCat.name)}/${dateStr}_${sanitize(doc.title)}${sideSuffix}.${ext}`;
        archive.append(readFileStream(session.id, doc.storedName), { name: zipPath });
      } else {
        let fileBuf = await readFile(session.id, doc.storedName);
        if (doc.isSensitive) {
          fileBuf = decryptFile(session.id, fileBuf);
        }
        // 如果是历史存量 WebP 或标注为 webp 的图片，转码为高质量 JPG 保证学信网/研招网/公考等平台通用兼容
        const isWebp =
          doc.mimeType === "image/webp" ||
          origExt === "webp" ||
          (fileBuf.length >= 12 &&
            fileBuf.subarray(0, 4).toString("ascii") === "RIFF" &&
            fileBuf.subarray(8, 12).toString("ascii") === "WEBP");
        if (isWebp) {
          try {
            fileBuf = await withSharpSlot(() => sharp(fileBuf).jpeg({ quality: 95 }).toBuffer());
            ext = "jpg";
          } catch (e) {
            console.warn("transcode webp to jpeg failed:", e);
          }
        }
        const zipPath = `${sanitize(mainCat.name)}/${dateStr}_${sanitize(doc.title)}${sideSuffix}.${ext}`;
        archive.append(fileBuf, { name: zipPath });
      }
      // E2ET 加密的备注服务器无法解密，CSV 中不导出内容
      const noteForCsv = (doc.note ?? "").startsWith("E2ET:") ? "（已加密，不导出）" : (doc.note ?? "");
      manifestRows.push(
        [
          mainCat.name,
          doc.title,
          subName,
          noteForCsv,
          doc.isSensitive ? "是" : "否",
          doc.createdAt.toISOString().slice(0, 10),
        ].map(csvCell).join(",")
      );
    } catch (e) {
      console.error("export skip file", doc.id, e);
    }
  }
  if (e2eeSkipped > 0) {
    archive.append(
      `未包含文件：${e2eeSkipped} 份（端到端加密文件，需由客户端解密查看）\r\n`,
      { name: "说明.txt" }
    );
  }
  // BOM 让 Excel 正确识别 UTF-8
  archive.append("\uFEFF" + manifestRows.join("\r\n"), { name: "材料清单.csv" });

  if (certificates.length > 0) {
    const rows = ["证书名称,颁发单位,级别,获得时间,备注"];
    for (const c of certificates) {
      const certNote = (c.note ?? "").startsWith("E2ET:") ? "（已加密，不导出）" : (c.note ?? "");
      rows.push(
        [c.name, c.org, c.level, c.awardedAt.toISOString().slice(0, 10), certNote].map(csvCell).join(",")
      );
    }
    archive.append("\uFEFF" + rows.join("\r\n"), { name: "证书汇总.csv" });
  }

  // 生成不可篡改存证核验证书
  archive.append(
    `档案核验证书\n` +
    `========================================\n` +
    `核验编号：${verifyCode}\n` +
    `归档时间：${new Date().toLocaleString("zh-CN")}\n` +
    `材料份数：${documents.length} 份\n` +
    `查验网址：/verify?code=${verifyCode}\n` +
    `========================================\n` +
    `重要提示：本压缩包在生成时计算了唯一不可篡改存证指纹。\n` +
    `任何对包内文件的添加、删除或修改都将导致存证校验失败。\n`,
    { name: "档案核验证书.txt" }
  );

  // 关键顺序：先把 archive 挂到响应流上（客户端即消费者），再异步 finalize。
  // 若在无消费者时 await finalize，archiver 可读缓冲超过高水位后会因背压
  // 永久停滞（实测 ≥2MB 不可压缩数据即死锁），请求永远无法返回。
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  archive
    .finalize()
    .then(async () => {
      const sha256 = hasher.digest("hex");
      const manifestSummary = `材料共 ${documents.length} 份（${validKeys.join("、")}）`;
      const signature = signExportRecord(verifyCode, sha256, manifestSummary, session.id);
      // zip 大小在流完成后才确定，随 finalize 回调落库
      await prisma.exportRecord.create({
        data: {
          userId: session.id,
          categoryKeys: validKeys.join(","),
          fileName: zipName,
          size: archive.pointer(),
          verifyCode,
          sha256,
          manifestSummary,
          watermarkText: typeof body.watermarkText === "string" ? body.watermarkText.trim() : null,
          signature,
        },
      });
      await logAudit(session.id, "export", {
        detail: `服务端打包 ${documents.length} 份材料（核验码: ${verifyCode}，${validKeys.join(",")}），${e2eeSkipped} 份 e2ee 未包含`,
        req,
      });
    })
    .catch((err) => console.error("export finalize error", err));

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

// 导出历史
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const records = await prisma.exportRecord.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ records });
}
