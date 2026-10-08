export type AssistantImage = { data: string; name: string };

// Sent messages retain a display copy, while the larger recognition source is
// only kept in the composer until sending finishes.
export const MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH = 400_000;

export function clipboardImage(clipboard: Pick<DataTransfer, "items" | "files">): File | undefined {
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return Array.from(clipboard.files).find(file => file.type.startsWith("image/"));
}

export function isAssistantImage(value: unknown): value is AssistantImage {
  if (!value || typeof value !== "object") return false;
  const image = value as AssistantImage;
  return typeof image.name === "string" && image.name.length <= 255 && typeof image.data === "string" && image.data.length <= 2_000_000
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.data);
}

export function isAssistantMessageImage(value: unknown): value is AssistantImage {
  return isAssistantImage(value) && value.data.length <= MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH;
}

/** Builds a local display copy; the recognition request still uses the source. */
export async function prepareAssistantMessageImage(source: AssistantImage): Promise<AssistantImage> {
  if (!isAssistantImage(source)) throw new Error("截图格式无效，请重新选择图片。");
  if (source.data.length <= MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH) return source;
  if (typeof Image !== "function" || typeof document === "undefined") throw new Error("浏览器无法处理图片，请选择较小的截图。");

  const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败，请重新选择截图。"));
    image.src = source.data;
  });
  const width = decoded.naturalWidth || decoded.width;
  const height = decoded.naturalHeight || decoded.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("图片读取失败，请重新选择截图。");

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片预览生成失败。");
    for (const longEdge of [1600, 1200, 960, 640, 480, 320, 160]) {
      const scale = Math.min(1, longEdge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      // Draw the complete image rather than cutting a thumbnail out of it.
      context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.65]) {
        const image = { data: canvas.toDataURL("image/jpeg", quality), name: source.name };
        if (isAssistantMessageImage(image)) return image;
      }
    }
  } catch {
    throw new Error("图片预览生成失败，请重新选择截图。");
  }
  throw new Error("截图过大，无法生成预览，请选择较小的图片。");
}
