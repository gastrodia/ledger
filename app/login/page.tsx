"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export default function LoginPage() {
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate
    const newErrors: Record<string, string> = {};
    if (!formData.username) {
      newErrors.username = "请输入用户名或邮箱";
    }
    if (!formData.password) {
      newErrors.password = "请输入密码";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrors({ username: data.error || '登录失败，请重试' });
        return;
      }

      // 登录成功，跳转到仪表板
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('登录错误:', error);
      setErrors({ username: '网络错误，请检查连接后重试' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="钱钱去哪了"
      subtitle="智能记账，轻松管理您的财务"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">用户名或邮箱</Label>
          <Input
            id="username"
            type="text"
            placeholder="请输入用户名或邮箱"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            autoComplete="username"
          />
          {errors.username && (
            <p className="text-sm text-destructive">{errors.username}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="请输入密码"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            autoComplete="current-password"
          />
          {errors.password && (
            <p className="text-sm text-destructive">{errors.password}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Checkbox id="remember" />
            <Label
              htmlFor="remember"
              className="text-sm font-normal cursor-pointer"
            >
              记住我
            </Label>
          </div>
          <Link 
            href="/forgot-password" 
            className="text-sm text-primary hover:underline"
          >
            忘记密码？
          </Link>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? "登录中..." : "立即登录"}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        还没有账户？{" "}
        <Link 
          href="/register" 
          className="text-primary hover:underline font-semibold"
        >
          立即注册
        </Link>
      </div>
    </AuthLayout>
  );
}
