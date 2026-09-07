"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Loader2 } from "lucide-react";
import type { Member } from "@/types";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/hooks/use-confirm";

// 预设头像选项
const avatarOptions = [
  "👨", "👩", "👴", "👵", "👦", "👧", "🧑", "👱",
    "👨‍🦳", "👩‍🦰", "👨‍🦱", "👩‍🦱", "🧓", "🧔", "👶", "😊"
];

export default function MembersPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 加载成员列表
  const [reload, setReload] = useState(0);
  const loadMembers = () => {
    setLoadError(null);
    setIsLoading(true);
    setReload((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/members", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("获取家庭成员失败");
        }

        const result = await response.json();
        if (controller.signal.aborted) return;
        setMembers(result.data || []);
        setLoadError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("加载家庭成员失败:", error);
        setLoadError("家庭成员加载失败，请检查网络后重试");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [router, reload]);

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setIsAddModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "删除家庭成员",
      description: "确定要删除这个家庭成员吗？此操作无法撤销。",
      confirmText: "删除",
      cancelText: "取消",
    });

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/members/${id}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || "删除失败");
        return;
      }

      toast.success("删除成功");
      loadMembers();
    } catch (error) {
      console.error("删除家庭成员失败:", error);
      toast.error("删除失败");
    }
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingMember(null);
  };

  const handleSave = () => {
    handleCloseModal();
    loadMembers();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              家庭成员
            </h1>
            <p className="text-sm leading-6 text-muted-foreground mt-1">
              管理您的家庭成员，用于记录交易的归属人
            </p>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4" />
            添加成员
          </Button>
        </div>

        {/* Loading State */}
        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-muted-foreground mt-4">加载中...</p>
            </CardContent>
          </Card>
        ) : loadError ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4" role="alert">
              <p className="font-medium">{loadError}</p>
              <Button variant="outline" onClick={loadMembers}>重新加载</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Members Grid */}
            {members.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">暂无家庭成员</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setIsAddModalOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    添加第一个成员
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      <MemberModal
        key={`${isAddModalOpen}:${editingMember?.id || "new"}`}
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        member={editingMember}
        onSave={handleSave}
      />
    </DashboardLayout>
  );
}

function MemberCard({
  member,
  onEdit,
  onDelete,
}: {
  member: Member;
  onEdit: (member: Member) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="relative group">
      <div className="p-4 pt-12 rounded-lg border bg-card hover:border-primary/30 hover:shadow-sm transition-colors text-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-3xl">
            {member.avatar || "👤"}
          </div>
          <div>
            <p className="font-medium">{member.name}</p>
          </div>
        </div>
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 bg-background"
          onClick={() => onEdit(member)}
        >
          <Edit className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 bg-background text-destructive hover:text-destructive"
          onClick={() => onDelete(member.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function MemberModal({
  isOpen,
  onClose,
  member,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    name: member?.name || "",
    avatar: member?.avatar || "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error("请输入成员姓名");
      return;
    }

    try {
      setIsSubmitting(true);

      if (member) {
        // 更新成员
        const response = await fetch(`/api/members/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || "更新失败");
          return;
        }

        toast.success("更新成功");
      } else {
        // 创建成员
        const response = await fetch("/api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const result = await response.json();

        if (!response.ok) {
          toast.error(result.error || "创建失败");
          return;
        }

        toast.success("创建成功");
      }

      onSave();
    } catch (error) {
      console.error("保存家庭成员失败:", error);
      toast.error("保存失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{member ? "编辑成员" : "添加成员"}</DialogTitle>
          <DialogDescription>
            设置成员的姓名和头像
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">成员姓名</Label>
            <Input
              id="name"
              type="text"
              placeholder="请输入成员姓名"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              maxLength={128}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar">头像 (Emoji)</Label>
            <Input
              id="avatar"
              type="text"
              placeholder="请输入头像 Emoji"
              value={formData.avatar}
              onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
              maxLength={10}
            />
          </div>

          <div className="space-y-2">
            <Label>快速选择头像</Label>
            <div className="grid grid-cols-6 gap-2">
              {avatarOptions.map((avatar) => (
                <button
                  key={avatar}
                  type="button"
                  onClick={() => setFormData({ ...formData, avatar: avatar })}
                  className={`p-3 rounded-lg text-3xl transition-all ${
                    formData.avatar === avatar
                      ? "bg-primary/20 border-2 border-primary"
                      : "bg-accent border-2 border-transparent hover:bg-accent/80"
                  }`}
                  title={avatar}
                >
                  {avatar}
                </button>
              ))}
            </div>
          </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                "保存"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
