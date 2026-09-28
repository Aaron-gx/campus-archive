/**
 * 证件有效期校验与到期状态判别
 *
 * 支持的字段格式：
 * 1. 身份证/居住证/通行证区间：2015.01.01-2025.01.01 / 2015-01-01 至 2025-01-01
 * 2. 长期有效：2018.10.15-长期 / 长期 / 至长期
 * 3. 护照/签注/单日期：2025-08-31 / 准予逗留至 2025-08-31 / 须在 2025.10.15 前出境
 * 4. 驾驶证年限：初次领证日期 (2018-05-10) + 有效期限 (6年/10年)
 * 5. 学生证学年：2020-2024 (毕业年 7 月 1 日为届满)
 */

export type ExpiryStatus = "expired" | "expiring" | "valid" | "permanent" | "unknown";

export interface ExpiryResult {
  status: ExpiryStatus;
  label: "已过期" | "即将到期" | "有效" | "长期" | "";
  expiryDateStr?: string; // 归一化 YYYY-MM-DD
  diffDays?: number; // 距今剩余天数，负数表示已过期天数
}

const EXPIRY_LABELS_REGEX = /(?:有效(?:期限|期至|期)?|签[注证]有效期至|香港有效期至|澳门有效期至|逗留期限|停留期限|学年|到期日|截至日期)/i;
const IGNORE_LABELS_REGEX = /(?:出生|初次领证|签发日期|发证日期|创建日期)/;

export function isExpiryField(label: string): boolean {
  if (IGNORE_LABELS_REGEX.test(label)) return false;
  return EXPIRY_LABELS_REGEX.test(label);
}

/** 归一化日期串为 YYYY-MM-DD */
export function normalizeDate(s: string): string | undefined {
  if (!s) return undefined;
  const m = s.replace(/\s+/g, "").match(/(\d{4})[.．\-/年](\d{1,2})[.．\-/月](\d{1,2})日?/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/**
 * 比较截止日期与基准时间
 */
export function compareDateWithNow(expiryDateStr: string, now: Date = new Date()): ExpiryResult {
  const [y, m, d] = expiryDateStr.split("-").map(Number);
  // 当天的 23:59:59 为止仍算有效
  const expDate = new Date(y, m - 1, d, 23, 59, 59, 999);
  const diffMs = expDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return {
      status: "expired",
      label: "已过期",
      expiryDateStr,
      diffDays,
    };
  }

  if (diffDays <= 30) {
    return {
      status: "expiring",
      label: "即将到期",
      expiryDateStr,
      diffDays,
    };
  }

  return {
    status: "valid",
    label: "有效",
    expiryDateStr,
    diffDays,
  };
}

/**
 * 评估单个字段的有效期状态
 */
export function checkFieldExpiry(
  label: string,
  value: string,
  allFields?: { label: string; value: string }[],
  now: Date = new Date()
): ExpiryResult {
  if (!label || !value || !isExpiryField(label)) {
    return { status: "unknown", label: "" };
  }

  const cleanVal = value.trim();

  // 1. 长期有效
  if (/长期|永久|permanent/i.test(cleanVal)) {
    return { status: "permanent", label: "长期" };
  }

  // 2. 学生证学年（如 "2020-2024" 或 "2020~2024" 或 "2020级"）
  if (/学年/.test(label)) {
    const rangeMatch = cleanVal.match(/(20\d{2})\s*[-~至到]\s*(20\d{2})/);
    if (rangeMatch) {
      const endYear = rangeMatch[2];
      const expiryDateStr = `${endYear}-07-01`;
      return compareDateWithNow(expiryDateStr, now);
    }
    const gradeMatch = cleanVal.match(/(20\d{2})\s*级/);
    if (gradeMatch) {
      const endYear = Number(gradeMatch[1]) + 4;
      const expiryDateStr = `${endYear}-07-01`;
      return compareDateWithNow(expiryDateStr, now);
    }
  }

  // 3. 驾驶证相对年限（如 "6年" / "10年" / "20年"）
  const yearsMatch = cleanVal.match(/^(\d+)\s*年$/);
  if (yearsMatch && allFields) {
    const years = Number(yearsMatch[1]);
    const startField = allFields.find(
      (f) => /初次领证日期|有效起始日期|签发日期/.test(f.label)
    );
    if (startField) {
      const startNorm = normalizeDate(startField.value);
      if (startNorm) {
        const [sy, sm, sd] = startNorm.split("-").map(Number);
        const expY = sy + years;
        const expiryDateStr = `${expY}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}`;
        return compareDateWithNow(expiryDateStr, now);
      }
    }
  }

  // 4. 银行卡/信用卡月年格式（如 09/28, 12/26, 05/2030）
  const mmYyMatch = cleanVal.match(/^(0[1-9]|1[0-2])[\/.-](\d{2}|\d{4})$/);
  if (mmYyMatch) {
    const month = Number(mmYyMatch[1]);
    let year = Number(mmYyMatch[2]);
    if (year < 100) year += 2000;
    const lastDay = new Date(year, month, 0).getDate();
    const expiryDateStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return compareDateWithNow(expiryDateStr, now);
  }

  // 5. 提取字符串中的所有日期
  const allDates: string[] = [];
  const re = /(\d{4}[.．\-/年]\d{1,2}[.．\-/月]\d{1,2}日?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleanVal)) !== null) {
    const norm = normalizeDate(match[1]);
    if (norm) allDates.push(norm);
  }

  if (allDates.length >= 2) {
    // 两个日期（如 2015.01.01-2025.01.01）：后一个是截止日期
    const expiryDateStr = allDates[1];
    return compareDateWithNow(expiryDateStr, now);
  } else if (allDates.length === 1) {
    // 单个日期（如 准予逗留至 2025-08-31 或 2025-08-31）
    const expiryDateStr = allDates[0];
    return compareDateWithNow(expiryDateStr, now);
  }

  return { status: "unknown", label: "" };
}

/**
 * 评估一组字段（整个证件）的综合有效期状态
 * 规则：
 * 1. 如果有任何有效期字段已过期 -> "expired" ("已过期")
 * 2. 否则如果有任何有效期字段即将到期 -> "expiring" ("即将到期")
 * 3. 否则如果存在长期有效字段 -> "permanent" ("长期")
 * 4. 否则如果存在有效字段 -> "valid" ("有效")
 * 5. 否则 -> "unknown"
 */
export function checkDocGroupExpiry(
  fields: { label: string; value: string }[],
  now: Date = new Date()
): ExpiryResult {
  if (!fields.length) return { status: "unknown", label: "" };

  const results: ExpiryResult[] = [];
  for (const f of fields) {
    if (isExpiryField(f.label)) {
      const res = checkFieldExpiry(f.label, f.value, fields, now);
      if (res.status !== "unknown") {
        results.push(res);
      }
    }
  }

  if (!results.length) return { status: "unknown", label: "" };

  // 1. 已过期优先
  const expired = results.find((r) => r.status === "expired");
  if (expired) return expired;

  // 2. 即将到期优先
  const expiring = results.find((r) => r.status === "expiring");
  if (expiring) return expiring;

  // 3. 有效优先
  const valid = results.find((r) => r.status === "valid");
  if (valid) return valid;

  // 4. 长期
  const permanent = results.find((r) => r.status === "permanent");
  if (permanent) return permanent;

  return { status: "unknown", label: "" };
}
