import { handleConversationResource } from "@/features/ai-assistant/conversation-handler";

export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  return handleConversationResource(request, (await params).conversationId);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  return handleConversationResource(request, (await params).conversationId);
}
