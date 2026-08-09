export type WorkspaceRole = "Owner" | "Admin" | "Project Manager" | "HR" | "Employee";

export type WorkspaceCurrentUser = {
  id: string;
  memberId: string;
  displayName: string;
  role: WorkspaceRole;
};

export const currentUser: WorkspaceCurrentUser = {
  id: "d0000000-0000-4000-8000-000000000001",
  memberId: "20000000-0000-4000-8000-000000000001",
  displayName: "张伟",
  role: "Owner",
};

export function getCurrentUser() {
  return currentUser;
}
