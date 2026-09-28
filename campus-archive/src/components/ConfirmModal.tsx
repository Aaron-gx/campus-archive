"use client";

import Modal from "@/components/Modal";

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  icon?: string;
  loading?: boolean;
  zIndex?: number;
}

/**
 * 通用 Apple 风格确认模态框（macOS 对话框拟态）
 * 用于替换全站粗糙的 window.confirm()，提供精致的触感与明确的后果提示
 */
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  icon,
  loading = false,
  zIndex,
}: ConfirmModalProps) {
  const defaultIcon = danger ? "🗑️" : "💬";

  return (
    <Modal open={open} onClose={onClose} maxWidth={380} zIndex={zIndex}>
      <button
        type="button"
        className="modal-close-btn"
        onClick={onClose}
        aria-label="关闭"
        disabled={loading}
      >
        ✕
      </button>
      <div className="text-center pt-1 pb-1">
        {/* 顶部拟态发光图标 */}
        <div
          className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-3.5 shadow-sm"
          style={{
            background: danger ? "rgba(255, 59, 48, 0.12)" : "rgba(0, 113, 227, 0.12)",
            border: danger ? "1px solid rgba(255, 59, 48, 0.2)" : "1px solid rgba(0, 113, 227, 0.2)",
          }}
        >
          {icon ?? defaultIcon}
        </div>

        {/* 标题 */}
        <h3 className="text-[17px] font-semibold tracking-tight mb-2 text-[var(--ink)]">
          {title}
        </h3>

        {/* 描述说明 */}
        {description && (
          <div className="text-[13px] leading-relaxed text-[var(--ink-soft)] mb-6 px-1">
            {description}
          </div>
        )}

        {/* 操作按钮组 */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            className="btn btn-ghost flex-1 !py-2.5 !text-[13.5px]"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn flex-1 !py-2.5 !text-[13.5px] ${danger ? "btn-danger !bg-red-500 !text-white !border-red-500 hover:!bg-red-600 shadow-md shadow-red-500/20" : "btn-ink"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
