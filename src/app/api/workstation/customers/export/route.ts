import {
  defaultCrmExchangeDependencies,
  handleCrmExport,
} from "@/features/customers/crm-import-export-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleCrmExport(request, await defaultCrmExchangeDependencies());
  } catch {
    return Response.json({ error: "crm_export_unavailable" }, { status: 503 });
  }
}
