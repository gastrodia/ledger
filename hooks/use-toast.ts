"use client";

import { useState, useCallback } from "react";
import type { ToastProps } from "@/components/ui/toast";

type ToastInput = Omit<ToastProps, "id"> & { id?: string };

let toastCount = 0;

// 全局状态管理
const listeners = new Set<(toasts: ToastProps[]) => void>();
let memoryState: ToastProps[] = [];

function dispatch(toasts: ToastProps[]) {
  memoryState = toasts;
  listeners.forEach((listener) => listener(toasts));
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastProps[]>(memoryState);

  // 订阅全局状态
  useState(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  });

  const toast = useCallback((props: ToastInput) => {
    const id = props.id || `toast-${toastCount++}`;
    const duration = props.duration ?? 3000;

    const newToast: ToastProps = {
      ...props,
      id,
      duration,
    };

    dispatch([...memoryState, newToast]);

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        dismiss(id);
      }, duration);
    }

    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch(memoryState.filter((t) => t.id !== id));
  }, []);

  return {
    toasts,
    toast,
    dismiss,
    success: (message: string, title?: string) =>
      toast({ title: title || "成功", description: message, variant: "success" }),
    error: (message: string, title?: string) =>
      toast({ title: title || "错误", description: message, variant: "error" }),
    warning: (message: string, title?: string) =>
      toast({ title: title || "警告", description: message, variant: "warning" }),
    info: (message: string, title?: string) =>
      toast({ title: title || "提示", description: message, variant: "default" }),
  };
}

// 导出全局函数
export const toast = {
  success: (message: string, title?: string) => {
    const id = `toast-${toastCount++}`;
    const duration = 3000;
    const newToast: ToastProps = {
      id,
      title: title || "成功",
      description: message,
      variant: "success",
      duration,
    };
    dispatch([...memoryState, newToast]);
    setTimeout(() => {
      dispatch(memoryState.filter((t) => t.id !== id));
    }, duration);
    return id;
  },
  error: (message: string, title?: string) => {
    const id = `toast-${toastCount++}`;
    const duration = 4000;
    const newToast: ToastProps = {
      id,
      title: title || "错误",
      description: message,
      variant: "error",
      duration,
    };
    dispatch([...memoryState, newToast]);
    setTimeout(() => {
      dispatch(memoryState.filter((t) => t.id !== id));
    }, duration);
    return id;
  },
  warning: (message: string, title?: string) => {
    const id = `toast-${toastCount++}`;
    const duration = 3500;
    const newToast: ToastProps = {
      id,
      title: title || "警告",
      description: message,
      variant: "warning",
      duration,
    };
    dispatch([...memoryState, newToast]);
    setTimeout(() => {
      dispatch(memoryState.filter((t) => t.id !== id));
    }, duration);
    return id;
  },
  info: (message: string, title?: string) => {
    const id = `toast-${toastCount++}`;
    const duration = 3000;
    const newToast: ToastProps = {
      id,
      title: title || "提示",
      description: message,
      variant: "default",
      duration,
    };
    dispatch([...memoryState, newToast]);
    setTimeout(() => {
      dispatch(memoryState.filter((t) => t.id !== id));
    }, duration);
    return id;
  },
};
