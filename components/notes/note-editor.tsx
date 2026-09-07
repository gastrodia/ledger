"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { upload } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { commands as mdCommands, type ICommand } from "@uiw/react-md-editor";

import "@uiw/react-md-editor/markdown-editor.css";
// MDEditor imports its preview styles through its declared dependency.

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });
const narrowQuery = "(max-width: 639px)";
const subscribeViewport = (listener: () => void) => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const isNarrowViewport = () => window.matchMedia(narrowQuery).matches;

export function NoteEditor({
  value,
  onChange,
  onUploadingChange,
  disabled = false,
}: {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const isNarrow = useSyncExternalStore(subscribeViewport, isNarrowViewport, () => false);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");

  const maxBytes = 10 * 1024 * 1024;

  const handleUploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      throw new Error("仅支持上传图片");
    }
    if (file.size > maxBytes) {
      throw new Error("图片过大（最大 10MB）");
    }

    setIsUploading(true);
    setProgress(null);
    onUploadingChange?.(true);
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
      const pathname = `notes/${Date.now()}_${safeName}`;
      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type || undefined,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });

      // 简单策略：追加到末尾（@uiw 编辑器没暴露光标 API 给我们）
      onChange((current) => `${current}\n![](${blob.url})\n`);
    } finally {
      setIsUploading(false);
      onUploadingChange?.(false);
    }
  };

  const toolbar = useMemo<ICommand[]>(() => {
    return [
      mdCommands.bold,
      mdCommands.italic,
      mdCommands.strikethrough,
      mdCommands.hr,
      mdCommands.divider,
      mdCommands.group(
        [
          mdCommands.title1,
          mdCommands.title2,
          mdCommands.title3,
          mdCommands.title4,
          mdCommands.title5,
          mdCommands.title6,
        ],
        {
          name: "title",
          groupName: "title",
          buttonProps: { "aria-label": "Insert title", title: "Insert title" },
        }
      ),
      mdCommands.quote,
      mdCommands.code,
      mdCommands.codeBlock,
      mdCommands.divider,
      mdCommands.unorderedListCommand,
      mdCommands.orderedListCommand,
      mdCommands.checkedListCommand,
      mdCommands.divider,
      mdCommands.link,
    ];
  }, []);

  const extraCommands = useMemo<ICommand[]>(() => {
    return isNarrow ? [mdCommands.fullscreen] : [mdCommands.codePreview, mdCommands.codeLive, mdCommands.fullscreen];
  }, [isNarrow]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isNarrow ? (
          <div className="mr-auto flex gap-1" aria-label="笔记视图">
            <Button type="button" size="sm" variant={mobileView === "edit" ? "default" : "outline"} aria-pressed={mobileView === "edit"} onClick={() => setMobileView("edit")}>编辑</Button>
            <Button type="button" size="sm" variant={mobileView === "preview" ? "default" : "outline"} aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>预览</Button>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            handleUploadImage(file).catch((err) =>
              toast.error(err instanceof Error ? err.message : "上传失败")
            );
            e.currentTarget.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || disabled}
        >
          <ImageIcon className="h-4 w-4" />
          {isUploading ? (progress === null ? "准备上传..." : `上传中 ${progress}%`) : "插入图片"}
        </Button>
      </div>

      {isUploading ? <p role="status" className="text-xs text-muted-foreground">图片上传完成后才能保存笔记，请保持页面打开。</p> : null}
      <div data-color-mode="light" className="rounded-md border bg-background">
        <MDEditor
          textareaProps={{ disabled }}
          value={value}
          onChange={(v) => onChange(v || "")}
          height={520}
          preview={isNarrow ? mobileView : "live"}
          visibleDragbar={false}
          commands={toolbar}
          extraCommands={extraCommands}
        />
      </div>
    </div>
  );
}

