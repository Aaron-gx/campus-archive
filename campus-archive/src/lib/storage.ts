import fs from "fs/promises";
import { createReadStream, type ReadStream } from "fs";
import path from "path";

// 存储层：驱动契约接口。支持本地磁盘实现，预留后续平滑迁移 OSS / COS / S3
export interface IStorageDriver {
  save(userId: string, storedName: string, data: Buffer): Promise<void>;
  read(userId: string, storedName: string): Promise<Buffer>;
  readStream(userId: string, storedName: string): ReadStream;
  delete(userId: string, storedName: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  readThumbnail(userId: string, storedName: string): Promise<Buffer | null>;
  saveThumbnail(userId: string, storedName: string, data: Buffer): Promise<void>;
}

const ROOT = path.join(process.cwd(), "storage");

/** 本地磁盘存储驱动（带路径穿越防范与原子目录保障） */
export class LocalStorageDriver implements IStorageDriver {
  private safeUserDir(userId: string): string {
    if (!userId || /[\\/]|\.\./.test(userId)) {
      throw new Error("[SECURITY] 非法 userId 格式");
    }
    return path.join(ROOT, userId);
  }

  private safeFilePath(userId: string, storedName: string): string {
    if (!storedName || /[\\/]|\.\./.test(storedName)) {
      throw new Error("[SECURITY] 非法 storedName 格式，禁止路径穿越");
    }
    const dir = this.safeUserDir(userId);
    const target = path.resolve(dir, storedName);
    if (!target.startsWith(path.resolve(dir))) {
      throw new Error("[SECURITY] 目标路径逃逸用户隔离目录");
    }
    return target;
  }

  async save(userId: string, storedName: string, data: Buffer): Promise<void> {
    const filePath = this.safeFilePath(userId, storedName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async read(userId: string, storedName: string): Promise<Buffer> {
    const filePath = this.safeFilePath(userId, storedName);
    return fs.readFile(filePath);
  }

  readStream(userId: string, storedName: string): ReadStream {
    const filePath = this.safeFilePath(userId, storedName);
    return createReadStream(filePath);
  }

  async delete(userId: string, storedName: string): Promise<void> {
    try {
      const filePath = this.safeFilePath(userId, storedName);
      await fs.unlink(filePath);
    } catch {
      // 文件不存在则忽略（数据库记录是唯一事实）
    }
    try {
      const thumbPath = this.safeFilePath(userId, `thumb_${storedName}.webp`);
      await fs.unlink(thumbPath);
    } catch {}
  }

  async deleteUser(userId: string): Promise<void> {
    const dir = this.safeUserDir(userId);
    await fs.rm(dir, { recursive: true, force: true });
  }

  async readThumbnail(userId: string, storedName: string): Promise<Buffer | null> {
    try {
      const thumbPath = this.safeFilePath(userId, `thumb_${storedName}.webp`);
      return await fs.readFile(thumbPath);
    } catch {
      return null;
    }
  }

  async saveThumbnail(userId: string, storedName: string, data: Buffer): Promise<void> {
    const thumbPath = this.safeFilePath(userId, `thumb_${storedName}.webp`);
    await fs.mkdir(path.dirname(thumbPath), { recursive: true });
    await fs.writeFile(thumbPath, data);
  }
}

// 默认驱动实例（后续可根据 STORAGE_DRIVER 环境变量切换为 S3/OSS 实现）
let currentDriver: IStorageDriver = new LocalStorageDriver();

export function setStorageDriver(driver: IStorageDriver) {
  currentDriver = driver;
}

export function getStorageDriver(): IStorageDriver {
  return currentDriver;
}

// 门面方法导出（保持现有业务层代码调用 100% 兼容）：
export const saveFile = (userId: string, storedName: string, data: Buffer) =>
  currentDriver.save(userId, storedName, data);

export const readFile = (userId: string, storedName: string) =>
  currentDriver.read(userId, storedName);

export const readFileStream = (userId: string, storedName: string) =>
  currentDriver.readStream(userId, storedName);

export const deleteFile = (userId: string, storedName: string) =>
  currentDriver.delete(userId, storedName);

export const deleteUserDir = (userId: string) =>
  currentDriver.deleteUser(userId);

export const readThumbnail = (userId: string, storedName: string) =>
  currentDriver.readThumbnail(userId, storedName);

export const saveThumbnail = (userId: string, storedName: string, data: Buffer) =>
  currentDriver.saveThumbnail(userId, storedName, data);
