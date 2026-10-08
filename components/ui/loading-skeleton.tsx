import type { HTMLAttributes, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { cn } from "@/lib/utils";

/** Decorative placeholders never enter the accessibility tree. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} aria-hidden="true" className={cn("rounded-md bg-muted-foreground/10 motion-safe:animate-pulse", className)} />;
}

export function SkeletonRegion({ label, className, children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return <div role="status" data-loading-skeleton className={className}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" aria-busy="true">{children}</div>
  </div>;
}

export function SummaryCardsSkeleton({ label = "正在加载收支汇总…" }: { label?: string }) {
  return <SkeletonRegion label={label}>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {["总收入", "总支出", "结余"].map(title => <Card key={title}>
        <CardContent className="pt-4 sm:pt-5">
          <div className="flex min-h-16 items-center justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <Skeleton className="h-8 w-28 max-w-full" />
            </div>
            <Skeleton className="size-10 shrink-0" />
          </div>
        </CardContent>
      </Card>)}
    </div>
  </SkeletonRegion>;
}

/** Shares the real table/card breakpoint, without a wide table on small screens. */
export function RecordListSkeleton({ label, columns, rows = 5, breakpoint = "md", tableClassName, leadingIcon = false, grouped = false }: {
  label: string;
  columns: readonly string[];
  rows?: number;
  breakpoint?: "md" | "lg";
  tableClassName?: string;
  leadingIcon?: boolean;
  grouped?: boolean;
}) {
  return <SkeletonRegion label={label}>
    <HorizontalScroll keyboardFocusable={false} className={breakpoint === "lg" ? "hidden lg:block" : "hidden md:block"}>
      <table className={cn("w-full table-fixed", tableClassName)}>
        <thead><tr className="border-b bg-muted/50">
          {columns.map((title, index) => <th key={`${title}-${index}`} className="p-4 text-left text-sm font-semibold text-muted-foreground last:text-right">{title}</th>)}
        </tr></thead>
        <tbody>
          {grouped && <tr className="border-b bg-muted/70"><td colSpan={columns.length} className="p-4">
            <div className="flex items-center justify-between gap-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-40" /></div>
          </td></tr>}
          {Array.from({ length: rows }, (_, row) => <tr key={row} className="border-b last:border-0">
            {columns.map((title, column) => <td key={`${title}-${column}`} className="p-4">
              <div className={cn("flex min-h-10 items-center gap-3", column === columns.length - 1 && "justify-end")}>
                {leadingIcon && column === 0 && <Skeleton className="size-10 shrink-0 rounded-lg" />}
                <Skeleton className={cn("h-4 min-w-0 max-w-full", (row + column) % 3 === 0 ? "w-16" : "w-24")} />
              </div>
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </HorizontalScroll>
    <div className={breakpoint === "lg" ? "lg:hidden" : "md:hidden"}>
      {grouped && <div className="flex items-center justify-between gap-4 bg-muted/70 px-4 py-3">
        <Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-36" />
      </div>}
      <div className="divide-y">
        {Array.from({ length: Math.min(rows, 4) }, (_, row) => <div key={row} className="flex items-start gap-3 p-4">
          {leadingIcon && <Skeleton className="size-12 shrink-0 rounded-xl" />}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center justify-between gap-4"><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-16" /></div>
            <Skeleton className={cn("h-4 max-w-full", row % 2 ? "w-40" : "w-52")} />
            <div className="flex items-center justify-between gap-4"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-24" /></div>
          </div>
        </div>)}
      </div>
    </div>
  </SkeletonRegion>;
}
