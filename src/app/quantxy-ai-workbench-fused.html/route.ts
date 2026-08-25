import { createWorkstationHtmlResponse } from "./route-support";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return createWorkstationHtmlResponse(request);
}
