# 2C2G 服务器极简部署指南

本项目已针对 **2核 2GB** 内存的轻量云服务器完成全方位的安全性与低资源性能调优：
- **内存防护**：Node.js V8 堆内存上限锁死为 1024MB，PM2 超 1200MB 平滑重启，Sharp 图片处理限制并发=1且内存缓存=20MB。
- **并发锁防护**：PM2 单实例（1 Worker）运行，配合 SQLite 开启 WAL 模式与 5000ms busy_timeout，彻底消除多进程写冲突。
- **安全加固**：登录与二次验证频率限制（防止暴力破解）、bcrypt 时序保护、高危内网 SSRF 拦截、生产安全 Cookie、安全响应头（防点击劫持与 XSS）。

---

## 部署步骤

### 1. 服务器环境准备（必须开启 Swap）
在服务器终端（需 root 权限）执行初始化脚本：
```bash
chmod +x deploy/setup-server.sh
sudo bash deploy/setup-server.sh
```

### 2. 配置环境变量 (.env)
在项目根目录下创建 `.env` 文件，务必配置强随机密钥（严禁使用默认值）：
```env
# 核心加密与 Session 密钥（生产环境必须设置强随机串，至少 32 字符）
AUTH_SECRET="生成随机32位以上强字符串"
DATA_ENCRYPTION_KEY="生成随机32位以上强字符串"

# 数据库路径（生产环境 SQLite）
DATABASE_URL="file:./prisma/dev.db"

# 生产环境标识
NODE_ENV="production"
PORT=3000
```

### 3. 构建与静态资源准备 (Standalone 模式)
```bash
# 1. 安装依赖
npm ci --production=false

# 2. 生成 Prisma 客户端
npx prisma generate

# 3. 部署或同步数据库结构
npx prisma db push

# 4. Next.js 独立产物构建
npm run build

# 5. 复制独立部署所需的静态资源与公共文件到 standalone 目录
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/ 2>/dev/null || true
```

### 4. 启动 PM2 守护进程
```bash
# 启动服务（已预置 2C2G 专属内存与单核优化参数）
pm2 start deploy/ecosystem.config.js

# 保存并设置开机自启
pm2 save
pm2 startup
```

### 5. Nginx 反向代理配置
```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/campus-archive.conf
# 校验并热重载 Nginx
sudo nginx -t && sudo systemctl reload nginx
```

---

## 运维常用命令
- 查看实时内存与状态：`pm2 monit` 或 `pm2 status`
- 查看应用运行日志：`pm2 logs campus-archive`
- 平滑重载应用：`pm2 reload campus-archive`
- 重启应用：`pm2 restart campus-archive`
