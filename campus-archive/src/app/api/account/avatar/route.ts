import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveFile, deleteFile, readFile } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB

function redirectToDefaultAvatar(): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: "/avatar.png",
      "Cache-Control": "no-cache",
    },
  });
}

// 获取用户头像流
export async function GET(req: Request) {
  const url = new URL(req.url);
  let targetUserId = url.searchParams.get("userId");

  if (!targetUserId) {
    const session = await getSessionUser();
    targetUserId = session?.id ?? null;
  }

  if (!targetUserId) {
    return redirectToDefaultAvatar();
  }

  // 校验 userId 为合法 CUID（Prisma 默认 ID 格式），防路径穿越（../ 注入 storage 目录）与 ID 探测
  if (!/^c[a-z0-9]{23,32}$/.test(targetUserId)) {
    return redirectToDefaultAvatar();
  }

  try {
    const data = await readFile(targetUserId, "avatar.webp");
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600, no-transform",
      },
    });
  } catch {
    // 未上传头像或读取失败，重定向到系统默认头像
    return redirectToDefaultAvatar();
  }
}

// 上传并设置个人头像
export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "请选择头像图片" }, { status: 400 });
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return NextResponse.json({ error: "头像图片大小不能超过 5MB" }, { status: 400 });
  }

  const ALLOWED_AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp"];
  if (file.type && !ALLOWED_AVATAR_MIMES.includes(file.type.toLowerCase())) {
    return NextResponse.json({ error: "仅支持 JPG、PNG 或 WebP 格式图片" }, { status: 400 });
  }

  try {
    const rawBuffer = Buffer.from(await file.arrayBuffer());

    // 校验魔数（彻底杜绝 SVG 注入与文件类型伪造）
    const isJpg = rawBuffer[0] === 0xff && rawBuffer[1] === 0xd8 && rawBuffer[2] === 0xff;
    const isPng = rawBuffer[0] === 0x89 && rawBuffer[1] === 0x50 && rawBuffer[2] === 0x4e && rawBuffer[3] === 0x47;
    const isWebp = rawBuffer.length >= 12 && rawBuffer.toString("ascii", 0, 4) === "RIFF" && rawBuffer.toString("ascii", 8, 12) === "WEBP";
    if (!isJpg && !isPng && !isWebp) {
      return NextResponse.json({ error: "图片格式损坏或不受支持" }, { status: 400 });
    }

    // 使用 sharp 自动纠正 EXIF 旋转、256x256 智能居中裁剪并压缩为轻量 WebP
    const processed = await sharp(rawBuffer)
      .rotate()
      .resize(256, 256, { fit: "cover", position: "center" })
      .webp({ quality: 85 })
      .toBuffer();

    await saveFile(session.id, "avatar.webp", processed);

    const avatarUrl = `/api/account/avatar?userId=${session.id}&v=${Date.now()}`;
    await prisma.user.update({
      where: { id: session.id },
      data: { avatar: avatarUrl },
    });

    return NextResponse.json({ ok: true, avatar: avatarUrl });
  } catch (err) {
    console.error("[Avatar Upload Error]", err);
    return NextResponse.json({ error: "头像处理失败，请重试" }, { status: 500 });
  }
}

// 移除自定义头像，恢复系统默认
export async function DELETE() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    await deleteFile(session.id, "avatar.webp");
    await prisma.user.update({
      where: { id: session.id },
      data: { avatar: null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Avatar Delete Error]", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
