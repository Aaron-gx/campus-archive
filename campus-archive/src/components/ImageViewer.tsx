"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { fetchFileBytes, clearDek } from "@/lib/e2ee";
import { copyText } from "@/lib/format";
import { rotateImageBytes, saveDocumentFile } from "@/lib/image-rotate";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  Printer,
  Download,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  X,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Sun,
  ShieldCheck,
  FileText,
  Sparkles,
  Layers,
  Compass,
} from "lucide-react";

export interface ViewerDoc {
  id: string;
  title: string;
  mimeType: string;
  fileName: string;
  e2ee: boolean;
  isSensitive?: boolean;
  side?: string | null;
  meta?: string | null;
  note?: string | null;
  size?: number;
  createdAt?: string;
  categoryName?: string;
  certificate?: {
    id?: string;
    name: string;
    org: string;
    level: string;
    awardedAt: string;
    note?: string | null;
  } | null;
}

export interface ImageViewerProps {
  docs: ViewerDoc[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDownload: (doc: ViewerDoc) => void;
  onDownloadAll?: () => void;
  onRequestVerify?: () => void;
  verifyTick?: number;
  thumbs?: Record<string, string>;
  onRotated?: (docId: string, newUrl: string) => void;
}

interface CacheItem {
  url: string;
  bytes: Uint8Array;
  mime: string;
}

function parseFields(meta?: string | null): { label: string; value: string }[] {
  if (!meta) return [];
  try {
    const parsed = JSON.parse(meta);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { fields?: unknown }).fields)) {
      return ((parsed as { fields: unknown[] }).fields).filter(
        (f): f is { label: string; value: string } =>
          !!f &&
          typeof f === "object" &&
          typeof (f as { label?: unknown }).label === "string" &&
          typeof (f as { value?: unknown }).value === "string"
      );
    }
  } catch {}
  return [];
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMime(mime?: string, fileName?: string): string {
  if (!mime) {
    const ext = fileName?.split(".").pop()?.toUpperCase();
    return ext || "FILE";
  }
  if (mime.includes("jpeg") || mime.includes("jpg")) return "JPEG";
  if (mime.includes("png")) return "PNG";
  if (mime.includes("webp")) return "WEBP";
  if (mime.includes("pdf")) return "PDF";
  return mime.split("/").pop()?.toUpperCase() || "IMAGE";
}

function formatDateStr(str?: string): string {
  if (!str) return "—";
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return str;
  }
}

type FilterMode = "normal" | "contrast" | "mono";

export default function ImageViewer({
  docs,
  index,
  onIndex,
  onClose,
  onDownload,
  onDownloadAll,
  onRequestVerify,
  verifyTick,
  thumbs,
  onRotated,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  // 面板显示状态（桌面端默认展开，移动/平板端默认收起以提供沉浸画板）
  const [showInspector, setShowInspector] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setShowInspector(true);
    }
  }, []);

  const [showFilmstrip, setShowFilmstrip] = useState(docs.length > 1);

  // 解密缩略图状态
  const [e2eeThumbs, setE2eeThumbs] = useState<Record<string, string>>({});

  // 加载状态
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // 变换状态：缩放、平移、旋转、翻转
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // 滤镜增强模式
  const [filterMode, setFilterMode] = useState<FilterMode>("normal");
  const [savingRotate, setSavingRotate] = useState(false);

  // 提示与全屏
  const [toast, setToast] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 内存缓存（objectURL + 原始字节）
  const cache = useRef<Map<string, CacheItem>>(new Map());

  const doc = docs[index] || docs[0];
  const multi = docs.length > 1;

  // 重置变换
  const resetTransform = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipH(false);
  }, []);

  const fitToScreen = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const setActualSize = useCallback(() => {
    setScale(2);
    setPan({ x: 0, y: 0 });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 2000);
  }, []);

  // 加载单张图片
  const loadDoc = useCallback(
    async (d: ViewerDoc): Promise<CacheItem> => {
      const hit = cache.current.get(d.id);
      if (hit) return hit;

      let bytes: Uint8Array;
      let mime: string;
      if (d.e2ee) {
        ({ bytes, mime } = await fetchFileBytes(d.id, d.mimeType));
      } else {
        const res = await fetch(`/api/documents/${d.id}/file`);
        if (!res.ok) {
          throw new Error(res.status === 403 ? "安全验证已过期" : "图片加载失败");
        }
        bytes = new Uint8Array(await res.arrayBuffer());
        mime = res.headers.get("Content-Type") || d.mimeType;
      }
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const item: CacheItem = { url: u, bytes, mime };
      cache.current.set(d.id, item);
      return item;
    },
    []
  );

  // 当前激活文档加载
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    resetTransform();
    setNaturalSize(null);

    const hit = cache.current.get(doc.id);
    if (hit) {
      setUrl(hit.url);
      setStatus("ok");
    } else {
      setUrl(null);
      setStatus("loading");
      setErrorMsg("");
      loadDoc(doc)
        .then((item) => {
          if (!cancelled) {
            setUrl(item.url);
            setStatus("ok");
          }
        })
        .catch((e) => {
          if (!cancelled) {
            const rawMsg = e instanceof Error ? e.message : "";
            const isDecryptErr = /invalid tag|tag mismatch|decrypt|e2ee|gcm/i.test(rawMsg);
            if (isDecryptErr) {
              clearDek();
            }
            setErrorMsg(isDecryptErr ? "解密失败" : rawMsg || "加载失败");
            setStatus("error");
          }
        });
    }

    // 后台静默预加载邻近图片
    const adjacent = [docs[index - 1], docs[index + 1]].filter(Boolean);
    adjacent.forEach((other) => {
      if (other && !cache.current.has(other.id)) {
        loadDoc(other).catch(() => {});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc, docs, index, loadDoc, resetTransform, verifyTick]);

  // 二次验证刷新
  useEffect(() => {
    if (verifyTick) {
      const c = cache.current;
      c.forEach((item) => URL.revokeObjectURL(item.url));
      c.clear();
    }
  }, [verifyTick]);

  // 卸载清理内存
  useEffect(() => {
    const c = cache.current;
    return () => {
      c.forEach((item) => URL.revokeObjectURL(item.url));
      c.clear();
    };
  }, []);

  // 获取材料缩略图：优先内存已解密对象 / 外部传入缩略图 / 内部解密缓存，非加密直接走原件接口
  const getThumbnailUrl = useCallback(
    (d: ViewerDoc): string | undefined => {
      if (cache.current.has(d.id)) {
        return cache.current.get(d.id)?.url;
      }
      if (thumbs?.[d.id]) {
        return thumbs[d.id];
      }
      if (e2eeThumbs[d.id]) {
        return e2eeThumbs[d.id];
      }
      if (!d.e2ee) {
        return `/api/documents/${d.id}/file?thumb=1`;
      }
      return undefined;
    },
    [thumbs, e2eeThumbs]
  );

  // 为底栏中未解密的 E2EE 文档后台批次解密，确保每张缩略图都真实显示
  useEffect(() => {
    let cancelled = false;
    const uncachedE2ee = docs.filter(
      (d) => d.e2ee && !cache.current.has(d.id) && !thumbs?.[d.id] && !e2eeThumbs[d.id]
    );
    if (!uncachedE2ee.length) return;

    const batchLoad = async () => {
      for (const d of uncachedE2ee) {
        if (cancelled) break;
        try {
          const item = await loadDoc(d);
          if (!cancelled) {
            setE2eeThumbs((prev) => ({ ...prev, [d.id]: item.url }));
          }
        } catch {
          // 忽略解密错误
        }
      }
    };
    void batchLoad();

    return () => {
      cancelled = true;
    };
  }, [docs, loadDoc, thumbs, e2eeThumbs]);

  // 底栏横向平滑滚动控制
  const scrollFilmstrip = useCallback((delta: number) => {
    if (!filmstripRef.current) return;
    filmstripRef.current.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  // 滚动至当前选中的底栏缩略图
  useEffect(() => {
    if (!filmstripRef.current) return;
    const activeBtn = filmstripRef.current.children[index] as HTMLElement | undefined;
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [index]);

  // 滚轮缩放
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.88;
      setScale((s) => Math.min(Math.max(s * factor, 0.2), 6));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // 拖拽平移
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 双击切换缩放
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale !== 1 || pan.x !== 0 || pan.y !== 0) {
      resetTransform();
    } else {
      setScale(2);
    }
  };

  // 旋转
  const handleRotateCw = () => setRotation((r) => (r + 90) % 360);
  const handleRotateCcw = () => setRotation((r) => (r - 90 + 360) % 360);

  // 镜像翻转
  const handleFlipH = () => setFlipH((f) => !f);

  // 保存当前旋转/翻转方向到文件
  const handleSaveOrientation = async () => {
    if (!doc || (rotation % 360 === 0 && !flipH)) return;
    setSavingRotate(true);
    try {
      const curItem = cache.current.get(doc.id);
      if (!curItem) throw new Error("缺少文件数据");

      const { bytes: newBytes, mime: newMime, blob: newBlob } = await rotateImageBytes(
        curItem.bytes,
        curItem.mime,
        rotation,
        flipH
      );

      await saveDocumentFile(doc.id, newBytes, newMime, doc.e2ee);

      const newUrl = URL.createObjectURL(newBlob);
      try {
        URL.revokeObjectURL(curItem.url);
      } catch {}

      cache.current.set(doc.id, {
        url: newUrl,
        bytes: newBytes,
        mime: newMime,
      });
      setUrl(newUrl);
      setRotation(0);
      setFlipH(false);
      showToast("已保存方向");
      onRotated?.(doc.id, newUrl);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存方向失败");
    } finally {
      setSavingRotate(false);
    }
  };

  // 滤镜切换
  const toggleFilter = () => {
    setFilterMode((m) => {
      if (m === "normal") return "contrast";
      if (m === "contrast") return "mono";
      return "normal";
    });
  };

  const filterStyle = useMemo(() => {
    switch (filterMode) {
      case "contrast":
        return "contrast(135%) brightness(108%) saturate(125%) drop-shadow(0 20px 45px rgba(0,0,0,0.85))";
      case "mono":
        return "grayscale(100%) contrast(150%) brightness(108%) drop-shadow(0 20px 45px rgba(0,0,0,0.85))";
      default:
        return "drop-shadow(0 20px 45px rgba(0,0,0,0.8))";
    }
  }, [filterMode]);

  // 全屏切换
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // 打印图片
  const handlePrint = useCallback(() => {
    if (!url) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const docContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${doc?.title || "打印原件"}</title>
          <style>
            @page { size: auto; margin: 8mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
            img { max-width: 100%; max-height: 100vh; object-fit: contain; }
          </style>
        </head>
        <body>
          <img src="${url}" />
        </body>
      </html>
    `;

    const iframeDoc = iframe.contentWindow?.document;
    if (iframeDoc) {
      iframeDoc.open();
      iframeDoc.write(docContent);
      iframeDoc.close();
      const printImg = iframeDoc.querySelector("img");
      if (printImg) {
        printImg.onload = () => {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              document.body.removeChild(iframe);
            }, 1000);
          }, 200);
        };
      }
    }
  }, [url, doc?.title]);

  // 复制图片到剪贴板
  const copyImage = useCallback(async () => {
    if (!doc) return;
    const item = cache.current.get(doc.id);
    if (!item) return;
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.write !== "function") {
      showToast("当前环境不支持直接复制图片");
      return;
    }
    try {
      if (item.mime === "image/png") {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": new Blob([item.bytes as BlobPart], { type: "image/png" }) }),
        ]);
        showToast("已复制图片");
        return;
      }
      const img = new Image();
      const u = URL.createObjectURL(new Blob([item.bytes as BlobPart], { type: item.mime }));
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = u;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      URL.revokeObjectURL(u);
      const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (pngBlob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
        showToast("已复制图片");
      }
    } catch {
      showToast("复制失败");
    }
  }, [doc, showToast]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === "Escape") onClose();
      if ((e.key === "ArrowLeft" || e.key === "PageUp") && index > 0) onIndex(index - 1);
      if ((e.key === "ArrowRight" || e.key === "PageDown") && index < docs.length - 1) onIndex(index + 1);
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(s * 1.15, 6));
      if (e.key === "-" || e.key === "_") setScale((s) => Math.max(s * 0.88, 0.2));
      if (e.key === "0") resetTransform();
      if (e.key === "1") setActualSize();
      if (e.key === "r" || e.key === "R") handleRotateCw();
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "i" || e.key === "I") setShowInspector((v) => !v);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        void copyImage();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, docs.length, onClose, onIndex, resetTransform, setActualSize, copyImage, handlePrint]);

  const parsedFields = parseFields(doc?.meta);

  if (!doc) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[80] flex flex-col select-none overflow-hidden text-white"
      style={{
        background: "rgba(10, 12, 16, 0.95)",
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 顶部控制栏 */}
      <header className="h-14 px-5 shrink-0 flex items-center justify-between border-b border-white/[0.08] bg-black/30 backdrop-blur-2xl z-30">
        {/* 左侧：文档标题与导航 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14.5px] font-semibold tracking-tight truncate max-w-[260px] md:max-w-[400px]">
              {doc.title}
            </span>
            {doc.side && (
              <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-white/90">
                {doc.side}
              </span>
            )}
            {doc.categoryName && (
              <span className="hidden sm:inline-block shrink-0 text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60">
                {doc.categoryName}
              </span>
            )}
          </div>

          {/* 进度计数器与翻页 */}
          {multi && (
            <div className="flex items-center gap-1 bg-white/[0.06] rounded-lg p-0.5 border border-white/[0.08] text-[12px] font-mono shrink-0">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onIndex(index - 1)}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                title="上一件 (←)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 text-white/70">
                {index + 1} / {docs.length}
              </span>
              <button
                type="button"
                disabled={index === docs.length - 1}
                onClick={() => onIndex(index + 1)}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                title="下一件 (→)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* 右侧：全局控制与动作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 滤镜增强切换 */}
          <button
            type="button"
            onClick={toggleFilter}
            className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[12px] font-medium transition-all ${
              filterMode !== "normal"
                ? "bg-[#0071E3] text-white shadow-sm"
                : "text-white/75 hover:text-white hover:bg-white/10"
            }`}
            title="增强对比"
          >
            <Sun className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {filterMode === "normal" ? "原色" : filterMode === "contrast" ? "增强对比" : "黑白"}
            </span>
          </button>

          {/* 打印 */}
          <button
            type="button"
            onClick={handlePrint}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-all"
            title="打印 (Ctrl+P)"
          >
            <Printer className="w-4 h-4" />
          </button>

          {/* 复制图片 */}
          <button
            type="button"
            onClick={copyImage}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-all"
            title="复制图像 (Ctrl+C)"
          >
            <Copy className="w-4 h-4" />
          </button>

          {/* 下载当前 */}
          <button
            type="button"
            onClick={() => onDownload(doc)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-all"
            title="下载原件"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* 信息面板开关 */}
          <button
            type="button"
            onClick={() => setShowInspector((v) => !v)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              showInspector
                ? "bg-white/20 text-white border border-white/20"
                : "text-white/75 hover:text-white hover:bg-white/10"
            }`}
            title="档案详情 (I)"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {/* 全屏 */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-all"
            title="全屏 (F)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="w-[1px] h-4 bg-white/15 mx-0.5" />

          {/* 关闭 */}
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/75 hover:text-white hover:bg-rose-500/30 transition-all"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 居中浮动 Toast */}
      {toast && (
        <div className="absolute top-18 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-white/95 text-slate-900 text-[12px] font-semibold shadow-2xl backdrop-blur-md animate-fade-in pointer-events-none">
          {toast}
        </div>
      )}

      {/* 主工作区：左侧画板 + 右侧信息面板 */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* 左侧画板视窗 */}
        <div className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
          <div
            ref={viewportRef}
            className={`relative flex-1 min-h-0 flex items-center justify-center overflow-hidden ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            onMouseDown={handleMouseDown}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                // 点击背景自适应还原
                resetTransform();
              }
            }}
          >
            {status === "loading" && (
              <div className="flex flex-col items-center gap-3 text-white/80">
                <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span className="text-[13px] font-medium">加载中…</span>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-3 text-white px-7 py-5 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/15 max-w-xs text-center shadow-2xl">
                <div className="text-[13.5px] font-medium">{errorMsg || "加载失败"}</div>
                {onRequestVerify && (
                  <button
                    type="button"
                    onClick={() => {
                      clearDek();
                      onRequestVerify();
                    }}
                    className="mt-1 px-4 py-1.5 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-[12.5px] font-medium transition-all shadow-md active:scale-95"
                  >
                    重新验证
                  </button>
                )}
              </div>
            )}

            {status === "ok" && url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={url}
                alt={doc.title}
                draggable={false}
                onDoubleClick={handleDoubleClick}
                onLoad={(e) => {
                  const target = e.currentTarget;
                  setNaturalSize({ width: target.naturalWidth, height: target.naturalHeight });
                }}
                className="select-none transition-transform duration-75 ease-out object-contain rounded-md"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${
                    flipH ? -1 : 1
                  })`,
                  maxHeight: "calc(100vh - 200px)",
                  maxWidth: "calc(100% - 32px)",
                  filter: filterStyle,
                }}
              />
            )}

            {/* 鹰眼小地图（当放大倍率大于 1.2 时呈现） */}
            {status === "ok" && url && scale > 1.2 && (
              <div
                className="absolute bottom-5 left-5 z-20 w-32 h-24 rounded-lg overflow-hidden border border-white/20 bg-black/60 backdrop-blur-md shadow-2xl flex items-center justify-center pointer-events-auto cursor-pointer"
                onClick={resetTransform}
                title="自适应"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="w-full h-full object-contain opacity-60" />
                <div
                  className="absolute border border-[#0071E3] bg-[#0071E3]/20 transition-all pointer-events-none rounded-xs"
                  style={{
                    width: `${Math.max(100 / scale, 15)}%`,
                    height: `${Math.max(100 / scale, 15)}%`,
                    transform: `translate(${-pan.x / (scale * 12)}px, ${-pan.y / (scale * 12)}px)`,
                  }}
                />
                <span className="absolute top-1 left-1.5 text-[9px] font-mono text-white/75 bg-black/60 px-1 rounded">
                  {Math.round(scale * 100)}%
                </span>
              </div>
            )}

            {/* 画板内侧左右快速切换微件 */}
            {multi && index > 0 && (
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all active:scale-95 shadow-xl"
                onClick={(e) => {
                  e.stopPropagation();
                  onIndex(index - 1);
                }}
                title="上一张 (←)"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {multi && index < docs.length - 1 && (
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 transition-all active:scale-95 shadow-xl"
                onClick={(e) => {
                  e.stopPropagation();
                  onIndex(index + 1);
                }}
                title="下一张 (→)"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* 悬浮快捷变换调色盘 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-2xl border border-white/15 shadow-2xl text-[12px] text-white/80 max-w-[95vw] overflow-x-auto no-scrollbar">
              {/* 缩小 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/15 hover:text-white transition-all active:scale-95"
                onClick={() => setScale((s) => Math.max(s * 0.88, 0.2))}
                title="缩小 (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              {/* 缩放数值 */}
              <button
                type="button"
                className="px-2 py-0.5 rounded hover:bg-white/15 hover:text-white transition-all font-mono text-[11px] font-medium"
                onClick={resetTransform}
                title="自适应 (0)"
              >
                {Math.round(scale * 100)}%
              </button>

              {/* 放大 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/15 hover:text-white transition-all active:scale-95"
                onClick={() => setScale((s) => Math.min(s * 1.15, 6))}
                title="放大 (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <div className="w-[1px] h-3.5 bg-white/15 mx-0.5" />

              {/* 自适应 */}
              <button
                type="button"
                className="px-2 py-0.5 rounded-md hover:bg-white/15 hover:text-white transition-all text-[11.5px] font-medium"
                onClick={fitToScreen}
                title="自适应"
              >
                自适应
              </button>

              {/* 100% */}
              <button
                type="button"
                className="px-2 py-0.5 rounded-md hover:bg-white/15 hover:text-white transition-all text-[11.5px] font-medium font-mono"
                onClick={setActualSize}
                title="100%"
              >
                100%
              </button>

              <div className="w-[1px] h-3.5 bg-white/15 mx-0.5" />

              {/* 逆时针 90 度 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/15 hover:text-white transition-all active:scale-95"
                onClick={handleRotateCcw}
                title="逆时针 90°"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* 顺时针 90 度 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/15 hover:text-white transition-all active:scale-95"
                onClick={handleRotateCw}
                title="顺时针 90° (R)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              {/* 镜像翻转 */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/15 hover:text-white transition-all active:scale-95"
                onClick={handleFlipH}
                title="水平镜像翻转"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
              </button>

              {/* 保存方向（旋转或翻转后显式提供持久化保存） */}
              {(rotation % 360 !== 0 || flipH) && (
                <button
                  type="button"
                  disabled={savingRotate}
                  onClick={handleSaveOrientation}
                  className="px-3 py-1 ml-1 rounded-full flex items-center gap-1.5 bg-[#0071E3] hover:bg-[#0077ED] text-white transition-all active:scale-95 text-[11.5px] font-semibold shadow-md animate-fade-in"
                  title="保存当前方向到文件"
                >
                  {savingRotate ? (
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{savingRotate ? "保存中…" : "保存方向"}</span>
                </button>
              )}
            </div>
          </div>

          {/* 底部胶卷导览栏 (Filmstrip Dock) */}
          {multi && (
            <div
              className="relative border-t border-white/[0.08] bg-black/60 backdrop-blur-2xl px-3 py-1.5 shrink-0 flex flex-col gap-1 z-20"
              style={{ maxHeight: "105px" }}
            >
              <div className="flex items-center justify-between text-[11.5px] text-white/60 px-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <Layers className="w-3.5 h-3.5 text-[#0071E3]" />
                  <span>全部材料</span>
                  <span className="text-white/40 font-mono">
                    ({index + 1} / {docs.length})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => scrollFilmstrip(-240)}
                      className="w-5 h-5 rounded hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                      title="向左滚动"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollFilmstrip(240)}
                      className="w-5 h-5 rounded hover:bg-white/15 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                      title="向右滚动"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="w-[1px] h-3 bg-white/15 mx-0.5" />

                  <button
                    type="button"
                    onClick={() => setShowFilmstrip((v) => !v)}
                    className="hover:text-white text-white/60 transition-colors text-[11px] cursor-pointer"
                  >
                    {showFilmstrip ? "收起" : "展开"}
                  </button>
                </div>
              </div>

              {showFilmstrip && (
                <div className="relative flex items-center group/dock">
                  {/* 左侧悬浮滑动按钮 */}
                  <button
                    type="button"
                    onClick={() => scrollFilmstrip(-280)}
                    className="absolute -left-1 z-10 w-7 h-12 rounded-r-md bg-black/80 hover:bg-black/95 text-white/75 hover:text-white border border-white/15 border-l-0 flex items-center justify-center transition-all shadow-xl backdrop-blur-md opacity-0 group-hover/dock:opacity-100 active:scale-95 cursor-pointer"
                    title="向左翻动"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div
                    ref={filmstripRef}
                    onWheel={(e) => {
                      if (e.deltaY !== 0 && filmstripRef.current) {
                        e.preventDefault();
                        filmstripRef.current.scrollLeft += e.deltaY * 1.5;
                      }
                    }}
                    className="flex items-center gap-2 overflow-x-auto overflow-y-hidden py-1 px-1 w-full scroll-smooth"
                    style={{
                      height: "64px",
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgba(255,255,255,0.2) transparent",
                    }}
                  >
                    {docs.map((d, i) => {
                      const isCur = i === index;
                      const thumbUrl = getThumbnailUrl(d);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => onIndex(i)}
                          className={`group relative shrink-0 rounded-lg overflow-hidden border transition-all duration-150 flex items-center justify-center p-0.5 cursor-pointer ${
                            isCur
                              ? "border-[#0071E3] ring-2 ring-[#0071E3]/80 scale-102 bg-white/20 shadow-lg shadow-[#0071E3]/30"
                              : "border-white/15 hover:border-white/40 bg-white/5 opacity-70 hover:opacity-100"
                          }`}
                          style={{
                            width: "80px",
                            height: "56px",
                            minWidth: "80px",
                            maxWidth: "80px",
                            minHeight: "56px",
                            maxHeight: "56px",
                          }}
                          title={d.side ? `${d.title} (${d.side})` : d.title}
                        >
                          {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumbUrl}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-contain pointer-events-none"
                              style={{ maxWidth: "100%", maxHeight: "100%" }}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-white/40">
                              <span className="text-[14px]">📄</span>
                            </div>
                          )}

                          {/* 序号标号 */}
                          <span className="absolute top-1 left-1 text-[8.5px] font-mono text-white/80 bg-black/75 px-1 py-0.2 rounded backdrop-blur-xs">
                            {i + 1}
                          </span>

                          {/* 槽位页标 */}
                          {d.side && (
                            <span className="absolute bottom-1 right-1 text-[8.5px] font-semibold text-white bg-[#0071E3]/90 px-1 py-0.2 rounded backdrop-blur-xs">
                              {d.side}
                            </span>
                          )}

                          {isCur && (
                            <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#0071E3] shadow-sm shadow-[#0071E3]" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* 右侧悬浮滑动按钮 */}
                  <button
                    type="button"
                    onClick={() => scrollFilmstrip(280)}
                    className="absolute -right-1 z-10 w-7 h-12 rounded-l-md bg-black/80 hover:bg-black/95 text-white/75 hover:text-white border border-white/15 border-r-0 flex items-center justify-center transition-all shadow-xl backdrop-blur-md opacity-0 group-hover/dock:opacity-100 active:scale-95 cursor-pointer"
                    title="向右翻动"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧信息抽屉 (Inspector Panel) */}
        {showInspector && (
          <aside className="fixed inset-y-0 right-0 lg:static w-full sm:w-80 md:w-88 max-w-[90vw] shrink-0 border-l border-white/[0.08] bg-black/90 lg:bg-black/50 backdrop-blur-3xl flex flex-col z-30 animate-fade-in overflow-hidden shadow-2xl">
            {/* 抽屉头部 */}
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-white/90">
                <FileText className="w-4 h-4 text-[#0071E3]" />
                <span>档案详情</span>
              </div>
              <button
                type="button"
                onClick={() => setShowInspector(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                title="收起"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 抽屉内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[12.5px]">
              {/* 文档概要卡片 */}
              <div className="p-3 rounded-xl bg-white/[0.05] border border-white/[0.08] space-y-2">
                <div className="text-[14px] font-semibold text-white tracking-tight leading-snug break-all">
                  {doc.title}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {doc.side && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-white/90">
                      {doc.side}
                    </span>
                  )}
                  {doc.categoryName && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/70">
                      {doc.categoryName}
                    </span>
                  )}
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>{doc.e2ee ? "端到端加密" : "受控存储"}</span>
                  </span>
                </div>
              </div>

              {/* 结构化证书属性 */}
              {doc.certificate && (
                <div className="p-3 rounded-xl bg-white/[0.05] border border-white/[0.08] space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>证书属性</span>
                  </div>

                  <div className="space-y-1.5">
                    <div>
                      <div className="text-[11px] text-white/45">证书全称</div>
                      <div className="text-[13px] font-medium text-white/95 mt-0.5">
                        {doc.certificate.name}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.06]">
                      <div>
                        <div className="text-[11px] text-white/45">级别</div>
                        <div className="text-[12px] font-medium text-amber-300 mt-0.5">
                          {doc.certificate.level}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-white/45">获奖时间</div>
                        <div className="text-[12px] font-mono text-white/90 mt-0.5">
                          {formatDateStr(doc.certificate.awardedAt)}
                        </div>
                      </div>
                    </div>

                    <div className="pt-1 border-t border-white/[0.06]">
                      <div className="text-[11px] text-white/45">颁发单位</div>
                      <div className="text-[12px] text-white/85 mt-0.5">{doc.certificate.org}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* OCR 结构化字段 */}
              {parsedFields.length > 0 && (
                <div className="p-3 rounded-xl bg-white/[0.05] border border-white/[0.08] space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
                    <Compass className="w-3.5 h-3.5 text-[#0071E3]" />
                    <span>识别字段</span>
                  </div>

                  <div className="space-y-1.5">
                    {parsedFields.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-[10.5px] text-white/45 block">{f.label}</span>
                          <span className="mono text-[12px] text-white/95 font-medium truncate block select-all">
                            {f.value}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await copyText(f.value);
                            setCopiedKey(f.label);
                            setTimeout(() => setCopiedKey(null), 1500);
                          }}
                          className="shrink-0 p-1 text-white/60 hover:text-white transition-colors"
                          title="复制"
                        >
                          {copiedKey === f.label ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 备注 */}
              {doc.note && (
                <div className="p-3 rounded-xl bg-white/[0.05] border border-white/[0.08] space-y-1">
                  <div className="text-[11px] text-white/45">备注</div>
                  <div className="text-white/85 text-[12px] leading-relaxed break-all whitespace-pre-wrap">
                    {doc.note}
                  </div>
                </div>
              )}

              {/* 技术规格 */}
              <div className="p-3 rounded-xl bg-white/[0.05] border border-white/[0.08] space-y-2">
                <div className="text-[11px] font-semibold tracking-wider text-white/50 uppercase">
                  技术规格
                </div>

                <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[12px]">
                  <div>
                    <span className="text-[10.5px] text-white/45 block">格式</span>
                    <span className="font-mono text-white/90">
                      {formatMime(doc.mimeType, doc.fileName)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white/45 block">大小</span>
                    <span className="font-mono text-white/90">{formatSize(doc.size)}</span>
                  </div>
                  {naturalSize && (
                    <div className="col-span-2">
                      <span className="text-[10.5px] text-white/45 block">原始尺寸</span>
                      <span className="font-mono text-white/90">
                        {naturalSize.width} × {naturalSize.height} 像素
                      </span>
                    </div>
                  )}
                  {doc.createdAt && (
                    <div className="col-span-2">
                      <span className="text-[10.5px] text-white/45 block">归档时间</span>
                      <span className="font-mono text-white/85">
                        {formatDateStr(doc.createdAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 底部动作栏 */}
            <div className="p-3 border-t border-white/[0.08] bg-black/40 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={copyImage}
                className="flex-1 h-9 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制图像</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[12px] font-medium flex items-center justify-center transition-all active:scale-95"
                title="打印"
              >
                <Printer className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onDownload(doc)}
                className="flex-1 h-9 rounded-lg bg-[#0071E3] hover:bg-[#0077ED] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-md"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载原件</span>
              </button>

              {multi && onDownloadAll && (
                <button
                  type="button"
                  onClick={onDownloadAll}
                  className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[12px] font-medium flex items-center justify-center transition-all active:scale-95 shrink-0"
                  title="下载全部"
                >
                  全部
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
