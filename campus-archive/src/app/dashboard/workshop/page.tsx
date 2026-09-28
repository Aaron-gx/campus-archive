"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, api } from "@/lib/format";
import { showToast } from "@/components/ui/alert-toast";
import Modal from "@/components/Modal";
import { encryptBytes, isUnlocked } from "@/lib/e2ee";
import {
  Upload,
  FolderOpen,
  Download,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  X,
  Image as ImageIcon,
  Lock,
  Unlock,
  Search,
} from "lucide-react";

interface Preset {
  id: string;
  name: string;
  width?: number;
  height?: number;
}

const PRESETS: Preset[] = [
  { id: "orig", name: "原尺寸" },
  { id: "1inch", name: "一寸", width: 295, height: 413 },
  { id: "2inch", name: "二寸", width: 413, height: 579 },
  { id: "small2inch", name: "小二寸", width: 390, height: 567 },
  { id: "exam", name: "考研/公考", width: 300, height: 400 },
  { id: "teacher", name: "教资", width: 240, height: 320 },
  { id: "custom", name: "自定义" },
];

const TARGET_KB_OPTIONS = [
  { id: "none", label: "不限" },
  { id: "20", label: "20 KB", kb: 20 },
  { id: "50", label: "50 KB", kb: 50 },
  { id: "100", label: "100 KB", kb: 100 },
  { id: "200", label: "200 KB", kb: 200 },
  { id: "custom", label: "自定义" },
];

interface ArchiveDoc {
  id: string;
  title: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: string;
  category: { name: string };
}

interface CategoryOption {
  id: string;
  name: string;
  key: string;
  sensitive?: boolean;
  children?: { id: string; name: string; key: string; sensitive?: boolean }[];
}

function buildPdfFromJpeg(
  jpegBytes: Uint8Array,
  imgWidth: number,
  imgHeight: number,
  pageSize: "auto" | "a4_p" | "a4_l" = "auto"
): Uint8Array {
  let pageW = Math.round((imgWidth * 72) / 150);
  let pageH = Math.round((imgHeight * 72) / 150);
  let renderX = 0;
  let renderY = 0;
  let renderW = pageW;
  let renderH = pageH;

  if (pageSize === "a4_p") {
    pageW = 595;
    pageH = 842;
    const scale = Math.min((pageW - 40) / imgWidth, (pageH - 40) / imgHeight);
    renderW = Math.round(imgWidth * scale);
    renderH = Math.round(imgHeight * scale);
    renderX = Math.round((pageW - renderW) / 2);
    renderY = Math.round((pageH - renderH) / 2);
  } else if (pageSize === "a4_l") {
    pageW = 842;
    pageH = 595;
    const scale = Math.min((pageW - 40) / imgWidth, (pageH - 40) / imgHeight);
    renderW = Math.round(imgWidth * scale);
    renderH = Math.round(imgHeight * scale);
    renderX = Math.round((pageW - renderW) / 2);
    renderY = Math.round((pageH - renderH) / 2);
  }

  const contentStream = `q\n${renderW} 0 0 ${renderH} ${renderX} ${renderY} cm\n/Im0 Do\nQ\n`;
  const contentBytes = new TextEncoder().encode(contentStream);

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let currentOffset = 0;

  function pushString(str: string) {
    const b = new TextEncoder().encode(str);
    parts.push(b);
    currentOffset += b.length;
  }

  function pushBytes(b: Uint8Array) {
    parts.push(b);
    currentOffset += b.length;
  }

  pushString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  offsets[1] = currentOffset;
  pushString("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets[2] = currentOffset;
  pushString("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  offsets[3] = currentOffset;
  pushString(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  offsets[4] = currentOffset;
  pushString(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushString("\nendstream\nendobj\n");

  offsets[5] = currentOffset;
  pushString(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  pushBytes(contentBytes);
  pushString("endstream\nendobj\n");

  const startXref = currentOffset;
  pushString(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) {
    const offStr = String(offsets[i]).padStart(10, "0");
    pushString(`${offStr} 00000 n \n`);
  }

  pushString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

  const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

export default function WorkshopPage() {
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [sourceSize, setSourceSize] = useState<number>(0);

  const [format, setFormat] = useState<"jpg" | "png" | "webp" | "pdf">("jpg");
  const [preset, setPreset] = useState<string>("orig");
  const [customWidth, setCustomWidth] = useState<number>(800);
  const [customHeight, setCustomHeight] = useState<number>(600);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [aspectRatio, setAspectRatio] = useState<number>(1);
  const [fitMode, setFitMode] = useState<"cover" | "contain" | "stretch">("cover");

  const [pdfPage, setPdfPage] = useState<"auto" | "a4_p" | "a4_l">("auto");
  const [kbMode, setKbMode] = useState<string>("none");
  const [customKb, setCustomKb] = useState<number>(50);
  const [quality, setQuality] = useState<number>(92);

  const [rotation, setRotation] = useState<number>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);

  const [processing, setProcessing] = useState<boolean>(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputWidth, setOutputWidth] = useState<number>(0);
  const [outputHeight, setOutputHeight] = useState<number>(0);
  const [outputSize, setOutputSize] = useState<number>(0);

  const outputUrlRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveDocs, setArchiveDocs] = useState<ArchiveDoc[]>([]);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveCategoryId, setSaveCategoryId] = useState("");
  const [saveIsSensitive, setSaveIsSensitive] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [savingArchive, setSavingArchive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageLoaded = useCallback((img: HTMLImageElement, name: string, size: number) => {
    setSourceImg(img);
    setSourceName(name);
    setSourceSize(size);
    setCustomWidth(img.naturalWidth);
    setCustomHeight(img.naturalHeight);
    setAspectRatio(img.naturalWidth / img.naturalHeight);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast.error("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        handleImageLoaded(img, file.name, file.size);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [handleImageLoaded]);

  const loadFromBlob = useCallback(async (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      handleImageLoaded(img, name, blob.size);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [handleImageLoaded]);

  const openArchivePicker = useCallback(async () => {
    setArchiveModalOpen(true);
    setArchiveLoading(true);
    try {
      const res = await api<{ documents: ArchiveDoc[] }>("/api/documents");
      const filtered = (res.documents || []).filter(
        (d) => d.mimeType.startsWith("image/") || (!d.mimeType.includes("pdf") && !d.fileName.endsWith(".pdf"))
      );
      setArchiveDocs(filtered);
    } catch {
      showToast.error("加载档案失败");
    } finally {
      setArchiveLoading(false);
    }
  }, []);

  const selectArchiveDoc = useCallback(async (doc: ArchiveDoc) => {
    setArchiveModalOpen(false);
    try {
      const res = await fetch(`/api/documents/${doc.id}/file`);
      if (!res.ok) throw new Error("获取文件失败");
      const blob = await res.blob();
      await loadFromBlob(blob, doc.fileName || `${doc.title}.jpg`);
    } catch {
      showToast.error("读取档案文件失败");
    }
  }, [loadFromBlob]);

  const targetDimensions = useMemo(() => {
    if (!sourceImg) return { w: 0, h: 0 };
    const p = PRESETS.find((item) => item.id === preset);
    let rawW = sourceImg.naturalWidth;
    let rawH = sourceImg.naturalHeight;

    if (rotation % 180 !== 0) {
      const tmp = rawW;
      rawW = rawH;
      rawH = tmp;
    }

    if (preset === "orig" || !p) {
      return { w: rawW, h: rawH };
    }
    if (preset === "custom") {
      return { w: Math.max(10, customWidth || 10), h: Math.max(10, customHeight || 10) };
    }
    return { w: p.width!, h: p.height! };
  }, [sourceImg, preset, customWidth, customHeight, rotation]);

  const targetW = targetDimensions.w;
  const targetH = targetDimensions.h;

  const handleCustomWidthChange = (val: number) => {
    setCustomWidth(val);
    if (lockAspect && aspectRatio > 0) {
      setCustomHeight(Math.round(val / aspectRatio));
    }
  };

  const handleCustomHeightChange = (val: number) => {
    setCustomHeight(val);
    if (lockAspect && aspectRatio > 0) {
      setCustomWidth(Math.round(val * aspectRatio));
    }
  };

  const generateOutput = useCallback(async () => {
    if (!sourceImg || targetW <= 0 || targetH <= 0) return;
    setProcessing(true);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (format === "jpg" || format === "pdf") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, targetW, targetH);
      } else {
        ctx.clearRect(0, 0, targetW, targetH);
      }

      ctx.save();
      ctx.translate(targetW / 2, targetH / 2);
      if (rotation !== 0) {
        ctx.rotate((rotation * Math.PI) / 180);
      }
      if (flipH || flipV) {
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }

      const sw = sourceImg.naturalWidth;
      const sh = sourceImg.naturalHeight;

      let dw = targetW;
      let dh = targetH;
      if (rotation % 180 !== 0) {
        dw = targetH;
        dh = targetW;
      }

      let drawX = -dw / 2;
      let drawY = -dh / 2;
      let drawW = dw;
      let drawH = dh;

      if (fitMode === "cover") {
        const scale = Math.max(dw / sw, dh / sh);
        drawW = sw * scale;
        drawH = sh * scale;
        drawX = -drawW / 2;
        drawY = -drawH / 2;
      } else if (fitMode === "contain") {
        const scale = Math.min(dw / sw, dh / sh);
        drawW = sw * scale;
        drawH = sh * scale;
        drawX = -drawW / 2;
        drawY = -drawH / 2;
      }

      ctx.drawImage(sourceImg, drawX, drawY, drawW, drawH);
      ctx.restore();

      const targetMime =
        format === "png"
          ? "image/png"
          : format === "webp"
            ? "image/webp"
            : "image/jpeg";

      let finalBlob: Blob | null = null;
      let previewBlob: Blob | null = null;
      const targetKb = kbMode === "custom" ? customKb : Number(kbMode);

      if (kbMode !== "none" && !Number.isNaN(targetKb) && targetKb > 0 && format !== "png") {
        const targetBytes = targetKb * 1024;
        let minQ = 0.05;
        let maxQ = 0.98;
        let bestBlob: Blob | null = null;

        for (let i = 0; i < 7; i++) {
          const midQ = (minQ + maxQ) / 2;
          const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, targetMime, midQ)
          );
          if (!blob) break;

          if (blob.size <= targetBytes) {
            bestBlob = blob;
            minQ = midQ;
          } else {
            maxQ = midQ;
          }
        }

        if (!bestBlob || bestBlob.size > targetBytes) {
          let scale = 0.85;
          while (scale >= 0.3) {
            const sc = document.createElement("canvas");
            sc.width = Math.round(canvas.width * scale);
            sc.height = Math.round(canvas.height * scale);
            const sctx = sc.getContext("2d");
            if (sctx) {
              sctx.imageSmoothingQuality = "high";
              sctx.drawImage(canvas, 0, 0, sc.width, sc.height);
              const sb = await new Promise<Blob | null>((res) =>
                sc.toBlob(res, targetMime, 0.7)
              );
              if (sb && sb.size <= targetBytes) {
                bestBlob = sb;
                break;
              }
            }
            scale -= 0.15;
          }
        }

        finalBlob =
          bestBlob ||
          (await new Promise<Blob | null>((res) => canvas.toBlob(res, targetMime, 0.1)));
        previewBlob = finalBlob;
      } else {
        const q = format === "png" ? undefined : quality / 100;
        finalBlob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, targetMime, q)
        );
        previewBlob = finalBlob;
      }

      if (!finalBlob) throw new Error("生成图片失败");

      if (format === "pdf") {
        const jpegBlob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", 0.95)
        );
        if (!jpegBlob) throw new Error("生成 PDF 图像失败");
        previewBlob = jpegBlob;
        const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
        const pdfBytes = buildPdfFromJpeg(jpegBytes, targetW, targetH, pdfPage);
        finalBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      }

      if (outputUrlRef.current) {
        URL.revokeObjectURL(outputUrlRef.current);
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      const oUrl = URL.createObjectURL(finalBlob);
      const pUrl = previewBlob ? URL.createObjectURL(previewBlob) : oUrl;
      outputUrlRef.current = oUrl;
      previewUrlRef.current = pUrl;

      setOutputBlob(finalBlob);
      setOutputUrl(oUrl);
      setPreviewUrl(pUrl);
      setOutputWidth(targetW);
      setOutputHeight(targetH);
      setOutputSize(finalBlob.size);
    } catch (err) {
      console.error(err);
      showToast.error("处理失败");
    } finally {
      setProcessing(false);
    }
  }, [
    sourceImg,
    targetW,
    targetH,
    format,
    fitMode,
    rotation,
    flipH,
    flipV,
    kbMode,
    customKb,
    quality,
    pdfPage,
  ]);

  useEffect(() => {
    if (!sourceImg) return;
    const timer = setTimeout(() => {
      void generateOutput();
    }, 150);
    return () => clearTimeout(timer);
  }, [generateOutput, sourceImg]);

  const handleDownload = () => {
    if (!outputBlob || !outputUrl) return;
    const base = (sourceName.replace(/\.[^/.]+$/, "") || "image").trim();
    const ext = format === "pdf" ? "pdf" : format === "png" ? "png" : format === "webp" ? "webp" : "jpg";
    const filename = `${base}_processed.${ext}`;

    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const openSaveArchiveModal = async () => {
    if (!outputBlob) return;
    const base = (sourceName.replace(/\.[^/.]+$/, "") || "图片").trim();
    setSaveTitle(base);
    setSaveModalOpen(true);
    try {
      const res = await api<{ categories: CategoryOption[] }>("/api/categories");
      setCategories(res.categories || []);
      const firstLeaf = res.categories?.[0]?.children?.[0]?.id || res.categories?.[0]?.id || "";
      setSaveCategoryId(firstLeaf);
    } catch {
      showToast.error("加载分类失败");
    }
  };

  const isSensitiveCategory = useMemo(() => {
    for (const c of categories) {
      if (c.id === saveCategoryId && c.sensitive) return true;
      if (c.children?.some((child) => child.id === saveCategoryId && (c.sensitive || child.sensitive))) return true;
    }
    return false;
  }, [categories, saveCategoryId]);

  const handleSaveToArchive = async () => {
    if (!outputBlob || !saveCategoryId || !saveTitle.trim()) {
      showToast.error("请完善保存信息");
      return;
    }
    setSavingArchive(true);
    try {
      const ext = format === "pdf" ? "pdf" : format === "png" ? "png" : format === "webp" ? "webp" : "jpg";
      const fileName = `${saveTitle.trim()}.${ext}`;
      const shouldEncrypt = saveIsSensitive || isSensitiveCategory;

      let fileToUpload: Blob = outputBlob;
      const headers: Record<string, string> = {};

      if (shouldEncrypt) {
        if (!isUnlocked()) {
          throw new Error("端到端加密环境未就绪或未解锁，请重新登录");
        }
        const plainBytes = new Uint8Array(await outputBlob.arrayBuffer());
        const encryptedBytes = await encryptBytes(plainBytes);
        if (!encryptedBytes) {
          throw new Error("材料客户端加密失败");
        }
        fileToUpload = new Blob([encryptedBytes as BlobPart], { type: "application/octet-stream" });
        headers["x-e2ee"] = "1";
      }

      const file = new File([fileToUpload], fileName, { type: fileToUpload.type });

      const form = new FormData();
      form.append("file", file);
      form.append("categoryId", saveCategoryId);
      form.append("title", saveTitle.trim());
      form.append("isSensitive", String(shouldEncrypt));

      const res = await fetch("/api/documents", {
        method: "POST",
        body: form,
        headers,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "保存失败");
      }

      showToast.success("已保存至档案");
      setSaveModalOpen(false);
      window.dispatchEvent(new Event("documents_updated"));
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingArchive(false);
    }
  };

  const filteredArchiveDocs = useMemo(() => {
    if (!archiveSearch.trim()) return archiveDocs;
    const q = archiveSearch.toLowerCase();
    return archiveDocs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.fileName?.toLowerCase().includes(q) ||
        d.category?.name?.toLowerCase().includes(q)
    );
  }, [archiveDocs, archiveSearch]);

  const reductionPct = useMemo(() => {
    if (!sourceSize || !outputSize) return null;
    const diff = ((sourceSize - outputSize) / sourceSize) * 100;
    return diff.toFixed(1);
  }, [sourceSize, outputSize]);

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/gif"
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="panel-title">图片工坊</h1>
        </div>

        {sourceImg && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-plain flex items-center gap-1.5 !py-1.5 !px-3 !rounded-xl text-[13px] font-medium"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>更换图片</span>
            </button>
            <button
              type="button"
              onClick={openArchivePicker}
              className="btn btn-plain flex items-center gap-1.5 !py-1.5 !px-3 !rounded-xl text-[13px] font-medium"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>从档案选择</span>
            </button>
          </div>
        )}
      </div>

      {!sourceImg ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                  handleImageLoaded(img, file.name, file.size);
                };
                img.src = event.target?.result as string;
              };
              reader.readAsDataURL(file);
            }
          }}
          className="rounded-2xl border-2 border-dashed border-[var(--line-strong)] bg-[var(--card)] p-12 flex flex-col items-center justify-center text-center transition-all hover:border-[var(--blue)] min-h-[380px]"
        >
          <div className="w-14 h-14 rounded-2xl bg-[var(--paper)] border border-[var(--line)] flex items-center justify-center text-[var(--ink-soft)] mb-4">
            <ImageIcon className="w-7 h-7 stroke-[1.5]" />
          </div>
          <span className="text-[15px] font-semibold text-[var(--ink)] mb-5">暂无图片</span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-ink flex items-center gap-2 !py-2.5 !px-5 !rounded-xl text-[13.5px] font-medium"
            >
              <Upload className="w-4 h-4" />
              <span>选择本地图片</span>
            </button>
            <button
              type="button"
              onClick={openArchivePicker}
              className="btn btn-plain flex items-center gap-2 !py-2.5 !px-5 !rounded-xl text-[13.5px] font-medium"
            >
              <FolderOpen className="w-4 h-4" />
              <span>从档案选择</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 space-y-3 shadow-xs">
              <label className="text-[13px] font-semibold text-[var(--ink)] block">输出格式</label>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[var(--card-alt)] border border-[var(--line)]">
                {(["jpg", "png", "webp", "pdf"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormat(fmt)}
                    className={`py-1.5 rounded-lg text-[13px] font-medium uppercase transition-all ${
                      format === fmt
                        ? "bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>

              {format === "pdf" && (
                <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between">
                  <span className="text-[12.5px] text-[var(--ink-soft)]">页面布局</span>
                  <div className="flex items-center gap-1">
                    {[
                      { id: "auto", label: "自适应" },
                      { id: "a4_p", label: "A4 纵向" },
                      { id: "a4_l", label: "A4 横向" },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPdfPage(p.id as typeof pdfPage)}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition ${
                          pdfPage === p.id
                            ? "bg-[var(--blue)] text-white"
                            : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 space-y-3.5 shadow-xs">
              <label className="text-[13px] font-semibold text-[var(--ink)] block">尺寸规格</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className={`px-3 py-1.5 rounded-xl text-[12.5px] font-medium transition-all ${
                      preset === p.id
                        ? "bg-[var(--ink)] text-white shadow-xs"
                        : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:text-[var(--ink)] border border-[var(--line)]"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              {preset === "custom" && (
                <div className="pt-2 border-t border-[var(--line)] space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <span className="text-[11.5px] text-[var(--ink-faint)] mb-1 block">宽 (px)</span>
                      <input
                        type="number"
                        min={10}
                        max={10000}
                        value={customWidth}
                        onChange={(e) => handleCustomWidthChange(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[var(--line-strong)] text-[13px] font-mono text-[var(--ink)] bg-[var(--input-bg)] focus:outline-none focus:border-[var(--blue)]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLockAspect(!lockAspect)}
                      className={`p-2 mt-4 rounded-lg border transition ${
                        lockAspect
                          ? "border-[var(--blue)] bg-[var(--blue-soft)] text-[var(--blue)]"
                          : "border-[var(--line)] bg-[var(--card-alt)] text-[var(--ink-faint)]"
                      }`}
                      title={lockAspect ? "已锁定比例" : "未锁定比例"}
                    >
                      {lockAspect ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1">
                      <span className="text-[11.5px] text-[var(--ink-faint)] mb-1 block">高 (px)</span>
                      <input
                        type="number"
                        min={10}
                        max={10000}
                        value={customHeight}
                        onChange={(e) => handleCustomHeightChange(Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border border-[var(--line-strong)] text-[13px] font-mono text-[var(--ink)] bg-[var(--input-bg)] focus:outline-none focus:border-[var(--blue)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {preset !== "orig" && (
                <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between">
                  <span className="text-[12.5px] text-[var(--ink-soft)]">裁剪填充</span>
                  <div className="flex items-center gap-1">
                    {[
                      { id: "cover", label: "居中裁剪" },
                      { id: "contain", label: "等比留白" },
                      { id: "stretch", label: "拉伸" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setFitMode(m.id as typeof fitMode)}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition ${
                          fitMode === m.id
                            ? "bg-[var(--ink)] text-white"
                            : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 space-y-3.5 shadow-xs">
              <label className="text-[13px] font-semibold text-[var(--ink)] block">目标文件大小</label>
              <div className="flex flex-wrap gap-1.5">
                {TARGET_KB_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setKbMode(opt.id)}
                    className={`px-3 py-1.5 rounded-xl text-[12.5px] font-medium transition-all ${
                      kbMode === opt.id
                        ? "bg-[var(--blue)] text-white shadow-xs font-semibold"
                        : "bg-[var(--card-alt)] text-[var(--ink-soft)] hover:text-[var(--ink)] border border-[var(--line)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {kbMode === "custom" && (
                <div className="pt-2 border-t border-[var(--line)] flex items-center gap-3">
                  <span className="text-[12.5px] text-[var(--ink-soft)] shrink-0">上限数值 (KB)</span>
                  <input
                    type="number"
                    min={5}
                    max={20000}
                    value={customKb}
                    onChange={(e) => setCustomKb(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--line-strong)] text-[13px] font-mono text-[var(--ink)] bg-[var(--input-bg)] focus:outline-none focus:border-[var(--blue)]"
                  />
                </div>
              )}

              {kbMode === "none" && format !== "png" && (
                <div className="pt-2 border-t border-[var(--line)] space-y-2">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="text-[var(--ink-soft)]">压缩质量</span>
                    <span className="font-mono font-medium text-[var(--ink)]">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full accent-[var(--blue)] h-1.5 bg-[var(--card-alt)] rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 space-y-3 shadow-xs">
              <label className="text-[13px] font-semibold text-[var(--ink)] block">旋转与翻转</label>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                  className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--card-alt)] hover:bg-[var(--line)] flex flex-col items-center gap-1.5 text-[12px] text-[var(--ink)] transition"
                  title="向左旋转90度"
                >
                  <RotateCcw className="w-4 h-4 text-[var(--ink-soft)]" />
                  <span>左转 90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--card-alt)] hover:bg-[var(--line)] flex flex-col items-center gap-1.5 text-[12px] text-[var(--ink)] transition"
                  title="向右旋转90度"
                >
                  <RotateCw className="w-4 h-4 text-[var(--ink-soft)]" />
                  <span>右转 90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFlipH(!flipH)}
                  className={`p-2.5 rounded-xl border transition flex flex-col items-center gap-1.5 text-[12px] ${
                    flipH
                      ? "border-[var(--blue)] bg-[var(--blue-soft)] text-[var(--blue)] font-medium"
                      : "border-[var(--line)] bg-[var(--card-alt)] text-[var(--ink)]"
                  }`}
                  title="水平翻转"
                >
                  <FlipHorizontal className="w-4 h-4" />
                  <span>水平镜像</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFlipV(!flipV)}
                  className={`p-2.5 rounded-xl border transition flex flex-col items-center gap-1.5 text-[12px] ${
                    flipV
                      ? "border-[var(--blue)] bg-[var(--blue-soft)] text-[var(--blue)] font-medium"
                      : "border-[var(--line)] bg-[var(--card-alt)] text-[var(--ink)]"
                  }`}
                  title="垂直翻转"
                >
                  <FlipVertical className="w-4 h-4" />
                  <span>垂直镜像</span>
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-[13px]">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[11px] text-[var(--ink-faint)] block mb-0.5">原始规格</span>
                  <span className="font-mono text-[var(--ink-soft)]">
                    {sourceImg.naturalWidth} × {sourceImg.naturalHeight} · {formatBytes(sourceSize)}
                  </span>
                </div>
                <div className="h-6 w-px bg-[var(--line)]" />
                <div>
                  <span className="text-[11px] text-[var(--ink-faint)] block mb-0.5">处理输出</span>
                  <span className="font-mono font-semibold text-[var(--ink)]">
                    {outputWidth} × {outputHeight} · {formatBytes(outputSize)} · {format.toUpperCase()}
                  </span>
                </div>
              </div>

              {reductionPct && Number(reductionPct) > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 font-mono text-[12px] font-semibold">
                  -{reductionPct}%
                </span>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-xs relative min-h-[420px] flex items-center justify-center overflow-hidden">
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, #8E8E93 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                }}
              />

              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="预览"
                  className="max-h-[460px] max-w-full object-contain rounded-lg shadow-md relative z-10 transition-transform"
                />
              ) : (
                <div className="text-[var(--ink-faint)] text-[13px] flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>处理中…</span>
                </div>
              )}

              {processing && (
                <div className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-full bg-[var(--card)]/90 backdrop-blur-md border border-[var(--line)] text-[12px] font-medium text-[var(--ink)] flex items-center gap-1.5 shadow-sm">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--blue)]" />
                  <span>渲染中</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownload}
                disabled={!outputBlob || processing}
                className="btn btn-primary flex-1 !py-3 !rounded-xl text-[14px] font-medium flex items-center justify-center gap-2 shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>下载处理后文件</span>
              </button>

              <button
                type="button"
                onClick={openSaveArchiveModal}
                disabled={!outputBlob || processing}
                className="btn btn-plain !py-3 !px-5 !rounded-xl text-[14px] font-medium flex items-center justify-center gap-2"
              >
                <span>保存至档案库</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal open={archiveModalOpen} onClose={() => setArchiveModalOpen(false)} maxWidth={560}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-semibold text-[var(--ink)]">从档案选择图片</span>
            <button
              type="button"
              onClick={() => setArchiveModalOpen(false)}
              className="p-1 rounded-lg text-[var(--ink-faint)] hover:text-[var(--ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] pointer-events-none" />
            <input
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
              placeholder="搜索档案材料…"
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--blue)]"
            />
          </div>

          <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
            {archiveLoading ? (
              <div className="py-12 text-center text-[13px] text-[var(--ink-faint)]">
                加载中…
              </div>
            ) : filteredArchiveDocs.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-[var(--ink-faint)]">
                暂无匹配图片材料
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {filteredArchiveDocs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => selectArchiveDoc(doc)}
                    className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:border-[var(--blue)] hover:shadow-xs transition cursor-pointer flex flex-col gap-2 text-left"
                  >
                    <div className="w-full h-24 rounded-lg bg-[var(--paper)] overflow-hidden flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/documents/${doc.id}/file?thumb=1`}
                        alt={doc.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-[var(--ink)] truncate">
                        {doc.title}
                      </div>
                      <div className="text-[11.5px] text-[var(--ink-faint)] font-mono mt-0.5">
                        {doc.category?.name} · {formatBytes(doc.size)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={saveModalOpen} onClose={() => setSaveModalOpen(false)} maxWidth={440}>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-semibold text-[var(--ink)]">保存至档案库</span>
            <button
              type="button"
              onClick={() => setSaveModalOpen(false)}
              className="p-1 rounded-lg text-[var(--ink-faint)] hover:text-[var(--ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[12.5px] font-medium text-[var(--ink-soft)] mb-1 block">
                文档标题
              </label>
              <input
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="请输入文档名称"
                className="w-full px-3 py-2 text-[13px] rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--blue)]"
              />
            </div>

            <div>
              <label className="text-[12.5px] font-medium text-[var(--ink-soft)] mb-1 block">
                归档分类
              </label>
              <select
                value={saveCategoryId}
                onChange={(e) => setSaveCategoryId(e.target.value)}
                className="w-full px-3 py-2 text-[13px] rounded-xl border border-[var(--line-strong)] bg-[var(--input-bg)] text-[var(--ink)] focus:outline-none focus:border-[var(--blue)]"
              >
                {categories.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.children && c.children.length > 0 ? (
                      c.children.map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.name}
                        </option>
                      ))
                    ) : (
                      <option value={c.id}>{c.name}</option>
                    )}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[13px] text-[var(--ink)] font-medium">敏感加密存储</span>
              <input
                type="checkbox"
                checked={saveIsSensitive || isSensitiveCategory}
                disabled={isSensitiveCategory}
                onChange={(e) => setSaveIsSensitive(e.target.checked)}
                className="w-4 h-4 accent-[var(--blue)] rounded cursor-pointer disabled:opacity-60"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setSaveModalOpen(false)}
              className="btn btn-plain !py-2 !px-4 !rounded-xl text-[13px]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveToArchive}
              disabled={savingArchive || !saveTitle.trim()}
              className="btn btn-primary !py-2 !px-4 !rounded-xl text-[13px]"
            >
              {savingArchive ? "保存中…" : "确定保存"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
