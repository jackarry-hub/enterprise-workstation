import { handleEnterpriseInitialization } from "@/features/settings/enterprise-initialization-handler";

export async function GET(request: Request) {
  return handleEnterpriseInitialization(request);
}

export async function POST(request: Request) {
  return handleEnterpriseInitialization(request);
}
