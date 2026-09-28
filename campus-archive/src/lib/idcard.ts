// 身份证 OCR 文本解析 + GB 11643-1999 证号校验（纯前端逻辑，无依赖）
//
// OCR 引擎（ppu-paddle-ocr）返回按行拼接的文本，这里负责：
// 1. 从行文本中提取 18 位公民身份号码并校验（含末位重算、单字符纠正）
// 2. 从证号推导出生日期、性别（比 OCR 文本更可靠）
// 3. 启发式提取 姓名/民族/住址（正面）、签发机关/有效期限（背面）
//
// 所有结果都用于“回填草稿 + 用户确认”，不作为可信数据静默入库。

export interface IdCardInfo {
  side: "front" | "back" | "unknown";
  name?: string;
  gender?: "男" | "女";
  ethnicity?: string;
  birthDate?: string; // YYYY-MM-DD，由证号推导
  idNumber?: string;
  idValid?: boolean;
  idRepaired?: boolean; // 校验位由算法重算/单字符纠正过，提示用户核对
  address?: string;
  issueOrg?: string;
  validPeriod?: string;
}

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = "10X98765432";

/** GB 11643-1999：前 17 位加权求和模 11 映射校验码 */
export function validateIdNumber(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += WEIGHTS[i] * Number(id[i]);
  return CHECK_CODES[sum % 11] === id[17].toUpperCase();
}

function computeCheckCode(first17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += WEIGHTS[i] * Number(first17[i]);
  return CHECK_CODES[sum % 11];
}

/**
 * 校验失败时的修复尝试，仅在“只错一个字符”假设下成立：
 * - 末位错误：校验码可直接重算（确定性）
 * - 前 17 位某一位错误：穷举替换，仅当恰好存在一个可行解时采纳
 * 多种可能或无解时返回 null，交回用户手工核对。
 */
export function repairIdNumber(id: string): string | null {
  if (!/^[0-9xX×]{18}$/.test(id)) return null;
  const candidates = new Set<string>();
  candidates.add(id.slice(0, 17) + computeCheckCode(id.slice(0, 17)));
  for (let i = 0; i < 17; i++) {
    for (const ch of "0123456789") {
      if (ch === id[i]) continue;
      const cand = id.slice(0, i) + ch + id.slice(i + 1);
      if (validateIdNumber(cand)) candidates.add(cand);
    }
  }
  const valid = Array.from(candidates).filter(validateIdNumber);
  return valid.length === 1 ? valid[0] : null;
}

// 允许 OCR 混入空格、点、间隔号；×/ｘ 等统一为 X
function normalizeDigits(text: string): string {
  return text
    .replace(/[ .·]+/g, "")
    .replace(/[×ｘ✗x]/g, "X");
}

const ID_SOURCE = "[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dX]";
const ID_PATTERN = new RegExp(ID_SOURCE, "g");

/** 提取证号：逐行找（证号前常带“公民身份号码”标签）；被 OCR 断行时兜底全文拼接再找 */
function findIdNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = normalizeDigits(line).match(ID_PATTERN);
    if (m) return m[0];
  }
  const all = normalizeDigits(lines.join(""));
  const m = all.match(ID_PATTERN);
  return m?.[0];
}

const LABEL_KEYWORDS =
  /姓名|性别|民族|出生|住址|公民身份号码|身份号码|签发机关|有效期限|中华人民共和国|居民身份证/;
const CJK = "[\\u4e00-\\u9fff]";
const NAME_SOURCE = `^\\s*姓名\\s*[:：]?\\s*(${CJK}{1,4}(?:·${CJK}{1,4}){0,4})\\s*$`;

function extractName(lines: string[]): string | undefined {
  // 1) 显式标签：姓名 张三 / 姓名：张三
  for (const line of lines) {
    const m = line.match(NAME_SOURCE);
    if (m) return m[1];
  }
  // 2) 标签被漏识别时的粘连行：张三性别男民族汉
  for (const line of lines) {
    const m = line.match(new RegExp(`^(${CJK}{2,15}(?:·${CJK}{1,10})?)性别`));
    if (m && !LABEL_KEYWORDS.test(m[1])) return m[1];
  }
  // 3) 兜底：第一条纯中文短行（排除证件抬头）
  for (const line of lines) {
    if (
      line.length >= 2 &&
      line.length <= 20 &&
      new RegExp(`^${CJK}{2,20}(·${CJK}{1,10})?$`).test(line) &&
      !LABEL_KEYWORDS.test(line)
    ) {
      return line;
    }
  }
  return undefined;
}

function extractEthnicity(lines: string[]): string | undefined {
  for (const line of lines) {
    // 民族 值后面通常紧跟“出生”或行尾，非贪婪截断
    const m = line.match(new RegExp(`民族\\s*(${CJK}{1,4}?)(?=出生|住址|公民|$)`));
    if (m) return m[1];
  }
  return undefined;
}

function extractAddress(lines: string[], numberLineIdx: number): string | undefined {
  // 住址位于“出生行”之后、证号行之前，可能折行；收集中间的中文行
  const birthIdx = lines.findIndex((l) => /出生/.test(l));
  const genderIdx = lines.findIndex((l) => /性别/.test(l));
  const start = (birthIdx >= 0 ? birthIdx : genderIdx) + 1;
  if (start <= 0) return undefined;
  const end = numberLineIdx >= 0 ? numberLineIdx : lines.length;
  const segs = lines
    .slice(start, end)
    .map((l) => l.replace(/^住址\s*[:：]?\s*/, "").trim())
    .filter((l) => l.length >= 4 && new RegExp(`^${CJK}`).test(l) && !/身份号码/.test(l));
  return segs.length ? segs.join("") : undefined;
}

function extractBackSide(lines: string[]): { issueOrg?: string; validPeriod?: string } {
  let issueOrg: string | undefined;
  let validPeriod: string | undefined;
  for (const line of lines) {
    const org = line.match(new RegExp(`签发机关\\s*[:：]?\\s*(${CJK}.+)$`));
    if (org) issueOrg = org[1].replace(/\s+/g, "");
    const period = line.match(/有效期限\s*[:：]?\s*([0-9.\-—~至年月日长期]+)/);
    if (period) validPeriod = period[1];
  }
  return { issueOrg, validPeriod };
}

/** 解析 OCR 整行文本 → 结构化身份证信息 */
export function parseIdCardText(rawText: string): IdCardInfo {
  const lines = rawText
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return { side: "unknown" };

  const rawNumber = findIdNumber(lines);
  const hasFrontKeywords =
    lines.some((l) => /公民身份号码|身份号码|姓名|性别|民族|住址/.test(l)) || !!rawNumber;
  const hasBackKeywords =
    lines.some((l) => /签发机关|发证机关|有效期限|中华人民共和国|公安[分]?局/.test(l)) ||
    lines.some((l) => /(?:长期|\d{4}[.．\-年]\d{1,2}[.．\-月]\d{1,2}.*[-—~至].*(?:\d{4}[.．\-年]|长期))/.test(l));

  let isBack = false;
  if (hasBackKeywords && !hasFrontKeywords) {
    isBack = true;
  } else if (hasFrontKeywords && !hasBackKeywords) {
    isBack = false;
  } else if (rawNumber) {
    isBack = false;
  } else if (lines.some((l) => /签发机关|有效期限/.test(l))) {
    isBack = true;
  }

  const info: IdCardInfo = { side: isBack ? "back" : "front" };

  // 证号行定位：完整 18 位所在行，或带“身份号码”标签的行（证号可能被 OCR 断到下一行）
  const numberLineIdx = lines.findIndex(
    (l) => /公民身份号码|身份号码/.test(l) || new RegExp(ID_SOURCE).test(normalizeDigits(l))
  );

  if (rawNumber) {
    info.idNumber = rawNumber;
    info.idValid = validateIdNumber(rawNumber);
    if (!info.idValid) {
      const repaired = repairIdNumber(rawNumber);
      if (repaired) {
        info.idNumber = repaired;
        info.idValid = true;
        info.idRepaired = true;
      }
    }
    if (info.idValid) {
      // 证号推导的出生日期与性别比 OCR 文本可靠（从修复后的最终值推导）
      const final = info.idNumber;
      info.birthDate = `${final.slice(6, 10)}-${final.slice(10, 12)}-${final.slice(12, 14)}`;
      info.gender = Number(final[16]) % 2 === 1 ? "男" : "女";
    }
  }

  if (isBack) {
    const { issueOrg, validPeriod } = extractBackSide(lines);
    info.issueOrg = issueOrg;
    info.validPeriod = validPeriod;
    if (!info.issueOrg && !info.validPeriod && !hasBackKeywords) {
      info.side = "unknown";
    }
  } else {
    info.name = extractName(lines);
    info.ethnicity = extractEthnicity(lines);
    info.address = extractAddress(lines, numberLineIdx);
    if (!info.idNumber && !info.name && !info.address && !hasFrontKeywords) {
      info.side = "unknown";
    }
  }

  return info;
}
