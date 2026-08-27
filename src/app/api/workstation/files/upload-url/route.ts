import { handleDefaultFileUploadReservation } from "@/features/files/file-command-handler";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleDefaultFileUploadReservation(request);
}
