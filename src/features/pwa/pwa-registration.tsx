"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PwaRegistration() {
  const [offline, setOffline] = useState(false); const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const sync = () => { const next = !navigator.onLine; setOffline(next); document.body.dataset.offline = String(next); };
    sync(); window.addEventListener("online", sync); window.addEventListener("offline", sync);
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker); }); });
      }).catch(() => undefined);
    }
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); delete document.body.dataset.offline; };
  }, []);
  useEffect(() => {
    function stopOfflineWrite(event: Event) {
      if (!offline) return;
      const target = event.target instanceof Element ? event.target.closest("[data-network-write='true']") : null;
      if (target) { event.preventDefault(); event.stopPropagation(); }
    }
    document.addEventListener("click", stopOfflineWrite, true); document.addEventListener("submit", stopOfflineWrite, true);
    return () => { document.removeEventListener("click", stopOfflineWrite, true); document.removeEventListener("submit", stopOfflineWrite, true); };
  }, [offline]);
  if (!offline && !waiting) return null;
  return <div className="fixed inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 text-sm shadow-xl backdrop-blur" role="status">{offline ? <><CloudOff className="size-5 shrink-0 text-warning" /><span className="min-w-0 flex-1"><strong>当前离线</strong><span className="block text-xs text-muted-foreground">读取仅限已缓存静态资源，业务写入已暂停。</span></span></> : <><RefreshCw className="size-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><strong>新版本已就绪</strong><span className="block text-xs text-muted-foreground">刷新后启用最新工作站。</span></span><Button size="sm" onClick={() => { waiting?.postMessage({ type: "SKIP_WAITING" }); location.reload(); }}>刷新</Button></>}</div>;
}
