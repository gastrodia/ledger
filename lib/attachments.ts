import { BlobNotFoundError, del, head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ownedAttachmentPath } from "@/lib/attachment-path";

export async function validateAttachment(key: unknown, userId: string, existingKey?: unknown) {
  if (key === undefined || key === null || key === "") return null;
  // Keep existing legacy references usable without granting new ownership.
  if (typeof key === "string" && key === existingKey) return null;
  const pathname = ownedAttachmentPath(key, userId);
  if (pathname) {
    try {
      // Resolve against this deployment's store, never an arbitrary remote URL.
      const blob = await head(pathname);
      if (blob.url === key && blob.pathname === pathname) return null;
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
  }
  return NextResponse.json({ error: "附件不存在或不属于当前用户，请重新上传" }, { status: 403 });
}

export async function deleteOwnedAttachment(key: string, userId: string) {
  const pathname = ownedAttachmentPath(key, userId);
  // Historical unscoped references are not proof of upload ownership.
  if (!pathname) return;
  try {
    const blob = await head(pathname);
    if (blob.url === key) await del(pathname);
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }
}
