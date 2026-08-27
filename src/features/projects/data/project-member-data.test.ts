import { describe, expect, it } from "vitest";

import {
  loadAvailableProjectMembers,
  loadProjectMemberDirectory,
} from "@/features/projects/data/project-member-data";

function query(data: unknown) {
  const response = { data, error: null };
  const chain = {
    select: () => chain,
    in: () => chain,
    is: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
  };
  return chain;
}

function client() {
  const members = [
    { id: 11, public_id: "51000000-0000-4000-8000-000000000011", user_id: "52000000-0000-4000-8000-000000000011", status: "active" },
    { id: 12, public_id: "51000000-0000-4000-8000-000000000012", user_id: "52000000-0000-4000-8000-000000000012", status: "active" },
  ];
  const profiles = [
    { public_id: "53000000-0000-4000-8000-000000000011", organization_member_id: 11, display_name: "有效成员", avatar_url: null, job_title: "工程师", employment_status: "active", department: { name: "研发部" } },
    { public_id: "53000000-0000-4000-8000-000000000012", organization_member_id: 12, display_name: "已离职成员", avatar_url: null, job_title: "前工程师", employment_status: "terminated", department: { name: "研发部" } },
  ];
  return {
    from(table: string) {
      return query(table === "organization_members" ? members : profiles);
    },
  };
}

const scope = { tenantId: 1, organizationId: 2 };

describe("project member directory", () => {
  it("excludes inactive employee profiles from formal add-member candidates", async () => {
    const members = await loadAvailableProjectMembers(client() as never, scope);
    expect(members.map(({ displayName }) => displayName)).toEqual(["有效成员"]);
  });

  it("retains inactive employee names when resolving historical project records", async () => {
    const directory = await loadProjectMemberDirectory(client() as never, [12], scope);
    expect(directory.get(12)).toEqual(expect.objectContaining({
      employmentStatus: "terminated",
      summary: expect.objectContaining({ displayName: "已离职成员" }),
    }));
  });
});
