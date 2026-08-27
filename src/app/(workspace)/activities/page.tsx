import type { Metadata } from "next";

import { ActivitiesPage } from "@/features/activities/activities-page";
import { loadProjectCollection } from "@/features/projects/data/project-collection-data";

export const metadata: Metadata = { title: "活动推进 | 企业工作站" };

export const dynamic = "force-dynamic";

export default async function ActivitiesRoute({ searchParams }: { searchParams: Promise<{ activity?: string }> }) {
  const [result, query] = await Promise.all([loadProjectCollection(), searchParams]);
  return <ActivitiesPage result={result} initialSelectedId={query.activity} />;
}
