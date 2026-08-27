import {
  defaultCrmExchangeDependencies,
  handleCrmImport,
} from "@/features/customers/crm-import-export-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleCrmImport(request, await defaultCrmExchangeDependencies());
  } catch {
    return Response.json({ error: "crm_import_unavailable" }, { status: 503 });
  }
}
