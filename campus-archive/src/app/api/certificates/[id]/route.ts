import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { CERTIFICATE_LEVELS } from "@/lib/constants";
import { deleteFile } from "@/lib/storage";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const cert = await prisma.certificate.findFirst({ where: { id: params.id, userId: session.id } });
  if (!cert) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const body = (await req.json()) ?? {};
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const org = typeof body.org === "string" && body.org.trim() ? body.org.trim() : undefined;
  const level =
    typeof body.level === "string" && CERTIFICATE_LEVELS.includes(body.level as (typeof CERTIFICATE_LEVELS)[number])
      ? body.level
      : undefined;
  const awardedAt =
    typeof body.awardedAt === "string" && !isNaN(new Date(body.awardedAt).getTime())
      ? new Date(body.awardedAt)
      : undefined;
  const note =
    typeof body.note === "string" ? (body.note.trim() || null) : undefined;

  const certificate = await prisma.certificate.update({
    where: { id: cert.id },
    data: { ...(name && { name }), ...(org && { org }), ...(level && { level }), ...(awardedAt && { awardedAt }), ...(note !== undefined && { note }) },
  });
  return NextResponse.json({ certificate });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const cert = await prisma.certificate.findFirst({
    where: { id: params.id, userId: session.id },
    include: { document: true },
  });
  if (!cert) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  // 1. 查找需级联删除的物理原件文档集合
  let docsToDelete: { id: string; title: string; storedName: string; isSensitive: boolean }[] = [];
  if (cert.document) {
    if (cert.document.groupId) {
      docsToDelete = await prisma.document.findMany({
        where: { groupId: cert.document.groupId, userId: session.id },
        select: { id: true, title: true, storedName: true, isSensitive: true },
      });
    } else {
      docsToDelete = [cert.document];
    }
  }

  // 2. 敏感材料二次验证门禁：若待删除文档包含敏感材料，必须通过二次验证
  const hasSensitiveDoc = docsToDelete.some((d) => d.isSensitive);
  if (hasSensitiveDoc) {
    const sensitiveVerified = await hasSensitiveAccess(session.id);
    if (!sensitiveVerified) {
      return NextResponse.json(
        { error: "删除敏感档案需进行二次验证", code: "SENSITIVE_VERIFY_REQUIRED" },
        { status: 403 }
      );
    }
  }

  // 3. 数据库事务原子级联删除
  const docIds = docsToDelete.map((d) => d.id);
  await prisma.$transaction([
    ...(docIds.length > 0 ? [prisma.certificate.deleteMany({ where: { documentId: { in: docIds } } })] : []),
    prisma.certificate.deleteMany({ where: { id: cert.id } }),
    ...(docIds.length > 0 ? [prisma.document.deleteMany({ where: { id: { in: docIds } } })] : []),
  ]);

  // 4. 清理物理存储并留痕审计日志
  for (const gd of docsToDelete) {
    await deleteFile(session.id, gd.storedName);
    await logAudit(session.id, "delete", {
      docId: gd.id,
      docTitle: gd.title,
      detail: `删除证书: ${cert.name}`,
      req,
    });
  }

  return NextResponse.json({ ok: true });
}

