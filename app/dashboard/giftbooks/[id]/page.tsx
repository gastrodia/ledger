"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Plus, ArrowLeft, CalendarDays, MapPin, Trash2, Edit, Paperclip, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import type { GiftBook, GiftBookSummary } from "@/types";
import { upload } from "@vercel/blob/client";

type GiftBookDetail = GiftBook & { summary?: GiftBookSummary };

type GiftBookRecordGroupListItem = {
  id: string; // group_id
  counterparty_name: string;
  gift_date: string;
  notes: string | null;
  cash_amount: number | null;
  currency: string | null;
  items_count: number;
  items_estimated_total: number;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
};

type GiftBookRecordGroupDetail = GiftBookRecordGroupListItem & {
  items: Array<{
    id: string;
    item_name: string;
    quantity: number;
    unit: string;
    estimated_value: number;
  }>;
};

function getTodayDateTimeLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T12:00`;
}

function toDateTimeLocal(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return getTodayDateTimeLocal();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hh}:${mm}`;
}

export default function GiftBookDetailPage() {
  const router = useRouter();
  const { confirm } = useConfirm();

  const params = useParams<{ id: string }>();
  const giftbookId = params?.id;

  const [giftbook, setGiftbook] = useState<GiftBookDetail | null>(null);
  const [records, setRecords] = useState<GiftBookRecordGroupListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    name?: string | null;
    type?: string | null;
  } | null>(null);
  const [previewItems, setPreviewItems] = useState<{
    title: string;
    items: GiftBookRecordGroupDetail["items"];
    estimatedTotal: number;
  } | null>(null);
  const [previewItemsLoading, setPreviewItemsLoading] = useState(false);

  const [q, setQ] = useState("");
  const [hasCash, setHasCash] = useState(false);
  const [hasItems, setHasItems] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingGroup, setEditingGroup] = useState<GiftBookRecordGroupDetail | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.append("q", q.trim());
    if (hasCash) p.append("hasCash", "true");
    if (hasItems) p.append("hasItems", "true");
    return p.toString();
  }, [q, hasCash, hasItems]);

  const loadGiftBook = async () => {
    if (!giftbookId) return null;
    const res = await fetch(`/api/giftbooks/${giftbookId}`);
    if (!res.ok) {
      if (res.status === 401) {
        router.push("/login");
        return null;
      }
      throw new Error("获取礼簿失败");
    }
    const result = await res.json();
    return result.data as GiftBookDetail;
  };

  const loadRecords = async () => {
    if (!giftbookId) return [];
    const res = await fetch(`/api/giftbooks/${giftbookId}/records?${queryString}`);
    if (!res.ok) {
      if (res.status === 401) {
        router.push("/login");
        return [];
      }
      throw new Error("获取记录失败");
    }
    const result = await res.json();
    return (result.data || []) as GiftBookRecordGroupListItem[];
  };

  const refreshAll = async () => {
    try {
      setIsLoading(true);
      if (!giftbookId) {
        setGiftbook(null);
        setRecords([]);
        return;
      }
      const [gb, recs] = await Promise.all([loadGiftBook(), loadRecords()]);
      if (gb) setGiftbook(gb);
      setRecords(recs);
    } catch (e) {
      console.error("加载礼簿详情失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const openAdd = () => {
    setModalMode("add");
    setEditingGroup(null);
    setIsModalOpen(true);
  };

  const openEdit = async (g: GiftBookRecordGroupListItem) => {
    setModalMode("edit");
    setEditingGroup(null);
    setIsModalOpen(true);
    setEditingLoading(true);
    try {
      const res = await fetch(`/api/gift-record-groups/${g.id}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取详情失败");
      }
      const result = await res.json();
      setEditingGroup(result.data || null);
    } catch (e) {
      console.error("加载礼簿记录详情失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
      setIsModalOpen(false);
    } finally {
      setEditingLoading(false);
    }
  };

  const openItemsPreview = async (g: GiftBookRecordGroupListItem) => {
    if (!g.items_count) return;
    setPreviewItems(null);
    setPreviewItemsLoading(true);
    try {
      const res = await fetch(`/api/gift-record-groups/${g.id}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取礼品明细失败");
      }
      const result = await res.json();
      const data = result.data as GiftBookRecordGroupDetail;
      const title = `${data.counterparty_name || "对方"} · 礼品明细`;
      const estimatedTotal = (data.items || []).reduce((acc, it) => acc + (it.estimated_value || 0), 0);
      setPreviewItems({
        title,
        items: data.items || [],
        estimatedTotal,
      });
    } catch (e) {
      console.error("加载礼品明细失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
    } finally {
      setPreviewItemsLoading(false);
    }
  };

  const handleDeleteGroup = async (g: GiftBookRecordGroupListItem) => {
    const ok = await confirm({
      title: "删除记录",
      description: "确定要删除这条礼簿记录吗？该次收礼的礼金与礼品会一起删除，且无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/gift-record-groups/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("记录已删除");
      await refreshAll();
    } catch (e) {
      console.error("删除礼簿记录失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  const handleDeleteGiftBook = async () => {
    const ok = await confirm({
      title: "删除礼簿",
      description: "确定要删除这个礼簿吗？礼簿下的记录会一起删除，且无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/giftbooks/${giftbookId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("礼簿已删除");
      router.push("/dashboard/giftbooks");
    } catch (e) {
      console.error("删除礼簿失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                <Link href="/dashboard/giftbooks" aria-label="返回礼簿列表">
                  <ArrowLeft className="h-5 w-5" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
                  {giftbook?.name || "礼簿详情"}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground mt-1">
                  {giftbook?.event_date && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(giftbook.event_date)}
                    </span>
                  )}
                  {giftbook?.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {giftbook.location}
                    </span>
                  )}
                  {giftbook?.event_type && (
                    <Badge variant="outline" className="text-xs">
                      {giftbook.event_type}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="hidden sm:inline-flex"
                onClick={handleDeleteGiftBook}
              >
                <Trash2 className="h-4 w-4" />
                删除礼簿
              </Button>
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4" />
                新增记录
              </Button>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">礼金合计</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(giftbook?.summary?.cashTotal ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">礼品估值合计</p>
                <p className="text-2xl font-bold text-primary">
                  {formatCurrency(giftbook?.summary?.itemEstimatedTotal ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">（可不填估值）</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">记录数</p>
                <p className="text-2xl font-bold text-primary">
                  {giftbook?.summary?.recordCount ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters + Records */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4">
              <CardTitle>礼簿记录</CardTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="q" className="text-xs text-muted-foreground">
                    搜索
                  </Label>
                  <Input
                    id="q"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="按姓名/备注搜索"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">包含</Label>
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={hasCash} onCheckedChange={(v) => setHasCash(!!v)} />
                      礼金
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox checked={hasItems} onCheckedChange={(v) => setHasItems(!!v)} />
                      礼品
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">加载中...</div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <div className="text-5xl mb-4">🎁</div>
                <p className="text-lg font-medium mb-2">暂无记录</p>
                <p className="text-sm mb-4">开始在这个礼簿里添加第一条记录</p>
                <Button variant="outline" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  添加第一条记录
                </Button>
              </div>
            ) : (
              <>
                {/* PC：表格（对齐“送礼”页面风格：按一次收礼汇总） */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          日期
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          对方
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                          礼金
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                          礼品估值
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          礼品
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          备注
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-40">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((g) => (
                        <tr
                          key={g.id}
                          className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                        >
                          <td className="p-4 text-sm text-muted-foreground">
                            {formatDate(g.gift_date)}
                          </td>
                          <td className="p-4 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{g.counterparty_name}</span>
                              {g.attachment_key ? (
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setPreviewAttachment({
                                      url: g.attachment_key!,
                                      name: g.attachment_name || "附件",
                                      type: g.attachment_type || undefined,
                                    })
                                  }
                                  aria-label="预览附件"
                                >
                                  <Paperclip className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            {g.cash_amount ? formatCurrency(g.cash_amount) : "-"}
                          </td>
                          <td className="p-4 text-right">
                            {g.items_count > 0 ? formatCurrency(g.items_estimated_total) : "-"}
                          </td>
                          <td className="p-4">
                            {g.items_count > 0 ? (
                              <button
                                type="button"
                                className="inline-flex"
                                onClick={() => openItemsPreview(g)}
                                aria-label="查看礼品明细"
                              >
                                <Badge variant="outline" className="font-normal hover:bg-accent">
                                  {g.items_count} 行
                                </Badge>
                              </button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {g.notes || "-"}
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => openEdit(g)}
                                aria-label="编辑"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleDeleteGroup(g)}
                                aria-label="删除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile：卡片（对齐“送礼”页面风格） */}
                <div className="md:hidden divide-y">
                  {records.map((g) => (
                    <div key={g.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{g.counterparty_name}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {formatDate(g.gift_date)}
                          </div>
                          {g.notes ? (
                            <div className="text-sm text-muted-foreground mt-1 truncate">
                              备注：{g.notes}
                            </div>
                          ) : null}
                        </div>
                        {g.attachment_key ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() =>
                              setPreviewAttachment({
                                url: g.attachment_key!,
                                name: g.attachment_name || "附件",
                                type: g.attachment_type || undefined,
                              })
                            }
                            aria-label="预览附件"
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <div className="text-muted-foreground">
                          {g.cash_amount ? (
                            <span>礼金：{formatCurrency(g.cash_amount)}</span>
                          ) : (
                            <span>礼金：-</span>
                          )}
                          <span className="mx-2">·</span>
                          {g.items_count > 0 ? (
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => openItemsPreview(g)}
                              aria-label="查看礼品明细"
                            >
                              礼品：{g.items_count} 行 / {formatCurrency(g.items_estimated_total)}
                            </button>
                          ) : (
                            <span>礼品：-</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => openEdit(g)}
                            aria-label="编辑"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleDeleteGroup(g)}
                            aria-label="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 新增/编辑弹窗（对齐“送礼”页面交互：add/edit + loading + key 触发重置） */}
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open) setEditingGroup(null);
          }}
        >
          <GiftBookRecordModal
            key={
              isModalOpen ? `${modalMode}-${editingGroup?.id || "new"}` : "closed"
            }
            giftbookId={giftbookId}
            mode={modalMode}
            loading={editingLoading}
            group={editingGroup}
            onClose={async (refresh) => {
              setIsModalOpen(false);
              setEditingGroup(null);
              if (refresh) await refreshAll();
            }}
          />
        </Dialog>

        {/* 礼品明细弹框 */}
        <Dialog
          open={previewItemsLoading || !!previewItems}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewItems(null);
              setPreviewItemsLoading(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle>{previewItems?.title || "礼品明细"}</DialogTitle>
              <DialogDescription>
                {previewItemsLoading
                  ? "加载中..."
                  : `共 ${previewItems?.items.length || 0} 行 · 合计估值 ${formatCurrency(previewItems?.estimatedTotal || 0)}`}
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              {previewItemsLoading ? (
                <div className="py-10 text-center text-muted-foreground">加载中...</div>
              ) : (previewItems?.items || []).length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">暂无礼品行</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-3 font-semibold text-muted-foreground">礼品</th>
                        <th className="text-right p-3 font-semibold text-muted-foreground">数量</th>
                        <th className="text-right p-3 font-semibold text-muted-foreground">估值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewItems?.items || []).map((it) => (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="p-3">{it.item_name}</td>
                          <td className="p-3 text-right">
                            {it.quantity} {it.unit || ""}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(it.estimated_value || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DialogBody>

            <DialogFooter>
              <Button onClick={() => setPreviewItems(null)} disabled={previewItemsLoading}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 附件预览对话框 */}
        <Dialog
          open={!!previewAttachment}
          onOpenChange={(open) => {
            if (!open) setPreviewAttachment(null);
          }}
        >
          <DialogContent className="sm:max-w-[900px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {previewAttachment?.type === "application/pdf" ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                附件预览
              </DialogTitle>
              <DialogDescription>
                {previewAttachment?.name || "未命名附件"}
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="flex items-center justify-center">
              {previewAttachment?.url ? (
                previewAttachment.type?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewAttachment.url}
                    alt={previewAttachment.name || "附件图片"}
                    className="w-full max-h-full object-contain rounded-md border"
                  />
                ) : (
                  <iframe
                    title={previewAttachment.name || "附件"}
                    src={previewAttachment.url}
                    className="w-full h-full rounded-md border"
                  />
                )
              ) : null}
            </DialogBody>

            {previewAttachment?.url ? (
              <DialogFooter>
                <Button asChild variant="outline">
                  <a href={previewAttachment.url} target="_blank" rel="noreferrer">
                    新窗口打开
                  </a>
                </Button>
                <Button onClick={() => setPreviewAttachment(null)}>关闭</Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function GiftBookRecordModal({
  giftbookId,
  mode,
  loading,
  group,
  onClose,
}: {
  giftbookId: string;
  mode: "add" | "edit";
  loading: boolean;
  group: GiftBookRecordGroupDetail | null;
  onClose: (refresh?: boolean) => void;
}) {
  const canEditFields = mode === "add" || !!group;

  const initial = useMemo(() => {
    if (mode === "edit" && group) {
      return {
        counterparty_name: group.counterparty_name || "",
        gift_date: group.gift_date ? toDateTimeLocal(group.gift_date) : getTodayDateTimeLocal(),
        notes: group.notes || "",
        hasCash: !!group.cash_amount,
        amount: group.cash_amount ? String(group.cash_amount) : "",
        hasItems: (group.items || []).length > 0,
        items:
          (group.items || []).map((it) => ({
            id: it.id,
            item_name: it.item_name || "",
            quantity: String(it.quantity ?? 1),
            unit: it.unit || "件",
            estimated_value: String(it.estimated_value ?? 0),
          })) || [],
      };
    }

    return {
      counterparty_name: "",
      gift_date: getTodayDateTimeLocal(),
      notes: "",
        hasCash: true,
        amount: "",
      hasItems: false,
      items: [] as Array<{
        id: string;
        item_name: string;
        quantity: string;
        unit: string;
        estimated_value: string;
      }>,
    };
  }, [mode, group]);

  const [form, setForm] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 附件：单附件（三态）
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  useEffect(() => {
    setForm(initial);
    setAttachment(null);
    setRemoveExistingAttachment(false);
  }, [initial]);

  const addItemRow = () => {
    setForm((prev) => ({
      ...prev,
      hasItems: true,
      items: [
        ...prev.items,
        {
          id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          item_name: "",
          quantity: "1",
          unit: "件",
          estimated_value: "0",
        },
      ],
    }));
  };

  const removeItemRow = (id: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((x) => x.id !== id),
    }));
  };

  const validate = () => {
    if (!form.counterparty_name.trim()) throw new Error("请填写对方姓名");
    if (!form.gift_date) throw new Error("请选择日期");
    if (!form.hasCash && !form.hasItems) throw new Error("至少选择礼金或礼品之一");

    if (form.hasCash) {
      const n = parseFloat(form.amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("礼金金额必须大于0");
    }

    if (form.hasItems) {
      if (form.items.length === 0) throw new Error("请至少添加一行礼品");
      for (const it of form.items) {
        if (!it.item_name.trim()) throw new Error("礼品名称为必填项");
        const q = parseFloat(it.quantity);
        if (!Number.isFinite(q) || q <= 0) throw new Error("礼品数量必须大于0");
        const unit = (it.unit || "件").trim();
        if (!unit) throw new Error("单位为必填项");
        const ev = parseFloat(it.estimated_value);
        if (!Number.isFinite(ev) || ev < 0) throw new Error("估值必须大于等于0");
      }
    }
  };

  const hasExistingAttachment = !!group?.attachment_key;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditFields) return;
    setIsSubmitting(true);

    try {
      validate();

      let attachment_key: string | null | undefined;
      let attachment_name: string | null | undefined;
      let attachment_type: string | null | undefined;

      if (mode === "edit" && removeExistingAttachment) {
        attachment_key = null;
        attachment_name = null;
        attachment_type = null;
      } else if (attachment) {
        const isAllowed =
          attachment.type === "application/pdf" || attachment.type.startsWith("image/");
        const maxBytes = 10 * 1024 * 1024;
        if (!isAllowed) throw new Error("仅支持上传图片或 PDF");
        if (attachment.size > maxBytes) throw new Error("附件过大（最大 10MB）");

        setIsUploading(true);
        const safeName = attachment.name.replace(/[^\w.\-() ]+/g, "_");
        const pathname = `giftbooks/${giftbookId}/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
        });
        attachment_key = blob.url;
        attachment_name = attachment.name;
        attachment_type = blob.contentType || attachment.type || undefined;
      } else {
        // 不动附件：PATCH 时不传字段即可
        attachment_key = undefined;
        attachment_name = undefined;
        attachment_type = undefined;
      }

      const payloadBase = {
        counterparty_name: form.counterparty_name.trim(),
        gift_date: new Date(form.gift_date).toISOString(),
        notes: form.notes.trim() || undefined,
        hasCash: form.hasCash,
        amount: form.hasCash ? parseFloat(form.amount) : null,
        hasItems: form.hasItems,
        items: form.hasItems
          ? form.items.map((it) => ({
              id: it.id,
              item_name: it.item_name.trim(),
              quantity: parseFloat(it.quantity),
              unit: (it.unit || "件").trim() || "件",
              estimated_value: parseFloat(it.estimated_value),
            }))
          : [],
        attachment_key,
        attachment_name,
        attachment_type,
      };

      const url =
        mode === "add"
          ? `/api/giftbooks/${giftbookId}/records`
          : `/api/gift-record-groups/${group?.id}`;
      const method = mode === "add" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBase),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (mode === "add" ? "创建失败" : "更新失败"));
      }

      toast.success(mode === "add" ? "记录已添加" : "记录已更新");
      onClose(true);
    } catch (e2) {
      console.error(mode === "add" ? "创建礼簿记录失败:" : "更新礼簿记录失败:", e2);
      toast.error(e2 instanceof Error ? e2.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[720px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "新增礼簿记录" : "编辑礼簿记录"}</DialogTitle>
        <DialogDescription>
          {mode === "add"
            ? "支持礼金 + 多行礼品组合"
            : loading
              ? "加载中..."
              : "修改收礼详情"}
        </DialogDescription>
      </DialogHeader>

      {loading && mode === "edit" ? (
        <DialogBody>
          <div className="py-10 text-center text-muted-foreground">加载中...</div>
        </DialogBody>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="counterparty">对方姓名 *</Label>
            <Input
              id="counterparty"
              value={form.counterparty_name}
              onChange={(e) => setForm({ ...form, counterparty_name: e.target.value })}
              placeholder="例如：李四"
              required
              maxLength={128}
              disabled={!canEditFields || isSubmitting || isUploading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">日期 *</Label>
            <Input
              id="date"
              type="datetime-local"
              value={form.gift_date}
              onChange={(e) => setForm({ ...form, gift_date: e.target.value })}
              required
              disabled={!canEditFields || isSubmitting || isUploading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">备注</Label>
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="可选"
              disabled={!canEditFields || isSubmitting || isUploading}
            />
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={form.hasCash}
                onCheckedChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    hasCash: !!v,
                    amount: !!v ? prev.amount : "",
                  }))
                }
                disabled={!canEditFields || isSubmitting || isUploading}
              />
              包含礼金
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={form.hasItems}
                onCheckedChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    hasItems: !!v,
                    items: !!v ? prev.items : [],
                  }))
                }
                disabled={!canEditFields || isSubmitting || isUploading}
              />
              包含礼品
            </label>
          </div>

          {form.hasCash ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border p-4">
              <div className="space-y-2">
                <Label htmlFor="amount">金额 *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="例如：200"
                  required
                  disabled={!canEditFields || isSubmitting || isUploading}
                />
              </div>
            </div>
          ) : null}

          {form.hasItems ? (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">礼品明细（多行）</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItemRow}
                  disabled={!canEditFields || isSubmitting || isUploading}
                >
                  <Plus className="h-4 w-4" />
                  添加一行
                </Button>
              </div>

              {form.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  暂无礼品行，点击右上角“添加一行”
                </div>
              ) : (
                <div className="space-y-3">
                  {form.items.map((it, idx) => (
                    <div key={it.id} className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <div className="md:col-span-4 space-y-2">
                        <Label htmlFor={`item-name-${it.id}`}>礼品名称 *（第 {idx + 1} 行）</Label>
                        <Input
                          id={`item-name-${it.id}`}
                          value={it.item_name}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === it.id ? { ...x, item_name: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="例如：水果礼盒"
                          required
                          disabled={!canEditFields || isSubmitting || isUploading}
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor={`item-qty-${it.id}`}>数量 *</Label>
                        <Input
                          id={`item-qty-${it.id}`}
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={it.quantity}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === it.id ? { ...x, quantity: e.target.value } : x
                              ),
                            }))
                          }
                          required
                          disabled={!canEditFields || isSubmitting || isUploading}
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor={`item-unit-${it.id}`}>单位 *</Label>
                        <Input
                          id={`item-unit-${it.id}`}
                          value={it.unit}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === it.id ? { ...x, unit: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="件"
                          required
                          disabled={!canEditFields || isSubmitting || isUploading}
                        />
                      </div>
                      <div className="md:col-span-3 space-y-2">
                        <Label htmlFor={`item-est-${it.id}`}>该行总估值 *（金额）</Label>
                        <Input
                          id={`item-est-${it.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.estimated_value}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === it.id ? { ...x, estimated_value: e.target.value } : x
                              ),
                            }))
                          }
                          required
                          disabled={!canEditFields || isSubmitting || isUploading}
                        />
                      </div>
                      <div className="md:col-span-1 flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeItemRow(it.id)}
                          aria-label="移除该行"
                          disabled={!canEditFields || isSubmitting || isUploading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  <div className="text-sm text-muted-foreground">
                    合计估值：{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(
                        form.items.reduce(
                          (acc, it) => acc + (parseFloat(it.estimated_value) || 0),
                          0
                        )
                      )}
                    </span>
                    {" · "}
                    共 {form.items.length} 行
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="attachment">附件（图片 / PDF，可选）</Label>

            {mode === "edit" && hasExistingAttachment && !removeExistingAttachment && !attachment ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
                <a
                  href={group!.attachment_key!}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary hover:underline"
                >
                  {group!.attachment_name || "当前附件"}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveExistingAttachment(true)}
                  disabled={isSubmitting || isUploading || !canEditFields}
                >
                  移除
                </Button>
              </div>
            ) : null}

            {mode === "edit" && removeExistingAttachment ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                <span>将移除现有附件</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveExistingAttachment(false)}
                  disabled={isSubmitting || isUploading || !canEditFields}
                >
                  撤销
                </Button>
              </div>
            ) : null}

            <Input
              id="attachment"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setAttachment(file);
                if (file) setRemoveExistingAttachment(false);
              }}
              disabled={isSubmitting || isUploading || !canEditFields}
            />

            {attachment ? (
              <div className="text-xs text-muted-foreground">
                已选择：{attachment.name}（{Math.ceil(attachment.size / 1024)} KB）
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">支持图片或 PDF，最大 10MB</div>
            )}
          </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSubmitting || isUploading}
            >
              取消
            </Button>
            <Button type="submit" disabled={!canEditFields || isSubmitting || isUploading}>
              {isSubmitting || isUploading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}

