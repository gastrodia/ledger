export const attachmentModules = [
  "transactions", "notes", "giftbooks", "loans", "loan-repayments", "gifts-given",
] as const;

// New uploads always have a user namespace and a unique upload directory.
export function isOwnedAttachmentPath(pathname: string, userId: string): boolean {
  const parts = pathname.split("/");
  return parts.length === 4 &&
    attachmentModules.some((module) => module === parts[0]) &&
    parts[1] === userId && /^[\w-]+$/.test(userId) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[2]) &&
    /^[\w.() -]+$/.test(parts[3]) && ![".", ".."].includes(parts[3]);
}

export function ownedAttachmentPath(key: unknown, userId: string): string | null {
  if (typeof key !== "string") return null;
  try {
    const url = new URL(key);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
        !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)) return null;
    const pathname = decodeURIComponent(url.pathname.slice(1));
    return isOwnedAttachmentPath(pathname, userId) ? pathname : null;
  } catch {
    return null;
  }
}
