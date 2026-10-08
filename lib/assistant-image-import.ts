import { MAX_AMOUNT_CENTS, isCalendarDate, type AssistantImageImportSummary } from "@/lib/assistant";
import { MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGES_LENGTH, MAX_ASSISTANT_IMAGE_LENGTH } from "@/lib/assistant-images";

type ImageSource = { image_index: number; row_index: number; time: string | null; transaction_id: string | null; kind?: "statement" | "receipt" | "unknown" };
type ImageRow = Record<string, unknown>;
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

// Keep the old single-image request compatible. The aggregate limit includes
// the base64 data URLs so it bounds the HTTP request, not only decoded pixels.
export function assistantRequestImages(body: Record<string, unknown>): string[] {
  if (body.images !== undefined && body.image !== undefined) throw new Error("请使用同一种截图上传方式后重试。");
  const value = body.images !== undefined ? body.images : body.image !== undefined ? [body.image] : [];
  if (!Array.isArray(value) || value.length > MAX_ASSISTANT_IMAGES) throw new Error(`一次最多上传 ${MAX_ASSISTANT_IMAGES} 张截图。`);
  if (value.some(image => typeof image !== "string" || image.length > MAX_ASSISTANT_IMAGE_LENGTH || !DATA_IMAGE.test(image))) {
    throw new Error("截图格式无效或图片过大，请选择较小的图片。");
  }
  const images = value as string[];
  if (images.reduce((length, image) => length + image.length, 0) > MAX_ASSISTANT_IMAGES_LENGTH) {
    throw new Error("截图总大小过大，请减少图片或分批上传。");
  }
  return images;
}

function sourceOf(row: ImageRow, imageCount: number): ImageSource | undefined {
  const source = row.source as ImageSource | undefined;
  if (!source || typeof source !== "object" || Array.isArray(source)
    || !Number.isInteger(source.image_index) || source.image_index < 1 || source.image_index > imageCount
    || !Number.isInteger(source.row_index) || source.row_index < 1
    || !(source.kind === undefined || ["statement", "receipt", "unknown"].includes(source.kind))
    || !(source.time === null || (typeof source.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(source.time)))
    || !(source.transaction_id === null || (typeof source.transaction_id === "string" && source.transaction_id.trim().length > 0 && source.transaction_id.length <= 120))) return undefined;
  return source;
}

function financialIdentity(row: ImageRow): string | undefined {
  if (!["income", "expense"].includes(row.type as string) || !Number.isSafeInteger(row.amount_cents)
    || (row.amount_cents as number) <= 0 || (row.amount_cents as number) > MAX_AMOUNT_CENTS
    || !isCalendarDate(row.transaction_date) || typeof row.description !== "string" || !row.description.trim() || row.description.length > 500) return undefined;
  // Do not group names by semantics: two merchants can have identical amounts.
  return JSON.stringify([row.type, row.transaction_date, row.amount_cents, row.description.trim().replace(/\s+/g, " ")]);
}

function samePrintedTransaction(left: ImageRow, right: ImageRow, imageCount: number): boolean {
  const identity = financialIdentity(left);
  if (!identity || identity !== financialIdentity(right)) return false;
  const a = sourceOf(left, imageCount), b = sourceOf(right, imageCount);
  if (!a || !b) return false;
  // Conflicting printed evidence always wins over a coincidental match.
  if (a.time && b.time && a.time !== b.time) return false;
  if (a.transaction_id && b.transaction_id && a.transaction_id.trim() !== b.transaction_id.trim()) return false;
  return Boolean((a.kind === "statement" && b.kind === "statement" && a.time && b.time && a.time === b.time)
    || (a.transaction_id && b.transaction_id && a.transaction_id.trim() === b.transaction_id.trim()));
}

function conflictingDetails(left: ImageRow, right: ImageRow): boolean {
  for (const field of ["payment_method", "member_id"]) {
    const a = typeof left[field] === "string" ? left[field].trim() : "";
    const b = typeof right[field] === "string" ? right[field].trim() : "";
    if (a && b && a !== b) return true;
  }
  return false;
}

function sameTransaction(left: ImageRow, right: ImageRow, imageCount: number): boolean {
  return samePrintedTransaction(left, right, imageCount) && !conflictingDetails(left, right);
}

/** Only join a previous image's suffix to the next image's prefix.
 * No historical draft, saved transaction or same-image row is removed.
 * Missing, conflicting or ambiguous provenance leaves rows intact for review.
 */
export function mergeAssistantImageImport(raw: unknown, imageCount: number): { output: unknown; summary?: AssistantImageImportSummary } {
  const output = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (imageCount < 2 || !output || typeof output !== "object" || Array.isArray(output)) return { output: raw };
  const plan = output as Record<string, unknown>;
  if (plan.action !== "record" || !Array.isArray(plan.drafts)) return { output: raw };
  const drafts = plan.drafts;
  // A bounded response is required before considering overlap. validatePlan
  // still enforces the 20 unique draft limit after every visible row is read.
  if (drafts.length > imageCount * 20) throw new Error("识别到的账目过多，一次最多生成20笔独立草稿，请分批上传。");
  const summary: AssistantImageImportSummary = {
    image_count: imageCount, extracted_count: drafts.length, removed_duplicates: 0,
    retained_count: drafts.length, review_required: false, warnings: [],
  };
  const warn = (message: string) => { summary.review_required = true; if (!summary.warnings.includes(message)) summary.warnings.push(message); };
  const rows: ImageRow[] = drafts.map(row => row && typeof row === "object" && !Array.isArray(row) ? row as ImageRow : {});
  const groups: ImageRow[][] = Array.from({ length: imageCount }, () => []);
  let lastImage = 1;
  let ordered = true;
  for (const row of rows) {
    const source = sourceOf(row, imageCount);
    if (!source || source.image_index < lastImage || source.row_index !== groups[source.image_index - 1].length + 1) {
      ordered = false; break;
    }
    lastImage = source.image_index;
    groups[source.image_index - 1].push(row);
  }
  if (!ordered) {
    warn("部分账目的截图来源或行顺序不完整，已保留全部账目，请核对可能重复的交易。");
    return { output, summary };
  }
  if (groups.some(group => !group.length)) warn("有截图未识别到完整交易，请核对图片中的账目是否遗漏。");
  if (rows.some(row => { const source = sourceOf(row, imageCount)!; return source.kind !== "statement" && !source.transaction_id; })) {
    warn("部分截图无法确认是连续的流水列表，且没有交易单号，已保留相似账目，请核对。");
  }
  if (rows.some(row => { const source = sourceOf(row, imageCount)!; return !source.time && !source.transaction_id; })) {
    warn("部分账目没有可核对的时间或交易单号，已保留，请核对可能重复的交易。");
  }
  const removed = new Set<ImageRow>();
  for (let index = 1; index < groups.length; index++) {
    const previous = groups[index - 1], current = groups[index];
    const limit = Math.min(previous.length, current.length);
    let overlap = 0;
    for (let length = limit; length > 0; length--) {
      const suffix = previous.slice(previous.length - length), prefix = current.slice(0, length);
      if (suffix.some((row, offset) => samePrintedTransaction(row, prefix[offset], imageCount) && conflictingDetails(row, prefix[offset]))) {
        warn("相邻截图中的相似交易存在支付方式或成员冲突，已保留，请逐笔核对。");
      }
      if (!suffix.every((row, offset) => sameTransaction(row, prefix[offset], imageCount))) continue;
      // Repeated fully identical rows within either original screenshot make
      // this boundary ambiguous even if their minute and amount match.
      if (suffix.some((row, offset) => previous.filter(candidate => sameTransaction(row, candidate, imageCount)).length !== 1
        || current.filter(candidate => sameTransaction(prefix[offset], candidate, imageCount)).length !== 1)) {
        warn("相邻截图中存在同时间、同金额的多笔相似交易，已保留，请逐笔核对。");
        break;
      }
      overlap = length; break;
    }
    for (const row of current.slice(0, overlap)) removed.add(row);
  }
  summary.removed_duplicates = removed.size;
  summary.retained_count = drafts.length - removed.size;
  return { output: { ...plan, drafts: drafts.filter((_: unknown, index: number) => !removed.has(rows[index])) }, summary };
}
