"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeft, Bot, MessageSquarePlus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { QUICK_CREATE_EVENT } from "@/features/quick-create/contextual-create-actions";

type Conversation = { id: string; title: string; version: number; lastMessageAt: string; lastOpenedAt?: string | null };
type Message = { id: string; sequence: number; role: "user" | "assistant"; content: string; state: "pending" | "completed" | "failed"; createdAt: string };

async function payload(response: Response) { return await response.json() as Record<string, unknown>; }

export function AssistantWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("正在同步会话…");

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/workstation/ai/conversations", { cache: "no-store" });
      const data = await payload(response); const items = Array.isArray(data.items) ? data.items as Conversation[] : [];
      if (!response.ok) throw new Error("load_failed");
      setConversations(items); setFeedback(items.length ? "" : "暂无会话，创建后可跨设备继续。");
      const desktop = typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 768px)").matches;
      const remembered = items
        .filter((item) => item.lastOpenedAt)
        .sort((left, right) => String(right.lastOpenedAt).localeCompare(String(left.lastOpenedAt)))[0];
      setSelected((current) => current
        ? items.find(({ id }) => id === current.id) ?? current
        : remembered ?? (desktop ? items[0] ?? null : null));
    } catch { setFeedback("会话同步失败，请稍后重试。"); }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(`/api/workstation/ai/conversations/${encodeURIComponent(conversationId)}/messages`, { cache: "no-store" });
      const data = await payload(response);
      if (!response.ok) throw new Error("load_failed");
      setMessages(Array.isArray(data.items) ? data.items as Message[] : []);
    } catch { setMessages([]); setFeedback("消息同步失败，请稍后重试。"); }
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { if (selected) void loadMessages(selected.id); else setMessages([]); }, [loadMessages, selected]);

  function selectConversation(conversation: Conversation | null, persist = true) {
    setSelected(conversation);
    if (conversation && persist) {
      void fetch(`/api/workstation/ai/conversations/${encodeURIComponent(conversation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      }).catch(() => undefined);
    }
  }

  async function createConversation() {
    setPending(true);
    try {
      const response = await fetch("/api/workstation/ai/conversations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ title: `新会话 ${new Date().toLocaleDateString("zh-CN")}` }) });
      const data = await payload(response); const conversation = data.conversation as Conversation | undefined;
      if (!response.ok || !conversation?.id) throw new Error("create_failed");
      setConversations((current) => [conversation, ...current]); selectConversation(conversation, false); setMessages([]); setFeedback("");
    } catch { setFeedback("新会话创建失败。"); } finally { setPending(false); }
  }

  useEffect(() => {
    function handleQuickCreate(event: Event) {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === "assistant.conversation.create") void createConversation();
    }
    window.addEventListener(QUICK_CREATE_EVENT, handleQuickCreate);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, handleQuickCreate);
  });

  async function sendMessage() {
    if (!selected || !draft.trim() || pending) return;
    const content = draft.trim(); setDraft(""); setPending(true); setFeedback("AI 正在处理，离开页面后结果仍会保存。");
    try {
      const response = await fetch(`/api/workstation/ai/conversations/${encodeURIComponent(selected.id)}/messages`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ content }) });
      await payload(response);
      await loadMessages(selected.id); await loadConversations();
      setFeedback(response.ok ? "已保存到会话记录。" : "本次调用失败，失败状态已记录，可稍后重试。");
    } catch { setFeedback("网络中断，消息已提交时可在刷新后查看。"); } finally { setPending(false); }
  }

  async function archiveConversation() {
    if (!selected || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/workstation/ai/conversations/${encodeURIComponent(selected.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: selected.version }) });
      if (!response.ok) throw new Error("archive_failed");
      selectConversation(null); setMessages([]); await loadConversations(); setFeedback("会话已归档。");
    } catch { setFeedback("会话状态已变化，请刷新后重试。"); } finally { setPending(false); }
  }

  return (
    <main className="mx-auto w-full max-w-420 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <section className="mb-4 flex items-end justify-between gap-3">
        <div><p className="text-xs font-semibold tracking-[0.18em] text-primary">PERSISTENT ASSISTANT</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">AI 助手</h1><p className="mt-1 text-sm text-muted-foreground">会话、调用状态与失败记录均保存到企业数据库。</p></div>
        <Button type="button" data-network-write="true" onClick={() => void createConversation()} disabled={pending}><MessageSquarePlus data-icon="inline-start" />新会话</Button>
      </section>
      <div className="grid min-h-[calc(100dvh-12rem)] gap-3 md:grid-cols-[18rem_minmax(0,1fr)]">
        <GlassCard className={cn("overflow-hidden p-2", selected && "max-md:hidden")}>
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">最近会话</div>
          <div className="grid gap-1">
            {conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => selectConversation(conversation)} className={cn("rounded-2xl px-3 py-3 text-left transition", selected?.id === conversation.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}><span className="block truncate text-sm font-semibold">{conversation.title}</span><span className={cn("mt-1 block text-xs", selected?.id === conversation.id ? "text-primary-foreground/75" : "text-muted-foreground")}>{new Date(conversation.lastMessageAt).toLocaleString("zh-CN")}</span></button>)}
          </div>
        </GlassCard>
        <GlassCard className={cn("flex min-h-140 flex-col overflow-hidden p-0", selected && "max-md:fixed max-md:inset-0 max-md:z-50 max-md:min-h-[100dvh] max-md:rounded-none max-md:bg-background")}>
          {selected ? <>
            <header className="flex min-h-16 items-center gap-2 border-b px-3 sm:px-5"><Button type="button" size="icon" variant="ghost" className="md:hidden" aria-label="返回会话列表" onClick={() => setSelected(null)}><ArrowLeft /></Button><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{selected.title}</h2><p className="text-xs text-muted-foreground">服务端持久会话</p></div><Button type="button" data-network-write="true" size="sm" variant="ghost" onClick={() => void archiveConversation()} disabled={pending}><Archive data-icon="inline-start" />归档</Button></header>
            <div className="flex-1 space-y-4 overflow-y-auto px-3 py-5 sm:px-6">{messages.length ? messages.map((message) => <article key={message.id} className={cn("max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm", message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "border bg-card")}><p className="whitespace-pre-wrap">{message.content}</p>{message.state === "failed" ? <p className="mt-2 text-xs text-destructive">调用失败，状态已记录</p> : null}</article>) : <div className="grid h-full min-h-70 place-items-center text-center"><div><Bot className="mx-auto size-10 text-primary"/><h2 className="mt-3 font-semibold">开始一个真实工作会话</h2><p className="mt-1 text-sm text-muted-foreground">消息发送后先落库，再调用模型。</p></div></div>}</div>
            <footer className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur sm:p-4"><p role="status" className="mb-2 min-h-4 text-xs text-muted-foreground">{feedback}</p><div className="flex items-end gap-2"><Textarea aria-label="输入消息" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={12000} placeholder="输入问题或工作目标…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && document.body.dataset.offline !== "true") { event.preventDefault(); void sendMessage(); } }} /><Button type="button" data-network-write="true" size="icon" aria-label="发送消息" disabled={pending || !draft.trim()} onClick={() => void sendMessage()}><Send /></Button></div></footer>
          </> : <div className="grid flex-1 place-items-center px-6 text-center"><div><Bot className="mx-auto size-10 text-primary"/><h2 className="mt-3 font-semibold">选择或创建会话</h2><p className="mt-1 text-sm text-muted-foreground">历史会话会自动同步。</p></div></div>}
        </GlassCard>
      </div>
    </main>
  );
}
