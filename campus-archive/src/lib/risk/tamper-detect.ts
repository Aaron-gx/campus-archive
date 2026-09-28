/**
 * 客户端离线图像篡改与修改痕迹初筛算子
 * 100% 浏览器离线运行，零网络外发，保障端到端加密隐私
 * 核心技术：
 * 1. Canvas 错误级别分析（ELA，Error Level Analysis）
 * 2. 图像头部 EXIF 编辑软件指纹与元数据异常探测
 */

export interface TamperDetectionResult {
  isTampered: boolean;
  issue: string;
  confidence: number; // 0 ~ 1
  details?: {
    maxGridRatio?: number;
    softwareDetected?: string;
  };
}

/**
 * 分析图片文件是否存在局部修改、拼接篡改或修图软件二次导出痕迹
 */
export async function detectImageTampering(file: File): Promise<TamperDetectionResult> {
  const defaultPass: TamperDetectionResult = {
    isTampered: false,
    issue: "",
    confidence: 0,
  };

  if (!file || !file.type.startsWith("image/")) return defaultPass;
  if (typeof window === "undefined") return defaultPass;

  try {
    // 1. 探测图片二进制头部是否存在常见修图软件签名
    const headerCheck = await checkExifSoftwareSignature(file);
    if (headerCheck.detected) {
      return {
        isTampered: true,
        issue: "修图软件生成",
        confidence: 0.85,
        details: { softwareDetected: headerCheck.software },
      };
    }

    // 2. 本地 Canvas 错误级别分析（ELA）
    const elaResult = await runCanvasEla(file);
    if (elaResult.isAnomalous) {
      return {
        isTampered: true,
        issue: "疑似局部修改",
        confidence: Math.min(0.9, Math.round(elaResult.ratio * 20) / 100),
        details: { maxGridRatio: elaResult.ratio },
      };
    }

    return defaultPass;
  } catch {
    return defaultPass;
  }
}

/**
 * 提取文件前 64KB 二进制流，搜索常见修图/合成软件特征字串
 */
async function checkExifSoftwareSignature(file: File): Promise<{ detected: boolean; software: string }> {
  try {
    const slice = file.slice(0, 65536);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      // 仅收集 ASCII 可见字符
      if (c >= 32 && c <= 126) {
        str += String.fromCharCode(c);
      }
    }

    const signatures = [
      { pattern: /Photoshop/i, name: "Photoshop" },
      { pattern: /Meitu/i, name: "美图秀秀" },
      { pattern: /Canva/i, name: "Canva" },
      { pattern: /GIMP/i, name: "GIMP" },
      { pattern: /Snapseed/i, name: "Snapseed" },
    ];

    for (const sig of signatures) {
      if (sig.pattern.test(str)) {
        return { detected: true, software: sig.name };
      }
    }
    return { detected: false, software: "" };
  } catch {
    return { detected: false, software: "" };
  }
}

/**
 * 基于 Canvas 的轻量级 ELA（Error Level Analysis）计算
 * 将图像缩放至 480px 宽度，以 85% JPEG 质量二次编码，
 * 比对原图与二次压缩图的高频像素残差方差分布。
 */
async function runCanvasEla(file: File): Promise<{ isAnomalous: boolean; ratio: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });

    const targetW = 480;
    const targetH = Math.round((img.naturalHeight * targetW) / (img.naturalWidth || 1)) || 360;

    // 画布 1：原图缩小版
    const c1 = document.createElement("canvas");
    c1.width = targetW;
    c1.height = targetH;
    const ctx1 = c1.getContext("2d", { willReadFrequently: true });
    if (!ctx1) return { isAnomalous: false, ratio: 1 };
    ctx1.drawImage(img, 0, 0, targetW, targetH);
    const d1 = ctx1.getImageData(0, 0, targetW, targetH).data;

    // 二次压缩为 85% JPEG
    const recompressedBlob = await new Promise<Blob | null>((res) =>
      c1.toBlob(res, "image/jpeg", 0.85)
    );
    if (!recompressedBlob) return { isAnomalous: false, ratio: 1 };

    const recompressedUrl = URL.createObjectURL(recompressedBlob);
    const img2 = new Image();
    await new Promise<void>((resolve, reject) => {
      img2.onload = () => resolve();
      img2.onerror = reject;
      img2.src = recompressedUrl;
    });
    URL.revokeObjectURL(recompressedUrl);

    // 画布 2：二次压缩图像
    const c2 = document.createElement("canvas");
    c2.width = targetW;
    c2.height = targetH;
    const ctx2 = c2.getContext("2d", { willReadFrequently: true });
    if (!ctx2) return { isAnomalous: false, ratio: 1 };
    ctx2.drawImage(img2, 0, 0, targetW, targetH);
    const d2 = ctx2.getImageData(0, 0, targetW, targetH).data;

    // 将画面划分成 6x6 共 36 个分块，分别计算各网格的平均误差方差
    const gridCols = 6;
    const gridRows = 6;
    const cellW = Math.floor(targetW / gridCols);
    const cellH = Math.floor(targetH / gridRows);
    const cellVariances: number[] = [];

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        let sumDiff = 0;
        let sumDiffSq = 0;
        let count = 0;

        for (let y = gy * cellH; y < (gy + 1) * cellH; y++) {
          for (let x = gx * cellW; x < (gx + 1) * cellW; x++) {
            const idx = (y * targetW + x) * 4;
            // 灰度残差差值
            const diffR = Math.abs(d1[idx] - d2[idx]);
            const diffG = Math.abs(d1[idx + 1] - d2[idx + 1]);
            const diffB = Math.abs(d1[idx + 2] - d2[idx + 2]);
            const diff = 0.299 * diffR + 0.587 * diffG + 0.114 * diffB;

            sumDiff += diff;
            sumDiffSq += diff * diff;
            count++;
          }
        }

        const mean = sumDiff / (count || 1);
        const variance = sumDiffSq / (count || 1) - mean * mean;
        cellVariances.push(variance);
      }
    }

    // 计算全局中位数方差与最大方差比
    const sorted = [...cellVariances].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const maxVar = sorted[sorted.length - 1] || 1;
    const ratio = maxVar / (median || 1);

    // 若局部网格残差方差达到中位数的 3.8 倍以上且绝对残差足够大，判定为局部合成修改异常
    const isAnomalous = ratio > 3.8 && maxVar > 12;
    return { isAnomalous, ratio };
  } finally {
    URL.revokeObjectURL(url);
  }
}
