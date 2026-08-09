import type {
  MemberSummary,
  Milestone,
  Objective,
  Project,
  ProjectMember,
  ProjectTask,
} from "@/features/projects/types";

export type ActivityProjectView = {
  project: Project;
  objective?: Objective;
  owner: MemberSummary;
  members: readonly ProjectMember[];
  stages: readonly Milestone[];
  tasks: readonly ProjectTask[];
};
