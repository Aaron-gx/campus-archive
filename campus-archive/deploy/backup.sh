#!/bin/bash
# ==============================================================================
# 「存档」每日备份脚本 —— SQLite 数据库 + 用户档案文件
# 建议部署为 cron（root）：
#   0 3 * * * /var/www/campus-archive/deploy/backup.sh >> /var/log/campus-archive-backup.log 2>&1
# 恢复方法：
#   1. 停应用：pm2 stop campus-archive
#   2. 解压对应日期备份，将 db 文件放回 prisma/、storage/ 覆盖
#   3. pm2 start campus-archive
# ==============================================================================

set -euo pipefail

# 应用目录（按实际部署路径修改）
APP_DIR="${APP_DIR:-/var/www/campus-archive}"
# 备份保留目录
BACKUP_DIR="${BACKUP_DIR:-/var/backups/campus-archive}"
# 保留天数
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# 异机/对象存储同步目标（可选，推荐 OSS/S3 rclone 远端，如 "rclone:campus-archive-backup"）
REMOTE_TARGET="${REMOTE_TARGET:-}"

DATE=$(date +%F)
TARGET="$BACKUP_DIR/$DATE"
mkdir -p "$TARGET"

echo "[$(date '+%F %T')] backup start -> $TARGET"

# 1) SQLite 在线备份（sqlite3 .backup 保证一致性，不锁库不丢 WAL 数据）
#    未安装 sqlite3 时回退为文件级拷贝（需应用短暂停写，风险较高，建议尽快安装 sqlite3）
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$APP_DIR/prisma/dev.db" ".backup '$TARGET/db.sqlite'"
else
  echo "[warn] sqlite3 未安装，使用文件级拷贝（WAL 未合并，恢复时需同目录 db-wal/db-shm）"
  cp "$APP_DIR/prisma/dev.db" "$TARGET/db.sqlite"
  for f in "$APP_DIR/prisma/dev.db-wal" "$APP_DIR/prisma/dev.db-shm"; do
    [ -f "$f" ] && cp "$f" "$TARGET/"
  done
fi

# 2) 用户档案文件（已加密落盘，明文不出服务器）
if [ -d "$APP_DIR/storage" ]; then
  tar -czf "$TARGET/storage.tar.gz" -C "$APP_DIR" storage
fi

# 3) 打包为单文件，便于异机传输
ARCHIVE="$BACKUP_DIR/campus-archive-$DATE.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" "$DATE"
rm -rf "$TARGET"

# 4) 同步到异机/对象存储（可选）
if [ -n "$REMOTE_TARGET" ] && command -v rclone &> /dev/null; then
  rclone copy "$ARCHIVE" "$REMOTE_TARGET/$(date +%Y/%m)"
fi

# 5) 清理过期备份
find "$BACKUP_DIR" -name "campus-archive-*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date '+%F %T')] backup done: $ARCHIVE"
