import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa/register-sw";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "钱钱去哪了 - 记账助手",
  description: "简单好用的个人记账软件，帮助您轻松管理收支",
  manifest: "/manifest.webmanifest",
  applicationName: "钱钱去哪了",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "钱钱去哪了",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${plusJakartaSans.variable} font-sans`}>
        <Providers>
          {children}
        </Providers>
        <PwaRegister />
        <Toaster />
      </body>
    </html>
  );
}
