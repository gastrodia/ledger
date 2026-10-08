import { cn } from "@/lib/utils";
import { BRAND_MARK_PATH, BRAND_NAME } from "@/lib/brand";

/** The approved, joined AI lettermark. Keep its silhouette at every size. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 156 88" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d={BRAND_MARK_PATH} />
    </svg>
  );
}

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} role="img" aria-label={BRAND_NAME}>
      <BrandMark className="h-[1.12em] w-auto text-[#6257e8]" />
      <span aria-hidden="true" className="font-bold tracking-[-0.055em] text-[#28243b]">记账</span>
    </span>
  );
}
