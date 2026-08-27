"use client";

import { useRouter } from "next/navigation";

export function useWorkspaceRouter() {
  try {
    return useRouter();
  } catch {
    return {
      push(href: string) {
        if (typeof window !== "undefined") window.history.pushState({}, "", href);
      },
      replace(href: string) {
        if (typeof window !== "undefined") window.history.replaceState({}, "", href);
      },
      refresh() {},
      back() {
        if (typeof window !== "undefined") window.history.back();
      },
      forward() {
        if (typeof window !== "undefined") window.history.forward();
      },
      prefetch() {},
    };
  }
}
