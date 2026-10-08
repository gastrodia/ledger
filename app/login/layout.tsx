import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `登录 · ${BRAND_NAME}`,
  description: BRAND_DESCRIPTION,
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
