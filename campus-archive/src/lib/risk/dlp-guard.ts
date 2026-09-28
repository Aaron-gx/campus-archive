/**
 * 敏感数据防出网硬隔离探针 (Data Loss Prevention, DLP)
 * 拦截任何潜在将敏感居民身份证件、银行卡、主密钥等外发至第三方或云端服务的请求
 */

import { validateIdCardNumber } from "./credential-rules";

export interface DlpInspectionResult {
  blocked: boolean;
  reason?: string;
}

/**
 * 校验发往云端 AI 或外部服务的请求参数
 * @param categoryKey 分类键
 * @param textPayload 附带的文本数据（如 OCR 文本、用户备注等）
 */
export function inspectOutboundPayload(categoryKey?: string, textPayload?: string): DlpInspectionResult {
  // 1. 严格阻断身份证件及其所有子分类
  if (categoryKey) {
    const cleanKey = categoryKey.trim().toLowerCase();
    if (cleanKey === "identity" || cleanKey.startsWith("identity-")) {
      return {
        blocked: true,
        reason: "为保障隐私安全，敏感证件严禁调用云端外部服务",
      };
    }
  }

  if (!textPayload) return { blocked: false };

  // 2. 检查文本中是否潜藏真实的 18 位中国居民身份证号
  const idRegex = /[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]/gi;
  const matches = textPayload.match(idRegex);
  if (matches) {
    for (const m of matches) {
      if (validateIdCardNumber(m).valid) {
        return {
          blocked: true,
          reason: "文本内容包含未脱敏居民身份证号，已被防泄露网关拦截",
        };
      }
    }
  }

  // 3. 检查文本中是否潜藏 16~19 位银行卡卡号（符合 Luhn 算法）
  const cardRegex = /\b([1-9]\d{15,18})\b/g;
  const cardMatches = textPayload.match(cardRegex);
  if (cardMatches) {
    for (const c of cardMatches) {
      if (checkLuhn(c)) {
        return {
          blocked: true,
          reason: "文本内容包含敏感银行卡号，已被防泄露网关拦截",
        };
      }
    }
  }

  return { blocked: false };
}

/**
 * Luhn 模 10 算法（银行卡卡号校验）
 */
function checkLuhn(cardNo: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = cardNo.length - 1; i >= 0; i--) {
    let n = parseInt(cardNo[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n = (n % 10) + 1;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}
