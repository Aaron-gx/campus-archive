# 简册 · 网页端 / 服务端

> 面向大学生成长周期的结构化档案工具。分类模板按大学生场景预设、证书结构化记录、敏感证件加密存储、评优与求职材料一键打包导出。

本目录既是网页版，也是安卓 App 的后端服务器。项目全貌见[仓库根目录 README](../README.md)。

## 设计规范（Paper Dossier 纸质档案袋）

全站遵循 `student-archive-demo.html` 设计规范：

- **色彩令牌**：米纸底 `#EFEAE0` + 点状纹理、卡片 `#FBF8F2`、墨色 `#202B38`、印章红 `#A63A3A`、金 `#B08D3D`、鼠尾草绿 `#5C7A63`、档案蓝 `#4A6D8C`
- **字体**：Noto Serif SC（标题/数字）、Noto Sans SC（正文）、JetBrains Mono（文件名/元信息）
- **组件语言**：顶栏品牌章（旋转 -3°「存」印章）、档案标签侧边栏（激活标签右移出血）、索引卡片统计条（虚线分隔 + 衬线数字）、虚线上传区、文档卡片（分类色 tag + 等宽文件名）、证书表格（大写表头 + 虚线行 + 级别 pill）
- **分类色**：身份证件=墨、获奖证书=金、经历证明=绿、活动照片=蓝、作品集=红
- **响应式**：<860px 侧边栏变为横向滚动标签条

设计令牌与组件类集中在 `src/app/globals.css`，页面使用语义类（`.tab/.index-strip/.doc-card/.cert-table/.chip/.dropzone` 等）。

## 功能一览（MVP 全部实现）

| 模块 | 说明 |
|---|---|
| 注册登录 | 手机号 / 学校邮箱 + 密码，JWT 会话（httpOnly Cookie，30 天） |
| 五大分类 | 身份证件 / 证书 / 经历证明 / 活动照片 / 作品集，共 21 个预设子类，开箱即用 |
| 文件上传 | 支持 JPG/PNG/WebP/HEIC/PDF，最大 20MB；图片自动压缩转 WebP（按 EXIF 纠正方向，长边 ≤2000px） |
| 敏感加密 | 身份证件类强制 AES-256-GCM 加密存储（按用户 HKDF 派生密钥），查看/导出需密码二次验证（10 分钟窗口） |
| 证书结构化 | 名称/颁发单位/级别（国际级→院级 7 档）/时间，可关联原件，表格视图支持级别筛选与搜索 |
| 打包导出 | 按类别生成 zip：解密文件按分类归档 + 材料清单.csv + 证书汇总.csv（带 BOM，Excel 直接打开）；内置"评优材料包/简历附件包"快捷场景 |
| 隐私合规 | 隐私政策（个保法）、账户注销即彻底删除数据库记录与物理文件、数据不作模型训练承诺 |
| 多端适配 | 响应式 H5：桌面侧边栏 + 移动端底部导航，手机/电脑同一套代码 |

## 技术栈

- **框架**：Next.js 14（App Router，前后端一体）+ TypeScript + Tailwind CSS
- **数据库**：SQLite + Prisma ORM（schema 与 PostgreSQL 兼容，切换只需改 datasource）
- **认证**：bcryptjs 密码哈希 + jose JWT
- **加密**：Node crypto，AES-256-GCM + HKDF 密钥派生
- **存储**：本地磁盘适配层（`src/lib/storage.ts`，可平滑替换为 OSS/COS）
- **图片处理**：sharp；**打包**：archiver

## 快速开始

```bash
npm install          # 安装依赖
npm run setup        # 初始化数据库 + 种子五大分类
npm run dev          # 启动开发服务器 → http://localhost:3000
```

生产部署：

```bash
npm run build && npm start
```

**首次必须配置密钥**（`.env`）：生产环境请重新生成 `MASTER_KEY`（敏感文件加密主密钥）与 `AUTH_SECRET`（JWT 密钥），并将 `MASTER_KEY` 托管至 KMS：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ 更换 `MASTER_KEY` 后已加密的历史文件将无法解密，上线前务必定版。

**可选：配置 AI 提取接口**（`.env`）：用于证书与经历证明等非敏感材料上传时的自动结构化回填（兼容 DeepSeek、通义千问等 OpenAI 协议接口）。敏感证件受端到端加密保护，严禁且不接入此接口。

```bash
AI_API_KEY="sk-your-key-here"
AI_BASE_URL="https://api.deepseek.com/v1"
AI_MODEL="deepseek-chat"
```

## 项目结构

```
prisma/schema.prisma        # 数据模型：User/Category(自关联子类)/Document/Certificate/ExportRecord
prisma/seed.ts              # 五大分类 + 21 个子类种子
src/lib/                    # auth(JWT+二次验证) / crypto(AES-256-GCM) / storage(磁盘适配层)
src/middleware.ts           # /dashboard 路由保护
src/app/api/                # REST API：auth / documents / certificates / export / account / categories
src/app/page.tsx            # 产品落地页（含印章装饰 SVG）
src/app/login|register      # 登录注册（档案卡片风）
src/app/dashboard/          # 工作台 / 分类详情 / 证书总目 / 导出打包 / 设置
src/app/privacy/            # 隐私政策
src/components/             # DashboardShell(顶栏+档案标签侧边栏) / SensitiveVerifyModal(二次验证弹窗)
.e2e/run.mjs                # 端到端 API 测试（28 项断言，可重复运行）
```

## 安全设计要点

- 敏感文件落盘前加密，`storage/{userId}/` 按用户隔离；数据库不存明文
- 二次验证令牌独立于登录会话，10 分钟短时效，查看/导出共用一道闸门
- 越权访问返回 404（不暴露资源存在性）；登录/改密错误信息统一，防账号枚举
- 删除文档/注销账户时物理文件同步删除；改密后全部会话吊销
- 文件响应头 `Cache-Control: private, no-store`，敏感内容不进缓存

## 从本地走向生产（升级路径）

1. **数据库**：`datasource` 改为 PostgreSQL 连接串即可迁移（schema 已按 PG 兼容编写）
2. **对象存储**：实现 `src/lib/storage.ts` 同名接口，替换为阿里云 OSS / 腾讯云 COS
3. **密钥管理**：`MASTER_KEY` 接入 KMS，按用户派生逻辑已就位
4. **V2 迭代方向**（刻意未做）：OCR 自动识别证书字段、手机验证码注册、微信小程序端、多端同步

## 测试

```bash
# 先启动 dev server，再运行（自动清理历史测试数据）
node --env-file=.env .e2e/run.mjs
```

覆盖注册/登录/加密上传/二次验证/证书 CRUD/导出 zip/越权/改密/注销全链路，共 28 项断言。

## Android App（Flutter 客户端）

配套 Flutter 安卓客户端位于本仓库 `../campus_archive_app`。

- **账号模式**：与网页版共用同一账号和全部 API（登录 / 上传 / 证书 / 导出 / 敏感二次验证），App 与网页数据实时一致
- **离线优先**：本机保存全量镜像（SQLite + AES-256-GCM 加密），断网时归档 / 编辑 / 删除 / 导出照常写入待同步队列，联网后自动上传
- App 侧代码结构与 API 契约见 `lib/data/api_client.dart`

### 局域网联调（手机 App ↔ 本机网页）

```bash
# 1. 启动服务端（监听全部网卡，手机才能访问）
npx next dev -H 0.0.0.0 -p 3000

# 2. 查本机局域网 IP（如 172.31.240.24）
ipconfig | findstr IPv4
```

手机与电脑连同一 WiFi，App 登录页「服务器地址」填 `http://<本机IP>:3000`。
若连不上，多半是 Windows 防火墙拦截 3000 端口，放行 Node.js 即可。
