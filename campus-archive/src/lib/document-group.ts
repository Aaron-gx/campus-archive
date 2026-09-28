// 证件分组通用工具：一个证件（正反面/主副页）= 一份逻辑材料
// 优先按 groupId 分组；若无 groupId，按同子分类下"去掉面后缀后的基础标题"自动配对

export const SIDE_SUFFIX =
  /[-·_\s]+(正面|反面|人像面|国徽面|主页|副页|首页|户主页|本人页|成员页|家庭成员页|父亲页|母亲页|配偶页|子女页|变动页|变动登记页|注册页|签注|签注面|签证页|信息面|签发信息面|个人信息面|个人信息页|资料页|卡号面|签名面)$/;

export function stripSideSuffix(title: string): string {
  return (title || "").replace(SIDE_SUFFIX, "").trim();
}
export const FRONT_HINT = /正面|人像面|首页|主页|资料页|卡号面/;

export interface BaseDoc {
  id: string;
  title: string;
  groupId?: string | null;
  side?: string | null;
  sideOrder?: number | null;
  createdAt: string | Date;
  categoryId?: string;
  isSensitive?: boolean;
}

export interface DocGroup<T extends BaseDoc = BaseDoc> {
  key: string;
  title: string; // 组标题（无面后缀）
  docs: T[]; // 组内文件，正面在前
  main: T; // 主文档（展示分类/时间/备注等）
  hasMultiple: boolean;
}

export function groupDocs<T extends BaseDoc>(list: T[]): DocGroup<T>[] {
  const byGroup = new Map<string, T[]>();
  const singles: T[] = [];
  for (const d of list) {
    if (d.groupId) {
      const arr = byGroup.get(d.groupId) ?? [];
      arr.push(d);
      byGroup.set(d.groupId, arr);
    } else {
      singles.push(d);
    }
  }

  // 旧数据配对：同子分类下"基础标题"相同且带面后缀的 ≥2 条合成一组
  const legacy = new Map<string, T[]>();
  const rest: T[] = [];
  for (const d of singles) {
    if (SIDE_SUFFIX.test(d.title)) {
      const k = `${d.categoryId ?? ""}:${d.title.replace(SIDE_SUFFIX, "")}`;
      const arr = legacy.get(k) ?? [];
      arr.push(d);
      legacy.set(k, arr);
    } else {
      rest.push(d);
    }
  }

  const makeGroup = (key: string, docsInGroup: T[]): DocGroup<T> => {
    const sorted = [...docsInGroup].sort((a, b) => {
      const fa = a.sideOrder ?? (FRONT_HINT.test(a.title) ? 0 : 1);
      const fb = b.sideOrder ?? (FRONT_HINT.test(b.title) ? 0 : 1);
      if (fa !== fb) return fa - fb;
      return +new Date(a.createdAt) - +new Date(b.createdAt);
    });
    return {
      key,
      title: sorted[0].title.replace(SIDE_SUFFIX, ""),
      docs: sorted,
      main: sorted[0],
      hasMultiple: sorted.length > 1,
    };
  };

  const groups: DocGroup<T>[] = [];
  byGroup.forEach((arr, gid) => groups.push(makeGroup(gid, arr)));
  legacy.forEach((arr, k) => {
    if (arr.length >= 2) groups.push(makeGroup(`legacy:${k}`, arr));
    else rest.push(...arr);
  });
  rest.forEach((d) => groups.push(makeGroup(d.id, [d])));

  groups.sort((a, b) => +new Date(b.main.createdAt) - +new Date(a.main.createdAt));
  return groups;
}
