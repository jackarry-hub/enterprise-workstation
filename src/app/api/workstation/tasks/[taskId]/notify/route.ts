export const dynamic = "force-dynamic";
export async function POST() {
  return Response.json(
    { error: "notification_retry_endpoint_retired" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
