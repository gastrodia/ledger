import type { AssistantImageImportSummary } from "@/lib/assistant";

export type AssistantImage = { data: string; name: string };
export const MAX_ASSISTANT_IMAGES = 5;
export const MAX_ASSISTANT_IMAGE_LENGTH = 2_000_000;
export const MAX_ASSISTANT_IMAGES_LENGTH = 4_000_000;

// Sent messages retain a display copy. Background tasks keep the larger
// recognition source on the server so a retry does not OCR a thumbnail.
export const MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH = 400_000;

export function clipboardImages(clipboard: Pick<DataTransfer, "items" | "files">): File[] {
  const files: File[] = [];
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file && !files.includes(file)) files.push(file);
  }
  return files.length ? files : Array.from(clipboard.files).filter(file => file.type.startsWith("image/"));
}

export function clipboardImage(clipboard: Pick<DataTransfer, "items" | "files">): File | undefined {
  return clipboardImages(clipboard)[0];
}

export function isAssistantImage(value: unknown): value is AssistantImage {
  if (!value || typeof value !== "object") return false;
  const image = value as AssistantImage;
  return typeof image.name === "string" && image.name.length <= 255 && typeof image.data === "string" && image.data.length <= MAX_ASSISTANT_IMAGE_LENGTH
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.data);
}

// A legacy single image is only used when the new array field is absent.
export function restoreAssistantImages(value: unknown, legacy?: unknown, message = false): AssistantImage[] {
  const candidates = value === undefined ? (legacy == null ? [] : [legacy]) : value;
  if (!Array.isArray(candidates) || candidates.length > MAX_ASSISTANT_IMAGES
    || candidates.some(image => !(message ? isAssistantMessageImage(image) : isAssistantImage(image)))) return [];
  const images = candidates as AssistantImage[];
  const limit = message ? MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH : MAX_ASSISTANT_IMAGES_LENGTH;
  return images.reduce((total, image) => total + image.data.length, 0) <= limit ? images : [];
}

export function appendAssistantImages(current: AssistantImage[], incoming: AssistantImage[]): AssistantImage[] {
  if ([...current, ...incoming].some(image => !isAssistantImage(image))) throw new Error("截图格式无效，请重新选择图片。");
  const result = [...current];
  for (const image of incoming) if (!result.some(existing => existing.data === image.data)) result.push(image);
  if (result.length > MAX_ASSISTANT_IMAGES) throw new Error(`一次最多选择 ${MAX_ASSISTANT_IMAGES} 张截图，请分批识别。`);
  if (result.reduce((total, image) => total + image.data.length, 0) > MAX_ASSISTANT_IMAGES_LENGTH) throw new Error("截图总大小过大，请减少图片或裁剪到账单区域后重试。");
  return result;
}

export function restoreAssistantImportSummary(value: unknown): AssistantImageImportSummary | undefined {
  if (!value || typeof value !== "object") return;
  const summary = value as AssistantImageImportSummary;
  const skipped = summary.skipped_zero_amounts === undefined ? 0 : summary.skipped_zero_amounts;
  if (![summary.image_count, summary.extracted_count, summary.removed_duplicates, summary.retained_count, skipped].every(n => Number.isSafeInteger(n) && n >= 0)
    || summary.image_count < 1 || summary.image_count > MAX_ASSISTANT_IMAGES || summary.extracted_count > MAX_ASSISTANT_IMAGES * 20
    || skipped + summary.removed_duplicates + summary.retained_count !== summary.extracted_count || typeof summary.review_required !== "boolean"
    || !Array.isArray(summary.warnings) || summary.warnings.length > 10 || summary.warnings.some(warning => typeof warning !== "string" || warning.length > 500)) return;
  return summary;
}

export function isAssistantMessageImage(value: unknown): value is AssistantImage {
  return isAssistantImage(value) && value.data.length <= MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH;
}

/** Builds a local display copy; the recognition request still uses the source. */
export async function prepareAssistantMessageImage(source: AssistantImage, maxLength = MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH): Promise<AssistantImage> {
  if (!isAssistantImage(source)) throw new Error("截图格式无效，请重新选择图片。");
  const limit = Math.min(MAX_ASSISTANT_MESSAGE_IMAGE_LENGTH, maxLength);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("图片预览大小无效。");
  if (source.data.length <= limit) return source;
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
        if (isAssistantMessageImage(image) && image.data.length <= limit) return image;
      }
    }
  } catch {
    throw new Error("图片预览生成失败，请重新选择截图。");
  }
  throw new Error("截图过大，无法生成预览，请选择较小的图片。");
}
