import type { Metadata } from "next";

import { HelpCenter } from "@/features/help/help-center";

export const metadata: Metadata = { title: "使用帮助 | 量子智枢" };

export default function HelpPage() {
  return <HelpCenter />;
}
