import { Check } from "lucide-react";
import { noteColors } from "@/lib/notes";

export function ColorPicker({ value, onChange, disabled = false, filter = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; filter?: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-1" role="group" aria-label={filter ? "按颜色筛选" : "便利贴颜色"}>
    {filter ? <button type="button" className="mr-1 min-h-10 px-2 text-xs text-muted-foreground" aria-pressed={value === "all"} onClick={() => onChange("all")}>全部颜色</button> : null}
    {noteColors.map((color) => <button type="button" key={color.value} title={color.label} aria-label={color.label} aria-pressed={value === color.value} disabled={disabled} onClick={() => onChange(color.value)} className="flex size-10 items-center justify-center rounded-full disabled:opacity-50">
      <span className="flex size-6 items-center justify-center rounded-full border" style={{ background: color.background, borderColor: value === color.value ? "#5c6057" : color.edge }}>{value === color.value ? <Check className="size-3.5 text-slate-700" /> : null}</span>
    </button>)}
  </div>;
}
