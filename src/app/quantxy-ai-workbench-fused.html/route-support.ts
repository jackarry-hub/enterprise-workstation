import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isLocalPreviewHost,
  isServerPreviewEnabled,
} from "@/lib/runtime/workstation-mode";

const SERVER_ADAPTER_SCRIPT =
  '<script src="/workstation-server-adapter.js?v=server-embed-85755e6"></script>';

function readFusedWorkbenchHtml() {
  return readFile(
    path.join(process.cwd(), "quantxy-ai-workbench-fused.html"),
    "utf8",
  );
}

function isFormalRequest(request: Request) {
  return new URL(request.url).searchParams.get("formal") === "1";
}

function escapeJsonForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function injectServerBootstrap(html: string, bootstrap: unknown) {
  if (!html.includes(SERVER_ADAPTER_SCRIPT)) {
    throw new Error("server_adapter_script_marker_missing");
  }
  const embeddedBootstrapScript = [
    '<script id="qxy-server-bootstrap">',
    "(function(){",
    `window.__QUANTXY_SERVER_BOOTSTRAP__=${escapeJsonForInlineScript(bootstrap)};`,
    "})();",
    "</script>",
  ].join("\n");

  return html.replace(
    SERVER_ADAPTER_SCRIPT,
    `${embeddedBootstrapScript}\n${SERVER_ADAPTER_SCRIPT}`,
  );
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

export async function createWorkstationHtmlResponse(
  request: Request,
) {
  const url = new URL(request.url);
  if (
    isFormalRequest(request)
    || !isServerPreviewEnabled()
    || !isLocalPreviewHost(url.hostname)
  ) {
    return new Response("workstation_preview_forbidden", { status: 404 });
  }

  const html = await readFusedWorkbenchHtml();
  return htmlResponse(html);
}
