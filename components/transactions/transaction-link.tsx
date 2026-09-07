"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/utils";

type SourceType = "given_gift" | "gift_group" | "loan" | "repayment";
type LinkedTransaction = { id: string; type: "income" | "expense"; amount: number; description: string | null; transaction_date: string };
type LinksState = { key: string; data: Record<string, LinkedTransaction>; error: string | null };
const LinksContext = createContext<{
  sourceType: SourceType;
  data: Record<string, LinkedTransaction>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} | null>(null);

export function TransactionLinksProvider({ sourceType, sourceIds, children }: {
  sourceType: SourceType; sourceIds: string[]; children: ReactNode;
}) {
  const idsKey = JSON.stringify([...new Set(sourceIds)].sort());
  const [revision, setRevision] = useState(0);
  const requestKey = `${sourceType}:${idsKey}:${revision}`;
  const [state, setState] = useState<LinksState>({ key: "", data: {}, error: null });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const ids = JSON.parse(idsKey) as string[];
      try {
        const data: Record<string, LinkedTransaction> = {};
        for (let offset = 0; offset < ids.length; offset += 100) {
          const params = new URLSearchParams({ sourceType, sourceIds: ids.slice(offset, offset + 100).join(",") });
          const response = await fetch(`/api/transaction-links?${params}`, { cache: "no-store", signal: controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "关联状态加载失败");
          for (const link of result.data as { sourceId: string; transaction: LinkedTransaction }[]) data[link.sourceId] = link.transaction;
        }
        if (!controller.signal.aborted) setState({ key: requestKey, data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key: requestKey, data: {}, error: error instanceof Error ? error.message : "关联状态加载失败" });
      }
    }
    void load();
    return () => controller.abort();
  }, [sourceType, idsKey, requestKey]);
  return <LinksContext.Provider value={{ sourceType, data: state.key === requestKey ? state.data : {}, loading: state.key !== requestKey, error: state.key === requestKey ? state.error : null, refresh: () => setRevision(value => value + 1) }}>{children}</LinksContext.Provider>;
}

export function TransactionLinkButton({ sourceId, label = "这条记录" }: { sourceId: string; label?: string }) {
  const context = useContext(LinksContext);
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  if (!context) throw new Error("TransactionLinkButton requires TransactionLinksProvider");
  const linked = context.data[sourceId];
  return <>
    <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal px-1 text-xs" onClick={() => setOpen(true)} aria-label={`${label}：${linked ? "已关联收支" : "查看收支关联"}`}>
      <Link2 className="h-3.5 w-3.5 shrink-0" />
      {context.loading ? "读取关联…" : context.error ? "关联状态待重试" : linked ? "已关联收支" : "关联已有收支"}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy.current) setOpen(value); }}>
      {open ? <LinkEditor sourceType={context.sourceType} sourceId={sourceId} label={label} busyRef={busy} onChanged={context.refresh} /> : null}
    </Dialog>
  </>;
}

function TransactionSummary({ transaction }: { transaction: LinkedTransaction }) {
  return <span className="block min-w-0 space-y-1">
    <span className="block font-medium">{transaction.type === "income" ? "收入" : "支出"} {formatCurrency(transaction.amount)} · {formatDate(transaction.transaction_date)}</span>
    <span className="block break-words text-sm text-muted-foreground">{transaction.description || "无备注"}</span>
  </span>;
}

function LinkEditor({ sourceType, sourceId, label, busyRef, onChanged }: {
  sourceType: SourceType; sourceId: string; label: string;
  busyRef: { current: boolean }; onChanged: () => void;
}) {
  const currentVersion = useRef(0);
  const [current, setCurrent] = useState<LinkedTransaction | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState(sourceType === "given_gift" ? "expense" : sourceType === "gift_group" ? "income" : "all");
  const [selected, setSelected] = useState<LinkedTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  }, [query, searchKey]);
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
      setCurrent(transaction ? result.data : null); setSelected(null); onChanged();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "关联保存失败，请重试"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>关联已有收支</DialogTitle><DialogDescription>{label}。只保存关联，不新增交易、不修改金额；解除关联也不会删除收支。</DialogDescription></DialogHeader>
    <DialogBody className="space-y-4">
      <section className="rounded-md border bg-muted/30 p-3 space-y-2" aria-label="当前关联">
        {!loaded ? <p role={currentError ? "alert" : "status"}>{currentError || "正在读取关联…"}</p> : current ? <>
          <p className="text-sm font-medium">已关联</p><TransactionSummary transaction={current} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/dashboard?${new URLSearchParams({ startDate: current.transaction_date.slice(0, 10), endDate: current.transaction_date.slice(0, 10) })}`}>查看当天收支</Link></Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void mutate(null)}>解除关联</Button>
          </div>
        </> : <p className="text-sm">尚未关联收支。这条台账记录不会自动计入收支统计。</p>}
        {currentError ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重试关联状态</Button> : null}
      </section>
      <p className="text-xs text-muted-foreground">每条台账和每笔收支最多保留一个关联。请核对日期、金额及备注；金额不会自动分摊或同步修改。</p>
      <div className="space-y-2">
        <label className="block space-y-1 text-sm"><span>搜索已有收支备注</span><Input value={q} onChange={event => { setQ(event.target.value); setSelected(null); }} disabled={busy} placeholder="输入备注关键词" /></label>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm"><span>收支类型</span><select className="block h-9 w-full rounded-md border bg-background px-2" value={type} disabled={busy} onChange={event => { setType(event.target.value); setSelected(null); }}><option value="all">全部收支</option><option value="income">收入</option><option value="expense">支出</option></select></label>
          <label className="min-w-0 flex-1 space-y-1 text-sm"><span>交易日期（可选）</span><Input type="date" value={date} disabled={busy} onChange={event => { setDate(event.target.value); setSelected(null); }} /></label>
        </div>
      </div>
      {results.key !== searchKey ? <p role="status">正在查找收支…</p> : results.error ? <div role="alert" className="space-y-2"><p>{results.error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重试收支列表</Button></div> : results.data.length === 0 ? <p className="py-4 text-sm text-muted-foreground">没有匹配的收支，请调整关键词或日期。需要先在记账页保存收支，再回到这里关联。</p> : <fieldset disabled={busy || !loaded || q.trim() !== keyword} className="min-w-0 space-y-2"><legend className="sr-only">选择要关联的收支</legend>{results.data.slice(0, 50).map(transaction => <label key={transaction.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected?.id === transaction.id ? "border-primary bg-primary/5" : ""}`}>
        <input type="radio" name="linked-transaction" className="mt-1" value={transaction.id} checked={selected?.id === transaction.id} onChange={() => setSelected(transaction)} disabled={transaction.id === current?.id} />
        <TransactionSummary transaction={transaction} />
      </label>)}{results.data.length > 50 ? <p className="text-xs text-muted-foreground">当前显示前 50 笔，请用关键词或日期缩小范围。</p> : null}</fieldset>}
      {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
    </DialogBody>
    <div className="flex justify-end"><Button type="button" disabled={!selected || !loaded || busy || results.key !== searchKey || q.trim() !== keyword || !results.data.some(row => row.id === selected.id)} onClick={() => void mutate(selected)}>{busy ? "保存中…" : current ? "更换关联" : "确认关联"}</Button></div>
  </DialogContent>;
}
