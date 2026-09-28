"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import SensitiveVerifyModal from "@/components/SensitiveVerifyModal";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import ImageViewer, { type ViewerDoc } from "@/components/ImageViewer";
import ChipGroup from "@/components/ChipGroup";
import FieldRows, { type EditableField } from "@/components/FieldRows";
import Toggle from "@/components/Toggle";
import ThinkingOrb from "@/components/ThinkingOrb";
import { api, formatBytes, formatDate, copyText } from "@/lib/format";
import { encryptBytes, fetchFileBytes, isUnlocked, clearDek } from "@/lib/e2ee";
import { recognizeDocument, type DocRecognition, type ExpectedDoc, type DocType, TYPE_LABELS } from "@/lib/doc-recognition";
import { groupDocs, type DocGroup, stripSideSuffix } from "@/lib/document-group";
import { checkDocGroupExpiry } from "@/lib/expiry";
import { checkLocalImageQuality } from "@/lib/image-quality";
import { detectImageTampering } from "@/lib/risk/tamper-detect";
import { validateIdCardNumber } from "@/lib/risk/credential-rules";
import { showToast } from "@/components/ui/alert-toast";

// identity-* 子分类 key → 证件识别期望类型（作为文本信号不足时的兜底）
const EXPECTED_BY_CHILD_KEY: Record<string, ExpectedDoc> = {
  "identity-idcard": "idcard",
  "identity-student": "student",
  "identity-household": "household",
  "identity-passport": "passport",
  "identity-license": "license",
  "identity-residence": "residence",
  "identity-birth": "birth",
  "identity-bankcard": "bankcard",
};

interface CategoryNode {
  id: string;
  key: string;
  name: string;
  icon?: string;
  sensitive?: boolean;
  count?: number;
  children?: { id: string; key: string; name: string; count: number }[];
}

interface DocItem {
  id: string;
  title: string;
  note: string | null;
  meta: string | null; // 结构化识别字段 JSON
  fileName: string;
  mimeType: string;
  size: number;
  isSensitive: boolean;
  e2ee: boolean;
  groupId: string | null; // 证件组：正反面同组
  side: string | null; // 面标签：正面/反面…
  sideOrder: number | null; // 组内排序
  metaMasked?: boolean; // 敏感证件字段已脱敏（验证窗口内为明文）
  noteMasked?: boolean; // 备注因敏感被隐藏
  createdAt: string;
  categoryId: string;
  category: { name: string; key: string; parent?: { name: string; key: string } | null };
  certificate?: { id: string; name: string; org: string; level: string; awardedAt: string } | null;
}



const LEVELS = ["国际级", "国家级", "省级", "市级", "校级", "院级", "其他"];

/** 解析文档 meta 中的结构化识别字段（容错：格式不对返回空） */
function parseDocMeta(meta: string | null): { label: string; value: string }[] {
  if (!meta) return [];
  try {
    const parsed: unknown = JSON.parse(meta);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { fields?: unknown }).fields)
    ) {
      return ((parsed as { fields: unknown }).fields as unknown[]).filter(
        (f): f is { label: string; value: string } =>
          !!f &&
          typeof f === "object" &&
          typeof (f as { label?: unknown }).label === "string" &&
          typeof (f as { value?: unknown }).value === "string"
      );
    }
  } catch {
    /* 忽略不合法数据 */
  }
  return [];
}

// 证件子分类 → 多面上传槽位（有正反面 / 主副页的证件自动拆成多个上传框）
interface IdSlot {
  key: string;
  label: string;
  suffix: string; // 上传时追加到标题后的后缀
}
const DEFAULT_HOUSEHOLD_SLOTS: IdSlot[] = [
  { key: "household-home", label: "户口簿首页", suffix: "首页" },
  { key: "household-master", label: "户主页", suffix: "户主页" },
  { key: "household-member", label: "本人页", suffix: "本人页" },
];

const HOUSEHOLD_PAGE_ROLES = [
  { label: "户口簿首页", suffix: "首页" },
  { label: "户主页", suffix: "户主页" },
  { label: "本人页", suffix: "本人页" },
  { label: "父亲页", suffix: "父亲页" },
  { label: "母亲页", suffix: "母亲页" },
  { label: "配偶页", suffix: "配偶页" },
  { label: "子女页", suffix: "子女页" },
  { label: "家庭成员页", suffix: "成员页" },
  { label: "变动登记页", suffix: "变动页" },
] as const;

const ID_SLOTS: Record<string, IdSlot[]> = {
  "identity-idcard": [
    { key: "front", label: "正面 · 人像面", suffix: "正面" },
    { key: "back", label: "反面 · 国徽面", suffix: "反面" },
  ],
  "identity-passport": [
    { key: "front", label: "正面 · 个人信息面", suffix: "正面" },
    { key: "back", label: "反面 · 签注/签证面", suffix: "反面" },
  ],
  "identity-license": [
    { key: "front", label: "主页", suffix: "主页" },
    { key: "back", label: "副页", suffix: "副页" },
  ],
  "identity-household": DEFAULT_HOUSEHOLD_SLOTS,
  "identity-residence": [
    { key: "front", label: "正面 · 个人信息面", suffix: "正面" },
    { key: "back", label: "反面 · 签发信息面", suffix: "反面" },
  ],
  "identity-student": [
    { key: "front", label: "首页 · 个人信息页", suffix: "首页" },
    { key: "back", label: "注册页", suffix: "注册页" },
  ],
  "identity-bankcard": [
    { key: "front", label: "正面", suffix: "正面" },
    { key: "back", label: "反面", suffix: "反面" },
  ],
};

// 多面证件槽位预期与对调规则
interface SlotRule {
  front: { expected: DocType[]; label: string; actionLabel: string };
  back: { expected: DocType[]; label: string; actionLabel: string };
  reverseTitle: string;
}

const DUAL_SLOT_RULES: Record<string, SlotRule> = {
  "identity-idcard": {
    front: { expected: ["idcard-front"], label: "人像面", actionLabel: "正面" },
    back: { expected: ["idcard-back"], label: "国徽面", actionLabel: "反面" },
    reverseTitle: "正反面颠倒",
  },
  "identity-license": {
    front: { expected: ["driver-license"], label: "主页", actionLabel: "主页" },
    back: { expected: ["driver-license-sub"], label: "副页", actionLabel: "副页" },
    reverseTitle: "主副页颠倒",
  },
  "identity-residence": {
    front: { expected: ["residence-front"], label: "个人信息面", actionLabel: "正面" },
    back: { expected: ["residence-back"], label: "签发信息面", actionLabel: "反面" },
    reverseTitle: "正反面颠倒",
  },
  "identity-passport": {
    front: { expected: ["passport", "travel-permit"], label: "个人信息面", actionLabel: "信息面" },
    back: { expected: ["travel-permit-back", "passport-visa"], label: "签注/签证面", actionLabel: "签注面" },
    reverseTitle: "信息面与签注面颠倒",
  },
  "identity-student": {
    front: { expected: ["student-card"], label: "信息页", actionLabel: "信息页" },
    back: { expected: ["student-card-reg"], label: "注册页", actionLabel: "注册页" },
    reverseTitle: "信息页与注册页颠倒",
  },
};

// GitHub 仓库类型
interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  topics: string[];
  updatedAt: string;
  homepage: string | null;
  archived: boolean;
}

// 语言颜色映射（GitHub 风格）
const LANG_COLOR: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  CSS: "#563d7c",
  HTML: "#e34c26",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Shell: "#89e051",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
};

const CATEGORY_META: Record<
  string,
  { accent: string; desc: string; dropTitle: string; dropHint: string; dropIcon: string }
> = {
  identity: {
    accent: "#0071E3",
    desc: "",
    dropTitle: "上传证件",
    dropHint: "",
    dropIcon: "🪪",
  },
  certificate: {
    accent: "#FF9500",
    desc: "",
    dropTitle: "登记证书",
    dropHint: "",
    dropIcon: "🏅",
  },
  experience: {
    accent: "#34C759",
    desc: "",
    dropTitle: "上传证明",
    dropHint: "",
    dropIcon: "📄",
  },
  photo: {
    accent: "#AF52DE",
    desc: "",
    dropTitle: "上传照片",
    dropHint: "",
    dropIcon: "📷",
  },
  portfolio: {
    accent: "#FF2D55",
    desc: "",
    dropTitle: "上传作品",
    dropHint: "",
    dropIcon: "🎨",
  },
};

async function imageFileToCompressedDataUrl(file: File, maxDim = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    if (file.size <= 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("");
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    img.src = url;
  });
}

export default function CategoryPage() {
  const { key } = useParams<{ key: string }>();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [filterChild, setFilterChild] = useState<string>("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 上传弹窗状态
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  // 多面上传模式（身份证正反面等）：每个槽位独立文件与预览
  const [sideFiles, setSideFiles] = useState<Record<string, File | null>>({});
  const [sidePreviews, setSidePreviews] = useState<Record<string, string>>({});
  const [subCategory, setSubCategory] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [withCert, setWithCert] = useState(false);
  const [certOrg, setCertOrg] = useState("");
  const [certLevel, setCertLevel] = useState("校级");
  const [certDate, setCertDate] = useState("");
  const [singleDragOver, setSingleDragOver] = useState(false);
  const [slotDragOver, setSlotDragOver] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<DocGroup<DocItem> | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 证件本地识别（OCR 在 Web Worker 中跑，图片不出浏览器）
  const [ocrStatus, setOcrStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [aiStatus, setAiStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [docRec, setDocRec] = useState<DocRecognition | null>(null);
  const [ocrError, setOcrError] = useState("");
  // 单文件模式：识别出的结构化字段（逐行可编辑，随 meta 保存）
  const [recFields, setRecFields] = useState<EditableField[]>([]);
  // 多面模式：每个槽位独立的识别状态与字段
  interface SlotOcr {
    status: "idle" | "running" | "done" | "error";
    error: string;
    typeLabel: string;
    detectedType?: DocType;
  }
  const [sideOcr, setSideOcr] = useState<Record<string, SlotOcr>>({});
  const [sideFields, setSideFields] = useState<Record<string, EditableField[]>>({});
  // OCR 原文缓存：切换子分类只需按新证件类型重新解析（毫秒级），不重跑模型
  const ocrTextRef = useRef<string | null>(null);
  // 自动回填的标题快照：值仍等于快照说明用户没改过，可随重新解析更新
  const autoTitleRef = useRef("");
  // 图像质量评估（模糊/过暗/反光）与简历文案生成
  const [qualityIssue, setQualityIssue] = useState<string>("");
  const [slotQuality, setSlotQuality] = useState<Record<string, string>>({});
  const [generatingBullet, setGeneratingBullet] = useState(false);
  const [resumeBullet, setResumeBullet] = useState("");

  // 敏感验证
  const [verifyOpen, setVerifyOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  // 结构化详情弹窗
  const [detailGroup, setDetailGroup] = useState<DocGroup<DocItem> | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // 编辑弹窗（组级：改基础标题 = 组内各面一起改名）
  const [editDoc, setEditDoc] = useState<DocItem | null>(null);
  const [editGroupDocs, setEditGroupDocs] = useState<DocItem[]>([]);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editChild, setEditChild] = useState("");
  const [confirmDeleteDocItem, setConfirmDeleteDocItem] = useState<DocItem | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // 端到端加密图片的解密缩略图（objectURL 缓存）
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // 缩略图版本戳：图片旋转更新时刷新普通图片缓存
  const [thumbVersion, setThumbVersion] = useState(0);
  // 当前正在旋转中的文档 ID
  const [rotatingDocId, setRotatingDocId] = useState<string | null>(null);
  // 二次验证成功的时间戳：变化时重拉敏感 e2ee 缩略图
  const [verifyTick, setVerifyTick] = useState(0);
  // 图片浏览器（灯箱）：当前打开的证件组 + 组内序号
  const [viewer, setViewer] = useState<{ docs: ViewerDoc[]; index: number } | null>(null);

  // 视图模式：pass (实体数字票夹卡，默认) | list (高密度清单表格)
  const [viewMode, setViewMode] = useState<"pass" | "list">("pass");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("campus_archive_view_mode");
      if (saved === "pass" || saved === "list") setViewMode(saved);
    } catch {}
  }, []);


  // GitHub 仓库（仅 portfolio 分类展示）
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);

  const mainCategory = tree.find((c) => c.key === key);
  const meta = CATEGORY_META[key] ?? {
    accent: "var(--ink)",
    desc: "",
    dropTitle: "上传文件",
    dropHint: "支持 JPG/PNG/WebP/HEIC/PDF，最大 20MB",
    dropIcon: "📎",
  };
  const isCertCategory = key === "certificate";
  const forceSensitive = mainCategory?.sensitive ?? false;

  // 当前选中子分类对应的多面上传配置（仅身份证件类有正反面 / 主副页 / 户口簿多页）
  const selectedChild = mainCategory?.children?.find((c) => c.id === subCategory);
  const isHousehold = key === "identity" && selectedChild?.key === "identity-household";
  const [householdSlots, setHouseholdSlots] = useState<IdSlot[]>(DEFAULT_HOUSEHOLD_SLOTS);
  const idSlots = key === "identity" && selectedChild
    ? (isHousehold ? householdSlots : ID_SLOTS[selectedChild.key])
    : undefined;
  const isDualUpload = !!idSlots;

  function resetSideFiles() {
    setSideFiles({});
    setSidePreviews((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setSideOcr({});
    setSideFields({});
  }

  function addHouseholdSlot() {
    const newKey = `household-${Date.now()}`;
    setHouseholdSlots((prev) => [
      ...prev,
      { key: newKey, label: "家庭成员页", suffix: "成员页" },
    ]);
  }

  function removeHouseholdSlot(slotKey: string) {
    setHouseholdSlots((prev) => prev.filter((s) => s.key !== slotKey));
    setSideFiles((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
    setSidePreviews((prev) => {
      if (prev[slotKey]) URL.revokeObjectURL(prev[slotKey]);
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
    setSideOcr((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
    setSideFields((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });
  }

  function setHouseholdSlotRole(slotKey: string, roleName: string) {
    const item = HOUSEHOLD_PAGE_ROLES.find((r) => r.label === roleName);
    const suffix = item ? item.suffix : roleName;
    setHouseholdSlots((prev) =>
      prev.map((s) => (s.key === slotKey ? { ...s, label: roleName, suffix } : s))
    );
  }

  function handleBatchHouseholdFiles(files: FileList | File[]) {
    const fileList = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.name.toLowerCase().endsWith(".heic")
    );
    if (!fileList.length) return;

    const updatedSlots = [...householdSlots];
    if (fileList.length > updatedSlots.length) {
      const extraCount = fileList.length - updatedSlots.length;
      for (let i = 0; i < extraCount; i++) {
        updatedSlots.push({
          key: `household-batch-${Date.now()}-${i}`,
          label: "家庭成员页",
          suffix: "成员页",
        });
      }
      setHouseholdSlots(updatedSlots);
    }

    fileList.forEach((f, idx) => {
      const slot = updatedSlots[idx];
      if (!slot) return;
      setSideFiles((prev) => ({ ...prev, [slot.key]: f }));
      setSidePreviews((prev) => {
        if (prev[slot.key]) URL.revokeObjectURL(prev[slot.key]);
        return { ...prev, [slot.key]: URL.createObjectURL(f) };
      });
      runSlotOcr(slot.key, f);
    });
  }

  function getHouseholdMismatch(slot: IdSlot, detectedType?: DocType) {
    if (!detectedType || detectedType === "unknown") return null;

    const isMemberCard =
      detectedType === "household-master" ||
      detectedType === "household-member" ||
      detectedType === "household-family";
    const isHomePage = detectedType === "household";

    // 1. 跨证件类型错放（如在户口簿槽位放入了身份证、驾驶证、护照等）
    if (!isMemberCard && !isHomePage) {
      return {
        isMismatch: true,
        detectedLabel: TYPE_LABELS[detectedType] || "其他材料",
      };
    }

    // 2. 首页槽位（户口簿首页）：误放入了常住人口登记卡（家庭成员页）
    if (slot.suffix === "首页" || slot.suffix === "变动页") {
      if (isMemberCard) {
        return {
          isMismatch: true,
          detectedLabel: "常住人口登记卡",
        };
      }
      return null;
    }

    // 3. 成员页槽位（户主页、本人页、家庭成员页、父亲页等）：误放入了户口簿首页
    if (isHomePage) {
      return {
        isMismatch: true,
        detectedLabel: "户口簿首页",
      };
    }

    // 4. 成员页内部（户主页、本人页、家庭成员页等）：
    // 户口簿中所有成员页均为常住人口登记卡，各成员具体角色由用户自主配置，严禁无理拦截
    return null;
  }

  function getSlotMismatch(slotKey: string, detectedType?: DocType, childKey?: string) {
    if (!detectedType || detectedType === "unknown" || !childKey) return null;
    const rule = DUAL_SLOT_RULES[childKey];
    if (!rule) return null;

    const thisSlot = slotKey === "front" ? rule.front : rule.back;
    const otherSlot = slotKey === "front" ? rule.back : rule.front;
    const otherKey = slotKey === "front" ? "back" : "front";

    // 匹配当前槽位预期
    if (thisSlot.expected.includes(detectedType)) {
      return null;
    }

    // 匹配对侧槽位预期：即放到了对侧
    if (otherSlot.expected.includes(detectedType)) {
      return {
        isMismatch: true,
        isOppositeSide: true,
        expectedLabel: thisSlot.label,
        detectedLabel: otherSlot.label,
        targetSlotKey: otherKey,
        targetSlotLabel: otherSlot.actionLabel,
      };
    }

    // 跨大类错放
    const foreignLabel = TYPE_LABELS[detectedType] || "其他版式";
    return {
      isMismatch: true,
      isOppositeSide: false,
      expectedLabel: thisSlot.label,
      detectedLabel: foreignLabel,
      targetSlotKey: undefined,
      targetSlotLabel: undefined,
    };
  }

  function swapDualSlots() {
    setSideFiles((prev) => ({
      ...prev,
      front: prev.back ?? null,
      back: prev.front ?? null,
    }));
    setSidePreviews((prev) => ({
      ...prev,
      front: prev.back ?? "",
      back: prev.front ?? "",
    }));
    setSideOcr((prev) => ({
      ...prev,
      front: prev.back ?? { status: "idle", error: "", typeLabel: "" },
      back: prev.front ?? { status: "idle", error: "", typeLabel: "" },
    }));
    setSideFields((prev) => ({
      ...prev,
      front: prev.back ?? [],
      back: prev.front ?? [],
    }));
    setUploadError("");
  }

  function moveSlot(fromKey: string, toKey: string) {
    setSideFiles((prev) => ({
      ...prev,
      [toKey]: prev[fromKey] ?? null,
      [fromKey]: null,
    }));
    setSidePreviews((prev) => ({
      ...prev,
      [toKey]: prev[fromKey] ?? "",
      [fromKey]: "",
    }));
    setSideOcr((prev) => ({
      ...prev,
      [toKey]: prev[fromKey] ?? { status: "idle", error: "", typeLabel: "" },
      [fromKey]: { status: "idle", error: "", typeLabel: "" },
    }));
    setSideFields((prev) => ({
      ...prev,
      [toKey]: prev[fromKey] ?? [],
      [fromKey]: [],
    }));
    setUploadError("");
  }

  const activeRule = selectedChild?.key ? DUAL_SLOT_RULES[selectedChild.key] : undefined;
  const frontMismatch = getSlotMismatch("front", sideOcr["front"]?.detectedType, selectedChild?.key);
  const backMismatch = getSlotMismatch("back", sideOcr["back"]?.detectedType, selectedChild?.key);
  const isReversed = !!(frontMismatch?.isOppositeSide && backMismatch?.isOppositeSide);
  const reverseBannerTitle = activeRule?.reverseTitle || "正反面颠倒";

  const bothBack = !!(
    activeRule &&
    sideOcr["front"]?.detectedType &&
    sideOcr["back"]?.detectedType &&
    activeRule.back.expected.includes(sideOcr["front"].detectedType) &&
    activeRule.back.expected.includes(sideOcr["back"].detectedType)
  );

  const bothFront = !!(
    activeRule &&
    sideOcr["front"]?.detectedType &&
    sideOcr["back"]?.detectedType &&
    activeRule.front.expected.includes(sideOcr["front"].detectedType) &&
    activeRule.front.expected.includes(sideOcr["back"].detectedType)
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catRes, docRes] = await Promise.all([
        api<{ categories: CategoryNode[] }>("/api/categories"),
        api<{ documents: DocItem[]; sensitiveGranted: boolean }>(`/api/documents?categoryKey=${key}`),
      ]);
      setTree(catRes.categories);
      let list = docRes.documents;
      // E2ET 加密的识别字段/备注在浏览器解密（服务器只见密文）
      const { decryptText } = await import("@/lib/e2ee");
      list = await Promise.all(
        list.map(async (d) => {
          if (!d.meta?.startsWith("E2ET:") && !d.note?.startsWith("E2ET:")) return d;
          return {
            ...d,
            meta: d.meta ? await decryptText(d.meta).catch(() => d.meta) : d.meta,
            note: d.note ? await decryptText(d.note).catch(() => d.note) : d.note,
          };
        })
      );
      setDocs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  // 文档图片旋转成功后回调：立即刷新缓存与缩略图
  const handleDocRotated = useCallback(
    (docId: string, newUrl: string) => {
      setThumbs((prev) => {
        if (prev[docId]) {
          try {
            URL.revokeObjectURL(prev[docId]);
          } catch {}
        }
        return { ...prev, [docId]: newUrl };
      });
      setThumbVersion((v) => v + 1);
      void load();
      window.dispatchEvent(new Event("documents_updated"));
    },
    [load]
  );

  // 编辑弹窗内快捷旋转
  const handleQuickRotate = useCallback(
    async (docToRotate: DocItem, angle: number) => {
      setRotatingDocId(docToRotate.id);
      try {
        const { fetchFileBytes } = await import("@/lib/e2ee");
        const { rotateImageBytes, saveDocumentFile } = await import("@/lib/image-rotate");
        const { bytes, mime } = await fetchFileBytes(docToRotate.id, docToRotate.mimeType);
        const { bytes: newBytes, mime: newMime, blob: newBlob } = await rotateImageBytes(
          bytes,
          mime,
          angle
        );
        await saveDocumentFile(docToRotate.id, newBytes, newMime, docToRotate.e2ee);
        const newUrl = URL.createObjectURL(newBlob);
        handleDocRotated(docToRotate.id, newUrl);
        showToast.success("已保存方向");
      } catch (err) {
        showToast.error(err instanceof Error ? err.message : "旋转失败");
      } finally {
        setRotatingDocId(null);
      }
    },
    [handleDocRotated]
  );

  // portfolio 分类：加载 GitHub 仓库
  useEffect(() => {
    if (key !== "portfolio") return;
    setGithubLoading(true);
    fetch("/api/github-repos")
      .then((r) => r.json())
      .then((d: { repos: GithubRepo[] }) => setGithubRepos(d.repos ?? []))
      .catch(() => setGithubRepos([]))
      .finally(() => setGithubLoading(false));
  }, [key]);

  useEffect(() => {
    if (mainCategory?.children?.length && !subCategory) {
      setSubCategory(mainCategory.children[0].id);
    }
  }, [mainCategory, subCategory]);

  useEffect(() => {
    setResumeBullet("");
  }, [detailGroup]);

  // 敏感文件统一门禁：10 分钟窗口内直接执行，否则弹二次验证后重试
  // （e2ee 与普通存储同样受窗口约束，必须先过验证再拉密文）
  async function withSensitiveGate(doc: DocItem, action: () => void | Promise<void>) {
    if (!doc.isSensitive) {
      await action();
      return;
    }
    try {
      const { granted } = await api<{ granted: boolean }>("/api/auth/sensitive-verify");
      if (granted) {
        await action();
        return;
      }
    } catch {
      /* 走弹窗 */
    }
    pendingAction.current = async () => {
      await action();
    };
    setVerifyOpen(true);
  }

  // 查看：按证件组浏览——正反面在灯箱里左右翻页；PDF 新标签页
  function viewGroup(g: DocGroup<DocItem>, startDoc?: DocItem) {
    const gateDoc = g.docs.find((d) => d.isSensitive) ?? g.main;
    void withSensitiveGate(gateDoc, async () => {
      const groupImages = g.docs.filter((d) => d.mimeType !== "application/pdf");
      if (!groupImages.length) {
        await openPdfTab(g.main);
        return;
      }

      let targetList = groupImages;
      const allCategoryImages = visible.filter((d) => d.mimeType !== "application/pdf");
      if (g.docs.length === 1 && allCategoryImages.length > 1) {
        targetList = allCategoryImages;
      }

      const targetDoc = startDoc ?? groupImages[0];
      const idx = targetList.findIndex((d) => d.id === targetDoc.id);

      const viewerDocs: ViewerDoc[] = targetList.map((d) => ({
        id: d.id,
        title: d.title,
        fileName: d.fileName,
        mimeType: d.mimeType,
        size: d.size,
        e2ee: d.e2ee,
        isSensitive: d.isSensitive,
        side: d.side,
        meta: d.meta,
        note: d.note,
        createdAt: d.createdAt,
        categoryName: d.category?.name || "材料",
        certificate: d.certificate,
      }));

      setViewer({ docs: viewerDocs, index: idx >= 0 ? idx : 0 });
    });
  }

  // 下载：组内所有面依次下载（敏感组验证一次即可）
  function downloadGroup(g: DocGroup<DocItem>) {
    void withSensitiveGate(g.main, async () => {
      for (const d of g.docs) await openDoc(d);
    });
  }

  // PDF 新标签页：e2ee 解密有耗时，同步先开占位窗口保住用户手势，避免被弹窗拦截
  async function openPdfTab(doc: DocItem) {
    if (!doc.e2ee) {
      window.open(`/api/documents/${doc.id}/file`, "_blank");
      return;
    }
    const w = window.open("", "_blank");
    try {
      const { bytes, mime } = await fetchFileBytes(doc.id, doc.mimeType);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      if (w) w.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      w?.close();
      showToast.error(err instanceof Error ? err.message : "文件解密失败");
    }
  }

  // 下载：e2ee 解密后用锚点触发（不受弹窗拦截影响）；普通存储走直链
  async function openDoc(doc: DocItem) {
    await withSensitiveGate(doc, async () => {
      if (doc.e2ee) {
        try {
          let { bytes, mime } = await fetchFileBytes(doc.id, doc.mimeType);
          let safeFileName = doc.fileName;
          if (doc.fileName.toLowerCase().endsWith(".webp") || mime.includes("webp")) {
            try {
              const blob = new Blob([bytes as BlobPart], { type: "image/webp" });
              const imgBitmap = await createImageBitmap(blob);
              const canvas = document.createElement("canvas");
              canvas.width = imgBitmap.width;
              canvas.height = imgBitmap.height;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(imgBitmap, 0, 0);
                const jpgBlob = await new Promise<Blob | null>((res) =>
                  canvas.toBlob(res, "image/jpeg", 0.95)
                );
                if (jpgBlob) {
                  bytes = new Uint8Array(await jpgBlob.arrayBuffer());
                  mime = "image/jpeg";
                  safeFileName = doc.fileName.replace(/\.webp$/i, ".jpg");
                }
              }
            } catch {}
          }
          const url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" })
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = safeFileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
          showToast.error(err instanceof Error ? err.message : "文件解密失败");
        }
        return;
      }
      const safeFileName = doc.fileName.toLowerCase().endsWith(".webp")
        ? doc.fileName.replace(/\.webp$/i, ".jpg")
        : doc.fileName;
      const a = document.createElement("a");
      a.href = `/api/documents/${doc.id}/file?download=1`;
      a.download = safeFileName;
      a.click();
    });
  }

  // 证件本地识别：Worker 内跑 PaddleOCR → 判别证件类型 → 按版式解析字段 → 回填
  // 类型判别以 OCR 文本信号优先（正反面/正副页自动区分），子分类期望兜底
  function expectedDoc(): ExpectedDoc | undefined {
    if (key !== "identity") return undefined;
    const child = mainCategory?.children?.find((c) => c.id === subCategory);
    return child ? EXPECTED_BY_CHILD_KEY[child.key] : undefined;
  }

  function applyRecognition(rec: DocRecognition) {
    setDocRec(rec);
    // 结构化字段进编辑行（每个字段一个输入框，可修改后随档案保存）
    const validatedFields: EditableField[] = rec.fields.map((f) => {
      if (f.label.includes("公民身份号码") || f.label.includes("身份证号")) {
        const valRes = validateIdCardNumber(f.value);
        if (!valRes.valid) {
          return { label: f.label, value: f.value, badge: "warn" };
        }
      }
      return { label: f.label, value: f.value, badge: f.badge };
    });
    setRecFields(validatedFields);
    // 标题建议：仅当标题仍是上次自动填充值或为空时替换（用户手改过的不动）
    const t = rec.titleSuggestion ? stripSideSuffix(rec.titleSuggestion) : "";
    if (t && (title === autoTitleRef.current || title === "")) {
      autoTitleRef.current = t;
      setTitle(t);
    }
  }

  function parseDocumentDate(text: string): string | null {
    if (!text) return null;
    const cnNumMap: Record<string, string> = {
      "〇": "0", "零": "0", "O": "0", "o": "0", "0": "0",
      "一": "1", "1": "1",
      "二": "2", "2": "2",
      "三": "3", "3": "3",
      "四": "4", "4": "4",
      "五": "5", "5": "5",
      "六": "6", "6": "6",
      "七": "7", "7": "7",
      "八": "8", "8": "8",
      "九": "9", "9": "9",
    };
    const lines = text.split(/[\r\n]+/).reverse();
    for (const line of lines) {
      const stdMatch = line.match(/(20\d{2}|19\d{2})\s*[年.\-\/]\s*(\d{1,2})\s*(?:[月.\-\/]\s*(\d{1,2})\s*日?)?/);
      if (stdMatch) {
        const y = stdMatch[1];
        const m = String(stdMatch[2]).padStart(2, "0");
        const d = stdMatch[3] ? String(stdMatch[3]).padStart(2, "0") : "01";
        return `${y}-${m}-${d}`;
      }
      const cnMatch = line.match(/([二一][〇零Oo0-9]{3})\s*年\s*([一二三四五六七八九十0-9]{1,3})\s*月(?:\s*([一二三四五六七八九十0-9]{1,3})\s*日)?/);
      if (cnMatch) {
        let yStr = "";
        for (const ch of cnMatch[1]) {
          yStr += cnNumMap[ch] ?? ch;
        }
        const parseCnMonthOrDay = (s: string) => {
          if (s === "十") return "10";
          if (s.startsWith("十")) return "1" + (cnNumMap[s[1]] ?? "0");
          if (s.endsWith("十")) return (cnNumMap[s[0]] ?? "1") + "0";
          if (s.includes("十")) {
            const parts = s.split("十");
            return (cnNumMap[parts[0]] ?? "1") + (cnNumMap[parts[1]] ?? "0");
          }
          return cnNumMap[s] ?? s;
        };
        const m = String(parseCnMonthOrDay(cnMatch[2])).padStart(2, "0");
        const d = cnMatch[3] ? String(parseCnMonthOrDay(cnMatch[3])).padStart(2, "0") : "01";
        if (yStr.length === 4 && Number(m) >= 1 && Number(m) <= 12) {
          return `${yStr}-${m}-${d}`;
        }
      }
    }
    return null;
  }

  function inferCertificateFields(fileName: string, ocrText: string = "") {
    const combined = `${fileName} ${ocrText}`;

    // 0. 登记证书自动勾选总目
    setWithCert(true);

    // 1. 自动清洗标题：去除开头的序号前缀（如 01_、01.、1- 等）及后缀拓展名
    const rawClean = fileName.replace(/\.[^.]+$/, "").replace(/^[\d+（(【\[\s._\-、]+/, "").trim();
    if (rawClean && (title === autoTitleRef.current || !title)) {
      autoTitleRef.current = rawClean;
      setTitle(rawClean);
    }

    // 2. 启发式子分类推断
    if (mainCategory?.children?.length) {
      let targetKey = "";
      if (/大赛|竞赛|技能大赛|一等奖|二等奖|三等奖|特等奖|优胜奖|奖状|优秀|表彰|荣誉证书/.test(combined)) {
        targetKey = "certificate-award";
      } else if (/CET|四级|六级|计算机|普通话|NCRE|雅思|托福|日语|等级考试|考级/.test(combined)) {
        targetKey = "certificate-level";
      } else if (/资格|从业资格|软考|教师资格|执业|会计师|建造师|工程师/.test(combined)) {
        targetKey = "certificate-qualify";
      } else if (/毕业|学位|学士|硕士|博士|结业/.test(combined)) {
        targetKey = "certificate-graduation";
      }
      if (targetKey) {
        const match = mainCategory.children.find((c) => c.key === targetKey);
        if (match) setSubCategory(match.id);
      }
    }

    // 3. 启发式级别推断
    if (/国际/.test(combined)) {
      setCertLevel("国际级");
    } else if (/全国|国家|教育部|工信部|团中央|中国/.test(combined)) {
      setCertLevel("国家级");
    } else if (/省级|全省|省|江苏|浙江|广东|山东|河南|河北|四川|湖北|湖南|安徽|福建|江西|陕西|辽宁|吉林|黑龙江|广西|内蒙古|新疆|宁夏|西藏|海南|贵州|云南|青海|北京|上海|天津|重庆/.test(combined)) {
      setCertLevel("省级");
    } else if (/市级|全市|市/.test(combined)) {
      setCertLevel("市级");
    } else if (/校级|全校|大学/.test(combined)) {
      setCertLevel("校级");
    } else if (/院级|分院|系/.test(combined)) {
      setCertLevel("院级");
    }

    // 4. 从 OCR 文本提取日期与颁发机构
    if (ocrText) {
      const detectedDate = parseDocumentDate(ocrText);
      if (detectedDate) {
        setCertDate(detectedDate);
      }
      const lines = ocrText.split(/[\n\r]+/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim().replace(/^[^a-zA-Z\u4e00-\u9fa5]+/, "").replace(/[^a-zA-Z\u4e00-\u9fa5]+$/, "");
        if (line.length >= 4 && line.length <= 32 && /厅|部|局|委员会|组委会|学会|协会|大学|学院|院|中心|办公室$/.test(line)) {
          setCertOrg(line);
          break;
        }
      }
    }
  }

  async function runAiExtract(fileToExtract: File, text: string) {
    setAiStatus("running");
    try {
      let imageBase64 = "";
      if (fileToExtract && fileToExtract.type.startsWith("image/")) {
        imageBase64 = await imageFileToCompressedDataUrl(fileToExtract);
      }
      const aiRes = await fetch("/api/ai/extract-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocrText: text || "",
          categoryKey: key,
          imageBase64: imageBase64 || undefined,
        }),
      });
      if (aiRes.ok) {
        const resData = await aiRes.json();
        if (resData.ok && resData.data) {
          const d = resData.data;
          if (key === "certificate") {
            if (d.name && (title === autoTitleRef.current || title === "")) {
              autoTitleRef.current = d.name;
              setTitle(d.name);
            }
            if (d.org) setCertOrg(d.org);
            if (d.level) setCertLevel(d.level);
            if (d.date) setCertDate(d.date);
            if (d.note && !note) setNote(d.note);
            if (d.subCategoryKey && mainCategory?.children?.length) {
              const matched = mainCategory.children.find((c) => c.key === d.subCategoryKey);
              if (matched) setSubCategory(matched.id);
            }
            setWithCert(true);
          } else if (key === "experience") {
            if (d.title && (title === autoTitleRef.current || title === "")) {
              autoTitleRef.current = d.title;
              setTitle(d.title);
            }
            if (d.note && !note) setNote(d.note);
            if (d.subCategoryKey && mainCategory?.children?.length) {
              const matched = mainCategory.children.find((c) => c.key === d.subCategoryKey);
              if (matched) setSubCategory(matched.id);
            }
          }
          setAiStatus("done");
        } else {
          setAiStatus("idle");
        }
      } else {
        setAiStatus("idle");
      }
    } catch {
      setAiStatus("idle");
    }
  }

  async function generateResumeBullet(group: DocGroup<DocItem> | null) {
    if (generatingBullet || !group) return;
    setGeneratingBullet(true);
    try {
      const doc = group.main;
      const res = await fetch("/api/ai/resume-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: key === "certificate" ? "certificate" : "experience",
          title: group.title,
          org: doc.certificate?.org || "",
          level: doc.certificate?.level || "",
          date: doc.certificate?.awardedAt?.slice(0, 10) || doc.createdAt.slice(0, 10),
          note: doc.note || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast.error(data.error || "生成失败");
        return;
      }
      if (data.ok && data.data?.bullet) {
        setResumeBullet(data.data.bullet);
      }
    } catch {
      showToast.error("生成失败");
    } finally {
      setGeneratingBullet(false);
    }
  }

  async function runDocOcr(f: File | null) {
    ocrTextRef.current = null;
    const canOcr = key === "identity" || key === "certificate" || key === "experience";
    if (!canOcr || !f || !f.type.startsWith("image/")) {
      setOcrStatus("idle");
      setAiStatus("idle");
      setDocRec(null);
      setRecFields([]);
      setQualityIssue("");
      autoTitleRef.current = "";
      return;
    }
    setOcrStatus("running");
    setAiStatus("idle");
    setOcrError("");
    setDocRec(null);
    setRecFields([]);
    setQualityIssue("");

    // 本地画质评估（零网络外发，包含模糊度、强光反光、过暗分析）
    void checkLocalImageQuality(f).then((q) => {
      if (!q.pass && q.issue) {
        setQualityIssue(q.issue);
      }
    });

    // 本地图像篡改与修改痕迹初筛（ELA + EXIF 签名）
    void detectImageTampering(f).then((t) => {
      if (t.isTampered && t.issue) {
        setQualityIssue((prev) => prev || t.issue);
      }
    });

    // 非敏感类别异步请求云端多模态画质判定（若本地已判定有问题则保留本地判定）
    if (key !== "identity" && f.type.startsWith("image/")) {
      void imageFileToCompressedDataUrl(f).then((b64) => {
        if (!b64) return;
        fetch("/api/ai/quality-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryKey: key, imageBase64: b64 }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d?.ok && d.data && !d.data.pass && d.data.issue) {
              setQualityIssue((prev) => prev || d.data.issue);
            }
          })
          .catch(() => {});
      });
    }

    try {
      const { ocrImage, rotateImageFile } = await import("@/lib/ocr");
      const res = await ocrImage(f);
      if (res.angle !== 0) {
        const rotated = await rotateImageFile(f, res.angle);
        setFiles((prev) => {
          const next = [...prev];
          if (next.length) next[0] = rotated;
          else next.push(rotated);
          return next;
        });
        setFilePreviews((prev) => {
          const next = [...prev];
          if (next[0]) URL.revokeObjectURL(next[0]);
          const url = URL.createObjectURL(rotated);
          if (next.length) next[0] = url;
          else next.push(url);
          return next;
        });
      }
      ocrTextRef.current = res.text;

      if (key === "identity") {
        const rec = recognizeDocument(res.text, expectedDoc());
        applyRecognition(rec);
        setOcrStatus("done");
        if (rec.type !== "unknown" && mainCategory?.children?.length) {
          const childKeyMap: Partial<Record<DocType, string>> = {
            "birth-cert": "identity-birth",
            "driver-license": "identity-license",
            "driver-license-sub": "identity-license",
            "residence-front": "identity-residence",
            "residence-back": "identity-residence",
            "household": "identity-household",
            "household-master": "identity-household",
            "household-member": "identity-household",
            "household-family": "identity-household",
            "student-card": "identity-student",
            "student-card-reg": "identity-student",
            "passport": "identity-passport",
            "passport-visa": "identity-passport",
            "travel-permit": "identity-passport",
            "travel-permit-back": "identity-passport",
            "idcard-front": "identity-idcard",
            "idcard-back": "identity-idcard",
            "bank-card-front": "identity-bankcard",
            "bank-card-back": "identity-bankcard",
          };
          const targetKey = childKeyMap[rec.type];
          if (targetKey) {
            const matched = mainCategory.children.find((c) => c.key === targetKey);
            if (matched && matched.id !== subCategory) {
              setSubCategory(matched.id);
            }
          }
        }
      } else if (key === "certificate" || key === "experience") {
        setOcrStatus("done");
        if (key === "certificate") {
          inferCertificateFields(f.name, res.text || "");
        }
        const isImage = f.type.startsWith("image/");
        const hasText = !!(res.text && res.text.trim());
        if (hasText || isImage) {
          await runAiExtract(f, res.text || "");
        }
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "识别失败");
      setOcrStatus("error");
      setAiStatus("idle");
    }
  }

  // 多面模式：对单个槽位的文件独立跑 OCR，字段落到该槽位的编辑行
  async function runSlotOcr(slotKey: string, f: File | null) {
    const setSlot = (s: SlotOcr) => setSideOcr((o) => ({ ...o, [slotKey]: s }));
    if (!f || !f.type.startsWith("image/")) {
      setSlot({ status: "idle", error: "", typeLabel: "" });
      setSideFields((m) => ({ ...m, [slotKey]: [] }));
      setSlotQuality((prev) => ({ ...prev, [slotKey]: "" }));
      return;
    }
    setSlot({ status: "running", error: "", typeLabel: "" });
    setSideFields((m) => ({ ...m, [slotKey]: [] }));
    setSlotQuality((prev) => ({ ...prev, [slotKey]: "" }));

    // 槽位本地画质与篡改检测（100% 离线计算，覆盖身份证、驾驶证、护照等所有证件）
    void checkLocalImageQuality(f).then((q) => {
      setSlotQuality((prev) => ({ ...prev, [slotKey]: !q.pass && q.issue ? q.issue : prev[slotKey] || "" }));
    });
    void detectImageTampering(f).then((t) => {
      if (t.isTampered && t.issue) {
        setSlotQuality((prev) => ({ ...prev, [slotKey]: prev[slotKey] || t.issue }));
      }
    });
    try {
      const { ocrImage, rotateImageFile } = await import("@/lib/ocr");
      const res = await ocrImage(f);
      if (res.angle !== 0) {
        const rotated = await rotateImageFile(f, res.angle);
        setSideFiles((s) => ({ ...s, [slotKey]: rotated }));
        setSidePreviews((p) => {
          if (p[slotKey]) URL.revokeObjectURL(p[slotKey]);
          return { ...p, [slotKey]: URL.createObjectURL(rotated) };
        });
      }
      const rec = recognizeDocument(res.text, expectedDoc());
      setSideFields((m) => ({
        ...m,
        [slotKey]: rec.fields.map((x) => ({ label: x.label, value: x.value, badge: x.badge })),
      }));
      setSlot({ status: "done", error: "", typeLabel: rec.typeLabel, detectedType: rec.type });
      // 首面识别出的标题建议自动回填（用户手改过则不动）
      if (rec.titleSuggestion && (title === autoTitleRef.current || title === "")) {
        const cleanT = stripSideSuffix(rec.titleSuggestion);
        autoTitleRef.current = cleanT;
        setTitle(cleanT);
      }
    } catch (err) {
      setSlot({ status: "error", error: err instanceof Error ? err.message : "识别失败", typeLabel: "" });
    }
  }

  // 切换子分类：按新证件类型重新解析已缓存的 OCR 文本（不重跑模型）
  useEffect(() => {
    if (ocrTextRef.current) {
      applyRecognition(recognizeDocument(ocrTextRef.current, expectedDoc()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subCategory]);

  // 切换子分类后槽位配置可能变化（如身份证↔驾驶证），清空已选的各面文件
  useEffect(() => {
    resetSideFiles();
    if (selectedChild?.key === "identity-household") {
      setHouseholdSlots(DEFAULT_HOUSEHOLD_SLOTS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subCategory]);

  // 顺时针旋转指定文件图片 90°
  async function handleRotateFile(index: number = 0) {
    const target = files[index];
    if (!target || !target.type.startsWith("image/")) return;
    try {
      const { rotateImageFile } = await import("@/lib/ocr");
      const rotated = await rotateImageFile(target, 90);
      setFiles((prev) => {
        const next = [...prev];
        next[index] = rotated;
        return next;
      });
      setFilePreviews((prev) => {
        const next = [...prev];
        if (next[index]) URL.revokeObjectURL(next[index]);
        next[index] = URL.createObjectURL(rotated);
        return next;
      });
      if (index === 0 && files.length === 1) {
        runDocOcr(rotated);
      }
    } catch (err) {
      console.warn("图片旋转失败:", err);
    }
  }

  function addFiles(newFiles: File[]) {
    const valid = newFiles.filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type === "application/pdf" ||
        /\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(f.name)
    );
    if (!valid.length) return;

    const newPreviews = valid.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));

    setFiles((prev) => {
      const combined = [...prev, ...valid];
      if (prev.length === 0) {
        if (valid.length === 1) {
          const rawClean = valid[0].name.replace(/\.[^.]+$/, "").replace(/^[\d+（(【\[\s._\-、]+/, "").trim();
          const def = rawClean || valid[0].name.replace(/\.[^.]+$/, "");
          setTitle(def);
          autoTitleRef.current = def;
          if (key === "certificate") {
            inferCertificateFields(valid[0].name, "");
          }
          runDocOcr(valid[0]);
        } else {
          setTitle("");
          autoTitleRef.current = "";
        }
      } else {
        if (title === autoTitleRef.current) {
          setTitle("");
          autoTitleRef.current = "";
        }
      }
      return combined;
    });

    setFilePreviews((prev) => [...prev, ...newPreviews]);
    setUploadError("");
  }

  function removeFileAt(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setTitle("");
        autoTitleRef.current = "";
        setOcrStatus("idle");
        setAiStatus("idle");
        setDocRec(null);
        setRecFields([]);
        ocrTextRef.current = null;
      } else if (next.length === 1 && prev.length > 1) {
        const rawClean = next[0].name.replace(/\.[^.]+$/, "").replace(/^[\d+（(【\[\s._\-、]+/, "").trim();
        const def = rawClean || next[0].name.replace(/\.[^.]+$/, "");
        setTitle(def);
        autoTitleRef.current = def;
        if (key === "certificate") {
          inferCertificateFields(next[0].name, "");
        }
        runDocOcr(next[0]);
      }
      return next;
    });
    setFilePreviews((prev) => {
      if (prev[index]) URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }

  function clearAllFiles() {
    filePreviews.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setFiles([]);
    setFilePreviews([]);
    setTitle("");
    autoTitleRef.current = "";
    setOcrStatus("idle");
    setAiStatus("idle");
    setDocRec(null);
    setRecFields([]);
    ocrTextRef.current = null;
  }

  // 顺时针旋转多面证件中某一槽位的图片 90° 并重新识别
  async function handleRotateSlot(slotKey: string) {
    const orig = sideFiles[slotKey];
    if (!orig || !orig.type.startsWith("image/")) return;
    try {
      const { rotateImageFile } = await import("@/lib/ocr");
      const rotated = await rotateImageFile(orig, 90);
      setSideFiles((s) => ({ ...s, [slotKey]: rotated }));
      setSidePreviews((p) => {
        if (p[slotKey]) URL.revokeObjectURL(p[slotKey]);
        return { ...p, [slotKey]: URL.createObjectURL(rotated) };
      });
      runSlotOcr(slotKey, rotated);
    } catch (err) {
      console.warn("图片旋转失败:", err);
    }
  }

  // 单个文件加密上传（多面模式对每一面各调用一次，同一证件的各面带同一 groupId）。
  // 敏感证件（identity 分类）的识别字段与备注先用 DEK 加密成 E2ET 信封再上传。
  async function uploadOneDoc(
    f: File,
    finalTitle: string,
    meta?: string,
    group?: { id: string; side: string; order: number }
  ) {
    const plain = new Uint8Array(await f.arrayBuffer());
    const cipher = await encryptBytes(plain);
    if (!cipher) {
      fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        clearDek();
        window.location.href = "/login";
      });
      throw new Error("端到端加密未解锁，正在退出重新登录...");
    }
    let metaVal = meta;
    let noteVal: string | null = note || null;
    const { encryptText } = await import("@/lib/e2ee");
    if (metaVal) metaVal = (await encryptText(metaVal)) ?? metaVal;
    if (noteVal) noteVal = (await encryptText(noteVal)) ?? noteVal;
    const cleanTitle = stripSideSuffix(finalTitle) || finalTitle;
    const blob = new Blob([cipher as BlobPart], { type: f.type || "application/octet-stream" });
    const form = new FormData();
    form.append("file", blob, f.name);
    form.append("categoryId", subCategory);
    form.append("title", cleanTitle);
    form.append("note", noteVal ?? "");
    if (metaVal) form.append("meta", metaVal);
    if (group) {
      form.append("groupId", group.id);
      form.append("side", group.side);
      form.append("sideOrder", String(group.order));
    }
    form.append("isSensitive", forceSensitive ? "true" : "false");
    form.append("withCertificate", withCert ? "true" : "false");
    if (withCert) {
      form.append("certOrg", certOrg);
      form.append("certLevel", certLevel);
      form.append("certAwardedAt", certDate);
    }
    const res = await fetch("/api/documents", {
      method: "POST",
      body: form,
      headers: { "x-e2ee": "1" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "上传失败");
  }

  function resetUploadForm() {
    filePreviews.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setFiles([]);
    setFilePreviews([]);
    setTitle("");
    setNote("");
    setOcrStatus("idle");
    setDocRec(null);
    setOcrError("");
    setRecFields([]);
    setSideOcr({});
    setSideFields({});
    ocrTextRef.current = null;
    autoTitleRef.current = "";
    resetSideFiles();
    setHouseholdSlots(DEFAULT_HOUSEHOLD_SLOTS);
    setWithCert(false);
    setCertOrg("");
    setCertDate("");
    setAiStatus("idle");
    setUploadProgress({ current: 0, total: 0 });
  }

  function handleOpenUpload() {
    if (!isUnlocked()) {
      fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        clearDek();
        window.location.href = "/login";
      });
      return;
    }
    if (filterChild && filterChild !== "__expired__") {
      setSubCategory(filterChild);
    }
    setUploadOpen(true);
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError("");
    if (!isUnlocked()) {
      fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        clearDek();
        window.location.href = "/login";
      });
      setUploadError("端到端加密未解锁，正在退出重新登录...");
      return;
    }
    if (!subCategory) {
      setUploadError("请选择子分类");
      return;
    }
    if (withCert && (!certOrg || !certDate)) {
      setUploadError("请补全证书的颁发单位和获得时间");
      return;
    }
    // 组装待上传任务：多面模式按槽位拆成多条记录，同一证件共用一个 groupId
    let tasks: { f: File; t: string; meta?: string; group?: { id: string; side: string; order: number } }[] = [];
    if (isDualUpload && idSlots) {
      if (isHousehold) {
        const base = "居民户口簿";
        const groupId = crypto.randomUUID();
        tasks = idSlots
          .map((s, i): { f: File; t: string; meta?: string; group?: { id: string; side: string; order: number } } | null => {
            const f = sideFiles[s.key];
            if (!f) return null;
            const fields = (sideFields[s.key] ?? []).filter((x) => x.value.trim());
            const meta = fields.length ? JSON.stringify({ side: s.label, fields }) : undefined;
            return { f, t: base, meta, group: { id: groupId, side: s.suffix, order: i } };
          })
          .filter((x): x is { f: File; t: string; meta?: string; group?: { id: string; side: string; order: number } } => x !== null);

        if (tasks.length === 0) {
          setUploadError("请选择户口簿材料");
          return;
        }
      } else {
        if (isReversed) {
          setUploadError(`${reverseBannerTitle}，请先对调`);
          return;
        }
        if (bothBack) {
          setUploadError(`两面均为${activeRule?.back.label || "反面"}，请核对`);
          return;
        }
        if (bothFront) {
          setUploadError(`两面均为${activeRule?.front.label || "正面"}，请核对`);
          return;
        }
        const base = stripSideSuffix(title.trim() || selectedChild?.name || "证件");
        const groupId = crypto.randomUUID(); // 本次上传的证件组 ID
        tasks = idSlots
          .map((s, i): { f: File; t: string; meta?: string; group?: { id: string; side: string; order: number } } | null => {
            const f = sideFiles[s.key];
            if (!f) return null;
            const fields = (sideFields[s.key] ?? []).filter((x) => x.value.trim());
            const meta = fields.length ? JSON.stringify({ side: s.label, fields }) : undefined;
            return { f, t: base, meta, group: { id: groupId, side: s.suffix, order: i } };
          })
          .filter((x): x is { f: File; t: string; meta?: string; group?: { id: string; side: string; order: number } } => x !== null);
        if (selectedChild?.key === "identity-bankcard") {
          if (tasks.length === 0) {
            setUploadError("请选择银行卡材料");
            return;
          }
        } else if (tasks.length < idSlots.length) {
          setUploadError("请上传完整证件");
          return;
        }
      }
    } else {
      if (files.length === 0) {
        setUploadError("请选择文件");
        return;
      }
      const fields = recFields.filter((x) => x.value.trim());
      tasks = files.map((f, i) => {
        let t = stripSideSuffix(f.name.replace(/\.[^.]+$/, ""));
        if (title.trim()) {
          t = files.length === 1
            ? stripSideSuffix(title.trim())
            : `${stripSideSuffix(title.trim())} (${i + 1})`;
        }
        return {
          f,
          t: t || f.name,
          meta: files.length === 1 && fields.length ? JSON.stringify({ fields }) : undefined,
        };
      });
    }
    setUploading(true);
    try {
      for (let i = 0; i < tasks.length; i++) {
        setUploadProgress({ current: i + 1, total: tasks.length });
        await uploadOneDoc(tasks[i].f, tasks[i].t, tasks[i].meta, tasks[i].group);
      }
      setUploadOpen(false);
      resetUploadForm();
      await load();
      window.dispatchEvent(new Event("documents_updated"));
      showToast.success(tasks.length > 1 ? `已成功归档 ${tasks.length} 份材料` : "归档成功");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
    }
  }

  // 编辑：敏感证件先过验证（否则备注/字段是密文状态，编辑会误以为内容为空）
  function openEditGroup(g: { main: DocItem; docs: DocItem[]; title: string }) {
    void withSensitiveGate(g.main, () => {
      setEditDoc(g.main);
      setEditGroupDocs(g.docs);
      setEditTitle(g.title);
      setEditNote(g.main.note ?? "");
      setEditChild(g.main.categoryId);
    });
  }

  // 保存编辑
  async function submitEdit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!editDoc || !editTitle.trim()) return;
    try {
      // 备注端到端加密后保存
      let noteToSave = editNote.trim() || null;
      if (noteToSave) {
        const { encryptText } = await import("@/lib/e2ee");
        noteToSave = (await encryptText(noteToSave)) ?? noteToSave;
      }

      // 组级批量更新：组内每个文档同步基础标题、备注与子分类
      if (editGroupDocs.length > 1) {
        await Promise.all(
          editGroupDocs.map((d) =>
            api(`/api/documents/${d.id}`, {
              method: "PATCH",
              json: { title: stripSideSuffix(editTitle), note: noteToSave, categoryId: editChild || undefined },
            })
          )
        );
      } else {
        await api(`/api/documents/${editDoc.id}`, {
          method: "PATCH",
          json: { title: stripSideSuffix(editTitle), note: noteToSave, categoryId: editChild || undefined },
        });
      }
      setEditDoc(null);
      setEditGroupDocs([]);
      await load();
      window.dispatchEvent(new Event("documents_updated"));
      showToast.success("保存成功");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  // 编辑弹窗内删除单项材料
  function handleDeleteDocInEdit(d: DocItem) {
    setConfirmDeleteDocItem(d);
  }

  async function executeDeleteSingleDoc() {
    if (!confirmDeleteDocItem) return;
    setDeletingDocId(confirmDeleteDocItem.id);
    try {
      await api(`/api/documents/${confirmDeleteDocItem.id}`, { method: "DELETE" });

      if (thumbs[confirmDeleteDocItem.id]) {
        setThumbs((prev) => {
          const next = { ...prev };
          delete next[confirmDeleteDocItem.id];
          return next;
        });
      }

      const remaining = editGroupDocs.filter((x) => x.id !== confirmDeleteDocItem.id);
      if (remaining.length === 0) {
        setEditDoc(null);
        setEditGroupDocs([]);
        setConfirmDeleteDocItem(null);
        await load();
        window.dispatchEvent(new Event("documents_updated"));
        showToast.success("删除成功");
      } else {
        setEditGroupDocs(remaining);
        if (editDoc?.id === confirmDeleteDocItem.id) {
          setEditDoc(remaining[0]);
        }
        setConfirmDeleteDocItem(null);
        await load();
        window.dispatchEvent(new Event("documents_updated"));
        showToast.success("已删除该页材料");
      }
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeletingDocId(null);
    }
  }

  // 删除：打开 Apple 风格确认对话框
  function deleteGroup(g: DocGroup<DocItem>) {
    setConfirmDeleteGroup(g);
  }

  async function executeDeleteGroup() {
    if (!confirmDeleteGroup) return;
    setDeleting(true);
    try {
      for (const d of confirmDeleteGroup.docs) {
        await api(`/api/documents/${d.id}`, { method: "DELETE" });
      }
      setConfirmDeleteGroup(null);
      await load();
      window.dispatchEvent(new Event("documents_updated"));
      showToast.success("删除成功");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  const allGroups = groupDocs(docs);
  const expiredGroupCount = allGroups.filter(
    (g) => checkDocGroupExpiry(g.docs.flatMap((d) => parseDocMeta(d.meta))).status === "expired"
  ).length;

  // 按证件分组渲染：一个证件（正反面）= 一张卡片，支持按子分类与过期状态筛选
  const visibleGroups = allGroups.filter((g) => {
    if (filterChild === "__expired__") {
      const exp = checkDocGroupExpiry(g.docs.flatMap((d) => parseDocMeta(d.meta)));
      if (exp.status !== "expired") return false;
    } else if (filterChild && !g.docs.some((d) => d.categoryId === filterChild)) {
      return false;
    }
    if (query) {
      const q = query.toLowerCase();
      const matchTitle = g.title.toLowerCase().includes(q);
      const matchNote = g.docs.some((d) => (d.note ?? "").toLowerCase().includes(q));
      const matchFile = g.docs.some((d) => d.fileName.toLowerCase().includes(q));
      const matchMeta = g.docs.some((d) => (d.meta ?? "").toLowerCase().includes(q));
      if (!matchTitle && !matchNote && !matchFile && !matchMeta) return false;
    }
    return true;
  });
  const visible = visibleGroups.flatMap((g) => g.docs);

  // E2EE 图片：拉取密文 → 本地解密 → objectURL 预览
  // 敏感 e2ee 文件受 10 分钟窗口约束：未验证时不拉取（避免 403 刷屏），显示锁占位
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const needGate = docs.some((d) => d.e2ee && d.isSensitive && d.mimeType !== "application/pdf");
      if (needGate) {
        try {
          const { granted } = await api<{ granted: boolean }>("/api/auth/sensitive-verify");
          if (!granted) return;
        } catch {
          return;
        }
      }
      for (const d of docs) {
        if (cancelled) return;
        if (!d.e2ee || d.mimeType === "application/pdf" || thumbs[d.id]) continue;
        try {
          const { bytes, mime } = await fetchFileBytes(d.id, d.mimeType);
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
          setThumbs((t) => ({ ...t, [d.id]: url }));
        } catch {
          /* 单个缩略图解密失败不阻塞列表 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // verifyTick：二次验证成功后重拉敏感缩略图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, verifyTick]);

  // 单个文件的卡片视觉（缩略图/锁/PDF 占位），组卡片内复用
  function docVisual(doc: DocItem) {
    if (doc.mimeType === "application/pdf") {
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center rounded-md border gap-1.5"
          style={{ background: "var(--card-alt)", borderColor: "var(--line)" }}
        >
          <span style={{ fontSize: 28 }}>📄</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-faint)", letterSpacing: "0.04em" }}>PDF</span>
        </div>
      );
    }
    if (doc.e2ee) {
      if (thumbs[doc.id]) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbs[doc.id]}
            alt={doc.title}
            className="max-h-full max-w-full rounded object-contain drop-shadow-sm transition-transform duration-200 group-hover/preview:scale-[1.02]"
          />
        );
      }
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed"
          style={{ borderColor: "var(--line-strong)", color: "var(--ink-faint)" }}
        >
          <span style={{ fontSize: 20 }}>{doc.isSensitive ? "🔒" : "🔑"}</span>
          <span style={{ fontSize: 10, marginTop: 3 }}>
            {doc.isSensitive ? "验证后可见" : "解密中…"}
          </span>
        </div>
      );
    }
    if (doc.isSensitive) {
      return (
        <div
          className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed"
          style={{ borderColor: "var(--line-strong)", color: "var(--ink-faint)" }}
        >
          <span style={{ fontSize: 20 }}>🔒</span>
          <span style={{ fontSize: 10, marginTop: 3 }}>验证后可见</span>
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/documents/${doc.id}/file?thumb=1&v=${thumbVersion}`}
        alt={doc.title}
        loading="lazy"
        className="max-h-full max-w-full rounded object-contain drop-shadow-sm transition-transform duration-200 group-hover/preview:scale-[1.02]"
      />
    );
  }

  if (loading && docs.length === 0) {
    return <p className="py-20 text-center text-sm" style={{ color: "var(--ink-faint)" }}>加载中…</p>;
  }

  return (
    <div style={{ "--accent": meta.accent } as React.CSSProperties}>
      {/* 面板头 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center justify-between">
          <div className="panel-title">
            {mainCategory?.icon} {mainCategory?.name ?? "分类"}
          </div>
          {/* 移动端视窗切换按钮 */}
          <div className="flex sm:hidden items-center bg-[var(--card-alt)] p-0.5 rounded-lg border border-[var(--line)]">
            <button
              type="button"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                viewMode === "pass"
                  ? "bg-[var(--card)] text-[var(--ink)] shadow-2xs font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setViewMode("pass");
                try {
                  localStorage.setItem("campus_archive_view_mode", "pass");
                } catch {}
              }}
              title="票夹"
            >
              <span>🗂️</span>
              <span>票夹</span>
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                viewMode === "list"
                  ? "bg-[var(--card)] text-[var(--ink)] shadow-2xs font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setViewMode("list");
                try {
                  localStorage.setItem("campus_archive_view_mode", "list");
                } catch {}
              }}
              title="列表"
            >
              <span>☰</span>
              <span>列表</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* 桌面端视窗切换按钮 */}
          <div className="hidden sm:flex items-center bg-[var(--card-alt)] p-0.5 rounded-lg border border-[var(--line)]">
            <button
              type="button"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                viewMode === "pass"
                  ? "bg-[var(--card)] text-[var(--ink)] shadow-2xs font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setViewMode("pass");
                try {
                  localStorage.setItem("campus_archive_view_mode", "pass");
                } catch {}
              }}
              title="票夹"
            >
              <span>🗂️</span>
              <span>票夹</span>
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                viewMode === "list"
                  ? "bg-[var(--card)] text-[var(--ink)] shadow-2xs font-semibold"
                  : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
              }`}
              onClick={() => {
                setViewMode("list");
                try {
                  localStorage.setItem("campus_archive_view_mode", "list");
                } catch {}
              }}
              title="列表"
            >
              <span>☰</span>
              <span>列表</span>
            </button>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题 / 备注…"
            className="input flex-1 sm:!w-48 !py-2 text-[13px]"
          />
          <button className="btn btn-ink shrink-0 !py-2 !px-4" onClick={handleOpenUpload}>
            ＋ 上传
          </button>
        </div>
      </div>

      {error && <div className="alert-error mb-4">{error}</div>}

      {/* GitHub 仓库区块（仅作品集分类展示） */}
      {key === "portfolio" && (
        <div className="mb-7">
          <div className="flex items-center justify-between mb-3">
            <span
              className="text-[13px] font-semibold tracking-tight"
              style={{ color: "var(--ink-faint)" }}
            >
              GitHub 开源项目
            </span>
            <a
              href="https://github.com/Aaron-gx"
              target="_blank"
              rel="noopener noreferrer"
              className="link-btn mono"
              style={{ fontSize: 12 }}
            >
              @Aaron-gx ↗
            </a>
          </div>
          {githubLoading ? (
            <p className="text-sm py-4" style={{ color: "var(--ink-faint)" }}>
              加载中…
            </p>
          ) : githubRepos.length === 0 ? null : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
            >
              {githubRepos.map((repo) => (
                <a
                  key={repo.id}
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="doc-card"
                  style={{ display: "block", textDecoration: "none", cursor: "pointer" }}
                >
                  {/* 仓库头部：名称 + GitHub 图标 */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className="fname"
                      style={{ fontSize: 13.5, fontWeight: 600, wordBreak: "break-all" }}
                    >
                      {repo.name}
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      width="15"
                      height="15"
                      fill="currentColor"
                      style={{ color: "var(--ink-faint)", flexShrink: 0, marginTop: 2 }}
                    >
                      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
                    </svg>
                  </div>

                  {/* 描述 */}
                  {repo.description && (
                    <div
                      className="fmeta mb-2"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {repo.description}
                    </div>
                  )}

                  {/* Topics */}
                  {repo.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {repo.topics.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="tag"
                          style={{ fontSize: 10, padding: "1px 6px" }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 底部：语言 + Stars + Forks */}
                  <div className="foot" style={{ marginTop: "auto" }}>
                    <span className="flex items-center gap-3">
                      {repo.language && (
                        <span
                          className="flex items-center gap-1 mono"
                          style={{ fontSize: 11, color: "var(--ink-faint)" }}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: LANG_COLOR[repo.language] ?? "var(--ink-faint)",
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          {repo.language}
                        </span>
                      )}
                      {repo.stars > 0 && (
                        <span
                          className="flex items-center gap-0.5 mono"
                          style={{ fontSize: 11, color: "var(--ink-faint)" }}
                        >
                          ★ {repo.stars}
                        </span>
                      )}
                      {repo.forks > 0 && (
                        <span
                          className="flex items-center gap-0.5 mono"
                          style={{ fontSize: 11, color: "var(--ink-faint)" }}
                        >
                          ⑂ {repo.forks}
                        </span>
                      )}
                    </span>
                    {repo.homepage && (
                      <span
                        className="link-btn"
                        style={{ fontSize: 11 }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.open(repo.homepage!, "_blank");
                        }}
                      >
                        主页 ↗
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
          {/* 分割线 */}
          {githubRepos.length > 0 && docs.length > 0 && (
            <div
              className="mt-6 mb-1"
              style={{ borderTop: "1px solid var(--line)", opacity: 0.5 }}
            />
          )}
        </div>
      )}

      {/* 子类筛选 */}
      {mainCategory?.children && mainCategory.children.length > 0 && (
        <div className="chip-row">
          <button className={`chip ${!filterChild ? "on" : ""}`} onClick={() => setFilterChild("")}>
            全部 {allGroups.length + (key === "portfolio" && !filterChild ? githubRepos.length : 0)}
          </button>
          {mainCategory.children.map((child) => (
            <button
              key={child.id}
              className={`chip ${filterChild === child.id ? "on" : ""}`}
              onClick={() => setFilterChild(child.id)}
            >
              {child.name} <span className="mono">{allGroups.filter((g) => g.docs.some((d) => d.categoryId === child.id)).length}</span>
            </button>
          ))}
          {expiredGroupCount > 0 && (
            <button
              className={`chip ${filterChild === "__expired__" ? "on !bg-red-50 !text-red-700 !border-red-300" : "!border-red-200 !text-red-600 hover:!bg-red-50"}`}
              onClick={() => setFilterChild(filterChild === "__expired__" ? "" : "__expired__")}
            >
              已过期 <span className="mono font-semibold">{expiredGroupCount}</span>
            </button>
          )}
        </div>
      )}

      {/* 文件网格 */}
      {visible.length === 0 ? (
        key === "portfolio" && githubRepos.length > 0 ? null : (
          <div className="empty">
            <div className="empty-mark">＋</div>
            <b>{docs.length === 0 ? "暂无材料" : "无匹配文件"}</b>
            {docs.length === 0 && (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ink" onClick={handleOpenUpload}>
                  上传材料
                </button>
              </div>
            )}
          </div>
        )
      ) : viewMode === "list" ? (
        /* 列表模式：高密度表格 */
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: 68 }}>缩略图</th>
                <th>材料名称</th>
                <th>分类</th>
                <th>关键识别信息</th>
                <th>大小</th>
                <th>创建时间</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((g) => {
                const mergedFields = g.docs.flatMap((d) => parseDocMeta(d.meta));
                const groupExpiry = checkDocGroupExpiry(mergedFields);
                const primaryField =
                  mergedFields.find((f) => /号码|证号|编号|签注号|学号|户号/.test(f.label)) ??
                  mergedFields[0];
                const otherCount = mergedFields.length - (primaryField ? 1 : 0);
                return (
                  <tr
                    key={g.key}
                    className="hover:bg-[var(--card-alt)] transition-colors cursor-pointer"
                    onClick={() => viewGroup(g)}
                  >
                    <td>
                      <div className="w-11 h-8 rounded-md overflow-hidden bg-[var(--card-alt)] border border-[var(--line)] flex items-center justify-center p-0.5">
                        {docVisual(g.main)}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                        <span>{g.title}</span>
                        {g.hasMultiple && (
                          <span className="text-[10px] text-[var(--ink-faint)] bg-[var(--card-alt)] border border-[var(--line)] px-1 py-0.2 rounded font-normal">
                            {g.docs.length === 2 ? "双面" : `${g.docs.length}页`}
                          </span>
                        )}
                        {groupExpiry.status === "expired" && (
                          <span className="text-[10px] font-semibold text-[#ff3b30] bg-[#ff3b30]/10 px-1 py-0.2 rounded">
                            已过期
                          </span>
                        )}
                        {groupExpiry.status === "expiring" && (
                          <span className="text-[10px] font-semibold text-[#d97706] bg-[#fef3c7] px-1 py-0.2 rounded">
                            即将到期
                          </span>
                        )}
                      </div>
                      {g.main.note && (
                        <div className="text-[11px] text-[var(--ink-faint)] truncate max-w-xs mt-0.5">
                          📝 {g.main.note}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
                        style={{
                          color: "var(--accent, #0071E3)",
                          background: "color-mix(in srgb, var(--accent, #0071E3) 10%, transparent)",
                        }}
                      >
                        {g.main.category.name}
                      </span>
                    </td>
                    <td>
                      {primaryField ? (
                        <div className="flex items-center gap-1.5 text-[11.5px]">
                          <span
                            className="inline-flex items-center gap-1 hover:bg-[var(--card-alt)] px-1 py-0.5 rounded cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailGroup(g);
                            }}
                          >
                            <span className="text-[var(--ink-faint)]">{primaryField.label}:</span>
                            <span className="mono font-semibold text-[var(--ink)]">{primaryField.value}</span>
                          </span>
                          {otherCount > 0 && (
                            <span
                              className="text-[10px] text-[#0071E3] bg-[#0071E3]/10 hover:bg-[#0071E3]/20 px-1.5 py-0.5 rounded font-medium cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailGroup(g);
                              }}
                            >
                              +{otherCount} 项
                            </span>
                          )}
                        </div>
                      ) : g.docs.some((d) => d.certificate) ? (
                        (() => {
                          const cert = g.docs.find((d) => d.certificate)?.certificate;
                          if (!cert) return null;
                          return (
                            <div className="flex items-center gap-1.5 text-[11.5px]">
                              {cert.level && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/60 shrink-0">
                                  {cert.level}
                                </span>
                              )}
                              <span className="text-[var(--ink-faint)] truncate max-w-xs">{cert.org}</span>
                            </div>
                          );
                        })()
                      ) : g.main.metaMasked ? (
                        <span className="text-[11px] text-[var(--ink-faint)]">🔒 验证后可见</span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="mono text-[11.5px] text-[var(--ink-faint)]">
                      {formatBytes(g.docs.reduce((s, d) => s + d.size, 0))}
                    </td>
                    <td className="mono text-[11.5px] text-[var(--ink-faint)]">
                      {formatDate(g.main.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="text-[11.5px] font-semibold text-[#0071E3] hover:underline px-1.5 py-1"
                          onClick={() => viewGroup(g)}
                        >
                          查看
                        </button>
                        <button
                          type="button"
                          className="text-[11.5px] text-[var(--ink-soft)] hover:text-[var(--ink)] px-1.5 py-1"
                          onClick={() => downloadGroup(g)}
                        >
                          下载
                        </button>
                        <button
                          type="button"
                          className="text-[11.5px] text-[var(--ink-soft)] hover:text-[var(--ink)] px-1.5 py-1"
                          onClick={() => openEditGroup(g)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="text-[11.5px] text-[var(--ink-faint)] hover:text-[#ff3b30] px-1.5 py-1"
                          onClick={() => deleteGroup(g)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* 现代精炼卡片（Apple 规范：清晰分层、绝不遮挡、严格等高） */
        <div className="doc-grid-modern">
          {visibleGroups.map((g) => {
            const mergedFields = g.docs.flatMap((d) => parseDocMeta(d.meta));
            const groupExpiry = checkDocGroupExpiry(mergedFields);
            const seen = new Set<string>();
            const merged = mergedFields.filter(
              (f) => (seen.has(f.label) ? false : (seen.add(f.label), true))
            );
            const primaryField =
              merged.find((f) => /号码|证号|编号|签注号|学号|户号|代码/.test(f.label)) ??
              merged.find((f) => /有效期限|有效期|到期|日期/.test(f.label)) ??
              merged.find((f) => /姓名|签发机关/.test(f.label)) ??
              merged.find((f) => !/性别/.test(f.label)) ??
              merged[0];
            const otherCount = merged.length - (primaryField ? 1 : 0);

            return (
              <div
                key={g.key}
                className={`doc-card-modern group ${
                  groupExpiry.status === "expired" ? "!border-red-300 shadow-sm" : ""
                }`}
              >
                {/* 1. 顶部状态栏：分类徽标 + 状态指示（绝不遮挡图片） */}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-tight"
                    style={{
                      color: "var(--accent, #0071E3)",
                      background: "color-mix(in srgb, var(--accent, #0071E3) 10%, transparent)",
                    }}
                  >
                    {g.main.category.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {groupExpiry.status === "expired" && (
                      <span className="inline-flex items-center text-[10.5px] font-semibold text-[#ff3b30] bg-[#ff3b30]/10 border border-[#ff3b30]/20 px-2 py-0.5 rounded-full">
                        已过期
                      </span>
                    )}
                    {groupExpiry.status === "expiring" && (
                      <span className="inline-flex items-center text-[10.5px] font-semibold text-[#d97706] bg-[#fef3c7] border border-[#fde68a] px-2 py-0.5 rounded-full">
                        即将到期
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--ink-faint)] bg-[var(--card-alt)] border border-[var(--line)] px-2 py-0.5 rounded-full">
                      {g.main.isSensitive ? (
                        <>🔒 加密</>
                      ) : g.docs.every((d) => d.mimeType === "application/pdf") ? (
                        "PDF"
                      ) : (
                        "图片"
                      )}
                    </span>
                  </div>
                </div>

                {/* 2. 证件原图展示框：双面同时展示，彻底移除内层嵌套厚框，极细轻透 */}
                <div
                  className="relative mb-3 cursor-pointer overflow-hidden rounded-xl flex items-center justify-center bg-[var(--card-alt)] border border-[var(--line)] p-2 transition-all duration-200 group-hover:scale-[1.008]"
                  style={{ height: 154 }}
                  onClick={() => viewGroup(g)}
                >
                  {g.hasMultiple ? (
                    g.docs.length === 2 ? (
                      <div className="grid grid-cols-2 gap-2 h-full w-full">
                        {g.docs.map((doc, idx) => (
                          <div
                            key={doc.id}
                            title={doc.title}
                            className="relative h-full w-full flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              viewGroup(g, doc);
                            }}
                          >
                            {docVisual(doc)}
                            <span className="absolute bottom-1 right-1 text-[8.5px] font-medium text-[var(--ink-soft)] bg-[var(--card)]/90 backdrop-blur-xs px-1.5 py-0.2 rounded border border-[var(--line)] shadow-2xs pointer-events-none">
                              {doc.side ?? (idx === 0 ? "正面" : "反面")}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5 h-full w-full">
                        {g.docs.slice(0, 3).map((doc, idx) => {
                          const isLastSlot = idx === 2;
                          const remainingCount = g.docs.length - 2;
                          return (
                            <div
                              key={doc.id}
                              title={doc.title}
                              className="relative h-full w-full flex items-center justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                viewGroup(g, doc);
                              }}
                            >
                              {docVisual(doc)}
                              {isLastSlot && remainingCount > 1 ? (
                                <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px] rounded-lg flex flex-col items-center justify-center text-white pointer-events-none">
                                  <span className="text-[13px] font-bold">+{remainingCount}</span>
                                  <span className="text-[9px] text-white/80">页</span>
                                </div>
                              ) : (
                                <span className="absolute bottom-1 right-1 text-[8.5px] font-medium text-[var(--ink-soft)] bg-[var(--card)]/90 backdrop-blur-xs px-1.5 py-0.2 rounded border border-[var(--line)] shadow-2xs pointer-events-none truncate max-w-[90%]">
                                  {doc.side ?? `第${idx + 1}页`}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      {docVisual(g.main)}
                    </div>
                  )}
                </div>

                {/* 3. 标题与规格信息 */}
                <div className="flex items-center justify-between gap-1.5">
                  <div
                    className="fname !text-[14.5px] !font-semibold !text-[var(--ink)] tracking-tight truncate cursor-pointer hover:text-[var(--blue)] transition-colors"
                    title={g.title}
                    onClick={() => viewGroup(g)}
                  >
                    {g.title}
                  </div>
                  {g.hasMultiple && (
                    <span className="text-[10px] font-medium text-[var(--ink-faint)] bg-[var(--card-alt)] border border-[var(--line)] px-1.5 py-0.2 rounded shrink-0">
                      {g.docs.length === 2 ? "双面" : `${g.docs.length}页`}
                    </span>
                  )}
                </div>
                <div className="fmeta mono !text-[11px] !text-[var(--ink-faint)] !mt-0.5 flex items-center gap-1.5">
                  <span>{formatBytes(g.docs.reduce((s, d) => s + d.size, 0))}</span>
                  <span className="text-[var(--line-strong)]">·</span>
                  <span>{formatDate(g.main.createdAt)}</span>
                </div>

                {/* 4. 关键识别指标行（保证每张卡片高度绝对恒定） */}
                <div className="mt-2 h-[26px] flex items-center">
                  {primaryField ? (
                    <div className="flex items-center gap-1.5 max-w-full truncate">
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink)] bg-[var(--card-alt)] hover:bg-[var(--card)] border border-[var(--line)] px-2 py-0.5 rounded-md max-w-full truncate cursor-pointer transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailGroup(g);
                        }}
                      >
                        <span className="text-[var(--ink-faint)] shrink-0">{primaryField.label}:</span>
                        <span className="mono font-semibold truncate max-w-[130px]">{primaryField.value}</span>
                      </span>
                      {otherCount > 0 && (
                        <span
                          className="inline-flex items-center text-[10.5px] font-medium text-[#0071E3] bg-[#0071E3]/8 hover:bg-[#0071E3]/18 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors shrink-0"
                          title="查看完整结构化信息"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailGroup(g);
                          }}
                        >
                          +{otherCount} 项
                        </span>
                      )}
                    </div>
                  ) : g.docs.some((d) => d.certificate) ? (
                    (() => {
                      const cert = g.docs.find((d) => d.certificate)?.certificate;
                      if (!cert) return null;
                      return (
                        <div className="flex items-center gap-1.5 max-w-full truncate text-[11px]">
                          {cert.level && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/60 shrink-0">
                              {cert.level}
                            </span>
                          )}
                          {cert.org && (
                            <span className="truncate text-[var(--ink-faint)]" title={cert.org}>
                              {cert.org}
                            </span>
                          )}
                        </div>
                      );
                    })()
                  ) : g.main.note ? (
                    <div className="text-[11px] text-[var(--ink-faint)] truncate max-w-full">
                      📝 {g.main.note}
                    </div>
                  ) : g.main.metaMasked ? (
                    <div className="text-[11px] text-[var(--ink-faint)]">
                      🔒 验证后可见
                    </div>
                  ) : (
                    <div className="text-[11px] text-[var(--ink-faint)]">
                      —
                    </div>
                  )}
                </div>

                {/* 5. 底部操作栏 */}
                <div className="foot !mt-3 !pt-2.5 border-t border-[var(--line)] flex items-center justify-between">
                  <button
                    type="button"
                    className="inline-flex items-center text-[12px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] px-3 py-1 rounded-lg active:scale-95 transition-all shadow-xs"
                    onClick={() => viewGroup(g)}
                  >
                    查看
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--card-alt)] text-[11.5px] font-medium px-2 py-1 rounded-md transition-all"
                      onClick={() => downloadGroup(g)}
                    >
                      下载
                    </button>
                    <button
                      type="button"
                      className="text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--card-alt)] text-[11.5px] font-medium px-2 py-1 rounded-md transition-all"
                      onClick={() => openEditGroup(g)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="text-[var(--ink-faint)] hover:text-[var(--stamp)] hover:bg-red-500/10 text-[11.5px] font-medium px-1.5 py-1 rounded-md transition-all"
                      onClick={() => deleteGroup(g)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 上传弹窗 */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth={580}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setUploadOpen(false)}
          aria-label="关闭"
        >
          ✕
        </button>

        <form onSubmit={submitUpload}>
          <div className="flex items-center gap-3 mb-1.5 pr-8">
            <div className="ico-tile !mb-0 !w-10 !h-10 !text-xl shrink-0">
              {meta.dropIcon}
            </div>
            <div>
              <h3 className="modal-title">{meta.dropTitle}</h3>
            </div>
          </div>

          <div className="space-y-4 mt-4">
            {/* 文件选择区 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label !mb-0">
                  {isDualUpload ? "证件材料 *" : "选择文件 *"}
                </label>
                {isDualUpload && !isHousehold && sideFiles["front"] && sideFiles["back"] && (
                  <button
                    type="button"
                    onClick={swapDualSlots}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[#0071E3] hover:bg-[#0071E3]/10 transition-colors cursor-pointer"
                  >
                    <span>⇄</span>
                    <span>对调两面</span>
                  </button>
                )}
              </div>

              {isDualUpload && idSlots ? (
                <div className="space-y-2.5">
                  {isHousehold && (
                    <div className="flex items-center justify-between pb-0.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => document.getElementById("household-batch-input")?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0071E3]/10 hover:bg-[#0071E3]/15 text-[#0071E3] transition-colors cursor-pointer"
                        >
                          <span>📁</span>
                          <span>批量导入多页</span>
                        </button>
                        <input
                          id="household-batch-input"
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files) handleBatchHouseholdFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={addHouseholdSlot}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--card-alt)] hover:bg-[var(--card)] border border-[var(--line)] text-[var(--ink)] transition-colors cursor-pointer"
                      >
                        <span>+</span>
                        <span>添加成员页</span>
                      </button>
                    </div>
                  )}

                  {!isHousehold && isReversed && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs shadow-sm">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span>⚠️</span>
                        <span>{reverseBannerTitle}</span>
                      </div>
                      <button
                        type="button"
                        onClick={swapDualSlots}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors cursor-pointer"
                      >
                        <span>⇄</span>
                        <span>对调两面</span>
                      </button>
                    </div>
                  )}

                  <div className={`grid ${isHousehold ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"} gap-2.5`}>
                    {idSlots.map((slot) => {
                      const picked = sideFiles[slot.key] ?? null;
                      const preview = sidePreviews[slot.key];
                      const isOver = !!slotDragOver[slot.key];
                      const st = sideOcr[slot.key];
                      const mismatch = !isHousehold ? getSlotMismatch(slot.key, st?.detectedType, selectedChild?.key) : null;
                      const householdMismatch = isHousehold ? getHouseholdMismatch(slot, st?.detectedType) : null;
                      const targetSlotKey = mismatch?.targetSlotKey;
                      const targetEmpty = targetSlotKey ? !sideFiles[targetSlotKey] : false;
                      return (
                        <div
                          key={slot.key}
                          className={`dual-slot relative overflow-hidden ${isOver ? "dragover" : ""} ${mismatch?.isMismatch || householdMismatch?.isMismatch ? "slot-warning" : ""}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setSlotDragOver((prev) => ({ ...prev, [slot.key]: true }));
                          }}
                          onDragLeave={() => setSlotDragOver((prev) => ({ ...prev, [slot.key]: false }))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setSlotDragOver((prev) => ({ ...prev, [slot.key]: false }));
                            if (isHousehold && e.dataTransfer.files && e.dataTransfer.files.length > 1) {
                              handleBatchHouseholdFiles(e.dataTransfer.files);
                              return;
                            }
                            const f = e.dataTransfer.files?.[0] ?? null;
                            if (!f) return;
                            setSideFiles((s) => ({ ...s, [slot.key]: f }));
                            setSidePreviews((p) => {
                              if (p[slot.key]) URL.revokeObjectURL(p[slot.key]);
                              return {
                                ...p,
                                [slot.key]: f && f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
                              };
                            });
                            runSlotOcr(slot.key, f);
                          }}
                          onClick={() => document.getElementById(`slot-file-${slot.key}`)?.click()}
                        >
                          {preview ? (
                            <div className="dual-slot-preview-wrap">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={preview} alt={slot.label} className="dual-slot-img" />
                            </div>
                          ) : (
                            <div className="dual-slot-empty">
                              <span className="text-2xl">
                                {isHousehold
                                  ? slot.suffix === "首页"
                                    ? "🏛️"
                                    : slot.suffix === "户主页"
                                    ? "👑"
                                    : slot.suffix.includes("父") || slot.suffix.includes("母")
                                    ? "👥"
                                    : "👤"
                                  : slot.key === "front"
                                  ? "👤"
                                  : "🏛️"}
                              </span>
                              <span>{isOver ? "释放文件即可" : "点击或拖拽上传"}</span>
                            </div>
                          )}

                          <div>
                            <div className="dual-slot-head">
                              {isHousehold ? (
                                <div className="flex items-center justify-between w-full pr-1">
                                  <select
                                    value={slot.label}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      setHouseholdSlotRole(slot.key, e.target.value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[12px] font-semibold text-[var(--ink)] bg-[var(--card)] border-none outline-none cursor-pointer hover:text-[#0071E3] py-0.5"
                                  >
                                    {HOUSEHOLD_PAGE_ROLES.map((r) => (
                                      <option key={r.label} value={r.label}>
                                        {r.label}
                                      </option>
                                    ))}
                                  </select>
                                  {householdSlots.length > 1 && (
                                    <button
                                      type="button"
                                      className="text-black/35 hover:text-red-500 text-xs px-1 py-0.5 rounded cursor-pointer transition-colors"
                                      title="移除此槽位"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        removeHouseholdSlot(slot.key);
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="dual-slot-label">{slot.label}</span>
                              )}

                              {!isHousehold && (
                                mismatch?.isMismatch ? (
                                  <span className="dual-slot-badge badge-warning flex items-center gap-1">
                                    <span>⚠️</span>
                                    <span>检测为{mismatch.detectedLabel}</span>
                                  </span>
                                ) : slotQuality[slot.key] ? (
                                  <span className="dual-slot-badge badge-warning flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200">
                                    <span>⚠️</span>
                                    <span>{slotQuality[slot.key]}</span>
                                  </span>
                                ) : picked ? (
                                  <span className="dual-slot-badge">
                                    {st?.status === "running" ? "识别中…" : "已选"}
                                  </span>
                                ) : null
                              )}
                            </div>

                            {picked && <div className="dual-slot-file">{picked.name}</div>}

                            {isHousehold && (
                              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                {householdMismatch?.isMismatch ? (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="dual-slot-badge badge-warning flex items-center gap-1 text-[10px]">
                                      <span>⚠️</span>
                                      <span>检测为{householdMismatch.detectedLabel}</span>
                                    </span>
                                    {HOUSEHOLD_PAGE_ROLES.some((r) => r.label === householdMismatch.detectedLabel) && (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#0071E3] bg-[#0071E3]/10 hover:bg-[#0071E3]/20 px-1.5 py-0.5 rounded border border-[#0071E3]/20 transition-colors cursor-pointer"
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          setHouseholdSlotRole(slot.key, householdMismatch.detectedLabel);
                                        }}
                                      >
                                        <span>标为{householdMismatch.detectedLabel}</span>
                                        <span>✓</span>
                                      </button>
                                    )}
                                  </div>
                                ) : slotQuality[slot.key] ? (
                                  <span className="dual-slot-badge badge-warning flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200">
                                    <span>⚠️</span>
                                    <span>{slotQuality[slot.key]}</span>
                                  </span>
                                ) : picked ? (
                                  <span className="dual-slot-badge">
                                    {st?.status === "running" ? "识别中…" : "已选"}
                                  </span>
                                ) : null}
                              </div>
                            )}

                            {!isHousehold && mismatch?.isMismatch && targetEmpty && (
                              <div className="mt-1.5">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-md border border-amber-300 transition-colors cursor-pointer"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    moveSlot(slot.key, targetSlotKey!);
                                  }}
                                >
                                  <span>移至{mismatch.targetSlotLabel}</span>
                                  <span>→</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {picked && (
                            <>
                              {picked.type.startsWith("image/") && (
                                <button
                                  type="button"
                                  className="dual-slot-rotate"
                                  title="顺时针旋转90°"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    handleRotateSlot(slot.key);
                                  }}
                                >
                                  ↻
                                </button>
                              )}
                              <button
                                type="button"
                                className="dual-slot-clear"
                                title="移除"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setSideFiles((s) => ({ ...s, [slot.key]: null }));
                                  setSidePreviews((p) => {
                                    if (p[slot.key]) URL.revokeObjectURL(p[slot.key]);
                                    return { ...p, [slot.key]: "" };
                                  });
                                  setSideOcr((o) => ({ ...o, [slot.key]: { status: "idle", error: "", typeLabel: "" } }));
                                  setSideFields((m) => ({ ...m, [slot.key]: [] }));
                                }}
                              >
                                ✕
                              </button>
                            </>
                          )}
                          <input
                            id={`slot-file-${slot.key}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              if (!f) return;
                              setSideFiles((s) => ({ ...s, [slot.key]: f }));
                              setSidePreviews((p) => {
                                if (p[slot.key]) URL.revokeObjectURL(p[slot.key]);
                                return {
                                  ...p,
                                  [slot.key]: f && f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
                                };
                              });
                              runSlotOcr(slot.key, f);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : files.length === 1 ? (
                <div className="file-card-selected">
                  {filePreviews[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={filePreviews[0]} alt="" className="file-card-thumb" />
                  ) : (
                    <div className="file-card-thumb-placeholder">
                      {files[0].type === "application/pdf" ? "📕" : "📎"}
                    </div>
                  )}
                  <div className="file-card-info">
                    <div className="file-card-name">{files[0].name}</div>
                    <div className="file-card-hint flex items-center gap-1.5 flex-wrap">
                      <span className="mono font-medium">{formatBytes(files[0].size)}</span>
                      <span>·</span>
                      <span>{files[0].type === "application/pdf" ? "PDF 文档" : "图片文件"}</span>
                      {qualityIssue && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px] font-medium">
                            <span>⚠️</span>
                            <span>{qualityIssue}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="file-card-actions">
                    {files[0].type.startsWith("image/") && (
                      <button
                        type="button"
                        className="file-card-rotate-btn"
                        title="顺时针旋转90°"
                        onClick={() => handleRotateFile(0)}
                      >
                        ↻ 旋转
                      </button>
                    )}
                    <button
                      type="button"
                      className="file-card-change-btn"
                      onClick={() => singleFileInputRef.current?.click()}
                    >
                      ＋ 添加文件
                    </button>
                    <button
                      type="button"
                      className="file-card-clear"
                      title="移除文件"
                      onClick={clearAllFiles}
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    ref={singleFileInputRef}
                    id="single-file-input"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        addFiles(Array.from(e.target.files));
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </div>
              ) : files.length > 1 ? (
                <div
                  className={`rounded-2xl border ${singleDragOver ? "border-[#0071e3] bg-[#0071e3]/[0.02]" : "border-[var(--line)] bg-[var(--card)]"} overflow-hidden shadow-2xs transition-colors`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setSingleDragOver(true);
                  }}
                  onDragLeave={() => setSingleDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setSingleDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      addFiles(Array.from(e.dataTransfer.files));
                    }
                  }}
                >
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--card-alt)] border-b border-[var(--line)]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--ink)]">
                        已选 {files.length} 个文件
                      </span>
                      <span className="text-[11px] font-mono text-[var(--ink-faint)]">
                        {formatBytes(files.reduce((s, f) => s + f.size, 0))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => singleFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/10 rounded-lg transition cursor-pointer"
                      >
                        <span>＋</span>
                        <span>添加文件</span>
                      </button>
                      <button
                        type="button"
                        onClick={clearAllFiles}
                        className="text-[11px] font-medium text-[var(--ink-faint)] hover:text-[#e03131] px-1.5 py-1 rounded transition cursor-pointer"
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto divide-y divide-[var(--line)] p-1.5 space-y-1">
                    {files.map((f, idx) => {
                      const prev = filePreviews[idx];
                      return (
                        <div
                          key={`${f.name}-${idx}-${f.size}`}
                          className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-[var(--card-alt)] transition"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {prev ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={prev}
                                alt=""
                                className="w-8 h-8 rounded-lg object-cover border border-[var(--line)] flex-shrink-0 bg-[var(--card-alt)]"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-lg border border-[var(--line)] bg-[var(--card-alt)] flex items-center justify-center text-sm flex-shrink-0">
                                {f.type === "application/pdf" ? "📕" : "📎"}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[var(--ink)] truncate max-w-[240px] sm:max-w-[320px]">
                                {f.name}
                              </div>
                              <div className="text-[10.5px] font-mono text-[var(--ink-faint)] flex items-center gap-1.5">
                                <span>{formatBytes(f.size)}</span>
                                {idx === 0 && qualityIssue && (
                                  <span className="inline-flex items-center gap-0.5 text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 text-[10px] font-medium">
                                    <span>⚠️</span>
                                    <span>{qualityIssue}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {f.type.startsWith("image/") && (
                              <button
                                type="button"
                                onClick={() => handleRotateFile(idx)}
                                className="w-6 h-6 flex items-center justify-center text-[var(--ink-faint)] hover:text-[#0071e3] rounded hover:bg-[var(--card-alt)] transition cursor-pointer text-xs"
                                title="顺时针旋转90°"
                              >
                                ↻
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeFileAt(idx)}
                              className="w-6 h-6 flex items-center justify-center text-[var(--ink-faint)] hover:text-[#e03131] rounded hover:bg-[var(--card-alt)] transition cursor-pointer text-xs"
                              title="移除"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <input
                    ref={singleFileInputRef}
                    id="single-file-input"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        addFiles(Array.from(e.target.files));
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </div>
              ) : (
                <div
                  className={`upload-drop-single ${singleDragOver ? "dragover" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setSingleDragOver(true);
                  }}
                  onDragLeave={() => setSingleDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setSingleDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      addFiles(Array.from(e.dataTransfer.files));
                    }
                  }}
                  onClick={() => singleFileInputRef.current?.click()}
                >
                  <div className="upload-drop-icon">📁</div>
                  <div className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
                    {singleDragOver ? "释放鼠标即可放入文件" : "点击或拖拽文件到此处"}
                  </div>
                  <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                    支持 JPG · PNG · WebP · HEIC · PDF（最大 20MB）
                  </div>
                  <input
                    ref={singleFileInputRef}
                    id="single-file-input"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        addFiles(Array.from(e.target.files));
                      }
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {(key === "certificate" || key === "experience") && files.length === 1 && (
              (ocrStatus === "running" || aiStatus === "running") ? (
                <div className="ocr-status flex items-center gap-2">
                  <ThinkingOrb state="working" size={20} />
                  <span>正在解析…</span>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[12.5px] text-[var(--ink-soft)] px-1 py-1">
                  <span className="flex items-center gap-1.5 text-xs">
                    {aiStatus === "done" ? (
                      <span className="text-[#34C759] font-medium">✓ 智能解析完成</span>
                    ) : certOrg && certDate ? (
                      <span className="text-[#34C759] font-medium">✓ 字段已识别</span>
                    ) : (
                      <span className="text-[var(--ink-faint)]">可核对或补充下方字段</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (files[0]) {
                        inferCertificateFields(files[0].name, ocrTextRef.current || "");
                        void runAiExtract(files[0], ocrTextRef.current || "");
                      }
                    }}
                    className="text-[var(--blue)] hover:underline cursor-pointer font-medium text-xs"
                  >
                    重新识别
                  </button>
                </div>
              )
            )}

            {/* 证件本地识别结果：每个面独立展示，字段逐行可编辑，随 meta 保存 */}
            {key === "identity" && !isDualUpload && (
              <div className="fields-panel">
                <div className="fields-panel-head">
                  <span className="fields-panel-title">识别字段</span>
                </div>
                {ocrStatus === "running" && (
                  <div className="ocr-status flex items-center gap-2">
                    <ThinkingOrb state="searching" size={20} />
                    <span>正在识别…</span>
                  </div>
                )}
                {ocrStatus === "error" && (
                  <div className="fields-empty" style={{ color: "var(--stamp)" }}>
                    识别未成功{ocrError ? `（${ocrError}）` : ""}
                  </div>
                )}
                {ocrStatus === "done" && (
                  <>
                    {docRec && docRec.type !== "unknown" && (
                      <div className="ocr-status mb-2">
                        <span><b style={{ color: "var(--ink)" }}>{docRec.typeLabel}</b></span>
                      </div>
                    )}
                    <FieldRows
                      fields={recFields}
                      onChange={setRecFields}
                    />
                  </>
                )}
              </div>
            )}

            {isDualUpload && idSlots && (
              <div className="space-y-3">
                {idSlots.map((slot) => {
                  const st = sideOcr[slot.key];
                  const fields = sideFields[slot.key] ?? [];
                  const hasFile = !!sideFiles[slot.key];
                  if (!hasFile || !st || st.status === "idle") return null;
                  return (
                    <div className="fields-panel" key={slot.key}>
                      <div className="fields-panel-head">
                        <span className="fields-panel-title">{slot.label}</span>
                        <div className="flex items-center gap-2">
                          {(isHousehold
                            ? getHouseholdMismatch(slot, st.detectedType)?.isMismatch
                            : getSlotMismatch(slot.key, st.detectedType, selectedChild?.key)?.isMismatch) && (
                            <span className="text-[11px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                              版式不符
                            </span>
                          )}
                          {st.typeLabel && <span className="fields-panel-sub">{st.typeLabel}</span>}
                        </div>
                      </div>
                      {st.status === "running" && (
                        <div className="ocr-status flex items-center gap-2">
                          <ThinkingOrb state="searching" size={20} />
                          <span>正在识别…</span>
                        </div>
                      )}
                      {st.status === "error" && (
                        <div className="fields-empty" style={{ color: "var(--stamp)" }}>
                          识别未成功{st.error ? `（${st.error}）` : ""}
                        </div>
                      )}
                      {st.status === "done" && (
                        <FieldRows
                          fields={fields}
                          onChange={(next) => setSideFields((m) => ({ ...m, [slot.key]: next }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 子分类 */}
            <div>
              <label className="label">所属子分类 *</label>
              <ChipGroup
                name="子分类"
                value={subCategory}
                onChange={setSubCategory}
                options={(mainCategory?.children ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
              {!subCategory && (
                <div className="fields-empty text-red-500">请选择一个子分类</div>
              )}
            </div>

            {/* 标题 & 备注 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">材料标题</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={files.length > 1 ? "默认使用各文件名" : "材料标题"}
                  className="input"
                />
              </div>
              <div>
                <label className="label">备注</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="备注"
                  className="input"
                />
              </div>
            </div>

            {/* 证书附加登记 */}
            {isCertCategory && (
              <div className="rounded-xl p-3.5" style={{ background: "rgba(176,141,61,.08)", border: "1px solid rgba(176,141,61,.25)" }}>
                <Toggle
                  checked={withCert}
                  onChange={setWithCert}
                  label="同时登记证书总目"
                />
                {withCert && (
                  <div className="mt-3 space-y-2.5 pt-2" style={{ borderTop: "1px dashed rgba(176,141,61,.2)" }}>
                    <input
                      value={certOrg}
                      onChange={(e) => setCertOrg(e.target.value)}
                      placeholder="颁发单位 *"
                      className="input"
                    />
                    <div>
                      <label className="label">证书级别</label>
                      <ChipGroup
                        name="证书级别"
                        value={certLevel}
                        onChange={setCertLevel}
                        options={LEVELS.map((l) => ({ value: l, label: l }))}
                      />
                    </div>
                    <div>
                      <label className="label">获得时间 *</label>
                      <input
                        type="date"
                        value={certDate}
                        onChange={(e) => setCertDate(e.target.value)}
                        className="input"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {uploadError && <div className="alert-error">{uploadError}</div>}

            {/* 底部操作按钮 */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="btn btn-ghost flex-1 !py-2.5"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="btn btn-ink flex-1 !py-2.5"
              >
                {uploading
                  ? uploadProgress.total > 1
                    ? `正在归档 (${uploadProgress.current}/${uploadProgress.total})…`
                    : "正在归档…"
                  : "确认归档"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={!!editDoc} onClose={() => setEditDoc(null)}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setEditDoc(null)}
          aria-label="关闭"
        >
          ✕
        </button>
        <form onSubmit={submitEdit}>
          <h3 className="modal-title mb-4">编辑材料信息</h3>
          <div className="space-y-3.5">
            {editGroupDocs.length > 0 && (
              <div className="space-y-2 p-3 rounded-xl border border-[var(--line)] bg-[var(--card-alt)] max-h-[260px] overflow-y-auto">
                {editGroupDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3.5">
                    <div className="relative w-16 h-14 rounded-lg overflow-hidden bg-[var(--card)] border border-[var(--line)] flex items-center justify-center p-0.5 shrink-0">
                      {docVisual(d)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[var(--ink)] truncate">
                        {d.side || d.title}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        {d.mimeType !== "application/pdf" && (
                          <>
                            <button
                              type="button"
                              disabled={rotatingDocId === d.id}
                              onClick={() => handleQuickRotate(d, 90)}
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#0071E3] hover:text-[#0077ED] bg-[#0071E3]/10 hover:bg-[#0071E3]/15 px-2.5 py-1 rounded-md transition-all active:scale-95 cursor-pointer"
                            >
                              {rotatingDocId === d.id ? (
                                <div className="w-3 h-3 border-2 border-[#0071E3]/30 border-t-[#0071E3] rounded-full animate-spin" />
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21.5 2v6h-6" />
                                  <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                </svg>
                              )}
                              旋转 90°
                            </button>
                            <button
                              type="button"
                              disabled={rotatingDocId === d.id}
                              onClick={() => handleQuickRotate(d, 180)}
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--card-alt)] px-2.5 py-1 rounded-md transition-all active:scale-95 cursor-pointer border border-[var(--line)]"
                            >
                              旋转 180°
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={deletingDocId === d.id}
                          onClick={() => handleDeleteDocInEdit(d)}
                          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#FF3B30] hover:text-[#D70015] bg-[#FF3B30]/10 hover:bg-[#FF3B30]/15 px-2.5 py-1 rounded-md transition-all active:scale-95 cursor-pointer"
                          title="删除此页材料"
                        >
                          {deletingDocId === d.id ? (
                            <div className="w-3 h-3 border-2 border-[#FF3B30]/30 border-t-[#FF3B30] rounded-full animate-spin" />
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="label">标题</label>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="input" required />
            </div>
            <div>
              <label className="label">备注</label>
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">子分类</label>
              <ChipGroup
                name="子分类"
                value={editChild}
                onChange={setEditChild}
                options={(mainCategory?.children ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setEditDoc(null)} className="btn btn-ghost flex-1">
                取消
              </button>
              <button type="submit" className="btn btn-ink flex-1">
                保存
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 结构化识别信息详情弹窗 */}
      <Modal open={!!detailGroup} onClose={() => setDetailGroup(null)} maxWidth={460}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setDetailGroup(null)}
          aria-label="关闭"
        >
          ✕
        </button>
        {detailGroup && (() => {
          const docsWithFields = detailGroup.docs.map((d) => ({
            doc: d,
            fields: parseDocMeta(d.meta),
          }));
          const allFields = docsWithFields.flatMap((x) => x.fields);
          const hasMultipleSides = detailGroup.docs.length > 1;

          return (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="modal-title !mb-0">{detailGroup.title}</h3>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
                  style={{
                    color: "var(--accent, #0071E3)",
                    background: "color-mix(in srgb, var(--accent, #0071E3) 10%, transparent)",
                  }}
                >
                  {detailGroup.main.category.name}
                </span>
                {detailGroup.hasMultiple && (
                  <span className="text-[10px] font-medium text-[var(--ink-faint)] bg-[var(--card-alt)] border border-[var(--line)] px-1.5 py-0.5 rounded">
                    {detailGroup.docs.length === 2 ? "双面" : `${detailGroup.docs.length}页`}
                  </span>
                )}
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {hasMultipleSides ? (
                  docsWithFields.map(({ doc, fields }, idx) => (
                    <div key={doc.id} className="space-y-2">
                      <div className="text-[12px] font-semibold text-[var(--ink-faint)] border-b border-[var(--line)] pb-1 flex items-center justify-between">
                        <span>{doc.side ?? (idx === 0 ? "正面" : "反面")}</span>
                        <span className="mono text-[11px] font-normal">{formatBytes(doc.size)}</span>
                      </div>
                      {fields.length > 0 ? (
                        <div className="space-y-1.5">
                          {fields.map((f, fi) => (
                            <div
                              key={fi}
                              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--card-alt)] border border-[var(--line)] text-[12.5px]"
                            >
                              <span className="text-[var(--ink-faint)] shrink-0">{f.label}</span>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="mono font-semibold text-[var(--ink)] truncate select-all">
                                  {f.value}
                                </span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await copyText(f.value);
                                    setCopiedField(f.value);
                                    setTimeout(() => setCopiedField(null), 1800);
                                  }}
                                  className="text-[11px] font-medium text-[#0071E3] hover:underline shrink-0 px-1"
                                >
                                  {copiedField === f.value ? "已复制" : "复制"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[12px] text-[var(--ink-faint)] py-1">
                          {doc.metaMasked ? "🔒 需二次验证" : "暂无结构化字段"}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="space-y-1.5">
                    {allFields.length > 0 ? (
                      allFields.map((f, fi) => (
                        <div
                          key={fi}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--card-alt)] border border-[var(--line)] text-[12.5px]"
                        >
                          <span className="text-[var(--ink-faint)] shrink-0">{f.label}</span>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="mono font-semibold text-[var(--ink)] truncate select-all">
                              {f.value}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await copyText(f.value);
                                setCopiedField(f.value);
                                setTimeout(() => setCopiedField(null), 1800);
                              }}
                              className="text-[11px] font-medium text-[#0071E3] hover:underline shrink-0 px-1"
                            >
                              {copiedField === f.value ? "已复制" : "复制"}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-[12px] text-[var(--ink-faint)] py-1">
                        {detailGroup.main.metaMasked ? "🔒 需二次验证" : "暂无结构化字段"}
                      </div>
                    )}
                  </div>
                )}

                {detailGroup.main.note && (
                  <div className="p-2 rounded-lg bg-[var(--card-alt)] border border-[var(--line)] text-[12.5px]">
                    <span className="text-[var(--ink-faint)] block text-[11px] mb-0.5">备注</span>
                    <span className="text-[var(--ink)]">{detailGroup.main.note}</span>
                  </div>
                )}

                {(key === "experience" || key === "certificate") && (
                  <div className="p-3 rounded-xl bg-[#0071E3]/[0.03] border border-[#0071E3]/15 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--ink)]">简历表达</span>
                      <button
                        type="button"
                        onClick={() => generateResumeBullet(detailGroup)}
                        disabled={generatingBullet}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0071E3] hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        {generatingBullet ? "生成中…" : resumeBullet ? "重新生成" : "生成"}
                      </button>
                    </div>
                    {resumeBullet ? (
                      <div className="flex items-start justify-between gap-2 p-2 rounded-lg bg-[var(--card)] border border-[var(--line-strong)] text-[12.5px] leading-relaxed">
                        <span className="text-[var(--ink)]">{resumeBullet}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await copyText(resumeBullet);
                            setCopiedField(resumeBullet);
                            setTimeout(() => setCopiedField(null), 1800);
                          }}
                          className="text-[11px] font-medium text-[#0071E3] hover:underline shrink-0 px-1 pt-0.5"
                        >
                          {copiedField === resumeBullet ? "已复制" : "复制"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-[var(--line)] mt-4">
                <button
                  type="button"
                  onClick={() => setDetailGroup(null)}
                  className="btn btn-ghost flex-1"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const g = detailGroup;
                    setDetailGroup(null);
                    viewGroup(g);
                  }}
                  className="btn btn-ink flex-1"
                >
                  查看材料
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 图片浏览器：专属加密视窗 */}
      {viewer && viewer.docs.length > 0 && (
        <ImageViewer
          docs={viewer.docs}
          index={Math.min(viewer.index, viewer.docs.length - 1)}
          thumbs={thumbs}
          onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewer(null)}
          onDownload={(vd) => {
            const d = docs.find((x) => x.id === vd.id);
            if (d) void openDoc(d);
          }}
          onDownloadAll={() => {
            const first = docs.find((x) => x.id === viewer.docs[0]?.id);
            if (first) {
              void withSensitiveGate(first, async () => {
                for (const vd of viewer.docs) {
                  const d = docs.find((x) => x.id === vd.id);
                  if (d) await openDoc(d);
                }
              });
            }
          }}
          onRequestVerify={() => {
            setVerifyOpen(true);
          }}
          verifyTick={verifyTick}
          onRotated={handleDocRotated}
        />
      )}

      <SensitiveVerifyModal
        open={verifyOpen}
        onClose={() => {
          setVerifyOpen(false);
          pendingAction.current = null;
        }}
        onSuccess={async () => {
          setVerifyOpen(false);
          setVerifyTick(Date.now());
          const action = pendingAction.current;
          pendingAction.current = null;
          if (action) {
            try {
              await action();
            } catch (err) {
              console.error("Execute pending action error:", err);
            }
          }
          await load(); // 重新拉取：敏感证件的脱敏字段在验证窗口内恢复明文
        }}
      />

      <ConfirmModal
        open={!!confirmDeleteGroup}
        danger
        icon="🗑️"
        title="删除材料？"
        description={
          confirmDeleteGroup
            ? `确定删除「${confirmDeleteGroup.title}」吗？`
            : undefined
        }
        confirmText="彻底删除"
        cancelText="取消"
        loading={deleting}
        onClose={() => setConfirmDeleteGroup(null)}
        onConfirm={executeDeleteGroup}
      />

      <ConfirmModal
        open={!!confirmDeleteDocItem}
        danger
        icon="🗑️"
        zIndex={60}
        title="删除此页材料？"
        description={
          confirmDeleteDocItem
            ? `确定删除「${confirmDeleteDocItem.side || confirmDeleteDocItem.title}」吗？`
            : undefined
        }
        confirmText="彻底删除"
        cancelText="取消"
        loading={deletingDocId !== null}
        onClose={() => setConfirmDeleteDocItem(null)}
        onConfirm={executeDeleteSingleDoc}
      />
    </div>
  );
}
