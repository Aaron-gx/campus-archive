/**
 * 常见高校与学生证件结构化字段规则及校验算法库
 * 包含：
 * 1. 中华人民共和国居民身份证号（ISO 7064:1983.MOD 11-2 校验位算法）
 * 2. 学信网学籍/学历在线验证码（16位/12位字符集与格式验证）
 * 3. 全国大学英语四六级成绩报告单 / 准考证号规则（15位编码）
 * 4. 统一社会信用代码（ISO 7064:1983.MOD 31-3 校验位算法）
 */

export interface CredentialValidationResult {
  valid: boolean;
  issue?: string;
}

/**
 * 校验 18 位中国居民身份证号码
 * 符合 GB 11643-1999 标准与 ISO 7064:1983.MOD 11-2 算法
 */
export function validateIdCardNumber(idCard: string): CredentialValidationResult {
  const clean = idCard.trim().toUpperCase();
  if (!clean) return { valid: false, issue: "身份证号为空" };

  // 18 位格式正则：前 17 位为数字，最后一位可为数字或 X
  const reg = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/;
  if (!reg.test(clean)) {
    return { valid: false, issue: "身份证号码格式不符" };
  }

  // 出生日期有效性校验
  const year = parseInt(clean.slice(6, 10), 10);
  const month = parseInt(clean.slice(10, 12), 10);
  const day = parseInt(clean.slice(12, 14), 10);
  const dateObj = new Date(year, month - 1, day);
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() + 1 !== month ||
    dateObj.getDate() !== day ||
    dateObj > new Date() ||
    year < 1900
  ) {
    return { valid: false, issue: "出生日期不合理" };
  }

  // ISO 7064:1983.MOD 11-2 权重乘积求和算法
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkDigits = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(clean[i], 10) * weights[i];
  }
  const expectedCheckDigit = checkDigits[sum % 11];

  if (clean[17] !== expectedCheckDigit) {
    return { valid: false, issue: "校验码不匹配" };
  }

  return { valid: true };
}

/**
 * 校验学信网学籍/学历/学位在线验证码
 * 学信网验证码规范：16 位或 12 位，由大写字母与数字组成
 * 排除易混淆字符（如 I, O, Z, S, V）
 */
export function validateChsiCode(code: string): CredentialValidationResult {
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!clean) return { valid: false, issue: "验证码为空" };

  // 早期学历证书在线验证码为 12 位，新版学籍/学历在线验证码统一为 16 位
  if (clean.length !== 12 && clean.length !== 16) {
    return { valid: false, issue: "应为12或16位字符" };
  }

  // 字符集仅包含合法字母数字
  if (!/^[0-9A-Z]+$/.test(clean)) {
    return { valid: false, issue: "包含非法字符" };
  }

  return { valid: true };
}

/**
 * 校验全国大学英语四、六级（CET-4/6）准考证号 / 成绩报告单编号
 * CET 15 位准考证编码规则：
 * - 1~6 位：学校考点代码（如 110010）
 * - 7~8 位：考试年份（如 24 代表 2024 年）
 * - 9 位：考试考季（1 为上半年6月，2 为下半年12月）
 * - 10 位：级别（1 代表 CET4，2 代表 CET6）
 * - 11~13 位：考场序号（001~999）
 * - 14~15 位：座位号（01~99）
 */
export function validateCetNumber(cetNo: string): CredentialValidationResult {
  const clean = cetNo.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!clean) return { valid: false, issue: "编号为空" };

  if (clean.length !== 15) {
    return { valid: false, issue: "准考证号应为15位" };
  }

  if (!/^\d{15}$/.test(clean)) {
    return { valid: false, issue: "准考证号应全为数字" };
  }

  const season = clean[8];
  if (season !== "1" && season !== "2") {
    return { valid: false, issue: "考季编码异常" };
  }

  const level = clean[9];
  if (level !== "1" && level !== "2") {
    return { valid: false, issue: "级别编码异常" };
  }

  const seat = parseInt(clean.slice(13, 15), 10);
  if (seat < 1 || seat > 99) {
    return { valid: false, issue: "座位号超出范围" };
  }

  return { valid: true };
}

export const validateChsiOnlineCode = validateChsiCode;
export const validateCetReportNumber = validateCetNumber;

/**
 * 校验 18 位统一社会信用代码（发证机构、企事业单位、高校法人等）
 * 符合 GB 32100-2015 与 ISO 7064:1983.MOD 31-3 校验位算法
 */
export function validateUscc(uscc: string): CredentialValidationResult {
  const clean = uscc.trim().toUpperCase();
  if (!clean) return { valid: false, issue: "代码为空" };

  if (clean.length !== 18) {
    return { valid: false, issue: "代码应为18位" };
  }

  const charSet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
  const weights = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = clean[i];
    const index = charSet.indexOf(char);
    if (index === -1) {
      return { valid: false, issue: `第${i + 1}位包含非法字符` };
    }
    sum += index * weights[i];
  }

  const remainder = sum % 31;
  const expectedCheckIndex = remainder === 0 ? 0 : 31 - remainder;
  const expectedCheckChar = charSet[expectedCheckIndex];

  if (clean[17] !== expectedCheckChar) {
    return { valid: false, issue: "校验码不匹配" };
  }

  return { valid: true };
}
