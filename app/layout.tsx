import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa/register-sw";
import { BRAND_COLOR, BRAND_DESCRIPTION, BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

const plusJakartaSans = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${BRAND_NAME} - ${BRAND_TAGLINE}`,
  description: BRAND_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  applicationName: BRAND_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: BRAND_COLOR,
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
