"use client";

import { AssistantMemberLabel } from "@/components/assistant/member-picker";
import { CategoryIcon } from "@/components/icons/entity-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssistantCategory, AssistantMember } from "@/lib/assistant";
import type { EditableAssistantDraft as EditableDraft } from "@/lib/assistant-task-client";
import { invalidDraftFields } from "@/lib/assistant-draft-editor";
import { cn } from "@/lib/utils";
import { fieldClass, fieldLabelClass, incompleteFieldClass } from "./page-styles";

type Props = {
  draft: EditableDraft;
  invalid: ReturnType<typeof invalidDraftFields>;
  locked: boolean;
  categories: AssistantCategory[];
  members: AssistantMember[];
  fields?: (keyof EditableDraft)[];
  onUpdate: (update: Partial<EditableDraft>) => void;
};

export function AssistantDraftEditor({ draft: d, invalid, locked, categories, members, onUpdate, fields = ["type", "amount", "category_id", "member_id", "transaction_date", "payment_method", "description"] }: Props) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-4">
    {fields.includes("type") && <div className={fieldLabelClass}>
      <Label id={`${d.id}-type-label`}>收支类型</Label>
      <div className="flex h-11 items-center gap-1 rounded-md border bg-muted/50 p-1" role="group" aria-labelledby={`${d.id}-type-label`}>
        {(["expense", "income"] as const).map(type => (
          <Button key={type} type="button" className="h-full min-w-0 flex-1 px-2 sm:px-3" variant={d.type === type ? "default" : "ghost"}
            aria-pressed={d.type === type} disabled={locked}
            onClick={() => onUpdate({ type, category_id: d.type === type ? d.category_id : null })}>
            {type === "expense" ? "支出" : "收入"}
          </Button>
        ))}
      </div>
    </div>}
    {fields.includes("amount") && <div className={fieldLabelClass}>
      <Label htmlFor={`${d.id}-amount`}>金额（元） *</Label>
      <Input id={`${d.id}-amount`} className={cn("h-11 min-w-0 text-2xl font-semibold md:text-2xl", invalid.amount && incompleteFieldClass)} aria-invalid={invalid.amount || undefined} autoComplete="off" aria-label="金额" inputMode="decimal" value={d.amount} disabled={locked} onChange={e => onUpdate({ amount: e.target.value })} placeholder="0.00" />
    </div>}
    {fields.includes("category_id") && <div className={fieldLabelClass}>
      <Label htmlFor={`${d.id}-category`}>分类 *</Label>
      <Select value={d.category_id || ""} disabled={locked} onValueChange={value => onUpdate({ category_id: value === "unselected" ? null : value })}>
        <SelectTrigger id={`${d.id}-category`} className={cn(fieldClass, invalid.category && incompleteFieldClass)} aria-invalid={invalid.category || undefined} aria-label="分类"><SelectValue placeholder="请选择分类" /></SelectTrigger>
        <SelectContent><SelectItem value="unselected">请选择分类</SelectItem>{categories.filter(c => c.type === d.type).map(c => <SelectItem key={c.id} value={c.id}><span className="inline-flex items-center gap-2"><CategoryIcon icon={c.icon} className="size-4" />{c.name}</span></SelectItem>)}</SelectContent>
      </Select>
    </div>}
    {fields.includes("member_id") && <div className={fieldLabelClass}>
      <Label htmlFor={`${d.id}-member`}>家庭成员 *</Label>
      <Select value={d.member_id || ""} disabled={locked} onValueChange={value => onUpdate({ member_id: value === "unselected" ? null : value })}>
        <SelectTrigger id={`${d.id}-member`} className={cn(fieldClass, invalid.member && incompleteFieldClass)} aria-invalid={invalid.member || undefined} aria-label="家庭成员"><SelectValue placeholder="请选择成员" /></SelectTrigger>
        <SelectContent><SelectItem value="unselected">请选择成员</SelectItem>{members.map(m => <SelectItem key={m.id} value={m.id} textValue={m.name}><AssistantMemberLabel member={m} /></SelectItem>)}</SelectContent>
      </Select>
    </div>}
    {fields.includes("transaction_date") && <div className={cn(fieldLabelClass, "col-span-2 sm:col-span-1")}>
      <Label htmlFor={`${d.id}-date`}>交易日期 *</Label>
      <Input id={`${d.id}-date`} className={cn(fieldClass, invalid.date && incompleteFieldClass)} aria-invalid={invalid.date || undefined} aria-label="日期" type="date" value={d.transaction_date} disabled={locked} onChange={e => onUpdate({ transaction_date: e.target.value })} />
    </div>}
    {fields.includes("payment_method") && <div className={cn(fieldLabelClass, "col-span-2 sm:col-span-1")}>
      <Label htmlFor={`${d.id}-payment`}>支付方式</Label>
      <Input id={`${d.id}-payment`} className={fieldClass} aria-label="支付方式" value={d.payment_method || ""} maxLength={40} disabled={locked} onChange={e => onUpdate({ payment_method: e.target.value || null })} placeholder="可选" />
    </div>}
    {fields.includes("description") && <div className={cn(fieldLabelClass, "col-span-2")}>
      <Label htmlFor={`${d.id}-description`}>备注</Label>
      <Input id={`${d.id}-description`} className={fieldClass} aria-label="备注" value={d.description} maxLength={500} disabled={locked} onChange={e => onUpdate({ description: e.target.value })} placeholder="如午餐、超市采购（可选）" />
    </div>}
  </div>;
}
