"use client";

import { usePathname } from "next/navigation";
import { Bot, CalendarPlus, FolderPlus, MessageSquarePlus, Plus, ReceiptText, ShieldCheck, UserRoundPlus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { dispatchContextualCreate, getContextualCreateActions, type ContextualCreateAction } from "@/features/quick-create/contextual-create-actions";

const icons = { folder: FolderPlus, calendar: CalendarPlus, customer: UserRoundPlus, receipt: ReceiptText, bot: Bot, workflow: Workflow, shield: ShieldCheck, message: MessageSquarePlus };
export function MobileCreateSheet() {
  const pathname = usePathname(); const session = useWorkspaceSession(); const capabilities = getModuleCapabilities(session); const actions = getContextualCreateActions({ pathname, session, capabilities });
  if (!actions.length) return null;
  return <Sheet><SheetTrigger asChild><Button type="button" size="icon" className="fixed right-5 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-xl md:hidden" aria-label="快速创建"><Plus className="size-6" /></Button></SheetTrigger><SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1.25rem+env(safe-area-inset-bottom))]"><SheetHeader><SheetTitle>快速创建</SheetTitle><SheetDescription>只显示当前页面已上线且你有权限执行的操作。</SheetDescription></SheetHeader><div className="grid gap-2 px-4">{actions.map((action) => { const Icon = icons[action.icon]; return <SheetClose key={action.id} asChild><Button type="button" variant="outline" className="min-h-13 justify-start rounded-2xl" onClick={() => dispatchContextualCreate(action as ContextualCreateAction)}><Icon data-icon="inline-start" />{action.label}</Button></SheetClose>; })}</div></SheetContent></Sheet>;
}
