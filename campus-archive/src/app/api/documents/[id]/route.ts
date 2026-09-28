import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import { logAudit } from "@/lib/audit";

// 编辑元信息（标题/备注/分类）
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const doc = await prisma.document.findFirst({ where: { id: params.id, userId: session.id } });
  if (!doc) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  // 1.1 敏感文档必须先通过二次验证，防止越权读取与篡改
  const sensitiveVerified = await hasSensitiveAccess(session.id);
  if (doc.isSensitive && !sensitiveVerified) {
    return NextResponse.json(
      { error: "查看或修改敏感档案需进行二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
      { status: 403 }
    );
  }

  const body = (await req.json()) ?? {};
  const rawTitle = typeof body.title === "string" && body.title.trim() ? body.title.trim() : doc.title;
  const title =
    rawTitle.replace(/[-·_\s]+(正面|反面|人像面|国徽面|主页|副页|首页|本人页|注册页|签注|签注面|签证页|信息面|签发信息面|个人信息面|个人信息页|资料页)$/, "").trim() || rawTitle;
  const note = typeof body.note === "string" ? body.note.trim() || null : doc.note;
  // 结构化字段：仅在传入合法 JSON 对象时更新
  let meta = doc.meta;
  if (typeof body.meta === "string" && body.meta.trim()) {
    try {
      const parsed = JSON.parse(body.meta);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = body.meta.length > 4000 ? JSON.stringify(parsed).slice(0, 4000) : body.meta;
      }
    } catch {
      /* 忽略不合法数据 */
    }
  }
  let categoryId = doc.categoryId;
  if (typeof body.categoryId === "string" && body.categoryId && body.categoryId !== doc.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
      include: { children: true },
    });
    if (!category || category.children.length > 0) {
      return NextResponse.json({ error: "目标分类无效（需为子分类）" }, { status: 400 });
    }
    categoryId = category.id;
  }

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { title, note, categoryId, meta },
  });
  if (doc.isSensitive) {
    await logAudit(session.id, "edit", { docId: doc.id, docTitle: updated.title, req });
  }

  const safeDoc = {
    ...updated,
    meta: doc.isSensitive && !sensitiveVerified ? null : updated.meta,
    note: doc.isSensitive && !sensitiveVerified ? null : updated.note,
  };
  return NextResponse.json({ document: safeDoc });
}

// 删除文档（连带物理文件与缩略图；若有关联证书记录一并清理，保证账实完全一致）
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const doc = await prisma.document.findFirst({ where: { id: params.id, userId: session.id } });
  if (!doc) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  // 敏感文档必须二次验证后方可删除
  if (doc.isSensitive) {
    const sensitiveVerified = await hasSensitiveAccess(session.id);
    if (!sensitiveVerified) {
      return NextResponse.json(
        { error: "删除敏感档案需进行二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
        { status: 403 }
      );
    }
  }

  // 1. 事务中同步清理关联的证书登记记录与文档数据库记录
  await prisma.$transaction([
    prisma.certificate.deleteMany({ where: { documentId: doc.id } }),
    prisma.document.delete({ where: { id: doc.id } }),
  ]);
  // 2. 删除存储原文件与缩略图缓存
  await deleteFile(session.id, doc.storedName);
  // 3. 记录审计日志
  await logAudit(session.id, "delete", { docId: doc.id, docTitle: doc.title, req });
  return NextResponse.json({ ok: true });
}
