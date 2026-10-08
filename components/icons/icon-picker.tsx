"use client";

import { useId, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CategoryIcon, MemberAvatar } from "@/components/icons/entity-icon";
import {
  CATEGORY_ICON_OPTIONS, MEMBER_AVATAR_OPTIONS, DEFAULT_CATEGORY_ICON, DEFAULT_MEMBER_AVATAR,
} from "@/lib/entity-icon-catalog";
import { cn } from "@/lib/utils";

export function IconPicker({ kind, value, onChange, previewName = "我", previewMemberId }: {
  kind: "category" | "member";
  value: string;
  onChange: (value: string) => void;
  previewName?: string;
  previewMemberId?: string;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("全部");
  const options = kind === "category" ? CATEGORY_ICON_OPTIONS : MEMBER_AVATAR_OPTIONS;
  const selected = options.find(option => option.value === value)
    || options.find(option => option.value === (kind === "category" ? DEFAULT_CATEGORY_ICON : DEFAULT_MEMBER_AVATAR))!;
  const query = search.trim().toLocaleLowerCase();
  const filtered = options.filter(option =>
    (group === "全部" || option.group === group)
    && `${option.label} ${option.text || ""} ${option.keywords} ${option.value}`.toLocaleLowerCase().includes(query),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3" aria-live="polite">
        {kind === "category" ? (
          <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
            <CategoryIcon icon={selected.value} className="size-6" />
          </span>
        ) : <MemberAvatar avatar={selected.value} name={previewName} memberId={previewMemberId} className="size-10 text-lg" />}
        <span className="text-sm"><span className="text-muted-foreground">当前选择：</span>{selected.label}{selected.text ? "（文字）" : ""}</span>
      </div>

      <>
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">{kind === "category" ? "搜索分类图标" : "搜索成员头像"}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={kind === "category" ? "搜索图标，如餐饮、交通、医疗" : "搜索头像，如爸爸、妈妈、姥姥"} className="pl-9"
            onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="图标分组">
          {["全部", ...new Set(options.map(option => option.group))].map(label => (
            <button key={label} type="button" aria-pressed={group === label} onClick={() => setGroup(label)}
              className={cn("min-h-9 rounded-md px-2.5 py-1 text-xs transition-colors", group === label ? "bg-secondary font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>
      </>

      <div role="group" aria-label={kind === "category" ? "选择分类图标" : "选择成员头像"}
        className="grid grid-cols-4 gap-2 p-1 sm:grid-cols-6">
        {filtered.map(option => (
          <button key={option.value} type="button" aria-label={option.text ? `${option.label}（文字）` : option.label} aria-pressed={selected.value === option.value}
            onClick={() => onChange(option.value)}
            className={cn("relative flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border px-1 py-2 transition-colors",
              selected.value === option.value ? "border-primary bg-secondary text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-muted/50")}>
            {kind === "category" ? <CategoryIcon icon={option.value} className="size-6" />
              : <MemberAvatar avatar={option.value} name={previewName} memberId={previewMemberId} className="size-8 text-sm" />}
            <span className="text-xs">{option.label}</span>
            {selected.value === option.value && <Check aria-hidden="true" className="absolute right-1 top-1 size-3" />}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <p role="status" className="py-3 text-center text-sm text-muted-foreground">没有找到匹配的图标，试试其他关键词</p>}
    </div>
  );
}
