import { describe, expect, it } from "vitest";

import { parseWorkProfileInput } from "@/features/work-profile/work-profile-schema";

describe("work profile input", () => {
  it("normalizes employee-maintained professional profile fields", () => {
    expect(parseWorkProfileInput({
      summary: "  擅长把复杂客户需求转成可验收任务。  ",
      preferredTaskTypes: [" 需求分析 ", "跨部门协作", "需求分析"],
      growthGoals: ["AI 产品设计", " 项目管理 "],
      weeklyCapacityHours: 36,
      selfSkills: [
        { name: " 需求分析 ", level: 5 },
        { name: "Prompt Engineering", level: 4 },
        { name: "prompt engineering", level: 3 },
      ],
    })).toEqual({
      summary: "擅长把复杂客户需求转成可验收任务。",
      preferredTaskTypes: ["需求分析", "跨部门协作"],
      growthGoals: ["AI 产品设计", "项目管理"],
      weeklyCapacityHours: 36,
      selfSkills: [
        { name: "需求分析", level: 5 },
        { name: "Prompt Engineering", level: 4 },
      ],
    });
  });

  it.each([
    ["non-object", null],
    ["summary too long", { summary: "x".repeat(241), preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 40, selfSkills: [] }],
    ["too many preferences", { summary: "", preferredTaskTypes: Array.from({ length: 9 }, (_, i) => `type-${i}`), growthGoals: [], weeklyCapacityHours: 40, selfSkills: [] }],
    ["too many goals", { summary: "", preferredTaskTypes: [], growthGoals: Array.from({ length: 9 }, (_, i) => `goal-${i}`), weeklyCapacityHours: 40, selfSkills: [] }],
    ["capacity below range", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 0, selfSkills: [] }],
    ["capacity above range", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 81, selfSkills: [] }],
    ["capacity is not an integer", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 37.5, selfSkills: [] }],
    ["too many self skills", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 40, selfSkills: Array.from({ length: 21 }, (_, i) => ({ name: `skill-${i}`, level: 3 })) }],
    ["skill level outside range", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 40, selfSkills: [{ name: "沟通", level: 6 }] }],
    ["empty skill name", { summary: "", preferredTaskTypes: [], growthGoals: [], weeklyCapacityHours: 40, selfSkills: [{ name: "  ", level: 3 }] }],
    ["oversized label", { summary: "", preferredTaskTypes: ["x".repeat(41)], growthGoals: [], weeklyCapacityHours: 40, selfSkills: [] }],
  ])("rejects %s", (_case, value) => {
    expect(parseWorkProfileInput(value)).toBeNull();
  });
});
