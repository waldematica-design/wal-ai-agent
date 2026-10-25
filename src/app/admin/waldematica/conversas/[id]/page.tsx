import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createWaldematicaAdminDataClient,
  requireWaldematicaAdmin,
} from "@/lib/waldematica-admin";

export const dynamic = "force-dynamic";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export default async function ConversaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireWaldematicaAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }
  const supabase = createWaldematicaAdminDataClient();
  const { data: conversation, error } = await supabase
    .from("waldematica_conversations")
    .select("id,visitor_id,status,started_at,last_message_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!conversation) notFound();

  const [messagesResult, visitorResult, leadResult] = await Promise.all([
    supabase.from("waldematica_messages")
      .select("id,role,content,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("waldematica_visitors")
      .select("name,email,phone")
      .eq("id", conversation.visitor_id)
      .maybeSingle(),
    supabase.from("waldematica_leads")
      .select("course_interest,stage,summary")
      .eq("visitor_id", conversation.visitor_id)
      .maybeSingle(),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (visitorResult.error) throw visitorResult.error;
  if (leadResult.error) throw leadResult.error;
  const messages = (messagesResult.data || []) as Message[];
  const visitor = visitorResult.data;
  const lead = leadResult.data;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin/waldematica/conversas" className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">← Todas as conversas</Link>
        <h1 className="mt-5 text-3xl font-bold">{visitor?.name || "Visitante não identificado"}</h1>
        <p className="mt-2 break-all text-sm text-slate-400">{visitor?.email || visitor?.phone || "Contato não informado"}</p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-2">Início: {localDate(conversation.started_at)}</span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-2">{messages.length} mensagens</span>
          <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-2">{lead ? `Lead: ${lead.stage}` : "Sem lead"}</span>
          {lead?.course_interest && <span className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-cyan-300">Curso: {lead.course_interest}</span>}
        </div>
        {lead?.summary && <div className="mt-5 rounded-xl border border-white/10 bg-slate-900 p-4 text-xs leading-relaxed text-slate-400"><strong className="text-slate-200">Resumo do lead:</strong> {lead.summary}</div>}
        <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-slate-900" aria-label="Histórico completo da conversa">
          <div className="border-b border-white/10 p-5">
            <h2 className="font-semibold">Histórico das mensagens</h2>
            <p className="mt-1 text-xs text-slate-400">Mensagens do visitante à direita e respostas do agente à esquerda. Somente leitura.</p>
          </div>
          <div className="space-y-5 bg-slate-950/60 p-4 sm:p-7">
            {messages.length ? messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[94%] rounded-2xl px-4 py-3 sm:max-w-[80%] ${isUser ? "rounded-br-sm bg-cyan-800/80 text-white" : "rounded-bl-sm border border-white/10 bg-slate-800 text-slate-100"}`}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
                    <p className={`mt-3 text-[11px] ${isUser ? "text-cyan-100/75" : "text-slate-400"}`}>
                      {isUser ? "Visitante" : "Agente IA"} · {localDate(message.created_at)}
                    </p>
                  </div>
                </div>
              );
            }) : <p className="p-6 text-sm text-slate-400">Nenhuma mensagem registrada nesta conversa.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
