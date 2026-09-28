module.exports = {
  apps: [
    {
      name: "campus-archive",
      // 安全加固入口（前置拦截 TRACE/TRACK 方法，并执行 Next.js standalone server）
      script: "deploy/server-entry.js",
      // 2C2G 服务器务必单实例运行：
      // 1. 避免 SQLite 单文件锁发生并发写争用；
      // 2. 避免多进程重复占用 Node.js 基础内存（单进程基线 ~150MB）。
      instances: 1,
      exec_mode: "fork",
      // 鉴于服务器当前内存已占用约 71%（剩余约 580MB），将堆上限压至 512MB（日常运行仅需 90~160MB）
      node_args: "--max-old-space-size=512",
      // 若内存异常达到 650MB，PM2 自动平稳重启，杜绝内核 OOM Killer 强杀
      max_memory_restart: "650M",
      env: {
        NODE_ENV: "production",
        PORT: 831,
        HOSTNAME: "0.0.0.0",
      },
    },
  ],
};
