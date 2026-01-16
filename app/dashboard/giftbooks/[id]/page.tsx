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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ArrowLeft, CalendarDays, MapPin, Trash2, Edit, Gift, Paperclip, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";
import type { GiftBook, GiftBookSummary, GiftRecord, GiftRecordType } from "@/types";
import { upload } from "@vercel/blob/client";

type GiftBookDetail = GiftBook & { summary?: GiftBookSummary };

export default function GiftBookDetailPage() {
  const router = useRouter();
  const { confirm } = useConfirm();

  const params = useParams<{ id: string }>();
  const giftbookId = params?.id;

  const [giftbook, setGiftbook] = useState<GiftBookDetail | null>(null);
  const [records, setRecords] = useState<GiftRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewAttachment, setPreviewAttachment] = useState<{
    url: string;
    name?: string | null;
    type?: string | null;
  } | null>(null);

  const [q, setQ] = useState("");
  const [giftType, setGiftType] = useState<GiftRecordType | "all">("all");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GiftRecord | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.append("q", q.trim());
    if (giftType !== "all") p.append("giftType", giftType);
    return p.toString();
  }, [q, giftType]);

  const onGiftTypeChange = (value: string) => {
    if (value === "all" || value === "cash" || value === "item") {
      setGiftType(value);
    }
  };

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
    return (result.data || []) as GiftRecord[];
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

  const handleDeleteRecord = async (recordId: string) => {
    const ok = await confirm({
      title: "删除记录",
      description: "确定要删除这条礼簿记录吗？此操作无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/gift-records/${recordId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "删除失败");
      }
      toast.success("记录已删除");
      await refreshAll();
    } catch (e) {
      console.error("删除记录失败:", e);
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
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4" />
                    添加记录
                  </Button>
                </DialogTrigger>
                <RecordModal
                  key={isAddOpen ? "open" : "closed"}
                  giftbookId={giftbookId}
                  mode="create"
                  onClose={(refresh) => {
                    setIsAddOpen(false);
                    if (refresh) refreshAll();
                  }}
                />
              </Dialog>
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
                  <Label className="text-xs text-muted-foreground">类型</Label>
                  <Select value={giftType} onValueChange={onGiftTypeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      <SelectItem value="cash">礼金</SelectItem>
                      <SelectItem value="item">礼品</SelectItem>
                    </SelectContent>
                  </Select>
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
                <Button variant="outline" onClick={() => setIsAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  添加第一条记录
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                <>
                  {/* PC：表格 */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            对方
                          </th>
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            类型
                          </th>
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            内容
                          </th>
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            日期
                          </th>
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            备注
                          </th>
                          <th className="text-left p-4 font-semibold text-sm text-muted-foreground">
                            附件
                          </th>
                          <th className="text-right p-4 font-semibold text-sm text-muted-foreground">
                            金额/估值
                          </th>
                          <th className="text-right p-4 font-semibold text-sm text-muted-foreground w-24">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((r) => {
                          const isCash = r.gift_type === "cash";
                          const content = isCash
                            ? "礼金"
                            : `${r.item_name || "礼品"}${r.quantity ? ` × ${r.quantity}` : ""}`;
                          const valueText = isCash
                            ? formatCurrency(r.amount ?? 0)
                            : r.estimated_value !== null && r.estimated_value !== undefined
                              ? formatCurrency(r.estimated_value)
                              : "-";

                          return (
                            <tr
                              key={r.id}
                              className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                            >
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <Gift className="h-4 w-4 text-primary shrink-0" />
                                  <span className="font-medium">{r.counterparty_name}</span>
                                </div>
                              </td>
                              <td className="p-4">
                                <span className="text-sm text-muted-foreground">
                                  {isCash ? "礼金" : "礼品"}
                                </span>
                              </td>
                              <td className="p-4">
                                <span className="text-sm text-muted-foreground truncate max-w-[420px] block">
                                  {content}
                                </span>
                              </td>
                              <td className="p-4">
                                <span className="text-sm text-muted-foreground">
                                  {formatDate(r.gift_date)}
                                </span>
                              </td>
                              <td className="p-4">
                                <span className="text-sm text-muted-foreground">
                                  {r.notes || "-"}
                                </span>
                              </td>
                              <td className="p-4">
                                {r.attachment_key ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                    onClick={() =>
                                      setPreviewAttachment({
                                        url: r.attachment_key!,
                                        name: r.attachment_name,
                                        type: r.attachment_type,
                                      })
                                    }
                                  >
                                    <Paperclip className="h-4 w-4" />
                                    <span className="truncate max-w-[160px]">
                                      {r.attachment_name || "附件"}
                                    </span>
                                  </button>
                                ) : (
                                  <span className="text-sm text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="p-4 text-right">
                                <span className={`font-bold ${isCash ? "text-green-600" : "text-primary"}`}>
                                  {valueText}
                                </span>
                              </td>
                              <td className="p-4">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setEditingRecord(r)}
                                    aria-label="编辑记录"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteRecord(r.id)}
                                    aria-label="删除记录"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 移动端：卡片 */}
                  <div className="md:hidden divide-y">
                    {records.map((r) => {
                      const isCash = r.gift_type === "cash";
                      const valueText = isCash
                        ? formatCurrency(r.amount ?? 0)
                        : r.estimated_value !== null && r.estimated_value !== undefined
                          ? `估值 ${formatCurrency(r.estimated_value)}`
                          : "未填估值";
                      const itemText = !isCash
                        ? `${r.item_name || "礼品"}${r.quantity ? ` × ${r.quantity}` : ""}`
                        : "";

                      return (
                        <div key={r.id} className="p-4 hover:bg-accent/30 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted shrink-0">
                              <Gift className="h-6 w-6 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold text-base truncate">
                                    {r.counterparty_name}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-muted-foreground">
                                      {isCash ? "礼金" : "礼品"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatDate(r.gift_date)}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setEditingRecord(r)}
                                    aria-label="编辑记录"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteRecord(r.id)}
                                    aria-label="删除记录"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {isCash ? (
                                <div className="text-lg font-bold text-green-600">
                                  {valueText}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <div className="text-sm text-muted-foreground">{itemText}</div>
                                  <div className="text-sm font-semibold text-primary">{valueText}</div>
                                </div>
                              )}

                              {r.notes && (
                                <div className="text-xs text-muted-foreground">
                                  备注：{r.notes}
                                </div>
                              )}

                              {r.attachment_key && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  onClick={() =>
                                    setPreviewAttachment({
                                      url: r.attachment_key!,
                                      name: r.attachment_name,
                                      type: r.attachment_type,
                                    })
                                  }
                                >
                                  <Paperclip className="h-3.5 w-3.5" />
                                  <span className="truncate max-w-[200px]">
                                    {r.attachment_name || "附件"}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit dialog */}
        {editingRecord && (
          <Dialog
            open={!!editingRecord}
            onOpenChange={(open) => {
              if (!open) setEditingRecord(null);
            }}
          >
            <RecordModal
              key={editingRecord.id}
              giftbookId={giftbookId}
              mode="edit"
              record={editingRecord}
              onClose={(refresh) => {
                setEditingRecord(null);
                if (refresh) refreshAll();
              }}
            />
          </Dialog>
        )}

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

            {previewAttachment?.url ? (
              previewAttachment.type?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name || "附件图片"}
                  className="w-full max-h-[70vh] object-contain rounded-md border"
                />
              ) : (
                <iframe
                  title={previewAttachment.name || "附件"}
                  src={previewAttachment.url}
                  className="w-full h-[70vh] rounded-md border"
                />
              )
            ) : null}

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

function RecordModal({
  giftbookId,
  mode,
  record,
  onClose,
}: {
  giftbookId: string;
  mode: "create" | "edit";
  record?: GiftRecord;
  onClose: (refresh?: boolean) => void;
}) {
  const getTodayDateTimeLocal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T12:00`;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [removeExistingAttachment, setRemoveExistingAttachment] = useState(false);
  const [formData, setFormData] = useState({
    gift_type: (record?.gift_type || "cash") as GiftRecordType,
    counterparty_name: record?.counterparty_name || "",
    amount: record?.amount?.toString() || "",
    currency: record?.currency || "CNY",
    item_name: record?.item_name || "",
    quantity: record?.quantity?.toString() || "",
    estimated_value: record?.estimated_value?.toString() || "",
    gift_date: record?.gift_date
      ? // 兼容 "YYYY-MM-DD" 或 timestamp 字符串
        (() => {
          const d = new Date(record.gift_date);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}T12:00`;
        })()
      : getTodayDateTimeLocal(),
    notes: record?.notes || "",
  });

  const isCash = formData.gift_type === "cash";
  const hasExistingAttachment = !!record?.attachment_key;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
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

      const base = {
        counterparty_name: formData.counterparty_name,
        gift_date: new Date(formData.gift_date).toISOString(),
        notes: formData.notes || undefined,
        attachment_key,
        attachment_name,
        attachment_type,
      };

      const payload =
        formData.gift_type === "cash"
          ? {
              ...base,
              gift_type: "cash" as const,
              amount: parseFloat(formData.amount),
              currency: formData.currency || "CNY",
            }
          : {
              ...base,
              gift_type: "item" as const,
              item_name: formData.item_name,
              quantity: formData.quantity ? parseFloat(formData.quantity) : undefined,
              estimated_value: formData.estimated_value ? parseFloat(formData.estimated_value) : undefined,
            };

      const url =
        mode === "create"
          ? `/api/giftbooks/${giftbookId}/records`
          : `/api/gift-records/${record!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (mode === "create" ? "创建失败" : "更新失败"));
      }

      toast.success(mode === "create" ? "记录已添加" : "记录已更新");
      onClose(true);
    } catch (e) {
      console.error("保存礼簿记录失败:", e);
      toast.error(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "添加礼簿记录" : "编辑礼簿记录"}</DialogTitle>
        <DialogDescription>
          记录礼金或礼品。礼金用于汇总统计；礼品可填写估值（可选）。
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>类型 *</Label>
          <Select
            value={formData.gift_type}
            onValueChange={(v) =>
              setFormData({
                ...formData,
                gift_type: v as GiftRecordType,
                amount: "",
                item_name: "",
                quantity: "",
                estimated_value: "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">礼金</SelectItem>
              <SelectItem value="item">礼品</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="counterparty">对方姓名 *</Label>
          <Input
            id="counterparty"
            value={formData.counterparty_name}
            onChange={(e) => setFormData({ ...formData, counterparty_name: e.target.value })}
            placeholder="例如：李四"
            required
            maxLength={128}
          />
        </div>

        {isCash ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">金额 *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="例如：200"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">币种</Label>
              <Input
                id="currency"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                placeholder="CNY"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item">礼品名称 *</Label>
              <Input
                id="item"
                value={formData.item_name}
                onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                placeholder="例如：电饭煲"
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qty">数量</Label>
                <Input
                  id="qty"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="例如：1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="est">估值（可选）</Label>
                <Input
                  id="est"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.estimated_value}
                  onChange={(e) => setFormData({ ...formData, estimated_value: e.target.value })}
                  placeholder="例如：399"
                />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="date">日期 *</Label>
          <Input
            id="date"
            type="datetime-local"
            value={formData.gift_date}
            onChange={(e) => setFormData({ ...formData, gift_date: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">备注</Label>
          <Input
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="可选"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment">附件（图片 / PDF，可选）</Label>

          {mode === "edit" && hasExistingAttachment && !removeExistingAttachment && !attachment ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
              <a
                href={record!.attachment_key!}
                target="_blank"
                rel="noreferrer"
                className="truncate text-primary hover:underline"
              >
                {record!.attachment_name || "当前附件"}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRemoveExistingAttachment(true)}
                disabled={isSubmitting || isUploading}
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
                disabled={isSubmitting || isUploading}
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
            disabled={isSubmitting || isUploading}
          />

          {attachment ? (
            <div className="text-xs text-muted-foreground">
              已选择：{attachment.name}（{Math.ceil(attachment.size / 1024)} KB）
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">支持图片或 PDF，最大 10MB</div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSubmitting || isUploading}>
            取消
          </Button>
          <Button type="submit" disabled={isSubmitting || isUploading}>
            {isSubmitting || isUploading ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

