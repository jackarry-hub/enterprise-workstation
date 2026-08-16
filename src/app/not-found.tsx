import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="workspace-mesh grid min-h-dvh place-items-center px-5"><section className="w-full max-w-lg rounded-3xl border border-glass-border bg-glass p-8 text-center shadow-[0_24px_70px_rgba(43,91,155,0.12)]"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-primary"><FileQuestion className="size-6" /></span><p className="mt-5 text-sm font-medium text-primary">404 · 页面不存在</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">没有找到这个工作页面</h1><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">链接可能已失效，或者当前页面已经调整。请返回量子智枢继续处理任务。</p><Button asChild className="mt-6"><Link href="/"><ArrowLeft />返回量子智枢</Link></Button></section></main>;
}
