import { handleConversationCollection } from "@/features/ai-assistant/conversation-handler";

export async function GET(request: Request) { return handleConversationCollection(request); }
export async function POST(request: Request) { return handleConversationCollection(request); }
