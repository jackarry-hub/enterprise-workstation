import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = await readFile(
    path.join(process.cwd(), "quantxy-ai-workbench-fused.html"),
    "utf8",
  );

  return new Response(html, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
    },
  });
}
