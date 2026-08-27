import { TaskCenterWorkspace } from "@/features/tasks/task-center-workspace";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { mockMembers } from "@/features/projects/mock-data";
import type { ProjectCollectionResult } from "@/features/projects/data/project-collection-data";

const defaultResult: ProjectCollectionResult = {
  details: getEffectiveProjectDetails([]),
  source: "mock",
  viewer: {},
  availableMembers: mockMembers,
};

export function TaskCenterPage({ result = defaultResult }: { result?: ProjectCollectionResult }) {
  return <TaskCenterWorkspace result={result} />;
}
