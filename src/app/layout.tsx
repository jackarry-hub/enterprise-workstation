import type { Metadata } from "next";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: "企业工作站",
  description: "面向决策、部门协同、个人执行、人事与财务的一体化企业工作站。",
  applicationName: "量子星河企业工作站",
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
