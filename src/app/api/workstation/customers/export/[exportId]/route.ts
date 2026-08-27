import {
  defaultCrmExchangeDependencies,
  handleCrmExportDownload,
} from "@/features/customers/crm-import-export-handler";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ exportId: string }> },
) {
  try {
    return await handleCrmExportDownload(request, context, await defaultCrmExchangeDependencies());
  } catch {
    return Response.json({ error: "crm_export_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
