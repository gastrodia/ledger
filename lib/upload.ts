"use client";

import { upload as uploadBlob } from "@vercel/blob/client";
import { isOwnedAttachmentPath } from "@/lib/attachment-path";

export async function upload(...args: Parameters<typeof uploadBlob>) {
  const [pathname, body, options] = args;
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) throw new Error("登录已失效，请重新登录后上传");
  const { user } = await response.json();
  const parts = pathname.split("/");
  const scopedPath = `${parts[0]}/${user.id}/${crypto.randomUUID()}/${parts.at(-1)}`;
  if (!isOwnedAttachmentPath(scopedPath, user.id)) throw new Error("不允许的上传路径");
  return uploadBlob(scopedPath, body, options);
}
