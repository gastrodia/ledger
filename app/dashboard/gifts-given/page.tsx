"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import { upload } from "@vercel/blob/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { GivenGiftDetail, GivenGiftListItem, GiftsGivenSummary } from "@/types";
import type { GivenGiftItem } from "@/types";
import { Edit, Paperclip, Plus, Trash2 } from "lucide-react";

type PreviewAttachment = { url: string; name?: string; type?: string } | null;
type PreviewItems = { title: string; items: GivenGiftItem[]; estimatedTotal: number } | null;

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatQty(q: number) {
  const s = String(q);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export default function GiftsGivenPage() {
  const router = useRouter();
  const { confirm } = useConfirm();

  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<GivenGiftListItem[]>([]);
  const [summary, setSummary] = useState<GiftsGivenSummary>({
    cashTotal: 0,
    itemEstimatedTotal: 0,
    recordCount: 0,
  });

  const [q, setQ] = useState("");
  // 默认不限制日期范围，避免“新增了但看不到”被筛选条件挡住
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasCash, setHasCash] = useState(false);
  const [hasItems, setHasItems] = useState(false);

  const [previewAttachment, setPreviewAttachment] = useState<PreviewAttachment>(null);
  const [previewItems, setPreviewItems] = useState<PreviewItems>(null);
  const [previewItemsLoading, setPreviewItemsLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingGift, setEditingGift] = useState<GivenGiftDetail | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  const loadGifts = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.append("q", q.trim());
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (hasCash) params.append("hasCash", "true");
      if (hasItems) params.append("hasItems", "true");

      const res = await fetch(`/api/gifts-given?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取送礼记录失败");
      }
      const result = await res.json();
      setItems(result.data || []);
      setSummary(
        result.summary || { cashTotal: 0, itemEstimatedTotal: 0, recordCount: 0 }
      );
    } catch (e) {
      console.error("加载送礼记录失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, startDate, endDate, hasCash, hasItems]);

  const openAdd = () => {
    setModalMode("add");
    setEditingGift(null);
    setIsModalOpen(true);
  };

  const openEdit = async (g: GivenGiftListItem) => {
    setModalMode("edit");
    setEditingGift(null);
    setIsModalOpen(true);
    setEditingLoading(true);
    try {
      const res = await fetch(`/api/gifts-given/${g.id}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取详情失败");
      }
      const result = await res.json();
      setEditingGift(result.data || null);
    } catch (e) {
      console.error("加载送礼详情失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
      setIsModalOpen(false);
    } finally {
      setEditingLoading(false);
    }
  };

  const openItemsPreview = async (g: GivenGiftListItem) => {
    if (!g.items_count) return;
    setPreviewItems(null);
    setPreviewItemsLoading(true);
    try {
      const res = await fetch(`/api/gifts-given/${g.id}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "获取物品明细失败");
      }
      const result = await res.json();
      const data = result.data as GivenGiftDetail;
      const title = `${data.recipient_name || "收礼人"} · 物品明细`;
      const estimatedTotal = (data.items || []).reduce((acc, it) => acc + (it.estimated_value || 0), 0);
      setPreviewItems({
        title,
        items: data.items || [],
        estimatedTotal,
      });
    } catch (e) {
      console.error("加载物品明细失败:", e);
      toast.error(e instanceof Error ? e.message : "加载失败，请重试");
    } finally {
      setPreviewItemsLoading(false);
    }
  };

  const handleDelete = async (g: GivenGiftListItem) => {
    const ok = await confirm({
      title: "删除送礼记录",
      description: "确定要删除这条送礼记录吗？附件也会同时删除，且无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/gifts-given/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("已删除");
      await loadGifts();
    } catch (e) {
      console.error("删除送礼记录失败:", e);
      toast.error(e instanceof Error ? e.message : "删除失败，请重试");
    }
  };

  const stats = useMemo(() => {
    return [
      { title: "现金合计", value: formatCurrency(summary.cashTotal || 0) },
      { title: "物品估值合计", value: formatCurrency(summary.itemEstimatedTotal || 0) },
      { title: "记录数", value: String(summary.recordCount || 0) },
    ];
  }, [summary]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">送礼</h1>
            <p className="text-muted-foreground mt-1">
              记录我送给别人的现金与物品（支持组合礼、附件）
            </p>
          </div>
          <Button className="w-full sm:w-auto" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            新增记录
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4">
              <CardTitle>筛选</CardTitle>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>关键词</Label>
                  <Input
                    placeholder="收礼人 / 事由 / 备注"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>开始日期</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>结束日期</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>包含</Label>
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={hasCash}
                        onCheckedChange={(v) => setHasCash(!!v)}
                      />
                      现金
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={hasItems}
                        onCheckedChange={(v) => setHasItems(!!v)}
                      />
                      物品
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">加载中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                暂无记录，点击右上角“新增记录”开始记录
              </div>
            ) : (
              <>
                {/* PC：表格 */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          日期
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          收礼人
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                          现金
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                          物品估值
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          物品
                        </th>
                        <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                          事由
                        </th>
                        <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-40">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((g) => (
                        <tr
                          key={g.id}
                          className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                        >
                          <td className="p-4 text-sm text-muted-foreground">
                            {formatDate(g.gift_date)}
                          </td>
                          <td className="p-4 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{g.recipient_name}</span>
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
                            {g.notes ? (
                              <div className="mt-1 text-xs text-muted-foreground truncate max-w-[420px]">
                                备注：{g.notes}
                              </div>
                            ) : null}
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
                                aria-label="查看物品明细"
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
                            {g.occasion || "-"}
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
                                onClick={() => handleDelete(g)}
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

                {/* Mobile：卡片 */}
                <div className="md:hidden divide-y">
                  {items.map((g) => (
                    <div key={g.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{g.recipient_name}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {formatDate(g.gift_date)}
                          </div>
                          {g.occasion ? (
                            <div className="text-sm text-muted-foreground mt-1 truncate">
                              事由：{g.occasion}
                            </div>
                          ) : null}
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
                            <span>现金：{formatCurrency(g.cash_amount)}</span>
                          ) : (
                            <span>现金：-</span>
                          )}
                          <span className="mx-2">·</span>
                          {g.items_count > 0 ? (
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => openItemsPreview(g)}
                              aria-label="查看物品明细"
                            >
                              物品：{g.items_count} 行 / {formatCurrency(g.items_estimated_total)}
                            </button>
                          ) : (
                            <span>物品：-</span>
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
                            onClick={() => handleDelete(g)}
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

        {/* 预览附件（复用交易记录的体验） */}
        <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
          <DialogContent className="sm:max-w-[800px]">
            <DialogHeader>
              <DialogTitle>附件预览</DialogTitle>
              <DialogDescription>
                {previewAttachment?.type === "application/pdf" ? "PDF" : "图片"}
                {" · "}
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

        {/* 新增/编辑弹窗 */}
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open) setEditingGift(null);
          }}
        >
          <GiftsGivenModal
            key={
              isModalOpen
                ? `${modalMode}-${editingGift?.id || "new"}`
                : "closed"
            }
            mode={modalMode}
            loading={editingLoading}
            gift={editingGift}
            onClose={async (refresh) => {
              setIsModalOpen(false);
              setEditingGift(null);
              if (refresh) await loadGifts();
            }}
          />
        </Dialog>

        {/* 物品明细弹框 */}
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
              <DialogTitle>{previewItems?.title || "物品明细"}</DialogTitle>
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
                <div className="py-10 text-center text-muted-foreground">暂无物品行</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-3 font-semibold text-muted-foreground">物品</th>
                        <th className="text-right p-3 font-semibold text-muted-foreground">数量</th>
                        <th className="text-right p-3 font-semibold text-muted-foreground">估值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewItems?.items || []).map((it, idx) => (
                        <tr key={`${it.item_name}-${idx}`} className="border-b last:border-0">
                          <td className="p-3">{it.item_name}</td>
                          <td className="p-3 text-right">
                            {formatQty(it.quantity)} {it.unit}
                          </td>
                          <td className="p-3 text-right">{formatCurrency(it.estimated_value)}</td>
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
      </div>
    </DashboardLayout>
  );
}

function GiftsGivenModal({
  mode,
  gift,
  loading,
  onClose,
}: {
  mode: "add" | "edit";
  gift: GivenGiftDetail | null;
  loading: boolean;
  onClose: (refresh?: boolean) => void;
}) {
  const idPrefix = mode === "edit" ? "edit-" : "";

  const initial = useMemo(() => {
    if (mode === "edit" && gift) {
      return {
        recipient_name: gift.recipient_name || "",
        gift_date: gift.gift_date ? gift.gift_date.slice(0, 10) : getTodayDate(),
        occasion: gift.occasion || "",
        notes: gift.notes || "",
        hasCash: !!gift.cash_amount,
        cash_amount: gift.cash_amount ? String(gift.cash_amount) : "",
        hasItems: (gift.items || []).length > 0,
        items:
          (gift.items || []).map((it, idx) => ({
            id: `${Date.now()}_${idx}`,
            item_name: it.item_name,
            quantity: String(it.quantity),
            unit: it.unit || "件",
            estimated_value: String(it.estimated_value),
          })) || [],
      };
    }
    return {
      recipient_name: "",
      gift_date: getTodayDate(),
      occasion: "",
      notes: "",
      hasCash: true,
      cash_amount: "",
      hasItems: false,
      items: [] as Array<{
        id: string;
        item_name: string;
        quantity: string;
        unit: string;
        estimated_value: string;
      }>,
    };
  }, [mode, gift]);

  const [form, setForm] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 附件：对齐交易记录（单附件，三态）
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);

  useEffect(() => {
    setForm(initial);
    setAttachment(null);
    setRemoveExistingAttachment(false);
  }, [initial]);

  const canEditFields = mode === "add" || !!gift;

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
    if (!form.recipient_name.trim()) throw new Error("请填写收礼人");
    if (!form.gift_date) throw new Error("请选择送礼日期");
    if (!form.hasCash && !form.hasItems) throw new Error("至少选择现金或物品之一");

    if (form.hasCash) {
      const n = parseFloat(form.cash_amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("现金金额必须大于0");
    }

    if (form.hasItems) {
      if (form.items.length === 0) throw new Error("请至少添加一行物品");
      for (const it of form.items) {
        if (!it.item_name.trim()) throw new Error("物品名称为必填项");
        const q = parseFloat(it.quantity);
        if (!Number.isFinite(q) || q <= 0) throw new Error("物品数量必须大于0");
        const unit = (it.unit || "件").trim();
        if (!unit) throw new Error("单位为必填项");
        const ev = parseFloat(it.estimated_value);
        if (!Number.isFinite(ev) || ev < 0) throw new Error("该行总估值必须大于等于0");
      }
    }
  };

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
        const pathname = `gifts-given/${Date.now()}_${safeName}`;
        const blob = await upload(pathname, attachment, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: attachment.type || undefined,
        });
        attachment_key = blob.url;
        attachment_name = attachment.name;
        attachment_type = blob.contentType || attachment.type || undefined;
      } else {
        attachment_key = undefined;
        attachment_name = undefined;
        attachment_type = undefined;
      }

      const payload = {
        recipient_name: form.recipient_name.trim(),
        gift_date: form.gift_date,
        occasion: form.occasion.trim() || null,
        notes: form.notes.trim() || null,
        cash_amount: form.hasCash ? parseFloat(form.cash_amount) : null,
        items: form.hasItems
          ? form.items.map((it) => ({
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
        mode === "add" ? "/api/gifts-given" : `/api/gifts-given/${gift?.id}`;
      const method = mode === "add" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (mode === "add" ? "创建失败" : "更新失败"));
      }

      toast.success(mode === "add" ? "已创建" : "已更新");
      onClose(true);
    } catch (e) {
      console.error(mode === "add" ? "创建送礼失败:" : "更新送礼失败:", e);
      toast.error(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const hasExistingAttachment = !!gift?.attachment_key;

  return (
    <DialogContent className="sm:max-w-[720px]">
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "新增送礼记录" : "编辑送礼记录"}</DialogTitle>
        <DialogDescription>
          {mode === "add"
            ? "支持现金 + 多行物品组合礼"
            : loading
              ? "加载中..."
              : "修改送礼详情"}
        </DialogDescription>
      </DialogHeader>

      {loading && mode === "edit" ? (
        <DialogBody>
          <div className="py-10 text-center text-muted-foreground">加载中...</div>
        </DialogBody>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody className="space-y-5 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}recipient`}>收礼人 *</Label>
              <Input
                id={`${idPrefix}recipient`}
                value={form.recipient_name}
                onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
                placeholder="例如：张三"
                required
                disabled={!canEditFields}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}date`}>送礼日期 *</Label>
              <Input
                id={`${idPrefix}date`}
                type="date"
                value={form.gift_date}
                onChange={(e) => setForm({ ...form, gift_date: e.target.value })}
                required
                disabled={!canEditFields}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}occasion`}>事由</Label>
              <Input
                id={`${idPrefix}occasion`}
                value={form.occasion}
                onChange={(e) => setForm({ ...form, occasion: e.target.value })}
                placeholder="例如：生日/乔迁/婚礼..."
                disabled={!canEditFields}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}notes`}>备注</Label>
              <Input
                id={`${idPrefix}notes`}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="可选"
                disabled={!canEditFields}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={form.hasCash}
                onCheckedChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    hasCash: !!v,
                    cash_amount: !!v ? prev.cash_amount : "",
                  }))
                }
                disabled={!canEditFields}
              />
              包含现金
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
                disabled={!canEditFields}
              />
              包含物品
            </label>
          </div>

          {form.hasCash ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border p-4">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}cash`}>现金金额 *</Label>
                <Input
                  id={`${idPrefix}cash`}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.cash_amount}
                  onChange={(e) => setForm({ ...form, cash_amount: e.target.value })}
                  required
                  disabled={!canEditFields}
                />
              </div>
            </div>
          ) : null}

          {form.hasItems ? (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">物品明细（多行）</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItemRow}
                  disabled={!canEditFields}
                >
                  <Plus className="h-4 w-4" />
                  添加一行
                </Button>
              </div>

              {form.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  暂无物品行，点击右上角“添加一行”
                </div>
              ) : (
                <div className="space-y-3">
                  {form.items.map((it, idx) => (
                    <div key={it.id} className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      <div className="md:col-span-4 space-y-2">
                        <Label htmlFor={`${idPrefix}item-name-${it.id}`}>
                          物品名称 *（第 {idx + 1} 行）
                        </Label>
                        <Input
                          id={`${idPrefix}item-name-${it.id}`}
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
                          disabled={!canEditFields}
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor={`${idPrefix}item-qty-${it.id}`}>数量 *</Label>
                        <Input
                          id={`${idPrefix}item-qty-${it.id}`}
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
                          disabled={!canEditFields}
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label htmlFor={`${idPrefix}item-unit-${it.id}`}>单位 *</Label>
                        <Input
                          id={`${idPrefix}item-unit-${it.id}`}
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
                          disabled={!canEditFields}
                        />
                      </div>
                      <div className="md:col-span-3 space-y-2">
                        <Label htmlFor={`${idPrefix}item-est-${it.id}`}>
                          该行总估值 *（金额）
                        </Label>
                        <Input
                          id={`${idPrefix}item-est-${it.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.estimated_value}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === it.id
                                  ? { ...x, estimated_value: e.target.value }
                                  : x
                              ),
                            }))
                          }
                          required
                          disabled={!canEditFields}
                        />
                      </div>
                      <div className="md:col-span-1 flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeItemRow(it.id)}
                          aria-label="移除该行"
                          disabled={!canEditFields}
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
                        form.items.reduce((acc, it) => acc + (parseFloat(it.estimated_value) || 0), 0)
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
            <Label htmlFor={`${idPrefix}attachment`}>附件（图片 / PDF，可选）</Label>

            {mode === "edit" && hasExistingAttachment && !removeExistingAttachment && !attachment ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
                <a
                  href={gift!.attachment_key!}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary hover:underline"
                >
                  {gift!.attachment_name || "当前附件"}
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
              id={`${idPrefix}attachment`}
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
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">
                  {attachment.name}（{Math.ceil(attachment.size / 1024)}KB）
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttachment(null)}
                  disabled={isSubmitting || isUploading || !canEditFields}
                >
                  移除
                </Button>
              </div>
            ) : null}
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
            <Button type="submit" disabled={isSubmitting || isUploading || !canEditFields}>
              {isSubmitting || isUploading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}

