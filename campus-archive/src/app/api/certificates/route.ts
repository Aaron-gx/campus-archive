import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hasSensitiveAccess } from "@/lib/auth";
import { CERTIFICATE_LEVELS } from "@/lib/constants";

// 证书表格数据（支持按级别筛选、关键词搜索）
export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const q = url.searchParams.get("q")?.trim();

  const certificates = await prisma.certificate.findMany({
    where: {
      userId: session.id,
      ...(level ? { level } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { org: { contains: q } }, { note: { contains: q } }] } : {}),
    },
    orderBy: { awardedAt: "desc" },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          isSensitive: true,
          mimeType: true,
          fileName: true,
          size: true,
          e2ee: true,
          side: true,
          meta: true,
          note: true,
          createdAt: true,
        },
      },
    },
  });
  // 敏感证件的 meta/备注在验证窗口/信任设备外一律不返回（与 documents/route.ts 门禁一致）
  const anySensitive = certificates.some((c) => c.document?.isSensitive);
  const granted = anySensitive ? await hasSensitiveAccess(session.id) : false;

  const safeCertificates = certificates.map((c) => {
    if (!c.document?.isSensitive || granted) return c;
    return {
      ...c,
      document: c.document
        ? { ...c.document, title: "居民身份证", fileName: "已加密材料", meta: null, note: null }
        : c.document,
    };
  });
  return NextResponse.json({ certificates: safeCertificates, levels: CERTIFICATE_LEVELS });
}

// 手动新增证书记录（不依赖上传原件）
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "请求格式错误，需使用 JSON" }, { status: 400 });
  }

  const { name, org, level, awardedAt, note, documentId } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "请填写证书名称" }, { status: 400 });
  }
  if (typeof org !== "string" || !org.trim()) {
    return NextResponse.json({ error: "请填写颁发单位" }, { status: 400 });
  }
  if (typeof level !== "string" || !(CERTIFICATE_LEVELS as readonly string[]).includes(level)) {
    return NextResponse.json({ error: "请选择证书级别" }, { status: 400 });
  }
  if (typeof awardedAt !== "string" || !awardedAt) {
    return NextResponse.json({ error: "请填写获奖时间" }, { status: 400 });
  }
  const awarded = new Date(awardedAt);
  if (isNaN(awarded.getTime())) {
    return NextResponse.json({ error: "请填写获奖时间" }, { status: 400 });
  }
  // 若关联原件，必须属于当前用户
  let documentIdSafe: string | undefined;
  if (typeof documentId === "string" && documentId) {
    const doc = await prisma.document.findFirst({ where: { id: documentId, userId: session.id } });
    if (!doc) return NextResponse.json({ error: "关联的原件不存在" }, { status: 400 });
    documentIdSafe = doc.id;
  }

  const certificate = await prisma.certificate.create({
    data: {
      userId: session.id,
      name: name.trim(),
      org: org.trim(),
      level,
      awardedAt: awarded,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      documentId: documentIdSafe,
    },
  });
  return NextResponse.json({ certificate }, { status: 201 });
}
