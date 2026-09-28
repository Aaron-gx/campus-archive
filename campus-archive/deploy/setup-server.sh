#!/bin/bash
# ==============================================================================
# 2C2G 服务器一键环境初始化与部署脚本
# 适用系统: Ubuntu 22.04+ / Debian 11+ / CentOS 8+
# ==============================================================================

set -e

echo "=== [1/5] 检查并配置系统 Swap 交换空间 (2C2G 核心防崩溃策略) ==="
# 2C2G 服务器物理内存有限，若突发流量或上传图片处理，极易触发 OOM Killer。
# 必须配置 2GB~4GB Swap 空间作为安全垫。
SWAP_EXISTS=$(swapon --show | wc -l)
if [ "$SWAP_EXISTS" -le 1 ]; then
    echo "创建 2GB Swap 空间..."
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # 设置 swappiness 为 10，优先使用物理内存，仅在物理内存紧张时才使用 Swap
    sysctl vm.swappiness=10
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    echo "Swap 空间配置完成！"
else
    echo "已检测到现有 Swap 空间，跳过创建。"
fi

echo "=== [2/5] 检查基础软件依赖 (Node.js 20+, Nginx, PM2) ==="
if ! command -v node &> /dev/null; then
    echo "正在安装 Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs nginx
fi

if ! command -v pm2 &> /dev/null; then
    echo "正在全局安装 PM2 进程守护工具..."
    npm install -g pm2
fi

echo "=== [3/5] 构建产物准备说明 ==="
echo "在本地开发机或服务器执行以下命令以完成生产打包："
echo "  1. npm run build"
echo "  2. cp -r public .next/standalone/  (若 public 存在)"
echo "  3. cp -r .next/static .next/standalone/.next/"
echo "  4. npx prisma db push --skip-generate (初始化生产 SQLite 数据库结构)"
echo "  5. pm2 start deploy/ecosystem.config.js"
echo "  6. pm2 save && pm2 startup"

echo "=== [4/5] Nginx 配置说明 ==="
echo "可将 deploy/nginx.conf 复制至 /etc/nginx/conf.d/ 并重启 Nginx:"
echo "  sudo cp deploy/nginx.conf /etc/nginx/conf.d/campus-archive.conf"
echo "  sudo nginx -t && sudo systemctl reload nginx"

echo "=== [5/5] 初始化检查完成！ ==="
