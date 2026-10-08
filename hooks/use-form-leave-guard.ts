"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "@/hooks/use-toast";

/** Route every user-initiated cancel, backdrop click and Escape through requestClose. */
export function useFormLeaveGuard({ isDirty, hasPendingFiles = false, isBusy = false }: {
  isDirty: boolean;
  hasPendingFiles?: boolean;
  isBusy?: boolean;
}) {
  const { confirm } = useConfirm();
  const latest = useRef({ isDirty, hasPendingFiles, isBusy });
  const confirming = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    latest.current = { isDirty, hasPendingFiles, isBusy };
  }, [isDirty, hasPendingFiles, isBusy]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isDirty && !hasPendingFiles && !isBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, hasPendingFiles, isBusy]);

  const requestClose = async (onClose: () => void): Promise<boolean> => {
    if (!mounted.current || confirming.current) return false;
    if (latest.current.isBusy) {
      toast.info("正在保存或上传，请完成后再关闭，避免丢失内容。");
      return false;
    }
    if (latest.current.isDirty || latest.current.hasPendingFiles) {
      confirming.current = true;
      try {
        const leave = await confirm({
          title: "离开当前编辑？",
          description: latest.current.hasPendingFiles
            ? "选中的附件尚未上传，离开后需要重新选择。尚未保存的输入也可能丢失。"
            : "当前输入尚未保存，离开后将丢失。你可以继续编辑并保存后再离开。",
          confirmText: "继续离开",
          cancelText: "继续编辑",
        });
        if (!leave || !mounted.current) return false;
        // Saving may have started while confirmation was open. Never close its form mid-request.
        if (latest.current.isBusy) {
          toast.info("正在保存或上传，请完成后再关闭。");
          return false;
        }
      } finally {
        confirming.current = false;
      }
    }
    onClose();
    return true;
  };
  return { requestClose };
}
