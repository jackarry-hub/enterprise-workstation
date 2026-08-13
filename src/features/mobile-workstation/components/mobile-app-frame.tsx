import type { ReactNode } from "react";

import { MobileBottomNav } from "@/features/mobile-workstation/components/mobile-bottom-nav";

export function MobileAppFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-label="移动工作区" className="mobile-app-frame">
      <div className="mobile-app-scroll">{children}</div>
      <MobileBottomNav />
    </section>
  );
}

