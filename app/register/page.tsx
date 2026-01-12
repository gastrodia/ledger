"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

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
        if (data.error.includes('邮箱')) {
          setErrors({ email: data.error });
        } else if (data.error.includes('用户名')) {
          setErrors({ username: data.error });
        } else {
          setErrors({ username: data.error || '注册失败，请重试' });
        }
        return;
      }

      // 注册成功，跳转到仪表板
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('注册错误:', error);
      setErrors({ username: '网络错误，请检查连接后重试' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="创建账户"
      subtitle="开始您的记账之旅"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">用户名</Label>
          <Input
            id="username"
            type="text"
            placeholder="请输入用户名"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            autoComplete="username"
          />
          {errors.username && (
            <p className="text-sm text-destructive">{errors.username}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="请输入邮箱地址"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            autoComplete="email"
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="请输入密码（至少6位）"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            autoComplete="new-password"
          />
          {errors.password && (
            <p className="text-sm text-destructive">{errors.password}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认密码</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            autoComplete="new-password"
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">{errors.confirmPassword}</p>
          )}
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

      <div className="mt-6 text-center text-sm text-muted-foreground">
        已有账户？{" "}
        <Link href="/login" className="text-primary hover:underline font-semibold">
          立即登录
        </Link>
      </div>
    </AuthLayout>
  );
}
