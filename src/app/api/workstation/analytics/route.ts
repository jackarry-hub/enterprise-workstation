import { handleCommercialAnalytics } from "@/features/analytics/analytics-handler";
export async function GET(request: Request) { return handleCommercialAnalytics(request); }
