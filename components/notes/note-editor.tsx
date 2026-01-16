"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

export function NoteEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const maxBytes = 10 * 1024 * 1024;

  const handleUploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      throw new Error("仅支持上传图片");
    }
    if (file.size > maxBytes) {
      throw new Error("图片过大（最大 10MB）");
    }

    setIsUploading(true);
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
      const pathname = `notes/${Date.now()}_${safeName}`;
      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type || undefined,
      });

      // 简单策略：追加到末尾（@uiw 编辑器没暴露光标 API 给我们）
      onChange(`${value}\n![](${blob.url})\n`);
    } finally {
      setIsUploading(false);
    }
  };

  const toolbar = useMemo(() => {
    return [
      "bold",
      "italic",
      "strikethrough",
      "hr",
      "|",
      "title",
      "quote",
      "code",
      "codeBlock",
      "|",
      "unorderedList",
      "orderedList",
      "checkedList",
      "|",
      "link",
      "|",
      "preview",
      "live",
      "fullscreen",
    ] as const;
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
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
          disabled={isUploading}
        >
          <ImageIcon className="h-4 w-4" />
          {isUploading ? "上传中..." : "插入图片"}
        </Button>
      </div>

      <div data-color-mode="light" className="rounded-md border bg-background">
        <MDEditor
          value={value}
          onChange={(v) => onChange(v || "")}
          height={520}
          preview="live"
          visibleDragbar={false}
          toolbarCommands={toolbar as unknown}
        />
      </div>
    </div>
  );
}

