import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import archiver from "archiver";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, "backups");
const MAX_BACKUPS = 7; // 保留最近 7 份备份

function pad(n) {
  return String(n).padStart(2, "0");
}

function getTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function flushSqliteWal() {
  const prisma = new PrismaClient();
  try {
    // 强制执行 WAL 检查点，把 -wal 缓冲完整刷入 SQLite 主文件
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
    console.log("  [1/4] SQLite WAL 缓冲已同步刷盘");
  } catch (err) {
    console.warn("  [1/4] SQLite 检查点提示:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("backup_") && f.endsWith(".zip"))
      .map((f) => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const item of toDelete) {
        fs.unlinkSync(item.path);
        console.log(`  [清理] 已轮转移除早期备份: ${item.name}`);
      }
    }
  } catch (e) {
    console.warn("  [清理] 旧备份轮转异常:", e.message);
  }
}

async function runBackup() {
  console.log("=== 开始执行数据库与加密存储灾备备份 ===");
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // 1. 刷盘 SQLite WAL
  await flushSqliteWal();

  // 2. 准备打包
  const ts = getTimestamp();
  const zipPath = path.join(BACKUP_DIR, `backup_${ts}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const donePromise = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  // 3. 收集数据库文件
  console.log("  [2/4] 归档 SQLite 数据库文件...");
  const dbPath = path.join(ROOT, "prisma", "dev.db");
  if (fs.existsSync(dbPath)) {
    archive.file(dbPath, { name: "prisma/dev.db" });
  }
  const dbWal = path.join(ROOT, "prisma", "dev.db-wal");
  if (fs.existsSync(dbWal)) {
    archive.file(dbWal, { name: "prisma/dev.db-wal" });
  }

  // 4. 收集加密物理文件
  console.log("  [3/4] 归档 storage/ 密文物理存储...");
  const storageDir = path.join(ROOT, "storage");
  if (fs.existsSync(storageDir)) {
    archive.directory(storageDir, "storage");
  }

  await archive.finalize();
  await donePromise;

  const stats = fs.statSync(zipPath);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`  [4/4] 备份完成！产物: backups/backup_${ts}.zip (${sizeMb} MB)`);

  // 5. 轮转旧备份
  await cleanOldBackups();
  console.log("=== 灾备备份全流程执行完毕 ===\n");
}

runBackup().catch((err) => {
  console.error("❌ 备份失败:", err);
  process.exit(1);
});
