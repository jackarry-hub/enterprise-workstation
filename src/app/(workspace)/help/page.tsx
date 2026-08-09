import type { Metadata } from "next";

import { HelpCenter } from "@/features/help/help-center";

export const metadata: Metadata = { title: "使用帮助 | 企业工作站" };

export default function HelpPage() {
  return <HelpCenter />;
}
