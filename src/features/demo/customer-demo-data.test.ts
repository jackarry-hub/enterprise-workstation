import { describe, expect, it } from "vitest";

import {
  customerDemoActors,
  customerDemoPeople,
  customerDemoProjectMembers,
  customerDemoSessions,
} from "@/features/demo/customer-demo-data";
import { mockEmployees } from "@/features/hr/employee-mock-data";
import { operationFixtureActors } from "@/features/operations/operations-data";
import { mockMembers } from "@/features/projects/mock-data";
import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { salaryMockResult } from "@/features/salary/salary-mock-data";

describe("customer demo organization", () => {
  it("keeps ten usable people with stable identities and all supported roles", () => {
    expect(customerDemoPeople).toHaveLength(10);
    expect(new Set(customerDemoPeople.map(({ id }) => id)).size).toBe(10);
    expect(new Set(customerDemoPeople.map(({ employeeNo }) => employeeNo)).size).toBe(10);
    expect(new Set(customerDemoPeople.map(({ role }) => role))).toEqual(
      new Set(["executive", "department_head", "employee", "finance", "hr"]),
    );
    expect(customerDemoPeople.every(({ responsibility }) => responsibility.trim().length > 0)).toBe(true);
    expect(customerDemoPeople.every(({ skills }) => skills.length === 3 && skills.every((skill) => skill.trim().length > 0))).toBe(true);
  });

  it("derives sessions, project members, and operation actors from the same people", () => {
    const expectedNames = customerDemoPeople.map(({ name }) => name).sort();

    expect(customerDemoSessions.map(({ profile }) => profile.displayName).sort()).toEqual(expectedNames);
    expect(customerDemoProjectMembers.map(({ displayName }) => displayName).sort()).toEqual(expectedNames);
    expect(customerDemoActors.map(({ name }) => name).sort()).toEqual(expectedNames);

    for (const person of customerDemoPeople) {
      expect(customerDemoSessions.find(({ authUserId }) => authUserId === person.authUserId)).toMatchObject({
        landingPath: "/dashboard",
        actor: {
          name: person.name,
          memberId: String(person.organizationMemberId),
          role: person.role,
          landingPath: person.landingPath,
        },
        profile: { departmentName: person.department, jobTitle: person.jobTitle },
      });
      expect(customerDemoProjectMembers.find(({ id }) => id === person.memberId)).toMatchObject({
        displayName: person.name,
        department: person.department,
        title: person.jobTitle,
      });
      expect(customerDemoActors.find(({ id }) => id === person.actorId)).toMatchObject({
        name: person.name,
        memberId: person.memberId,
        role: person.role,
      });
    }
  });

  it("feeds the existing people, project, and workflow adapters without duplicate rosters", () => {
    const expectedNames = customerDemoPeople.map(({ name }) => name).sort();

    expect(mockEmployees.map(({ profile }) => profile.displayName).sort()).toEqual(expectedNames);
    expect(mockMembers.map(({ displayName }) => displayName).sort()).toEqual(expectedNames);
    expect(operationFixtureActors.map(({ name }) => name).sort()).toEqual(expectedNames);
  });

  it("keeps approval and payroll people inside the ten-person demo roster", () => {
    const allowedNames = new Set(customerDemoPeople.map(({ name }) => name));
    const approvalPeople = approvalMockResult.data.approvals.flatMap((approval) => [
      approval.applicant.displayName,
      approval.owner.displayName,
      ...approval.steps.flatMap((step) => step.approver ? [step.approver.displayName] : []),
      ...approval.actions.map((action) => action.actor.displayName),
    ]);

    expect(approvalPeople.every((name) => allowedNames.has(name))).toBe(true);
    expect(salaryMockResult.data.records.map(({ employee }) => employee.displayName).sort()).toEqual(
      customerDemoPeople.map(({ name }) => name).sort(),
    );
  });
});
