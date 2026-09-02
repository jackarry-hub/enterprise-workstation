import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("AI conversation resume migration", () => {
  it("stores the active conversation server-side and keeps it owner-scoped", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609020003_ai_conversation_resume.sql"), "utf8").toLowerCase();
    expect(sql).toContain("last_opened_at");
    expect(sql).toContain("touch_current_ai_conversation");
    expect(sql).toContain("conversation.owner_member_id = v_actor.member_id");
    expect(sql).toContain("'lastopenedat', item.last_opened_at");
    expect(sql).toContain("grant execute on function public.touch_current_ai_conversation(uuid)");
  });
});
