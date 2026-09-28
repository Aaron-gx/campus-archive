"use client";

import * as React from "react";
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInformationFill,
} from "@remixicon/react";
import { AlertBadge, type AlertBadgeAction, type AlertBadgeProps } from "./alert-badge";

type ToastVariant = "error" | "success" | "info";

export interface ToastItem {
  id: string;
  variant?: ToastVariant;
  label: string;
  icon?: AlertBadgeProps["icon"];
  action?: AlertBadgeAction;
  duration?: number;
}

export type ToastOptions = Omit<ToastItem, "id">;

type ToastListener = (toasts: ToastItem[]) => void;

let toastList: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  listeners.forEach((listener) => listener([...toastList]));
}

export function dismissToast(id: string) {
  toastList = toastList.filter((item) => item.id !== id);
  notify();
}

export function showToast(options: ToastOptions | string): string {
  const id = Math.random().toString(36).substring(2, 9);
  const toastObj: ToastItem =
    typeof options === "string"
      ? { id, label: options, variant: "info" }
      : { id, variant: "info", ...options };

  // 默认根据 variant 自动配备相符的图标
  if (!toastObj.icon) {
    if (toastObj.variant === "success") toastObj.icon = RiCheckboxCircleFill;
    else if (toastObj.variant === "error") toastObj.icon = RiErrorWarningFill;
    else toastObj.icon = RiInformationFill;
  }

  toastList = [toastObj, ...toastList];
  notify();

  const duration = toastObj.duration ?? 3500;
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

// 辅助方法
showToast.success = (label: string, action?: AlertBadgeAction) =>
  showToast({ variant: "success", label, action });
showToast.error = (label: string, action?: AlertBadgeAction) =>
  showToast({ variant: "error", label, action });
showToast.info = (label: string, action?: AlertBadgeAction) =>
  showToast({ variant: "info", label, action });
showToast.dismiss = dismissToast;

export function useToast() {
  return {
    toast: showToast,
    dismiss: dismissToast,
  };
}

export function AlertToastContainer() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    listeners.add(setToasts);
    setToasts([...toastList]);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto shadow-lg transition-all duration-200 animate-in fade-in slide-in-from-top-2"
        >
          <AlertBadge
            variant={item.variant}
            icon={item.icon}
            label={item.label}
            action={
              item.action
                ? {
                    ...item.action,
                    onClick: (e) => {
                      item.action?.onClick?.(e);
                      dismissToast(item.id);
                    },
                  }
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
