import { loadNotificationInbox } from "@/features/operations/notification-inbox-data";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await loadNotificationInbox();
  return Response.json(result, { status: result.source === "unavailable" ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
}
