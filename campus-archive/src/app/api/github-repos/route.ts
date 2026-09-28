import { NextResponse } from "next/server";
import { getGithubRepos } from "@/lib/github";

export const revalidate = 3600; // 服务端缓存 1 小时

export async function GET() {
  const repos = await getGithubRepos();
  return NextResponse.json({ repos });
}
