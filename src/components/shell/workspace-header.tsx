"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Check, ChevronDown, CircleHelp, LogOut, Mail, Menu, RotateCcw, Search, Settings, UserRound, UsersRound } from "lucide-react";

import { WorkspaceSearchDialog } from "@/components/shell/workspace-search-dialog";
import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { navigationItems } from "@/config/navigation";
import { signOut } from "@/features/auth/actions";
import { useCustomerDemoSession, useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { resetCustomerDemoState } from "@/features/demo/customer-demo-state";
import { getOperationNotifications, markOperationNotificationRead } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";

export function WorkspaceHeader() {
  const router = useRouter();
  const session = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  const { actor: workspaceActor, profile } = session;
  const { state, context, actor: operationActor } = useOperations(session);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const notifications = getOperationNotifications(state, operationActor.id);
  const unreadCount = notifications.filter(({ read }) => !read).length;
  const helpLinks = navigationItems.filter(({ available, roles }) => available && (!roles || roles.includes(workspaceActor.role))).slice(0, 3);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-18 items-center border-b border-glass-border bg-glass px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <Sheet>
          <SheetTrigger asChild><Button type="button" variant="outline" size="icon" className="mr-3 lg:hidden" aria-label="打开主导航"><Menu aria-hidden="true" /></Button></SheetTrigger>
          <SheetContent side="left" className="w-70 p-0">
            <SheetHeader className="sr-only"><SheetTitle>企业工作站导航</SheetTitle><SheetDescription>选择要进入的工作模块</SheetDescription></SheetHeader>
            <WorkspaceSidebar className="w-full border-r-0" />
          </SheetContent>
        </Sheet>

        <Button type="button" variant="outline" aria-label="全局搜索" onClick={() => setSearchOpen(true)} className="mx-auto hidden h-10 w-full max-w-110 justify-start rounded-xl border-input/80 bg-background/70 text-muted-foreground shadow-none md:flex">
          <Search data-icon="inline-start" aria-hidden="true" /><span className="truncate">搜索我有权限查看的工作...</span><kbd className="ml-auto rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">⌘ K</kbd>
        </Button>

        <div className="ml-auto flex items-center gap-2 md:ml-6">
          <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="打开移动端搜索" onClick={() => setSearchOpen(true)}><Search aria-hidden="true" /></Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="查看通知">
                <Bell aria-hidden="true" />{unreadCount ? <span className="absolute -mr-5 -mt-5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-primary-foreground">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-2xl p-2">
              <DropdownMenuLabel className="flex items-center justify-between"><span>最新通知</span><span className="text-xs font-normal text-muted-foreground">{unreadCount} 条未读</span></DropdownMenuLabel><DropdownMenuSeparator />
              {notifications.slice(0, 4).map((item) => (
                <DropdownMenuItem key={item.id} asChild className="rounded-xl p-0">
                  <Link href={item.href} onClick={() => markOperationNotificationRead(context, item.id, operationActor.id)} className="block px-3 py-2.5"><span className="flex items-center gap-2 text-sm font-medium">{!item.read ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}{item.title}</span><span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{item.description}</span></Link>
                </DropdownMenuItem>
              ))}
              {!notifications.length ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">当前没有新通知</p> : null}
              <DropdownMenuSeparator /><DropdownMenuItem asChild className="rounded-xl"><Link href="/notifications" className="justify-center text-primary">查看全部通知</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button asChild variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="查看消息"><Link href="/approvals"><Mail aria-hidden="true" /></Link></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="帮助中心" className="hidden sm:inline-flex" onClick={() => setHelpOpen(true)}><CircleHelp aria-hidden="true" /></Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="h-12 gap-2 rounded-xl px-2" aria-label="打开用户菜单">
                <Avatar size="lg" role="img" aria-label={profile.displayName}>
                  {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={profile.displayName} /> : null}
                  <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-primary-foreground">{profile.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-left sm:block"><span className="block text-sm font-semibold text-foreground">{profile.displayName}</span><span className="block text-xs text-muted-foreground">{workspaceActor.roleLabel} · {profile.jobTitle}</span></span>
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={demo.enabled ? "w-80" : "w-52"}>
              <DropdownMenuLabel className="min-w-0">
                <span className="block truncate text-sm font-medium">{profile.displayName}</span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">{profile.departmentName} · {profile.jobTitle}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {demo.enabled ? (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">切换演示身份</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {demo.sessions.map((candidate) => {
                      const personId = candidate.identity.providerSubject.replace("customer-demo:", "");
                      const selected = demo.currentPersonId === personId;
                      return (
                        <DropdownMenuItem
                          key={candidate.authUserId}
                          aria-label={`切换为 ${candidate.profile.displayName} · ${candidate.profile.jobTitle}`}
                          onSelect={() => {
                            const next = demo.switchIdentity(personId);
                            if (next) router.push(next.landingPath);
                          }}
                          className="items-start py-2"
                        >
                          <span className="grid size-5 shrink-0 place-items-center">{selected ? <Check aria-hidden="true" /> : null}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{candidate.profile.displayName} · {candidate.profile.jobTitle}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{candidate.profile.departmentName}</span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setResetOpen(true)}>
                    <RotateCcw aria-hidden="true" />重置演示数据
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuGroup>
                {workspaceActor.role === "executive" ? <><DropdownMenuItem asChild><Link href="/settings?tab=personal"><UserRound aria-hidden="true" />个人资料</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/settings?tab=notifications"><Settings aria-hidden="true" />偏好设置</Link></DropdownMenuItem></> : null}
                {workspaceActor.role === "department_head" ? <><DropdownMenuItem asChild><Link href="/people"><UsersRound aria-hidden="true" />我的团队</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/leave"><UserRound aria-hidden="true" />请假与审批</Link></DropdownMenuItem></> : null}
                {workspaceActor.role === "employee" ? <><DropdownMenuItem asChild><Link href="/tasks"><UserRound aria-hidden="true" />我的任务</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/payroll"><Settings aria-hidden="true" />我的工资单</Link></DropdownMenuItem></> : null}
                {workspaceActor.role === "finance" ? <><DropdownMenuItem asChild><Link href="/payroll"><UserRound aria-hidden="true" />薪资办理</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/leave"><Settings aria-hidden="true" />我的请假</Link></DropdownMenuItem></> : null}
                {workspaceActor.role === "hr" ? <><DropdownMenuItem asChild><Link href="/people"><UsersRound aria-hidden="true" />人员管理</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/payroll"><Settings aria-hidden="true" />薪资复核</Link></DropdownMenuItem></> : null}
              </DropdownMenuGroup>
              {!demo.enabled ? <><DropdownMenuSeparator /><form action={signOut}><DropdownMenuItem asChild variant="destructive"><button type="submit" className="w-full"><LogOut aria-hidden="true" />退出登录</button></DropdownMenuItem></form></> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <WorkspaceSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent><DialogHeader><DialogTitle>{workspaceActor.roleLabel}工作台帮助</DialogTitle><DialogDescription>这里只提供当前岗位需要的业务入口；其他岗位数据不会出现在菜单和搜索中。</DialogDescription></DialogHeader><div className="grid gap-2 sm:grid-cols-3">{helpLinks.map((item) => <Button key={item.href} asChild variant="outline"><Link href={item.href} onClick={() => setHelpOpen(false)}>{item.label}</Link></Button>)}</div><Button asChild><Link href="/help" onClick={() => setHelpOpen(false)}>打开完整使用指南</Link></Button></DialogContent>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重置客户演示数据？</DialogTitle>
            <DialogDescription>任务、项目、客户和设置会恢复为演示初始状态，当前选择的演示身份会保留。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button type="button" variant="destructive" onClick={() => {
              resetCustomerDemoState();
              setResetOpen(false);
              router.push("/dashboard");
              router.refresh();
            }}>确认重置</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
