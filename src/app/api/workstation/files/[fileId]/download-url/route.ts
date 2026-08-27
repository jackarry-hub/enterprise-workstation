import { handleDefaultFileDownload } from "@/features/files/file-command-handler";

export const runtime = "nodejs";

export function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  return handleDefaultFileDownload(request, context);
}
