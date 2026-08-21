export type WorkProfileInput = {
  summary: string;
  preferredTaskTypes: string[];
  growthGoals: string[];
  weeklyCapacityHours: number;
  selfSkills: Array<{ name: string; level: number }>;
};

function normalizedLabels(value: unknown, maximumItems: number) {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const label = item.trim();
    if (!label || label.length > 40) return null;
    const key = label.toLocaleLowerCase("zh-CN");
    if (!seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  }
  return labels;
}

export function parseWorkProfileInput(value: unknown): WorkProfileInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.summary !== "string") return null;
  const summary = body.summary.trim();
  if (summary.length > 240) return null;
  const preferredTaskTypes = normalizedLabels(body.preferredTaskTypes, 8);
  const growthGoals = normalizedLabels(body.growthGoals, 8);
  const weeklyCapacityHours = body.weeklyCapacityHours;
  if (!preferredTaskTypes || !growthGoals
    || !Number.isInteger(weeklyCapacityHours)
    || Number(weeklyCapacityHours) < 1
    || Number(weeklyCapacityHours) > 80
    || !Array.isArray(body.selfSkills)
    || body.selfSkills.length > 20) return null;

  const selfSkills: WorkProfileInput["selfSkills"] = [];
  const seenSkills = new Set<string>();
  for (const rawSkill of body.selfSkills) {
    if (!rawSkill || typeof rawSkill !== "object" || Array.isArray(rawSkill)) {
      return null;
    }
    const skill = rawSkill as Record<string, unknown>;
    if (typeof skill.name !== "string") return null;
    const name = skill.name.trim();
    if (!name || name.length > 40 || !Number.isInteger(skill.level)
      || Number(skill.level) < 1 || Number(skill.level) > 5) return null;
    const key = name.toLocaleLowerCase("zh-CN");
    if (!seenSkills.has(key)) {
      seenSkills.add(key);
      selfSkills.push({ name, level: Number(skill.level) });
    }
  }

  return {
    summary,
    preferredTaskTypes,
    growthGoals,
    weeklyCapacityHours: Number(weeklyCapacityHours),
    selfSkills,
  };
}
