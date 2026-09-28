/**
 * 本地 Canvas 图像质量快速评估算子
 * 100% 浏览器本地运行，零网络外发，完全满足隐私保护要求
 * 用于即时检测翻拍照片的模糊度、过曝（强光反光）与过暗
 */

export interface ImageQualityResult {
  pass: boolean;
  issue: "画面模糊" | "光线过暗" | "强光反光" | "";
  score: {
    blurVariance: number;
    brightness: number;
    overexposedRatio: number;
  };
}

/**
 * 分析图片文件或 ObjectURL 的画质
 * 将图片按比例缩放至 300px 宽度的离屏 Canvas，计算灰度方差与直方图（耗时 < 15ms）
 */
export async function checkLocalImageQuality(fileOrUrl: File | string): Promise<ImageQualityResult> {
  const defaultPass: ImageQualityResult = {
    pass: true,
    issue: "",
    score: { blurVariance: 0, brightness: 128, overexposedRatio: 0 },
  };

  if (typeof window === "undefined") return defaultPass;

  let url = "";
  let needsRevoke = false;
  if (typeof fileOrUrl === "string") {
    url = fileOrUrl;
  } else {
    if (!fileOrUrl.type.startsWith("image/")) return defaultPass;
    url = URL.createObjectURL(fileOrUrl);
    needsRevoke = true;
  }

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });

    const targetW = 320;
    const targetH = Math.round((img.naturalHeight * targetW) / (img.naturalWidth || 1)) || 240;

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return defaultPass;

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    const data = imgData.data;
    const totalPixels = targetW * targetH;

    // 1. 转单通道灰度数组并统计平均亮度、过曝像素
    const gray = new Float32Array(totalPixels);
    let sumBrightness = 0;
    let overexposedCount = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[p] = g;
      sumBrightness += g;
      if (g > 250) overexposedCount++;
    }

    const avgBrightness = sumBrightness / totalPixels;
    const overexposedRatio = overexposedCount / totalPixels;

    // 2. 使用简化拉普拉斯梯度算子计算边缘方差（衡量锐度与模糊程度）
    let laplacianSum = 0;
    let laplacianSumSq = 0;
    let validCount = 0;

    for (let y = 1; y < targetH - 1; y++) {
      const rowOffset = y * targetW;
      for (let x = 1; x < targetW - 1; x++) {
        const idx = rowOffset + x;
        // 4-邻域拉普拉斯核 [0, 1, 0; 1, -4, 1; 0, 1, 0]
        const lap =
          gray[idx - targetW] +
          gray[idx + targetW] +
          gray[idx - 1] +
          gray[idx + 1] -
          4 * gray[idx];

        laplacianSum += lap;
        laplacianSumSq += lap * lap;
        validCount++;
      }
    }

    const mean = laplacianSum / (validCount || 1);
    const variance = laplacianSumSq / (validCount || 1) - mean * mean;

    // 3. 判定缺陷指标
    // 过暗：平均灰度 < 45
    if (avgBrightness < 45) {
      return {
        pass: false,
        issue: "光线过暗",
        score: { blurVariance: variance, brightness: avgBrightness, overexposedRatio },
      };
    }

    // 强光反光：在非大面积纯白纸张的照片中，局部出现超过 18% 的过曝强光斑
    // 注意：证书/扫描件/A4 纸底色本身就是大面积纯白（avgBrightness 通常 > 200），不能误判为反光
    if (avgBrightness < 205 && overexposedRatio > 0.18) {
      return {
        pass: false,
        issue: "强光反光",
        score: { blurVariance: variance, brightness: avgBrightness, overexposedRatio },
      };
    }

    // 画面模糊：拉普拉斯方差低于阈值（自然清晰照片方差通常 > 100，极度模糊通常 < 30）
    if (variance < 32) {
      return {
        pass: false,
        issue: "画面模糊",
        score: { blurVariance: variance, brightness: avgBrightness, overexposedRatio },
      };
    }

    return {
      pass: true,
      issue: "",
      score: { blurVariance: variance, brightness: avgBrightness, overexposedRatio },
    };
  } catch {
    return defaultPass;
  } finally {
    if (needsRevoke) URL.revokeObjectURL(url);
  }
}
