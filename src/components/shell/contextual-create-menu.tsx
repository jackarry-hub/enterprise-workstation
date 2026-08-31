"use client";

import { usePathname } from "next/navigation";
import { Bot, CalendarPlus, ChevronDown, FolderPlus, MessageSquarePlus, Plus, ReceiptText, ShieldCheck, UserRoundPlus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { dispatchContextualCreate, getContextualCreateActions, type ContextualCreateAction } from "@/features/quick-create/contextual-create-actions";

const icons = { folder: FolderPlus, calendar: CalendarPlus, customer: UserRoundPlus, receipt: ReceiptText, bot: Bot, workflow: Workflow, shield: ShieldCheck, message: MessageSquarePlus };
export function ContextualCreateMenu() {
  const pathname = usePathname(); const session = useWorkspaceSession(); const capabilities = getModuleCapabilities(session); const actions = getContextualCreateActions({ pathname, session, capabilities });
  if (!actions.length) return null;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" className="hidden min-h-11 gap-2 rounded-xl md:inline-flex" aria-label="快速创建"><Plus /><span>快速创建</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-58 rounded-2xl p-2">{actions.map((action) => { const Icon = icons[action.icon]; return <DropdownMenuItem key={action.id} className="min-h-11 rounded-xl" onSelect={() => dispatchContextualCreate(action as ContextualCreateAction)}><Icon />{action.label}</DropdownMenuItem>; })}</DropdownMenuContent></DropdownMenu>;
}
