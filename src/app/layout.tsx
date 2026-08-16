import type { Metadata } from "next";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: "量子智枢 QuantNexus",
  description: "把经营目标转成可执行项目、任务与结果的企业内部工作系统。",
  applicationName: "量子智枢 QuantNexus",
  keywords: ["企业工作台", "任务协同", "项目管理", "审批", "考勤", "薪资"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a href="#main-content" className="sr-only z-100 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">跳到主要内容</a>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
