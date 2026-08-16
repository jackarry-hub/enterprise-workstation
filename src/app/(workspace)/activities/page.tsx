import type { Metadata } from "next";

import { ActivitiesPage } from "@/features/activities/activities-page";

export const metadata: Metadata = { title: "活动推进 | 量子智枢" };

export default function ActivitiesRoute() {
  return <ActivitiesPage />;
}
