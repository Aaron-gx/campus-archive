# 简册 · 个人电子档案袋

大学四年，一档留痕。给大学生用的电子档案袋，一个账号、网页端和安卓 App 两端共用。

要解决的问题很具体：材料散在相册、群文件、教务系统和各种打卡小程序里，等到要评优、要投简历才回头翻，才发现根本凑不齐。简册把这些东西按预设分类收拢，把证书变成能筛选能导出的结构化记录，把身份证这类高危证件单独加密锁起来，最后能按场景一键打包。

## 两端

| 端 | 目录 | 技术栈 |
|---|---|---|
| 网页版 / 服务端 | `campus-archive/` | Next.js 14 · TypeScript · Prisma · SQLite |
| 安卓 App | `campus_archive_app/` | Flutter · Dart · SQLite |

网页端同时也是 App 的后端服务器，两端共用一套 REST API 和同一个账号。App 本地保存全量镜像，断网时归档、编辑、导出照常可用，恢复联网后自动上传同步。

## 功能

| 模块 | 说明 |
|---|---|
| 注册登录 | 手机号 / 学校邮箱 + 密码，JWT 会话（httpOnly Cookie，30 天） |
| 五大分类 | 身份证件 / 证书 / 经历证明 / 活动照片 / 作品集，21 个预设子类 |
| 文件上传 | JPG / PNG / WebP / HEIC / PDF，单文件上限 20MB；图片按 EXIF 纠正方向、长边压到 2000px 转 WebP |
| 敏感证件加密 | 身份证件类强制 AES-256-GCM 落盘加密，密钥按用户 HKDF 派生；查看与导出需密码二次验证（10 分钟窗口） |
| 证书结构化 | 名称 / 颁发单位 / 七档级别 / 时间，可关联原件，支持级别筛选与搜索 |
| 打包导出 | 按分类产出 zip（解密文件归档 + 材料清单.csv + 证书汇总.csv），内置"评优材料包""简历附件包"两种场景 |
| 存证核验 | 导出包含服务端签发的存证编号与 HMAC 签名，公开核验页可查真伪 |
| 隐私合规 | 隐私政策、注销即彻底删除库记录与物理文件、数据不作模型训练 |
| 响应式 | 桌面端侧边栏、移动端底部导航，一套代码 |

## 技术栈

网页端

- Next.js 14 App Router + TypeScript + Tailwind CSS
- SQLite + Prisma ORM，schema 按 PostgreSQL 兼容编写，换 datasource 即可迁移
- bcryptjs 密码哈希 + jose JWT；加密走 Node crypto，AES-256-GCM + HKDF 按用户派生密钥
- sharp 处理图片，archiver 打包导出，onnxruntime-web 在浏览器里跑本地 OCR

安卓端

- Flutter + Dart，本地 SQLite 全量镜像 + AES-256-GCM 加密
- `lib/data/api_client.dart` 对接网页端全部接口

## 快速开始

### 网页端 / 服务端

```bash
cd campus-archive
npm install              # postinstall 会自动同步 OCR 的 wasm 运行时
cp .env.example .env
npm run setup            # 建库 + 写入五大分类种子
npm run dev              # http://localhost:3000
```

首次必须生成两个密钥填进 `.env`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`AUTH_SECRET` 是会话签名密钥，`MASTER_KEY` 是敏感文件加密主密钥。MASTER_KEY 一旦更换，此前加密的文件就再也解不开，上线前务必定版，生产环境建议托管到 KMS。

OCR 模型（`public/models/ocr/`）有 6MB 左右，不在 npm 包里，缺失时 `npm install` 会打印下载地址。不装只影响身份证识别，其余功能不受影响。

### 安卓 App

```bash
cd campus_archive_app
flutter pub get
flutter run
```

登录页的服务器地址填本机局域网 IP，服务端要监听全部网卡手机才连得上：

```bash
npx next dev -H 0.0.0.0 -p 3000
```

手机和电脑连同一个 WiFi。连不上多半是 Windows 防火墙拦了 3000 端口，放行 Node.js 即可。

## 测试

```bash
cd campus-archive
node --env-file=.env .e2e/run.mjs            # 端到端全链路
node --env-file=.env .e2e/security-test.mjs  # 安全回归
```

两组脚本都可以反复运行，跑之前会精确清理自己产生的测试账号与数据，不触碰真实用户记录。需要 dev server 已经起来。

## 安全设计

这是项目里最花心思的部分，几个关键决定：

- 敏感文件落盘前完成加密，明文不进数据库；`storage/{userId}/` 按用户隔离
- 二次验证令牌独立于登录会话，10 分钟短时效，查看和导出共用同一道闸门
- 越权访问统一返回 404，不暴露资源是否存在；登录与改密错误信息统一，防账号枚举
- 删除文档与注销账户时物理文件同步删除；改密后吊销全部会话与信任设备
- 文件响应头 `Cache-Control: private, no-store`，敏感内容不进任何缓存
- 上传侧做魔数嗅探、PDF 危险特征扫描、图像尺寸炸弹限制；AI 接口做 SSRF 防护与按用户限流
- 审计日志记录真实连接层 IP，仅在显式配置受信代理时才采信转发头

## AI 能力（分敏感度分级）

身份类材料绝不上云。`ai-router.ts` 按分类分流：身份证件走纯本地通道（浏览器端 OCR + 规则引擎），证书、经历证明、照片、作品集才走云端多模态模型。云端通道沿用用户自己配置的 API Key，服务端不代持。

完整方案见 `docs/AI集成解决方案.md`。

## 目录结构

```
├── campus-archive/          网页版 + 服务端（Next.js）
│   ├── prisma/              数据模型与分类种子
│   ├── src/app/             页面与 REST API
│   ├── src/lib/             auth / crypto / storage / ai-router 等
│   ├── deploy/              nginx、pm2、服务器初始化与备份脚本
│   ├── scripts/             资源同步、端口清理、数据库备份
│   └── .e2e/                端到端与安全回归测试
├── campus_archive_app/      安卓 App（Flutter）
│   └── lib/
│       ├── data/            API 客户端、本地库、加解密、导出
│       ├── pages/           各页面
│       └── state/           状态管理
└── docs/                    设计缘起、项目总览、AI 集成方案
```

## 文档

- [设计缘起](docs/设计缘起.md) — 最初的产品思路与取舍
- [项目总览](docs/项目总览.md) — 目录结构与使用形态
- [AI 集成解决方案](docs/AI集成解决方案.md) — 分级 AI 能力矩阵与三阶段路线
- [CHANGELOG](campus-archive/CHANGELOG.md) — 功能演进与安全加固记录

## 已知限制

- 账号模式需要服务器可达（局域网或已部署的公网地址），纯离线只做本地镜像排队，恢复联网后同步
- 微信小程序端、多端实时冲突处理尚未实现

## 许可

MIT，见 [LICENSE](LICENSE)。OCR 模型来自 PaddleOCR（Apache-2.0），由 [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models) 转成 ONNX Runtime 格式。
