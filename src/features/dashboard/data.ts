// Deprecated presentational datasets. The active dashboard and analytics pages
// use authenticated server projections. Keeping typed empty collections avoids
// fabricated business records if a legacy panel is imported elsewhere.
export const projectHealth: readonly { name: string; owner: string; progress: number; dueDate: string; status: "active" | "warning" | "success" }[] = [];
export const taskTrend: readonly { date: string; created: number; completed: number }[] = [];
export const todoItems: readonly { title: string; meta: string; time: string; level: "紧急" | "重要" | "普通" }[] = [];
export const announcements: readonly { title: string; date: string; tone: "blue" | "orange" | "green" }[] = [];
export const schedules: readonly { time: string; title: string; place: string; remaining: string }[] = [];
export const activityStages: readonly { label: string; progress: string; state: "success" | "active" | "neutral" }[] = [];
export const projectActivity: readonly { person: string; action: string; time: string }[] = [];
