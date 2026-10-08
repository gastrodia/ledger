"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  const focusField = (field: string) => {
    const input = formRef.current?.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.focus();
  };

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({
      ...current,
      [field]: "",
      form: "",
      ...(field === "password" ? { confirmPassword: "" } : {}),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate
    const newErrors: Record<string, string> = {};
    if (!formData.username) {
      newErrors.username = "请输入用户名";
    } else if (formData.username.length < 3) {
      newErrors.username = "用户名至少3个字符";
    }
    if (formData.username.includes("@")) newErrors.username = "用户名不能包含 @";
    if (!formData.email) {
      newErrors.email = "请输入邮箱";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "请输入有效的邮箱地址";
    }
    if (!formData.password) {
      newErrors.password = "请输入密码";
    } else if (formData.password.length < 6) {
      newErrors.password = "密码至少6个字符";
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "两次密码不一致";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      focusField(Object.keys(newErrors)[0]);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: formData.username,
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // 将错误信息映射到相应的字段
        const message = typeof data?.error === "string" && data.error
          ? data.error
          : "注册失败，请重试";
        const field = message.includes("邮箱") ? "email" : message.includes("用户名") ? "username" : undefined;
        if (field) {
          setErrors({ [field]: message });
          focusField(field);
        } else {
          setErrors({ form: message });
        }
        toast({ title: "注册失败", description: message, variant: "error" });
        return;
      }

      // 注册成功，跳转到 AI 记账
      window.location.href = '/dashboard/assistant';
    } catch (error) {
      console.error('注册错误:', error);
      const message = "网络错误，请检查连接后重试";
      setErrors({ form: message });
      toast({ title: "注册失败", description: message, variant: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="创建家庭账户"
      subtitle="开始您的记账之旅"
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="username">用户名</Label>
          <Input
            id="username"
            name="username"
            type="text"
            placeholder={errors.username || "请输入用户名"}
            value={formData.username}
            onChange={(e) => updateField("username", e.target.value)}
            autoComplete="username"
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? "username-error" : undefined}
            title={errors.username || undefined}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={errors.email || "请输入邮箱地址"}
            value={formData.email}
            onChange={(e) => updateField("email", e.target.value)}
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            title={errors.email || undefined}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder={errors.password || "请输入密码（至少6位）"}
            value={formData.password}
            onChange={(e) => updateField("password", e.target.value)}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            title={errors.password || undefined}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认密码</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder={errors.confirmPassword || "请再次输入密码"}
            value={formData.confirmPassword}
            onChange={(e) => updateField("confirmPassword", e.target.value)}
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
            title={errors.confirmPassword || undefined}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          注册即表示您同意我们的{" "}
          <Link href="/terms" className="text-primary hover:underline">
            服务条款
          </Link>{" "}
          和{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            隐私政策
          </Link>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? "注册中..." : "注册"}
        </Button>
      </form>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {errors.username && <span id="username-error">{errors.username}。</span>}
        {errors.email && <span id="email-error">{errors.email}。</span>}
        {errors.password && <span id="password-error">{errors.password}。</span>}
        {errors.confirmPassword && <span id="confirm-password-error">{errors.confirmPassword}。</span>}
        {errors.form && <span>{errors.form}</span>}
      </div>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        已有账户？{" "}
        <Link href="/login" className="text-primary hover:underline font-semibold">
          立即登录
        </Link>
      </div>
    </AuthLayout>
  );
}
