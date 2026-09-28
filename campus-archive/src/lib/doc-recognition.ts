// 证件识别调度：按 OCR 文本判别证件类型，再用对应解析器提取字段
//
// 设计：
// - 文本信号优先（证件上的版式关键词），子分类期望值兜底 —— 用户放错子类也能正确解析
// - 身份证/驾驶证自动区分正反面、正副页
// - 所有结果都是"回填草稿 + 用户确认"，证号类字段带校验徽标

import { parseIdCardText, validateIdNumber } from "./idcard";

export type DocType =
  | "idcard-front"
  | "idcard-back"
  | "driver-license"
  | "driver-license-sub"
  | "passport"
  | "passport-visa"
  | "travel-permit"
  | "travel-permit-back"
  | "student-card"
  | "student-card-reg"
  | "household"
  | "household-master"
  | "household-member"
  | "household-family"
  | "residence-front"
  | "residence-back"
  | "birth-cert"
  | "bank-card-front"
  | "bank-card-back"
  | "unknown";

/** 子分类期望的证件大类（来自 identity-* 子分类 key） */
export type ExpectedDoc = "idcard" | "student" | "household" | "passport" | "license" | "residence" | "birth" | "bankcard";

export interface DocField {
  label: string;
  value: string;
  badge?: "ok" | "warn" | "repair"; // 证号校验通过 / 未通过 / 已自动纠正
}

export interface DocRecognition {
  type: DocType;
  typeLabel: string; // 如 "身份证 · 人像面"
  fields: DocField[];
  titleSuggestion?: string;
  noteParts: string[];
  rawPreview?: string; // 类型不明时给用户看的原文摘录
}

const CJK = "[\\u4e00-\\u9fff]";
export const TYPE_LABELS: Record<DocType, string> = {
  "idcard-front": "身份证 · 人像面",
  "idcard-back": "身份证 · 国徽面",
  "driver-license": "驾驶证 · 主页",
  "driver-license-sub": "驾驶证 · 副页",
  passport: "护照 · 资料页",
  "passport-visa": "护照 · 签证页",
  "travel-permit": "通行证 · 个人信息面",
  "travel-permit-back": "通行证 · 签注面",
  "student-card": "学生证 · 信息页",
  "student-card-reg": "学生证 · 注册页",
  household: "居民户口簿 · 首页",
  "household-master": "居民户口簿 · 户主页",
  "household-member": "居民户口簿 · 本人页",
  "household-family": "居民户口簿 · 成员页",
  "residence-front": "居住证 · 个人信息面",
  "residence-back": "居住证 · 签发信息面",
  "birth-cert": "出生医学证明",
  "bank-card-front": "银行卡",
  "bank-card-back": "银行卡",
  unknown: "未识别版式",
};

function splitLines(rawText: string): string[] {
  return rawText
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** 清理中文字符间空格：如 "新 生 儿 姓 名" → "新生儿姓名"（保留换行） */
function removeCjkSpaces(s: string): string {
  let prev = s;
  while (true) {
    const next = prev.replace(/([\u4e00-\u9fa5])[^\S\r\n]+([\u4e00-\u9fa5])/g, "$1$2");
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/** 归一化中文日期：2014.01.01 / 2014年1月1日 / 2014-01-01 → 2014-01-01 */
function normalizeCnDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.replace(/\s+/g, "").match(/(\d{4})[.．\-年](\d{1,2})[.．\-月](\d{1,2})日?/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** MRZ 日期（YYMMDD）→ YYYY-MM-DD；出生年按 >30 判 19xx，有效期一律 20xx */
function mrzDate(d: string, kind: "birth" | "expiry"): string {
  const yy = Number(d.slice(0, 2));
  const year = kind === "birth" ? (yy > 30 ? 1900 + yy : 2000 + yy) : 2000 + yy;
  return `${year}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
}

/** 行内标签取值："姓名 张三" / "性别男" → 张三/男；值尾部若粘着下一个标签词则剥掉 */
function labelValue(lines: string[], label: string): string | undefined {
  const re = new RegExp(`${label}\\s*[:：]?\\s*([^\\s:：]{1,40})`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      const v = m[1].replace(/(性别|民族|出生|住址|关系|有效|签发|证号|号码|名称|日期)$/, "");
      if (v) return v;
    }
  }
  return undefined;
}

/**
 * 从多行文本中提取中英双语标签后的值（例如 "姓名 / Name 张三" 或 标签与值分行）
 * 支持中文标签、可选斜杠、英文标签、冒号等，并可在同行业未取到有效值时检查下一行
 */
function extractBilingualField(
  lines: string[],
  cnLabelRegex: RegExp,
  enLabelRegex?: RegExp
): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(cnLabelRegex);
    if (m && m.index !== undefined) {
      let rest = line.slice(m.index + m[0].length).trim();
      // 剥掉可能紧随其后的 / 或英文标签
      if (rest.startsWith("/") || rest.startsWith("／")) {
        rest = rest.replace(/^[\/／]\s*/, "");
        if (enLabelRegex) {
          rest = rest.replace(enLabelRegex, "").trim();
        } else {
          rest = rest.replace(/^[A-Za-z\s\.\,\-]+/, "").trim();
        }
      } else if (enLabelRegex && enLabelRegex.test(rest)) {
        rest = rest.replace(enLabelRegex, "").trim();
      }
      // 剥掉冒号
      rest = rest.replace(/^[:：]\s*/, "").trim();

      // 如果当前行剩余内容有真实值
      if (rest.length > 0) {
        rest = rest.replace(/(性别|民族|出生|住址|关系|有效|签发|证号|号码|名称|日期|Place|Authority|Date|Sex|Valid|Card)$/i, "").trim();
        if (rest) return rest;
      }

      // 如果当前行无剩余内容，尝试检查下一行（分行排列情况）
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (!/^(姓名|性别|出生|有效|签发|证件|号码|住址|Name|Sex|Date|Valid|Place|Authority|Card)/i.test(next)) {
          return next;
        }
      }
    }
  }
  return undefined;
}

/** 所有 18 位身份证号（去重） */
function findAllIdNumbers(text: string): { num: string; valid: boolean }[] {
  const cleaned = text.replace(/[ .·]+/g, "");
  const seen = new Set<string>();
  const out: { num: string; valid: boolean }[] = [];
  const re = /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const num = m[0].replace(/x$/, "X");
    if (!seen.has(num)) {
      seen.add(num);
      out.push({ num, valid: validateIdNumber(num) });
    }
  }
  return out;
}

function badgeSuffix(f: DocField): string {
  if (f.label === "公民身份号码" || f.label === "证号" || f.label === "银行卡号") {
    if (f.badge === "warn") return "（校验未通过，请核对）";
    if (f.badge === "repair") return "（已自动纠正，请核对）";
  }
  return "";
}

// ---------- 各证件解析器 ----------

function parseIdcardFront(lines: string[], text: string): DocField[] {
  const info = parseIdCardText(text);
  const fields: DocField[] = [];
  if (info.name) fields.push({ label: "姓名", value: info.name });
  if (info.gender) fields.push({ label: "性别", value: info.gender });
  if (info.ethnicity) fields.push({ label: "民族", value: `${info.ethnicity}族` });
  if (info.birthDate) fields.push({ label: "出生", value: info.birthDate });
  if (info.address) fields.push({ label: "住址", value: info.address });
  if (info.idNumber) {
    fields.push({
      label: "公民身份号码",
      value: info.idNumber,
      badge: info.idValid ? (info.idRepaired ? "repair" : "ok") : "warn",
    });
  }
  return fields;
}

function parseIdcardBack(lines: string[]): DocField[] {
  const fields: DocField[] = [];
  const org = labelValue(lines, "签发机关");
  if (org) fields.push({ label: "签发机关", value: org });
  const periodLine = lines.find((l) => /有效期限/.test(l));
  if (periodLine) {
    const m = periodLine.match(/有效期限\s*[:：]?\s*(.+)/);
    if (m) fields.push({ label: "有效期限", value: m[1].replace(/\s+/g, "") });
  }
  return fields;
}

function parseDriverLicense(lines: string[], isSub: boolean): { fields: DocField[]; title?: string } {
  const fields: DocField[] = [];
  const name = labelValue(lines, "姓名");
  const id = findAllIdNumbers(lines.join(""))[0];
  if (id) fields.push({ label: "证号", value: id.num, badge: id.valid ? "ok" : "warn" });
  if (name) fields.push({ label: "姓名", value: name });

  if (isSub) {
    const archive = labelValue(lines, "档案编号") ?? lines.join("").match(/档案编号\s*[:：]?\s*(\d{8,14})/)?.[1];
    if (archive) fields.push({ label: "档案编号", value: archive });
    return { fields };
  }

  // 性别与“国籍”常同行且 OCR 易丢空格（性别男国籍中国），精确匹配男女
  const gender = lines.join("").match(/性别\s*[:：]?\s*([男女])/)?.[1];
  if (gender) fields.push({ label: "性别", value: gender });
  const birth = normalizeCnDate(labelValue(lines, "出生日期"));
  if (birth) fields.push({ label: "出生日期", value: birth });
  const addrLine = lines.find((l) => /住址/.test(l));
  if (addrLine) fields.push({ label: "住址", value: addrLine.replace(/^住址\s*[:：]?\s*/, "") });
  const firstIssue = normalizeCnDate(labelValue(lines, "初次领证日期"));
  if (firstIssue) fields.push({ label: "初次领证日期", value: firstIssue });
  const cls =
    lines.join("").match(/准驾车型\s*[:：]?\s*([A-Z][0-9]?)/)?.[1] ??
    lines.find((l) => /^[A-Z][0-9]?$/.test(l)); // 车型在版式上常单独成行
  if (cls) fields.push({ label: "准驾车型", value: String(cls).trim() });
  const period = lines.find((l) => /有效期限\s*\d/.test(l))?.match(/有效期限\s*[:：]?\s*(.+)/)?.[1];
  if (period) fields.push({ label: "有效期限", value: period.replace(/\s+/g, "") });
  else {
    const validFrom = normalizeCnDate(labelValue(lines, "有效起始日期"));
    if (validFrom) fields.push({ label: "有效起始日期", value: validFrom });
  }
  return {
    fields,
    title: name ? `驾驶证${cls ? `（${String(cls).trim()}照）` : ""}` : undefined,
  };
}

function parsePassport(lines: string[]): { fields: DocField[]; title?: string } {
  const joined = lines.join("\n");
  const fields: DocField[] = [];

  // 护照号：标签行优先，其次 E/EA+8位特征
  const num =
    joined.match(/护照号码?\s*[:：]?\s*([A-Z]{1,2}\d{6,9})/i)?.[1] ??
    joined.match(/Passport\s*No\.?\s*[:：]?\s*([A-Z]{0,2}\d{6,9})/i)?.[1] ??
    joined.match(/\b([A-Z]\d{8})\b/)?.[1];
  if (num) fields.push({ label: "护照号", value: num });

  // MRZ 机器读取区（两行 30+ 位字母数字<）：P<CHNZHANG<<WEI… / 证号+出生+有效期
  const mrz = joined.match(/^[A-Z0-9<]{30,44}$/gm) ?? [];
  if (mrz.length >= 2) {
    const l1 = mrz[0] ?? "";
    const l2 = mrz[1] ?? "";
    if (!num && /^\w\d{8}/.test(l2)) fields.push({ label: "护照号", value: l2.slice(0, 9) });
    // 姓名行：P<CHN姓<<名<<<…，连续 < 分隔
    const nameM = l1.match(/^P<[A-Z]{3}(.+)$/);
    if (nameM) {
      const [sur, giv] = nameM[1].split("<<");
      const surname2 = sur?.replace(/</g, "");
      const given2 = giv?.replace(/</g, " ").trim().replace(/\s+/g, " ");
      if (surname2 && given2 && !fields.some((f) => f.label === "姓名")) {
        fields.push({ label: "姓名", value: `${given2} ${surname2}` });
      }
    }
    const birthM = l2.match(/^.{13}(\d{6})/);
    if (birthM) fields.push({ label: "出生日期", value: mrzDate(birthM[1], "birth") });
    const expM = l2.match(/^.{21}(\d{6})/);
    if (expM) fields.push({ label: "有效期至", value: mrzDate(expM[1], "expiry") });
  }

  // 资料页标签行（姓/名单独成行，避免误匹配"姓名"；值取整行后再剥掉双语标签词）
  let surname: string | undefined;
  let given: string | undefined;
  const cleanSurname = (v: string) => v.replace(/Surname/gi, "").replace(/\/+/g, "").replace(/[:：]/g, "").trim();
  const cleanGiven = (v: string) => v.replace(/Given\s*Names?/gi, "").replace(/\/+/g, "").replace(/[:：]/g, "").trim();
  for (const l of lines) {
    let m = l.match(/^姓(?!名)\s*[:：]?\s*(.+)$/);
    if (!m) m = l.match(/^Surname\s*[:：]?\s*(.+)$/i);
    if (m) surname = cleanSurname(m[1]) || surname;
    let g = l.match(/^名(?!称)\s*[:：]?\s*(.+)$/);
    if (!g) g = l.match(/^Given Names?\s*[:：]?\s*(.+)$/i);
    if (g) given = cleanGiven(g[1]) || given;
  }
  if ((surname || given) && !fields.some((f) => f.label === "姓名")) {
    fields.splice(fields.length > 0 ? 1 : 0, 0, { label: "姓名", value: `${given ?? ""} ${surname ?? ""}`.trim() });
  }  const birth = normalizeCnDate(labelValue(lines, "出生日期") ?? labelValue(lines, "Date of Birth"));
  if (birth && !fields.some((f) => f.label === "出生日期")) fields.push({ label: "出生日期", value: birth });
  const expiry = normalizeCnDate(labelValue(lines, "有效期至") ?? labelValue(lines, "Date of Expiry"));
  if (expiry && !fields.some((f) => f.label === "有效期至")) fields.push({ label: "有效期至", value: expiry });
  const authority = labelValue(lines, "签发机关") ?? labelValue(lines, "Authority");
  if (authority) fields.push({ label: "签发机关", value: authority });

  return { fields, title: "护照" };
}

/** 提取签注/签证种类：如 个人旅游 (G) / 团队旅游 (L) / 逗留 (D) 等 */
function extractVisaType(text: string): string | undefined {
  // 1. 完整代码格式：个人旅游 (G) / 团队旅游（L） / 逗留 (Student) / 逗留(D) / 人才(R) / 探亲(T) / 商务(S) 等
  const m1 = text.match(/(个人旅游|团队旅游|探亲|商务|逗留|人才|其他|学习|应邀|定居)\s*[（\(]\s*([A-Za-z0-9]{1,15})\s*[）\)]/i);
  if (m1) {
    const name = m1[1];
    const code = m1[2].length === 1 ? m1[2].toUpperCase() : m1[2];
    return `${name} (${code})`;
  }
  const m1b = text.match(/(个人旅游|团队旅游|探亲|商务|逗留|人才|其他|学习|应邀|定居)\s+([GTLSRQXDY])\b/i);
  if (m1b) {
    return `${m1b[1]} (${m1b[2].toUpperCase()})`;
  }
  // 2. 独立标签式：种类: 个人旅游 / Type: G / 类别: 逗留 (Student)
  const m2 = text.match(/(?:种类|Type|类别|Category)\s*[:：\/／\s]*([^\n\r\/]{1,30})/i);
  if (m2) {
    const val = m2[1].trim();
    if (/^[GTLSRQXDY]$/i.test(val)) {
      const codeMap: Record<string, string> = {
        G: "个人旅游 (G)",
        L: "团队旅游 (L)",
        T: "探亲 (T)",
        S: "商务 (S)",
        D: "逗留 (D)",
        R: "人才 (R)",
        Q: "其他 (Q)",
        X: "学习 (X)",
        Y: "应邀 (Y)",
      };
      return codeMap[val.toUpperCase()] ?? val;
    }
    const cleanVal = val.match(/(个人旅游|团队旅游|探亲|商务|逗留|人才|其他|学习|应邀|定居|就读|就业|工作|受养人|优才|高才)/)?.[0];
    if (cleanVal) {
      const codePart = val.match(/[（\(]\s*([A-Za-z0-9]{1,15})\s*[）\)]/)?.[1];
      return codePart ? `${cleanVal} (${codePart})` : cleanVal;
    }
  }
  // 3. 关键字兜底
  const m3 = text.match(/(个人旅游|团队旅游|探亲|商务|逗留|人才|其他|学习|应邀|定居|就读|就业|受养人|优才|高才)/);
  if (m3) return m3[1];
  return undefined;
}

/** 提取往返有效次数：如 一年一次有效 / 三个月一次有效 / 多次有效 等 */
function extractEntries(text: string): string | undefined {
  // 1. "一年一次有效" / "三个月一次有效" / "1年2次有效" / "三个月二次" / "一年多次有效" / "六个月一次"
  const m1 = text.match(/((?:[一二三四五六七八九十\d]+\s*(?:年|个?月))\s*[一二三四五六七八九十\d多]\s*次(?:\s*有效)?)/);
  if (m1) {
    let s = m1[1].replace(/\s+/g, "");
    if (!s.endsWith("有效")) s += "有效";
    return s;
  }
  // 2. "一次有效" / "二次有效" / "多次有效"
  const m2 = text.match(/([一二三四五六七八九十多\d]\s*次\s*有效)/);
  if (m2) {
    return m2[1].replace(/\s+/g, "");
  }
  // 3. 英文形式
  if (/Multiple\s*Entries/i.test(text)) return "多次有效";
  if (/Double\s*Entries/i.test(text)) return "二次有效";
  if (/Single\s*Entry/i.test(text)) return "一次有效";
  return undefined;
}

/** 提取停留期限 / 逗留时间：如 每次在香港逗留不超过7天 / 准予在港逗留至 2025-08-31 等 */
function extractStayDuration(text: string): string | undefined {
  // 1. "每次在香港逗留不超过7天" / "每次在澳门逗留不超过7天"
  const m1 = text.match(/(每次(?:在[香港澳门澳門台湾]+)?(?:逗留|停留)?不超过\s*\d+\s*天)/);
  if (m1) return m1[1].replace(/\s+/g, "");

  // 2. "准予在港逗留至: 2025-08-31" / "准予逗留至 2025-08-31"
  const m2 = text.match(/准予(?:在[港澳]+)?(?:逗留|停留)至\s*[:：]?\s*([0-9.\-年\/]{8,12})/);
  if (m2) {
    const d = normalizeCnDate(m2[1]);
    if (d) return `准予逗留至 ${d}`;
  }

  // 3. "不超过 7 天" / "不超过7天" / "不超过14天"
  const m3 = text.match(/(不超过\s*\d+\s*天)/);
  if (m3) return `每次逗留${m3[1].replace(/\s+/g, "")}`;

  // 4. "准予停留 7 天"
  const m4 = text.match(/准予停留\s*(\d+)\s*天/);
  if (m4) return `停留不超过${m4[1]}天`;

  return undefined;
}

/** 提取签注/签证有效期至 */
function extractEndorsementExpiry(text: string): string | undefined {
  // 1. 有效期至 / Valid Until / Date of Expiry
  const m1 = text.match(/(?:有效期至|有效期限|Valid\s*Until|Date\s*of\s*Expiry)\s*[:：\/／\s]*([0-9.\-年\/]{8,12})/i);
  if (m1) {
    const d = normalizeCnDate(m1[1]);
    if (d) return d;
  }
  // 2. 须在 2025年10月15日前出境
  const m2 = text.match(/须在\s*([0-9.\-年\/]{8,12})\s*前出境/);
  if (m2) {
    const d = normalizeCnDate(m2[1]);
    if (d) return d;
  }
  // 3. 日期匹配（如果行中含有有效或出境）
  const validLine = text.split("\n").find((l) => /有效|出境|Valid|Expiry/i.test(l));
  if (validLine) {
    const dMatch = validLine.match(/([0-9.\-年\/]{8,12})/);
    if (dMatch) {
      const d = normalizeCnDate(dMatch[1]);
      if (d) return d;
    }
  }
  return undefined;
}

function parseTravelPermit(lines: string[]): { fields: DocField[]; title?: string } {
  const joined = lines.join("\n");
  const fields: DocField[] = [];

  // 1. 证件号码：C/W/L/M/H 开头的 8-9 位，或 8 位数字（台胞证）
  let num: string | undefined;
  const numMatch =
    joined.match(/(?:证件号码?|Card\s*No\.?)\s*[:：\/／\s]*([CWLMH]?\s*\d{7,10})/i) ??
    joined.match(/\b([CWLMH]\s*\d{8})\b/i);
  if (numMatch) {
    num = numMatch[1].replace(/\s+/g, "").toUpperCase();
  } else {
    // 兜底：寻找 8 位非年份纯数字（排除 19xx / 20xx 开头的年份串）
    const digitMatch = joined.match(/\b(?!(?:19|20)\d{6}\b)(\d{8})\b/);
    if (digitMatch) {
      num = digitMatch[1];
    }
  }
  if (num) {
    fields.push({ label: "证件号", value: num });
  }

  // 2. 姓名：支持 "姓名 / Name 张三"、"张三 / ZHANG SAN"、"Name: 王五" 或分行
  const rawName =
    extractBilingualField(lines, /姓名/i, /Name/i) ??
    labelValue(lines, "姓名") ??
    lines.find((l) => /^Name\s*[:：]?\s*/i.test(l))?.replace(/^Name\s*[:：]?\s*/i, "");
  if (rawName) {
    const cnName = rawName.match(/([\u4e00-\u9fff·]{2,10})/)?.[1];
    const finalName = cnName ?? rawName.replace(/[\/／]/g, "").trim();
    if (finalName && !/^(香港|澳门|澳門|台湾|签注|签证|出入境|管理局|Authority)/.test(finalName)) {
      fields.push({ label: "姓名", value: finalName });
    }
  }

  // 3. 性别：支持 "性别 / Sex 男"
  const rawGender =
    extractBilingualField(lines, /性别/i, /Sex/i) ??
    joined.match(/性别\s*[:：\/／\s]*([男女])/)?.[1] ??
    joined.match(/([男女])\s*[\/／]\s*[MF]/i)?.[1] ??
    joined.match(/Sex\s*[:：]?\s*([MF男女])/i)?.[1];
  if (rawGender) {
    const g = rawGender.match(/([男女])/)?.[1] ?? (rawGender.toUpperCase() === "M" ? "男" : rawGender.toUpperCase() === "F" ? "女" : undefined);
    if (g) fields.push({ label: "性别", value: g });
  }

  // 4. 出生日期：支持 "出生日期 / Date of Birth 1995.05.20"
  const rawBirth =
    extractBilingualField(lines, /出生(?:日期)?/i, /Date\s*of\s*Birth/i) ??
    labelValue(lines, "出生") ??
    lines.find((l) => /Date\s*of\s*Birth/i.test(l));
  const birth =
    normalizeCnDate(rawBirth) ??
    normalizeCnDate(joined.match(/Date\s*of\s*Birth\s*[:：]?\s*([0-9.\-年\/]+)/i)?.[1]);
  if (birth) {
    fields.push({ label: "出生日期", value: birth });
  }

  // 5. 卡片有效期限（正面）：常见为 "2024.01.15 - 2034.01.14" 两段区间
  const rawExpiry =
    extractBilingualField(lines, /有效(?:期限|期至)?/i, /Valid\s*Until/i) ??
    lines.find((l) => /有效|Valid\s*Until/i.test(l));
  if (rawExpiry) {
    const dates = rawExpiry.match(/(\d{4}[.．\-年]\d{1,2}[.．\-月]\d{1,2}日?)/g);
    if (dates && dates.length >= 2) {
      const from = normalizeCnDate(dates[0]);
      const to = normalizeCnDate(dates[1]);
      if (from && to) {
        fields.push({ label: "有效期限", value: `${from} 至 ${to}` });
      }
    } else if (num && !/签注|签证|个人旅游|团队旅游|往返/.test(joined)) {
      const exp = normalizeCnDate(rawExpiry);
      if (exp) {
        fields.push({ label: "有效期至", value: exp });
      }
    }
  }

  // 6. 签发地点：支持 "签发地点 / Place of Issue 广东"
  let placeVal: string | undefined;
  const rawPlace =
    extractBilingualField(lines, /签发地点/i, /Place\s*of\s*Issue/i) ??
    labelValue(lines, "签发地点");
  if (rawPlace && !/出入境|管理局|移民局|中华人民共和国|Authority/.test(rawPlace)) {
    const cnPlace = rawPlace.match(/([\u4e00-\u9fff]{2,10})/)?.[1];
    if (cnPlace && !/^(签发|机关|地点|Authority)/i.test(cnPlace)) {
      placeVal = cnPlace;
    }
  }
  if (!placeVal) {
    const placeLine = lines.find((l) => /Place\s*of\s*Issue|签发地点/i.test(l));
    if (placeLine) {
      const p = placeLine.match(/(北京|天津|河北|山西|内蒙古|辽宁|吉林|黑龙江|上海|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|广西|海南|重庆|四川|贵州|云南|西藏|陕西|甘肃|青海|宁夏|新疆)/)?.[0];
      if (p) placeVal = p;
    }
  }
  if (placeVal) {
    fields.push({ label: "签发地点", value: placeVal });
  }

  // 7. 签发机关：支持 "签发机关 / Authority 中华人民共和国出入境管理局"
  let authVal: string | undefined;
  const orgMatch = joined.match(/(?:中华人民共和国)?(?:国家移民管理局|出入境管理局|公安部出入境管理局|[^\s\n]{2,10}公安厅出入境管理局)/)?.[0];
  if (orgMatch) {
    authVal = orgMatch;
  } else {
    const rawAuth =
      extractBilingualField(lines, /签发机关/i, /Authority/i) ??
      labelValue(lines, "签发机关") ??
      lines.find((l) => /Authority/i.test(l))?.replace(/Authority\s*[:：]?\s*/i, "");
    if (rawAuth && !/^(签发|地点|Place|Authority)/i.test(rawAuth) && rawAuth !== "签发地点") {
      authVal = rawAuth.match(/([\u4e00-\u9fff]{4,25})/)?.[1];
    }
  }
  if (authVal && authVal !== "签发地点") {
    fields.push({ label: "签发机关", value: authVal });
  }

  // 8. 签注 / 签证信息（背面、签注页或电子签注凭条）
  const hasHK = /(?:香港|Hong\s*Kong)/i.test(joined);
  const hasMO = /(?:澳门|澳門|Macao|Macau)/i.test(joined);
  const hasTW = /(?:台湾|臺灣|Taiwan)/i.test(joined);
  const isEntryPermit = /进入许可|Entry\s*Permit/i.test(joined);
  const hasEndorsement =
    isEntryPermit ||
    /签注|签证|个人旅游|团队旅游|往返|有效次数|出境|逗留至|逗留不超过|准予逗留|停留不超过/i.test(joined) ||
    (hasHK && (hasMO || /种类|往返|有效|逗留|Type|Entries/i.test(joined)));

  if (hasEndorsement || hasHK || hasMO || hasTW) {
    if (isEntryPermit) {
      // 香港入境处进入许可 / 签证
      fields.push({ label: "签注目的地", value: "香港" });
      const vType = extractVisaType(joined) ?? "逗留";
      fields.push({ label: "签证类别", value: vType });
      const vNo = joined.match(/(?:签证号码?|Visa\s*No\.?|Permit\s*No\.?)\s*[:：\/／\s]*([A-Z0-9]{6,14})/i)?.[1];
      if (vNo) fields.push({ label: "签证号码", value: vNo.toUpperCase() });
      const vExp = extractEndorsementExpiry(joined);
      if (vExp) fields.push({ label: "签证有效期至", value: vExp });
      const vStay = extractStayDuration(joined);
      if (vStay) fields.push({ label: "逗留期限", value: vStay });
    } else if (hasHK && hasMO) {
      // 港澳双面签注（同张卡片背面包含香港和澳门两组签注）
      const hkIdx = joined.search(/香港|Hong\s*Kong/i);
      const moIdx = joined.search(/澳门|澳門|Macao|Macau/i);
      let hkText = "";
      let moText = "";
      if (hkIdx < moIdx) {
        hkText = joined.slice(hkIdx, moIdx);
        moText = joined.slice(moIdx);
      } else {
        moText = joined.slice(moIdx, hkIdx);
        hkText = joined.slice(hkIdx);
      }

      const hkType = extractVisaType(hkText) ?? extractVisaType(joined);
      const hkEntries = extractEntries(hkText);
      const hkExpiry = extractEndorsementExpiry(hkText);
      const hkStay = extractStayDuration(hkText) ?? (joined.match(/每次在香港逗留不超过\s*\d+\s*天/)?.[0]?.replace(/\s+/g, ""));

      const moType = extractVisaType(moText) ?? extractVisaType(joined);
      const moEntries = extractEntries(moText);
      const moExpiry = extractEndorsementExpiry(moText);
      const moStay = extractStayDuration(moText) ?? (joined.match(/每次在澳门逗留不超过\s*\d+\s*天/)?.[0]?.replace(/\s+/g, ""));

      fields.push({ label: "签注目的地", value: "香港、澳门" });
      if (hkType || hkEntries) {
        fields.push({
          label: "香港签注",
          value: [hkType, hkEntries].filter(Boolean).join(" · ") || "有效签注",
        });
      }
      if (hkExpiry) fields.push({ label: "香港有效期至", value: hkExpiry });
      if (hkStay) fields.push({ label: "香港停留期限", value: hkStay });

      if (moType || moEntries) {
        fields.push({
          label: "澳门签注",
          value: [moType, moEntries].filter(Boolean).join(" · ") || "有效签注",
        });
      }
      if (moExpiry) fields.push({ label: "澳门有效期至", value: moExpiry });
      if (moStay) fields.push({ label: "澳门停留期限", value: moStay });
    } else {
      // 单目的地签注（香港、澳门、台湾 或未明确标明目的地）
      const dest = hasHK ? "香港" : hasMO ? "澳门" : hasTW ? "台湾" : undefined;
      if (dest) {
        fields.push({ label: "签注目的地", value: dest });
      }

      const visaType = extractVisaType(joined);
      if (visaType) {
        const typeLabel = /签证/.test(joined) && !/签注/.test(joined) ? "签证类别" : "签注种类";
        fields.push({ label: typeLabel, value: visaType });
      }

      const entries = extractEntries(joined);
      if (entries) {
        fields.push({ label: "有效次数", value: entries });
      }

      const endorsementExpiry = extractEndorsementExpiry(joined);
      if (endorsementExpiry) {
        const expLabel = /签证/.test(joined) && !/签注/.test(joined) ? "签证有效期至" : "签注有效期至";
        if (!fields.some((f) => f.label === expLabel || f.label === "有效期限")) {
          fields.push({ label: expLabel, value: endorsementExpiry });
        } else if (fields.some((f) => f.label === "有效期限")) {
          fields.push({ label: expLabel, value: endorsementExpiry });
        }
      }

      const stay = extractStayDuration(joined);
      if (stay) {
        fields.push({ label: "停留期限", value: stay });
      }
    }

    // 签注/签证号码
    const endNum = joined.match(/(?:签注号码?|Endorsement\s*No\.?|签证号码?|Visa\s*No\.?)\s*[:：\/／\s]*([A-Z0-9]{7,14})/i)?.[1];
    if (endNum) {
      const numLabel = /签证/.test(joined) && !/签注/.test(joined) ? "签证号码" : "签注号码";
      if (!fields.some((f) => f.label === numLabel)) {
        fields.push({ label: numLabel, value: endNum.toUpperCase() });
      }
    }

    // 签发日期
    const issueDate = joined.match(/(?:签发日期|Date\s*of\s*Issue)\s*[:：\/／\s]*([0-9.\-年\/]{8,12})/i)?.[1];
    if (issueDate) {
      const d = normalizeCnDate(issueDate);
      if (d && !fields.some((f) => f.label === "签发日期")) {
        fields.push({ label: "签发日期", value: d });
      }
    }
  }

  // 标题建议：以证件性质命名，不按面/页命名
  let title = "往来港澳通行证";
  if (isEntryPermit) {
    title = "香港进入许可";
  } else if (/往来台湾/.test(joined) || (num && /^[WL]/i.test(num)) || hasTW) {
    title = "往来台湾通行证";
  } else if (/回乡证|港澳居民来往内地/.test(joined) || (num && /^[HM]/i.test(num))) {
    title = "港澳居民来往内地通行证";
  } else if (/台胞证|台湾居民来往大陆/.test(joined)) {
    title = "台湾居民来往大陆通行证";
  } else if (/港澳/.test(joined) || (num && /^C/i.test(num)) || hasHK || hasMO) {
    title = "往来港澳通行证";
  }

  return { fields, title };
}

function parseStudentCard(lines: string[]): { fields: DocField[]; title?: string } {
  const joined = lines.join("\n");
  const fields: DocField[] = [];
  const school = joined.match(new RegExp(`(${CJK}{2,14}(?:大学|学院|学校))`))?.[1];
  if (school) fields.push({ label: "学校", value: school });
  const name = labelValue(lines, "姓名");
  if (name) fields.push({ label: "姓名", value: name });
  const sid = joined.match(/学号\s*[:：]?\s*(\d{6,14})/)?.[1] ?? joined.match(/\b(\d{8,12})\b/)?.[1];
  if (sid) fields.push({ label: "学号", value: sid });
  const dept = labelValue(lines, "院系") ?? labelValue(lines, "学院") ?? labelValue(lines, "系");
  if (dept) fields.push({ label: "院系", value: dept });
  const major = labelValue(lines, "专业");
  if (major) fields.push({ label: "专业", value: major });
  const years = joined.match(/(20\d{2})\s*[年\-至~]\s*(20\d{2})/) ?? joined.match(/入学\s*[:：]?\s*(20\d{2})/);
  if (years) fields.push({ label: "学年", value: years[2] ? `${years[1]}-${years[2]}` : `${years[1]}级` });
  const title = school ? `${school}学生证` : "学生证";
  return { fields, title };
}

function parseHousehold(lines: string[]): { fields: DocField[]; title?: string } {
  const joined = lines.join("\n");
  const fields: DocField[] = [];
  const huHao = joined.match(/户号\s*[:：]?\s*(\d{6,14})/)?.[1];
  if (huHao) fields.push({ label: "户号", value: huHao });
  const huBie = labelValue(lines, "户别");
  if (huBie) fields.push({ label: "户别", value: huBie });
  const name = labelValue(lines, "姓名") || labelValue(lines, "户主姓名");
  if (name) fields.push({ label: "姓名", value: name });
  const ids = findAllIdNumbers(joined);
  if (ids[0]) {
    fields.push({ label: "公民身份号码", value: ids[0].num, badge: ids[0].valid ? "ok" : "warn" });
    if (ids.length > 1) {
      fields.push({
        label: "其他成员证号",
        value: `${ids.length - 1} 个${ids.slice(1).every((i) => i.valid) ? "（均校验通过）" : "（含未通过）"}`,
      });
    }
  }
  const relation =
    labelValue(lines, "与户主关系") ||
    labelValue(lines, "户主或与户主关系") ||
    labelValue(lines, "关系");
  if (relation) fields.push({ label: "与户主关系", value: relation });
  const sex = labelValue(lines, "性别");
  if (sex && (sex.startsWith("男") || sex.startsWith("女"))) fields.push({ label: "性别", value: sex[0] });
  const nation = labelValue(lines, "民族");
  if (nation) fields.push({ label: "民族", value: nation });
  const birthPlace = labelValue(lines, "出生地");
  if (birthPlace) fields.push({ label: "出生地", value: birthPlace });
  const originPlace = labelValue(lines, "籍贯");
  if (originPlace) fields.push({ label: "籍贯", value: originPlace });
  const edu = labelValue(lines, "文化程度");
  if (edu) fields.push({ label: "文化程度", value: edu });
  const address = joined.match(/(?:住址|本市（县）其他住址|家庭住址)\s*[:：]?\s*([^\n]{4,50})/)?.[1];
  if (address) fields.push({ label: "住址", value: address.trim() });
  const title = "居民户口簿";
  return { fields, title };
}

function parseResidence(lines: string[], isBack = false): { fields: DocField[]; title?: string } {
  const joined = lines.join("\n");
  const fields: DocField[] = [];

  if (isBack) {
    const authority = joined.match(/(?:签发机关|发证机构|签发机构)\s*[:：]?\s*([^\s:：\n]{4,30})/)?.[1];
    if (authority) fields.push({ label: "签发机关", value: authority });
    const validity = joined.match(/(?:有效期限|有效日期|有效期)\s*[:：]?\s*([0-9.\-年\/至~ ]{8,25})/)?.[1];
    if (validity) fields.push({ label: "有效期限", value: validity.trim() });
    return { fields, title: "居住证" };
  }

  const name = labelValue(lines, "姓名");
  if (name) fields.push({ label: "姓名", value: name });
  const sex = labelValue(lines, "性别");
  if (sex && (sex.startsWith("男") || sex.startsWith("女"))) fields.push({ label: "性别", value: sex[0] });
  const nation = labelValue(lines, "民族");
  if (nation) fields.push({ label: "民族", value: nation });
  const ids = findAllIdNumbers(joined);
  if (ids[0]) {
    fields.push({ label: "公民身份号码", value: ids[0].num, badge: ids[0].valid ? "ok" : "warn" });
  }
  const address = joined.match(/(?:现居住地址|居住地址|住址)\s*[:：]?\s*([^\n]{4,50})/)?.[1];
  if (address) fields.push({ label: "居住地址", value: address.trim() });
  const origin = joined.match(/(?:户籍地址|户籍所在地)\s*[:：]?\s*([^\n]{4,50})/)?.[1];
  if (origin) fields.push({ label: "户籍地址", value: origin.trim() });

  return { fields, title: "居住证" };
}

function parseBirthCert(lines: string[]): { fields: DocField[]; title?: string } {
  const fields: DocField[] = [];
  const cleanedLines = lines.map(removeCjkSpaces);
  const cleanedText = cleanedLines.join("\n");

  // 1. 新生儿姓名
  let name =
    extractBilingualField(cleanedLines, /^(?:新生儿姓名|婴儿姓名|新生儿)/, /Name\s*(?:of\s*child)?/i) ??
    cleanedText.match(/(?:新生儿姓名|婴儿姓名|新生儿)\s*[/／]?\s*(?:Name\s*(?:of\s*child)?)?\s*[:：]?\s*([\u4e00-\u9fa5]{2,10})/i)?.[1];

  if (!name) {
    const idx = cleanedLines.findIndex((l) => /^(?:新生儿姓名|婴儿姓名|新生儿)/.test(l));
    if (idx >= 0) {
      for (let j = idx + 1; j < Math.min(idx + 4, cleanedLines.length); j++) {
        const candidate = cleanedLines[j].replace(/^[:：\s]+/, "").trim();
        if (/^[\u4e00-\u9fa5]{2,8}$/.test(candidate) && !/^(性别|男|女|出生|时间|孕周|健康|良好|中国|汉族|Name|Sex)/i.test(candidate)) {
          name = candidate;
          break;
        }
      }
    }
  }
  if (name) {
    const cleanName = name.replace(/(性别|男|女|出生|时间|孕周).*$/, "").trim();
    if (cleanName) fields.push({ label: "新生儿姓名", value: cleanName });
  }

  // 2. 性别
  let sex = cleanedText.match(/性别\s*[/／]?\s*(?:Sex)?\s*[:：]?\s*(男|女)/i)?.[1];
  if (!sex) {
    const idx = cleanedLines.findIndex((l) => /性别|Sex/i.test(l));
    if (idx >= 0) {
      for (let j = idx; j < Math.min(idx + 3, cleanedLines.length); j++) {
        const m = cleanedLines[j].match(/\b(男|女)\b/);
        if (m) {
          sex = m[1];
          break;
        }
      }
    }
  }
  if (sex) fields.push({ label: "性别", value: sex });

  // 3. 出生日期 / 出生时间
  let birthDate = cleanedText.match(/(?:出生时间|出生日期)\s*[/／]?\s*(?:Date\s*of\s*birth)?\s*[:：]?\s*([0-9.\-年\/月日时分 ]{8,30})/i)?.[1];
  if (!birthDate) {
    const idx = cleanedLines.findIndex((l) => /出生时间|出生日期|Date\s*of\s*birth/i.test(l));
    if (idx >= 0) {
      for (let j = idx; j < Math.min(idx + 3, cleanedLines.length); j++) {
        const m = cleanedLines[j].match(/(\d{4})[.．\-年](\d{1,2})[.．\-月](\d{1,2})/);
        if (m) {
          birthDate = m[0];
          break;
        }
      }
    }
  }
  if (birthDate) {
    const d = normalizeCnDate(birthDate);
    if (d) fields.push({ label: "出生日期", value: d });
    else fields.push({ label: "出生日期", value: birthDate.trim() });
  }

  // 4. 出生孕周
  const gest = cleanedText.match(/(?:出生孕周|孕周)\s*[/／]?\s*(?:Gestational\s*age)?\s*[:：]?\s*(\d{1,2}\s*周(?:\s*\d\s*天)?|\d{1,2})/i)?.[1];
  if (gest) {
    const gVal = gest.replace(/\s+/g, "");
    fields.push({ label: "出生孕周", value: /^\d+$/.test(gVal) ? `${gVal}周` : gVal });
  }

  // 5. 出生体重
  const weight = cleanedText.match(/(?:出生体重|体重)\s*[/／]?\s*(?:Weight)?\s*[:：]?\s*(\d{3,5})\s*(?:克|g)?/i)?.[1];
  if (weight) fields.push({ label: "出生体重", value: `${weight}克` });

  // 6. 出生身长
  const height = cleanedText.match(/(?:出生身长|身长)\s*[/／]?\s*(?:Height)?\s*[:：]?\s*(\d{2,3})\s*(?:厘米|cm)?/i)?.[1];
  if (height) fields.push({ label: "出生身长", value: `${height}cm` });

  // 7. 出生地点
  const place =
    extractBilingualField(cleanedLines, /^(?:出生地点|出生地)/, /Place\s*of\s*birth/i) ??
    cleanedText.match(/(?:出生地点|出生地)\s*[/／]?\s*(?:Place\s*of\s*birth)?\s*[:：]?\s*([^\n:：]{3,40})/i)?.[1];
  if (place) {
    const cleanPlace = place.replace(/(母亲|Father|Mother).*$/i, "").trim();
    if (cleanPlace) fields.push({ label: "出生地点", value: cleanPlace });
  }

  // 划分母亲与父亲文本段落以精准提取姓名与证号
  const motherIdx = cleanedLines.findIndex((l) => /母亲姓名|母亲|Mother/i.test(l));
  const fatherIdx = cleanedLines.findIndex((l) => /父亲姓名|父亲|Father/i.test(l));
  const orgIdx = cleanedLines.findIndex((l) => /签发机构|医疗保健机构|接生机构|Issued\s*by/i.test(l));

  const motherLines = motherIdx >= 0
    ? cleanedLines.slice(motherIdx, fatherIdx > motherIdx ? fatherIdx : orgIdx > motherIdx ? orgIdx : motherIdx + 8)
    : [];
  const fatherLines = fatherIdx >= 0
    ? cleanedLines.slice(fatherIdx, orgIdx > fatherIdx ? orgIdx : fatherIdx + 8)
    : [];

  // 8. 母亲姓名
  let mother =
    extractBilingualField(motherLines.length ? motherLines : cleanedLines, /^(?:母亲姓名|母亲)/, /Mother'?s?\s*name/i) ??
    cleanedText.match(/(?:母亲姓名|母亲)\s*[/／]?\s*(?:Mother'?s?\s*name)?\s*[:：]?\s*([\u4e00-\u9fa5]{2,10})/i)?.[1];
  if (mother) {
    mother = mother.replace(/(年龄|国籍|民族|中国|有效|身份证|Age|Nationality).*$/i, "").trim();
    if (mother && !/^(年龄|国籍|民族|中国|有效|身份证)/.test(mother)) {
      fields.push({ label: "母亲姓名", value: mother });
    }
  }

  // 9. 母亲证号
  const motherIds = findAllIdNumbers(motherLines.join("\n"));
  if (motherIds.length > 0) {
    fields.push({ label: "母亲证号", value: motherIds[0].num, badge: motherIds[0].valid ? "ok" : "warn" });
  }

  // 10. 父亲姓名
  let father =
    extractBilingualField(fatherLines.length ? fatherLines : cleanedLines, /^(?:父亲姓名|父亲)/, /Father'?s?\s*name/i) ??
    cleanedText.match(/(?:父亲姓名|父亲)\s*[/／]?\s*(?:Father'?s?\s*name)?\s*[:：]?\s*([\u4e00-\u9fa5]{2,10})/i)?.[1];
  if (father) {
    father = father.replace(/(年龄|国籍|民族|中国|有效|身份证|Age|Nationality).*$/i, "").trim();
    if (father && !/^(年龄|国籍|民族|中国|有效|身份证)/.test(father)) {
      fields.push({ label: "父亲姓名", value: father });
    }
  }

  // 11. 父亲证号
  const fatherIds = findAllIdNumbers(fatherLines.join("\n"));
  if (fatherIds.length > 0 && (!motherIds.length || fatherIds[0].num !== motherIds[0].num)) {
    fields.push({ label: "父亲证号", value: fatherIds[0].num, badge: fatherIds[0].valid ? "ok" : "warn" });
  } else if (!motherIds.length && fatherIds.length === 0) {
    const allIds = findAllIdNumbers(cleanedText);
    if (allIds.length === 1) {
      fields.push({ label: "母亲证号", value: allIds[0].num, badge: allIds[0].valid ? "ok" : "warn" });
    } else if (allIds.length >= 2) {
      fields.push({ label: "母亲证号", value: allIds[0].num, badge: allIds[0].valid ? "ok" : "warn" });
      fields.push({ label: "父亲证号", value: allIds[1].num, badge: allIds[1].valid ? "ok" : "warn" });
    }
  }

  // 12. 证明编号 (出生医学证明编号，常见以字母开头+8~10位数字)
  const certNo =
    cleanedText.match(/(?:出生医学证明编号|证明编号|编号|No\.?|NO\.?)\s*[:：]?\s*([A-Za-z]\d{8,10})/i)?.[1] ??
    cleanedText.match(/\b([A-Za-z]\d{9,10})\b/)?.[1];
  if (certNo) fields.push({ label: "证明编号", value: certNo.toUpperCase() });

  // 13. 签发机构
  const org =
    extractBilingualField(cleanedLines, /^(?:签发机构|医疗保健机构名称|医疗保健机构|接生机构|助产机构)/, /Issued\s*by|Name\s*of\s*facility/i) ??
    cleanedText.match(/(?:签发机构|医疗保健机构名称|医疗保健机构|接生机构|助产机构)\s*[/／]?\s*(?:Issued\s*by|Name\s*of\s*facility)?\s*[:：]?\s*([^\s:：\n]{4,40})/i)?.[1];
  if (org) {
    const cleanOrg = org.replace(/(签发日期|Date|编号|No).*$/i, "").trim();
    if (cleanOrg) fields.push({ label: "签发机构", value: cleanOrg });
  }

  // 14. 签发日期
  const issueDate =
    cleanedText.match(/(?:签发日期)\s*[/／]?\s*(?:Date\s*of\s*issue)?\s*[:：]?\s*([0-9.\-年\/月日 ]{8,20})/i)?.[1];
  if (issueDate) {
    const d = normalizeCnDate(issueDate);
    if (d) fields.push({ label: "签发日期", value: d });
  }

  return { fields, title: "出生医学证明" };
}

// ---------- 银行卡解析器 ----------

/**
 * 校验银行卡号 Luhn (模10) 国际标准校验算法
 */
export function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

const COMMON_BANKS = [
  "中国工商银行", "中国建设银行", "中国农业银行", "中国银行", "中国邮政储蓄银行",
  "交通银行", "招商银行", "中信银行", "中国光大银行", "华夏银行",
  "中国民生银行", "广发银行", "平安银行", "兴业银行", "上海浦东发展银行",
  "浦发银行", "浙商银行", "渤海银行", "恒丰银行", "北京银行",
  "上海银行", "江苏银行", "南京银行", "宁波银行", "徽商银行",
  "杭州银行", "广州银行", "长沙银行", "成都银行", "重庆银行",
  "农村商业银行", "农商银行", "农村信用社", "微众银行", "网商银行"
];

function parseBankCard(lines: string[], isBack?: boolean): { fields: DocField[]; title: string } {
  const text = lines.join("\n");
  const cleaned = removeCjkSpaces(text);
  const fields: DocField[] = [];

  // 1. 发卡银行识别
  let bankName = "";
  for (const b of COMMON_BANKS) {
    if (text.includes(b) || cleaned.includes(b)) {
      bankName = b;
      break;
    }
  }
  if (!bankName) {
    const m = cleaned.match(/([\u4e00-\u9fa5]{2,8}(?:银行|农商行|信用社))/);
    if (m && !/持卡人|服务|开户|签名/.test(m[1])) {
      bankName = m[1];
    }
  }
  if (bankName) {
    fields.push({ label: "发卡银行", value: bankName });
  }

  // 2. 卡片类型（借记卡/储蓄卡/信用卡/贷记卡）
  let cardType = "";
  if (/\bCREDIT(?:\s*CARD)?\b|信用卡|贷记卡/i.test(text)) {
    cardType = "信用卡";
  } else if (/\bDEBIT(?:\s*CARD)?\b|借记卡|储蓄卡/i.test(text)) {
    cardType = "借记卡";
  }
  if (cardType) {
    fields.push({ label: "卡片类型", value: cardType });
  }

  // 3. 卡组织（银联 / Visa / MasterCard / JCB / 运通）
  let org = "";
  if (/银联|UnionPay/i.test(text)) {
    org = "中国银联";
  } else if (/VISA/i.test(text)) {
    org = "Visa";
  } else if (/MasterCard|万事达/i.test(text)) {
    org = "MasterCard";
  } else if (/JCB/i.test(text)) {
    org = "JCB";
  } else if (/American\s*Express|美国运通|运通/i.test(text)) {
    org = "美国运通";
  }
  if (org) {
    fields.push({ label: "卡组织", value: org });
  }

  // 4. 银行卡号（16~19位数字，支持 6-13、4-4-4-4 等任意空格/横线分隔）
  const candidateNums: string[] = [];
  const digitBlockRe = /(?:^|[^\d])([3-6](?:[\s-]*\d){15,18})(?:[^\d]|$)/g;
  let gm: RegExpExecArray | null;
  while ((gm = digitBlockRe.exec(text)) !== null) {
    const rawDigits = gm[1].replace(/[\s-]/g, "");
    if (rawDigits.length >= 16 && rawDigits.length <= 19) {
      candidateNums.push(rawDigits);
    }
  }
  const rawRe = /\b([3-6]\d{15,18})\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = rawRe.exec(cleaned)) !== null) {
    if (!candidateNums.includes(rm[1])) {
      candidateNums.push(rm[1]);
    }
  }

  let validCardNum = "";
  let unverifiedCardNum = "";
  for (const num of candidateNums) {
    if (validateLuhn(num)) {
      validCardNum = num;
      break;
    } else if (!unverifiedCardNum && num.length >= 16 && num.length <= 19) {
      unverifiedCardNum = num;
    }
  }

  const finalCardNum = validCardNum || unverifiedCardNum;
  if (finalCardNum) {
    const formatted = finalCardNum.replace(/(\d{4})(?=\d)/g, "$1 ");
    fields.push({
      label: "银行卡号",
      value: formatted,
      badge: validCardNum ? "ok" : "warn",
    });
  }

  // 5. 有效期 (VALID THRU 09/28 或 09/28)
  const expiryMatch =
    text.match(/(?:VALID\s*THRU|EXPIRES|EXP|MONTH\/YEAR|VALID\s*FROM|有效[期至]?)\s*[:：]?\s*([0-1]?\d[\/\.-]\d{2,4})/i) ??
    text.match(/\b(0[1-9]|1[0-2])[\/]([2-4]\d)\b/);
  if (expiryMatch) {
    const val = expiryMatch[2] ? `${expiryMatch[1]}/${expiryMatch[2]}` : expiryMatch[1];
    fields.push({ label: "有效期限", value: val });
  }

  // 6. 反面特征（客服电话、CVV安全码）
  if (isBack) {
    const hotline =
      text.match(/(?:24小时)?(?:客户?服务)?(?:热线|电话|专线)\s*[:：]?\s*([0-9-]{5,12})/i)?.[1] ??
      text.match(/\b(95\d{3}|400[0-9-]{7,8}|800[0-9-]{7,8})\b/)?.[1];
    if (hotline) {
      fields.push({ label: "客服热线", value: hotline });
    }

    const cvv =
      text.match(/(?:CVV2?|CVC2?|安全码|后[三四]位|末[三四]位)\s*[:：]?\s*(\d{3,4})/i)?.[1] ??
      text.match(/\b(\d{3})\b(?=\s*(?:签名|末三位|后三位|CVC|CVV))/i)?.[1];
    if (cvv) {
      fields.push({ label: "安全码", value: cvv });
    }
  }

  // 严格遵循守则 3：标题只能是纯粹的证件类型名称
  return { fields, title: "银行卡" };
}

// ---------- 类型判别与调度 ----------

function detectType(text: string, expected?: ExpectedDoc): DocType {
  const cleaned = removeCjkSpaces(text);
  const has = (re: RegExp) => re.test(text) || re.test(cleaned);

  // 1. 出生医学证明（优先判别，避免父母身份证号误触发身份证分支）
  if (
    expected === "birth" ||
    has(/出生医学证明|出生证明|出生证/) ||
    has(/MEDICAL\s*CERTIFICATE\s*OF\s*BIRTH/i) ||
    has(/新生儿|接生机构|助产机构|接生人员/) ||
    has(/出生孕周|出生体重|出生身长/) ||
    (has(/出生/) && (has(/母亲|父亲/) || has(/签发机构|医疗保健机构/)))
  ) {
    return "birth-cert";
  }

  // 2. 居住证
  if (has(/居住证/)) {
    return has(/签发机关|有效期限|签发日期/) ? "residence-back" : "residence-front";
  }

  // 3. 机动车驾驶证
  if (has(/机动车驾驶证/)) return has(/副页|档案编号/) && !has(/准驾车型/) ? "driver-license-sub" : "driver-license";

  // 4. 出入境证件 / 港澳台通行证
  if (
    has(/通行证/) ||
    has(/往来港澳/) ||
    has(/往来台湾/) ||
    has(/回乡证|台胞证/) ||
    has(/出入境管理局|国家移民管理局/) ||
    has(/签注/) ||
    has(/进入许可|Entry\s*Permit/i) ||
    has(/(?:香港|澳门|澳門|台湾)[\s\S]*(?:签注|签证|个人旅游|团队旅游|探亲|商务|逗留|人才|有效|出境|逗留至)/) ||
    has(/(?:签注|签证)[\s\S]*(?:香港|澳门|澳門|台湾)/) ||
    has(/(?:个人旅游|团队旅游|探亲|商务|逗留|人才)\s*[（\(]?[GTLSRQXDY][）\)]?/i) ||
    has(/Exit-Entry/i) ||
    ((has(/通行证|出入境|港澳|台湾/) || expected === "passport") && has(/[CWLMH]\s*\d{8}/i))
  ) {
    const isBack =
      has(/进入许可|Entry\s*Permit/i) ||
      has(/签注|个人旅游|团队旅游|往返|有效次数|出境|逗留至|逗留不超过|准予逗留|停留不超过/) ||
      (has(/香港|澳门|澳門|台湾/) && has(/种类|往返|有效|逗留|Type|Entries/));
    const hasCardNumber = has(/[CWLMH]\s*\d{8}/i) && has(/姓名|出生|性别/);
    if (isBack && !hasCardNumber) {
      return "travel-permit-back";
    }
    return "travel-permit";
  }

  // 5. 护照
  if (has(/护照/)) {
    if (has(/VISA|签证|VISAS/i) && !has(/P<CHN|Surname|Given\s*Name|Passport\s*No/i)) {
      return "passport-visa";
    }
    return "passport";
  }

  // 6. 户口簿
  if (has(/户口[簿本]|常住人口登记|户主|户别|户号/)) {
    if (has(/与户主关系|曾用名|常住人口登记卡|文化程度|籍贯|出生地/) && !has(/户口专用/)) {
      const rel = text.match(/(?:与户主关系|户主或与户主关系|关系)\s*[:：]?\s*([^\s:：\n]{1,10})/)?.[1] || "";
      if (/户主/.test(rel)) return "household-master";
      if (/本人/.test(rel)) return "household-member";
      if (/父|母|妻|夫|配偶|祖父|祖母|外祖|兄|弟|姐|妹|孙|子|女|长子|独生子|长女|次子|次女|儿|媳|婿/.test(rel)) return "household-family";
      return "household-family";
    }
    return "household";
  }

  // 7. 学生证
  if (has(/学生证|学号/) || (has(/学籍|学生/) && expected === "student")) {
    if (has(/注册|乘车区间|火车票优惠卡|优惠卡|第一学期|第二学期/) && !has(/学号|院系|专业|入学/)) {
      return "student-card-reg";
    }
    return "student-card";
  }

  // 8. 居民身份证
  if (
    (has(/公民身份号码/) && !has(/户口|驾驶证|学生证|出生/)) ||
    (has(/居民身份证/) && has(/住址|出生/) && !has(/母亲|父亲|孕周|体重/)) ||
    (expected === "idcard" && (has(/住址|出生|性别|民族/) || findAllIdNumbers(text).length > 0))
  ) {
    return "idcard-front";
  }
  if (
    has(/签发机关|有效期限/) ||
    (has(/中华人民共和国/) && has(/居民身份证/) && !has(/公民身份号码|住址|出生/)) ||
    (expected === "idcard" && has(/公安[分]?局|长期/) && !has(/公民身份号码|住址/))
  ) {
    if (expected !== "license" && expected !== "passport" && expected !== "bankcard") return "idcard-back";
  }

  // 9. 银行卡
  const isBankText =
    has(/借记卡|储蓄卡|信用卡|贷记卡|UnionPay|银联|DEBIT|CREDIT|发卡行/i) ||
    COMMON_BANKS.some((b) => text.includes(b) || cleaned.includes(b)) ||
    has(/\b(?:62\d{14,17}|4\d{15}|5[1-5]\d{14})\b/);
  if (isBankText) {
    const isBack = has(
      /CVV|CVC|安全码|后[三四]位|末[三四]位|客户?服务|服务电话|服务专线|服务热线|热线|电话\s*[:：]?\s*\d|\b(?:95\d{3}|400[0-9-]{7,8}|800[0-9-]{7,8})\b|签名|Signature|拾获|捡获|交还|仅限本人|遵章守约|银行所有|分支机构|柜员机|ATM|磁条|\.com|\.cn|24小时/i
    );
    return isBack ? "bank-card-back" : "bank-card-front";
  }

  // 文本信号不足时按子分类期望兜底
  switch (expected) {
    case "bankcard": {
      const isBack = has(
        /CVV|CVC|安全码|后[三四]位|末[三四]位|客户?服务|服务电话|服务专线|服务热线|热线|电话\s*[:：]?\s*\d|\b(?:95\d{3}|400[0-9-]{7,8}|800[0-9-]{7,8})\b|签名|Signature|拾获|捡获|交还|仅限本人|遵章守约|银行所有|分支机构|柜员机|ATM|磁条|\.com|\.cn|24小时/i
      );
      return isBack ? "bank-card-back" : "bank-card-front";
    }
    case "residence": return has(/签发机关|有效期限|签发日期/) ? "residence-back" : "residence-front";
    case "license": return has(/副页|档案编号/) ? "driver-license-sub" : "driver-license";
    case "passport": {
      if (has(/进入许可|Entry\s*Permit|签注|个人旅游|团队旅游|往返|有效次数|逗留至|停留不超过/i)) {
        return "travel-permit-back";
      }
      if (has(/VISA|签证|VISAS/i) && !has(/P<CHN|Surname|Passport\s*No/i)) {
        return "passport-visa";
      }
      if (
        has(/[CWLMH]\s*\d{8}/i) ||
        has(/港澳|香港|澳门|澳門|台湾|出入境|移民管|通行/)
      ) {
        return "travel-permit";
      }
      return "passport";
    }
    case "student": {
      if (has(/注册|乘车区间|火车票优惠卡|优惠卡|第一学期|第二学期/) && !has(/学号|院系|专业|入学/)) {
        return "student-card-reg";
      }
      return "student-card";
    }
    case "household": {
      if (has(/与户主关系|曾用名|常住人口登记卡|文化程度|籍贯|出生地/)) {
        const rel = text.match(/(?:与户主关系|户主或与户主关系|关系)\s*[:：]?\s*([^\s:：\n]{1,10})/)?.[1] || "";
        if (/户主/.test(rel)) return "household-master";
        if (/本人/.test(rel)) return "household-member";
        if (/父|母|妻|夫|配偶|祖父|祖母|外祖|兄|弟|姐|妹|孙|子|女|长子|独生子|长女|次子|次女|儿|媳|婿/.test(rel)) return "household-family";
        return "household-family";
      }
      return "household";
    }
    case "idcard": {
      if (
        has(/签发机关|有效期限|中华人民共和国|公安[分]?局/) &&
        !has(/公民身份号码|住址|出生/)
      ) {
        return "idcard-back";
      }
      if (has(/公民身份号码|住址|出生|性别|民族/) || findAllIdNumbers(text).length > 0) {
        return "idcard-front";
      }
      return has(/签发机关|有效期限/) ? "idcard-back" : "idcard-front";
    }
    default: return "unknown";
  }
}

/** 入口：OCR 原文 + 子分类期望 → 结构化识别结果 */
export function recognizeDocument(rawText: string, expected?: ExpectedDoc): DocRecognition {
  const lines = splitLines(rawText);
  const text = lines.join("\n");
  if (!lines.length) return { type: "unknown", typeLabel: TYPE_LABELS.unknown, fields: [], noteParts: [] };

  const type = detectType(text, expected);
  let fields: DocField[] = [];
  let title: string | undefined;
  let noteParts: string[] = [];

  switch (type) {
    case "bank-card-front":
    case "bank-card-back": {
      const r = parseBankCard(lines, type === "bank-card-back");
      fields = r.fields;
      title = r.title;
      break;
    }
    case "idcard-front":
    case "idcard-back": {
      fields = type === "idcard-front" ? parseIdcardFront(lines, text) : parseIdcardBack(lines);
      title = "居民身份证";
      break;
    }
    case "residence-front":
    case "residence-back": {
      const r = parseResidence(lines, type === "residence-back");
      fields = r.fields;
      title = r.title;
      break;
    }
    case "birth-cert": {
      const r = parseBirthCert(lines);
      fields = r.fields;
      title = r.title;
      break;
    }
    case "driver-license":
    case "driver-license-sub": {
      const r = parseDriverLicense(lines, type === "driver-license-sub");
      fields = r.fields;
      title = "机动车驾驶证";
      break;
    }
    case "passport":
    case "passport-visa": {
      const r = parsePassport(lines);
      fields = r.fields;
      title = "护照";
      break;
    }
    case "travel-permit":
    case "travel-permit-back": {
      const r = parseTravelPermit(lines);
      fields = r.fields;
      title = r.title || "往来港澳通行证";
      break;
    }
    case "student-card":
    case "student-card-reg": {
      const r = parseStudentCard(lines);
      fields = r.fields;
      title = r.title || "学生证";
      break;
    }
    case "household":
    case "household-master":
    case "household-member":
    case "household-family": {
      const r = parseHousehold(lines);
      fields = r.fields;
      title = "居民户口簿";
      break;
    }
    default:
      return {
        type: "unknown",
        typeLabel: TYPE_LABELS.unknown,
        fields: [],
        noteParts: [],
        rawPreview: lines.slice(0, 4).join(" / ").slice(0, 100),
      };
  }

  // 备注：全部字段拼接（姓名用标签前缀保持可读）
  noteParts = fields.map((f) => `${f.label === "公民身份号码" ? "证号" : f.label} ${f.value}${badgeSuffix(f)}`);
  return { type, typeLabel: TYPE_LABELS[type], fields, titleSuggestion: title, noteParts };
}
