export interface RepoItem {
  id: number;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  updatedAt: string;
  homepage: string | null;
  archived: boolean;
}

interface RawGithubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  updated_at: string;
  homepage: string | null;
  archived: boolean;
  fork: boolean;
}

// 上一次成功结果缓存：GitHub 限流（匿名 60 次/小时）或网络故障时兜底，
// 避免落地页数据静默消失
let cachedRepos: RepoItem[] | null = null;

export async function getGithubRepos(): Promise<RepoItem[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "campus-archive-app",
  };
  // 配置 GITHUB_TOKEN 后限额提升至 5000 次/小时
  if (process.env.GITHUB_TOKEN?.trim()) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }
  try {
    const res = await fetch(
      "https://api.github.com/users/Aaron-gx/repos?sort=updated&per_page=30",
      { headers, next: { revalidate: 3600 } }
    );

    if (!res.ok) return cachedRepos ?? [];

    const data: RawGithubRepo[] = await res.json();
    const repos = data
      .filter((r) => !r.fork && r.name !== "Aaron-gx")
      .map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        topics: r.topics ?? [],
        updatedAt: r.updated_at,
        homepage: r.homepage || null,
        archived: r.archived,
      }));
    cachedRepos = repos;
    return repos;
  } catch {
    return cachedRepos ?? [];
  }
}

export async function getGithubRepoCount(): Promise<number> {
  const repos = await getGithubRepos();
  return repos.length;
}

// 非阻塞计数：首页渲染不等待 GitHub 外部请求。
// 有缓存立即返回；无缓存则后台触发一次填充，本次返回当前缓存（可能为 0），
// 避免外部网络慢/超时拖慢整页 SSR。
let countFetchStarted = false;
export async function getGithubRepoCountCached(): Promise<number> {
  const cached = cachedRepos;
  if (cached) return cached.length;
  if (!countFetchStarted) {
    countFetchStarted = true;
    void getGithubRepos().catch(() => {});
  }
  return 0;
}
