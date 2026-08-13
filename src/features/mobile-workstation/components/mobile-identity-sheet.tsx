"use client";

import { useState } from "react";
import { Check, ChevronRight, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCustomerDemoSession, useWorkspaceSession } from "@/features/auth/workspace-session-provider";

function personId(providerSubject: string) {
  return providerSubject.replace("customer-demo:", "");
}

export function MobileIdentitySheet() {
  const router = useRouter();
  const { actor } = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  const [open, setOpen] = useState(false);

  if (!demo.enabled) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label="切换演示身份" className="mobile-identity-trigger">
          <span className="mobile-identity-trigger__icon"><UsersRound aria-hidden="true" className="size-4.5" /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-xs font-medium text-[#7b899f]">我的演示身份</span>
            <strong className="mt-0.5 block truncate text-sm text-[#21304a]">{actor.name} · {actor.title}</strong>
          </span>
          <span className="text-xs font-semibold text-[#2f7df6]">切换</span>
          <ChevronRight aria-hidden="true" className="size-4 text-[#8290a6]" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mobile-identity-sheet" aria-describedby="mobile-identity-description">
        <SheetHeader className="mobile-identity-sheet__header">
          <SheetTitle>选择演示身份</SheetTitle>
          <SheetDescription id="mobile-identity-description">保留全部 10 位人员，切换后只展示该人员自己的工作内容。</SheetDescription>
        </SheetHeader>
        <div className="mobile-identity-list" role="list">
          {demo.sessions.map((candidate) => {
            const candidatePersonId = personId(candidate.identity.providerSubject);
            const selected = candidatePersonId === demo.currentPersonId;
            return (
              <button
                key={candidate.authUserId}
                type="button"
                data-testid="mobile-identity-option"
                aria-label={candidate.profile.displayName + " · " + candidate.profile.jobTitle + " · " + candidate.profile.departmentName}
                aria-pressed={selected}
                className="mobile-identity-option"
                onClick={() => {
                  const next = demo.switchIdentity(candidatePersonId);
                  if (!next) return;
                  setOpen(false);
                  router.push(next.actor.landingPath);
                }}
              >
                <span className="mobile-identity-option__avatar">{candidate.profile.displayName.slice(0, 1)}</span>
                <span className="min-w-0 flex-1 text-left">
                  <strong className="block truncate text-sm text-[#182742]">{candidate.profile.displayName} · {candidate.profile.jobTitle}</strong>
                  <span className="mt-0.5 block truncate text-xs text-[#74829a]">{candidate.profile.departmentName}</span>
                </span>
                {selected ? <span className="mobile-identity-option__check"><Check aria-hidden="true" className="size-4" /><span className="sr-only">当前身份</span></span> : <ChevronRight aria-hidden="true" className="size-4 text-[#9ba8ba]" />}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
