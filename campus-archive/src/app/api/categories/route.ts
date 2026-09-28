import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { groupDocs } from "@/lib/document-group";

// 分类树 + 每个用户的分类文档计数（按逻辑证件/材料组聚合，正反面合并为1份材料）
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [categories, userDocs] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.document.findMany({
      where: { userId: session.id },
      select: {
        id: true,
        categoryId: true,
        groupId: true,
        title: true,
        side: true,
        sideOrder: true,
        createdAt: true,
      },
    }),
  ]);

  const docGroups = groupDocs(userDocs);

  // 预构建 categoryId -> 所属 docGroup 索引集合的映射，将嵌套 O(N*M) 过滤优化为 O(N) 线性查表
  const categoryGroupMap = new Map<string, Set<number>>();
  docGroups.forEach((g, gIdx) => {
    for (const d of g.docs) {
      let set = categoryGroupMap.get(d.categoryId);
      if (!set) {
        set = new Set<number>();
        categoryGroupMap.set(d.categoryId, set);
      }
      set.add(gIdx);
    }
  });

  const tree = categories
    .filter((c) => !c.parentId)
    .map((parent) => {
      const childCategories = categories.filter((c) => c.parentId === parent.id);
      const childIds = childCategories.map((c) => c.id);

      const children = childCategories.map((c) => {
        const count = categoryGroupMap.get(c.id)?.size ?? 0;
        return {
          id: c.id,
          key: c.key,
          name: c.name,
          count,
        };
      });

      // 父分类计数 = 属于该父分类自身或其下任一子分类的逻辑材料组并集总数
      const parentGroupIndices = new Set<number>();
      categoryGroupMap.get(parent.id)?.forEach((idx) => parentGroupIndices.add(idx));
      for (const cid of childIds) {
        categoryGroupMap.get(cid)?.forEach((idx) => parentGroupIndices.add(idx));
      }
      const count = parentGroupIndices.size;

      return {
        id: parent.id,
        key: parent.key,
        name: parent.name,
        icon: parent.icon,
        sensitive: parent.sensitive,
        count,
        children,
      };
    });

  return NextResponse.json({ categories: tree });
}
