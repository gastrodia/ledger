"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import styles from "@/components/layout/auth-layout.module.css";

export default function LoginPage() {
  const { toast } = useToast();
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const updateField = (field: "username" | "password", value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", form: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const newErrors: Record<string, string> = {};
    const username = formData.username;
    if (!username) newErrors.username = "请输入用户名或邮箱";
    if (!formData.password) newErrors.password = "请输入密码";
    setErrors(newErrors);
    if (Object.keys(newErrors).length) {
      (newErrors.username ? usernameRef : passwordRef).current?.focus();
      return;
    }

    submitting.current = true;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: formData.password }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : "登录失败，请重试";
        setErrors({ form: message });
        toast({ title: "登录失败", description: message, variant: "error" });
        return;
      }
      window.location.href = "/dashboard/assistant";
    } catch {
      const message = "暂时无法连接，请检查网络后重试";
      setErrors({ form: message });
      toast({ title: "登录失败", description: message, variant: "error" });
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout title="欢迎回来" subtitle="登录，接着记录你的生活。">
      <form onSubmit={handleSubmit} className={styles.loginForm} noValidate aria-busy={isLoading}>
        <div className={styles.field}>
          <Label htmlFor="username">用户名或邮箱</Label>
          <Input
            ref={usernameRef}
            id="username"
            name="username"
            type="text"
            placeholder={errors.username || "输入用户名或邮箱"}
            title={errors.username || undefined}
            value={formData.username}
            onChange={(e) => updateField("username", e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={isLoading}
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? "username-error" : undefined}
          />
        </div>
        <div className={styles.field}>
          <Label htmlFor="password">密码</Label>
          <div className={styles.passwordControl}>
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder={errors.password || "输入你的密码"}
              title={errors.password || undefined}
              value={formData.password}
              onChange={(e) => updateField("password", e.target.value)}
              autoComplete="current-password"
              required
              disabled={isLoading}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              aria-pressed={showPassword}
              aria-controls="password"
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <Button type="submit" className={styles.submitButton} disabled={isLoading}>
          {isLoading ? <><Loader2 className="animate-spin" aria-hidden="true" />正在登录</> : <>登录<ArrowRight aria-hidden="true" /></>}
        </Button>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {errors.username && <span id="username-error">{errors.username}。</span>}
          {errors.password && <span id="password-error">{errors.password}。</span>}
          {errors.form && <span>{errors.form}</span>}
        </div>
      </form>
      <div className={styles.signup}>
        还没有家庭账户？<Link href="/register">创建一个家庭 <ArrowRight size={14} className="ml-1" aria-hidden="true" /></Link>
      </div>
    </AuthLayout>
  );
}
