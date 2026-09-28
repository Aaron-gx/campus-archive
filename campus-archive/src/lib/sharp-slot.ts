/**
 * sharp 压缩并发闸门（进程级共享）
 *
 * sharp.concurrency(1) 只限制 CPU 线程数，不限制排队任务数；并发上传/缩略图生成
 * 时多个大图同时在队列中会内存叠加。用信号量限制同时执行 sharp 的任务数，
 * 防止 2C2G 小规格服务器在处理多个大图时内存暴涨。
 */

let sharpActive = 0;
const sharpWaiters: Array<() => void> = [];

const MAX_CONCURRENT = Number(process.env.SHARP_CONCURRENCY ?? 2);
const MAX_QUEUE_WAITERS = 10;

export async function withSharpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (sharpActive >= MAX_CONCURRENT) {
    if (sharpWaiters.length >= MAX_QUEUE_WAITERS) {
      throw new Error("图像处理并发已达上限，请稍后重试");
    }
    await new Promise<void>((resolve) => sharpWaiters.push(resolve));
  }
  sharpActive++;
  try {
    return await fn();
  } finally {
    sharpActive--;
    sharpWaiters.shift()?.();
  }
}
