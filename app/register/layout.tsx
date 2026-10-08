import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = {
  title: `注册 · ${BRAND_NAME}`,
  description: `创建 ${BRAND_NAME}账户，${BRAND_TAGLINE}`,
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
