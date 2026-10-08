"use client";

import { useListResource } from "@/hooks/use-list-resource";
import { ListSyncFeedback } from "@/components/ui/list-sync-feedback";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Check, ChevronRight, CircleAlert, CircleCheck, CircleDashed, Link2, LoaderCircle, Pencil, Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type SourceType = "given_gift" | "gift_group" | "loan" | "repayment";
type LinkedTransaction = { id: string; type: "income" | "expense"; amount: number; description: string | null; transaction_date: string };
const LinksContext = createContext<{
  sourceType: SourceType;
  data: Record<string, LinkedTransaction>;
  loading: boolean;
  loadedIds: string[];
  error: string | null;
  update: (sourceId: string, transaction: LinkedTransaction | null) => void;
} | null>(null);

export function TransactionLinksProvider({ sourceType, sourceIds, scopeKey = "", children }: {
  sourceType: SourceType; sourceIds: string[]; scopeKey?: string; children: ReactNode;
}) {
  const idsKey = JSON.stringify([...new Set(sourceIds)].sort());
  const loader = useCallback(async (signal: AbortSignal) => {
    const ids: string[] = JSON.parse(idsKey);
    const data: Record<string, LinkedTransaction> = {};
    for (let offset = 0; offset < ids.length; offset += 100) {
      const params = new URLSearchParams({ sourceType, sourceIds: ids.slice(offset, offset + 100).join(",") });
      const response = await fetch(`/api/transaction-links?${params}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "关联状态加载失败");
      for (const link of result.data as { sourceId: string; transaction: LinkedTransaction }[]) data[link.sourceId] = link.transaction;
    }
    return { data, ids };
  }, [sourceType, idsKey]);
  const resource = useListResource(`${sourceType}:${scopeKey}`, loader);
  const update = (sourceId: string, transaction: LinkedTransaction | null) => resource.update(current => {
    const next = { ...current.data };
    if (transaction) next[sourceId] = transaction;
    else delete next[sourceId];
    return { data: next, ids: [...new Set([...current.ids, sourceId])] };
  });
  return <LinksContext.Provider value={{ sourceType, data: resource.data?.data ?? {}, loadedIds: resource.data?.ids ?? [], loading: resource.isLoading, error: resource.loadError ?? resource.refreshError, update }}>
    <ListSyncFeedback error={resource.refreshError} refreshing={resource.isRefreshing} onRetry={resource.refresh} />
    {children}
  </LinksContext.Provider>;
}

export function TransactionLinkButton({ sourceId, sourceDate, label = "这条记录" }: { sourceId: string; sourceDate: string; label?: string }) {
  const context = useContext(LinksContext);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  if (!context) throw new Error("TransactionLinkButton requires TransactionLinksProvider");
  const linked = context.data[sourceId];
  const waiting = context.loading || !context.loadedIds.includes(sourceId);
  const failed = waiting && !!context.error;
  const statusLabel = waiting ? failed ? "关联状态读取失败" : "读取关联中" : linked ? "已关联收支" : "未关联收支";
  const actionLabel = waiting ? failed ? "重试" : null : linked ? "查看" : "去关联";
  const StatusIcon = waiting ? failed ? CircleAlert : LoaderCircle : linked ? CircleCheck : CircleDashed;
  return <>
    <Button type="button" variant="outline" size="sm" className={cn(
      "h-auto min-h-8 max-w-full flex-wrap justify-start gap-2 px-2.5 py-1.5 text-xs shadow-none",
      waiting ? failed ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900" : "border-dashed bg-muted/30 text-muted-foreground" : linked ? "border-green-200 bg-green-50 text-green-800 hover:border-green-300 hover:bg-green-100 hover:text-green-900" : "border-dashed border-slate-300 bg-muted/20 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground",
    )} onClick={() => setOpen(true)} aria-label={`${label}：${statusLabel}${actionLabel ? `，${actionLabel}` : ""}`} aria-haspopup="dialog" aria-expanded={open}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><StatusIcon aria-hidden="true" className={cn("size-3.5 shrink-0", waiting && !failed && "animate-spin")} />{statusLabel}</span>
      {actionLabel ? <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap border-l pl-2", !waiting && !linked ? "border-slate-300 text-primary" : "border-current/20")}>
        {!waiting && !linked ? <Plus aria-hidden="true" className="size-3" /> : null}{actionLabel}{!waiting && linked ? <ChevronRight aria-hidden="true" className="size-3" /> : null}
      </span> : null}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy.current) setOpen(value); }}>
      {open ? <LinkEditor sourceType={context.sourceType} sourceId={sourceId} sourceDate={sourceDate} label={label} busyRef={busy} onChanged={transaction => context.update(sourceId, transaction)} /> : null}
    </Dialog>
  </>;
}

function TransactionSummary({ transaction, status }: { transaction: LinkedTransaction; status?: "selected" | "current" }) {
  const income = transaction.type === "income";
  return <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
    <span className="min-w-0 break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]">{transaction.description?.trim() || "无备注"}</span>
    <span className={cn("max-w-28 break-all text-right text-base font-semibold leading-6 tabular-nums sm:max-w-36 sm:text-lg", income ? "text-green-700" : "text-red-600")}>
      <span className="mr-0.5 text-xs font-medium">{income ? "+" : "−"}¥</span>{formatCurrency(transaction.amount)}
    </span>
    <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className={cn("rounded px-1.5 py-0.5 font-medium", income ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600")}>{income ? "收入" : "支出"}</span>
      <time dateTime={formatDate(transaction.transaction_date)} className="tabular-nums">{formatDate(transaction.transaction_date)}</time>
      {status ? <span className={cn("ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium", status === "selected" ? "bg-primary/10 text-primary" : "bg-green-100 text-green-800")}>
        {status === "current" ? <CircleCheck aria-hidden="true" className="size-3" /> : null}{status === "selected" ? "已选中 · 待确认" : "当前已关联"}
      </span> : null}
    </span>
  </span>;
}

function TransactionOption({ transaction, selected, current, onSelect }: {
  transaction: LinkedTransaction; selected: boolean; current: boolean; onSelect: () => void;
}) {
  return <label className="relative block">
    <input type="radio" name="linked-transaction" className="peer sr-only" value={transaction.id} checked={selected} onChange={onSelect} disabled={current} />
    <span className={cn(
      "flex items-start gap-3 rounded-lg border p-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
      current ? "cursor-default border-green-200 bg-green-50/60" : "cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
      selected ? "border-primary bg-primary/5 ring-1 ring-primary" : !current && "bg-background hover:border-primary/40 hover:bg-muted/40",
    )}>
      <span aria-hidden="true" className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border", current ? "border-transparent text-green-700" : selected ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 bg-background")}>
        {current ? <CircleCheck className="size-5" /> : selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      <TransactionSummary transaction={transaction} status={current ? "current" : selected ? "selected" : undefined} />
    </span>
  </label>;
}

function LinkEditor({ sourceType, sourceId, sourceDate, label, busyRef, onChanged }: {
  sourceType: SourceType; sourceId: string; sourceDate: string; label: string;
  busyRef: { current: boolean }; onChanged: (transaction: LinkedTransaction | null) => void;
}) {
  const currentVersion = useRef(0);
  const [current, setCurrent] = useState<LinkedTransaction | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [date, setDate] = useState(sourceDate);
  const defaultType = sourceType === "given_gift" ? "expense" : sourceType === "gift_group" ? "income" : "all";
  const [type, setType] = useState<string>(defaultType);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<LinkedTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const showSearch = loaded && (!current || editing);
  const query = new URLSearchParams({ ...(keyword ? { q: keyword } : {}), ...(date ? { startDate: date, endDate: date } : {}), ...(type !== "all" ? { type } : {}) }).toString();
  const [results, setResults] = useState<{ key: string; data: LinkedTransaction[]; error: string | null }>({ key: "", data: [], error: null });
  const searchKey = `${query}:${reload}`;
  useEffect(() => { const timer = setTimeout(() => setKeyword(q.trim()), 250); return () => clearTimeout(timer); }, [q]);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++currentVersion.current;
    async function loadCurrent() {
      if (busyRef.current) return;
      try {
        const response = await fetch(`/api/transaction-links?${new URLSearchParams({ sourceType, sourceId })}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "关联状态加载失败");
        if (!controller.signal.aborted && version === currentVersion.current) { setCurrent(result.data); setLoaded(true); setCurrentError(null); }
      } catch (error) { if (!controller.signal.aborted && version === currentVersion.current) { setCurrentError(error instanceof Error ? error.message : "关联状态加载失败"); setLoaded(false); } }
    }
    void loadCurrent();
    return () => controller.abort();
  }, [sourceType, sourceId, reload, busyRef]);
  useEffect(() => {
    if (!showSearch) return;
    const controller = new AbortController();
    async function search() {
      try {
        const response = await fetch(`/api/transactions?${query}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "收支记录加载失败");
        if (!controller.signal.aborted) setResults({ key: searchKey, data: result.data, error: null });
      } catch (error) { if (!controller.signal.aborted) setResults({ key: searchKey, data: [], error: error instanceof Error ? error.message : "收支记录加载失败" }); }
    }
    void search();
    return () => controller.abort();
  }, [query, searchKey, showSearch]);
  const startEditing = () => {
    if (!current) return;
    setQ(""); setKeyword(""); setSelected(null); setSaveError(null);
    setDate(formatDate(current.transaction_date)); setType(current.type);
    setEditing(true);
  };
  const mutate = async (transaction: LinkedTransaction | null) => {
    if (busyRef.current || !loaded) return;
    if (transaction && (results.key !== searchKey || q.trim() !== keyword || !results.data.some(row => row.id === transaction.id))) return;
    busyRef.current = true;
    currentVersion.current += 1;
    setBusy(true); setSaveError(null);
    try {
      const response = await fetch("/api/transaction-links", {
        method: transaction ? "PUT" : "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId, ...(transaction ? { transactionId: transaction.id } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "关联保存失败，请重试");
      currentVersion.current += 1;
      setCurrent(transaction ? result.data : null); setSelected(null); onChanged(transaction ? result.data : null);
      setEditing(false);
      if (!transaction) {
        setQ(""); setKeyword(""); setDate(sourceDate); setType(defaultType);
      }
    } catch (error) { setSaveError(error instanceof Error ? error.message : "关联保存失败，请重试"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>{!loaded ? "收支关联" : current ? editing ? "修改收支关联" : "收支关联详情" : "关联已有收支"}</DialogTitle><DialogDescription>{label}。只保存关联，不新增交易、不修改金额；解除关联也不会删除收支。</DialogDescription></DialogHeader>
    <DialogBody className="space-y-4">
      <section className={cn("space-y-3 rounded-lg border p-3", loaded && current ? "border-green-200 bg-green-50/50" : currentError ? "border-amber-200 bg-amber-50/50" : "border-dashed bg-muted/30")} aria-label="当前关联">
        {!loaded ? <p className={cn("flex items-center gap-2 text-sm", currentError ? "text-amber-800" : "text-muted-foreground")} role={currentError ? "alert" : "status"}>{currentError ? <CircleAlert aria-hidden="true" className="size-4 shrink-0" /> : <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />}{currentError || "正在读取关联…"}</p> : current ? <>
          <p className="inline-flex items-center gap-1.5 rounded-md bg-green-100 px-2 py-1 text-xs font-semibold text-green-800"><CircleCheck aria-hidden="true" className="size-3.5" />已关联收支</p><TransactionSummary transaction={current} />
          <div className="flex flex-wrap gap-2 border-t border-green-200/60 pt-3">
            <Button asChild size="sm" variant="outline"><Link href={`/dashboard?${new URLSearchParams({ startDate: formatDate(current.transaction_date), endDate: formatDate(current.transaction_date) })}`}><CalendarDays aria-hidden="true" />查看当天收支</Link></Button>
            {!editing ? <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={startEditing}><Pencil aria-hidden="true" />修改关联</Button> : null}
            <Button type="button" variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" disabled={busy} onClick={() => void mutate(null)}><Unlink aria-hidden="true" />解除关联</Button>
          </div>
        </> : <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><CircleDashed aria-hidden="true" className="size-4" />未关联收支</p>
          <p className="text-xs text-muted-foreground">从下方选择已有收支，再点击“确认关联”。</p>
        </>}
        {currentError ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重试关联状态</Button> : null}
      </section>
      <p className="text-xs text-muted-foreground">每条台账和每笔收支最多保留一个关联。请核对日期、金额及备注；金额不会自动分摊或同步修改。</p>
      {showSearch ? <>
      <div className="space-y-2">
        <label className="block space-y-1 text-sm"><span>搜索已有收支备注</span><Input value={q} onChange={event => { setQ(event.target.value); setSelected(null); }} disabled={busy} placeholder="输入备注关键词" /></label>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm"><span>收支类型</span><select className="block h-9 w-full rounded-md border bg-background px-2" value={type} disabled={busy} onChange={event => { setType(event.target.value); setSelected(null); }}><option value="all">全部收支</option><option value="income">收入</option><option value="expense">支出</option></select></label>
          <label className="min-w-0 flex-1 space-y-1 text-sm"><span>交易日期（可选）</span><Input type="date" value={date} disabled={busy} onChange={event => { setDate(event.target.value); setSelected(null); }} /></label>
        </div>
      </div>
      {results.key !== searchKey ? <p role="status">正在查找收支…</p> : results.error ? <div role="alert" className="space-y-2"><p>{results.error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重试收支列表</Button></div> : results.data.length === 0 ? <p className="py-4 text-sm text-muted-foreground">没有匹配的收支，请调整关键词或日期。需要先在记账页保存收支，再回到这里关联。</p> : <fieldset disabled={busy || !loaded || q.trim() !== keyword} className="min-w-0 space-y-2"><legend className="sr-only">选择要关联的收支</legend>{results.data.slice(0, 50).map(transaction => <TransactionOption key={transaction.id} transaction={transaction} selected={selected?.id === transaction.id} current={transaction.id === current?.id} onSelect={() => setSelected(transaction)} />)}{results.data.length > 50 ? <p className="text-xs text-muted-foreground">当前显示前 50 笔，请用关键词或日期缩小范围。</p> : null}</fieldset>}
      </> : null}
      {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
    </DialogBody>
    {showSearch ? <div className="flex justify-end gap-2">
      {current ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setEditing(false); setSelected(null); setSaveError(null); }}>取消修改</Button> : null}
      <Button type="button" disabled={!selected || !loaded || busy || results.key !== searchKey || q.trim() !== keyword || !results.data.some(row => row.id === selected.id)} onClick={() => void mutate(selected)}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Link2 aria-hidden="true" />}{busy ? "保存中…" : current ? "确认更换关联" : "确认关联"}</Button>
    </div> : null}
  </DialogContent>;
}
