import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultWorkstationBootstrapDependencies,
  type WorkstationBootstrapDependencies,
} from "@/app/api/workstation/bootstrap/handler";

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

function redirectToLogin(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/login", url.origin);
  destination.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(destination, 307);
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

function errorSummary(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const candidate = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
    queryName?: unknown;
  };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    queryName: typeof candidate.queryName === "string"
      ? candidate.queryName
      : undefined,
    message: typeof candidate.message === "string"
      ? candidate.message
      : String(error),
    details: typeof candidate.details === "string" ? candidate.details : undefined,
    hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
  };
}

export async function createWorkstationHtmlResponse(
  request: Request,
  dependencies: WorkstationBootstrapDependencies =
    defaultWorkstationBootstrapDependencies,
) {
  const html = await readFusedWorkbenchHtml();

  if (!isFormalRequest(request)) return htmlResponse(html);

  const session = await dependencies.loadSession();
  if (!session) return redirectToLogin(request);

  try {
    const bootstrap = await dependencies.loadBootstrap(
      session as Parameters<WorkstationBootstrapDependencies["loadBootstrap"]>[0],
    );
    return htmlResponse(injectServerBootstrap(html, bootstrap));
  } catch (error) {
    console.error("formal_workstation_bootstrap_failed", errorSummary(error));
    return new Response("workstation_unavailable", {
      status: 503,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}
