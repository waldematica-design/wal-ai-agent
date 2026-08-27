import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Lead = {
  id: string;
  visitor_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  target_exam: string | null;
  course_interest: string | null;
  main_goal: string | null;
  current_level: string | null;
  desired_start: string | null;
  preferred_contact: string | null;
  stage: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type Conversation = {
  id: string;
  visitor_id: string;
  status: string;
  started_at: string;
  last_message_at: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    new: "Novo",
    interested: "Interessado",
    qualified: "Qualificado",
    hot: "Quente",
    human: "Atendimento humano",
    closed: "Encerrado",
  };

  return labels[stage] || stage;
}

function stageClasses(stage: string) {
  const classes: Record<string, string> = {
    new: "border-slate-700 bg-slate-800 text-slate-300",
    interested:
      "border-blue-500/30 bg-blue-500/10 text-blue-300",
    qualified:
      "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
    hot:
      "border-orange-500/30 bg-orange-500/10 text-orange-300",
    human:
      "border-violet-500/30 bg-violet-500/10 text-violet-300",
    closed:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };

  return (
    classes[stage] ||
    "border-slate-700 bg-slate-800 text-slate-300"
  );
}

function normalizePhoneForWhatsApp(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-white">
        <h1 className="text-2xl font-bold">
          Configuração incompleta
        </h1>

        <p className="mt-3 text-slate-400">
          As variáveis do Supabase não estão configuradas.
        </p>
      </main>
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseSecretKey
  );

  const {
    data: lead,
    error: leadError,
  } = await supabase
    .from("waldematica_leads")
    .select(`
      id,
      visitor_id,
      name,
      email,
      phone,
      target_exam,
      course_interest,
      main_goal,
      current_level,
      desired_start,
      preferred_contact,
      stage,
      summary,
      created_at,
      updated_at
    `)
    .eq("id", id)
    .maybeSingle();

  if (leadError) {
    throw leadError;
  }

  if (!lead) {
    notFound();
  }

  const typedLead = lead as Lead;

  let conversation: Conversation | null = null;
  let messages: Message[] = [];

  if (typedLead.visitor_id) {
    const {
      data: conversationData,
      error: conversationError,
    } = await supabase
      .from("waldematica_conversations")
      .select(`
        id,
        visitor_id,
        status,
        started_at,
        last_message_at
      `)
      .eq("visitor_id", typedLead.visitor_id)
      .order("last_message_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (conversationError) {
      throw conversationError;
    }

    conversation =
      (conversationData as Conversation | null) ||
      null;
  }

  if (conversation) {
    const {
      data: messageData,
      error: messageError,
    } = await supabase
      .from("waldematica_messages")
      .select(`
        id,
        role,
        content,
        created_at
      `)
      .eq("conversation_id", conversation.id)
      .order("created_at", {
        ascending: true,
      });

    if (messageError) {
      throw messageError;
    }

    messages = (messageData || []) as Message[];
  }

  const whatsappNumber =
    typedLead.phone
      ? normalizePhoneForWhatsApp(
          typedLead.phone
        )
      : "";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="mb-6">
          <Link
            href="/admin/waldematica/leads"
            className="text-sm text-blue-300 hover:text-blue-200"
          >
            ← Voltar para leads Waldemática
          </Link>
        </div>

        <header className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-400">
                Waldemática
              </p>

              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                {typedLead.name ||
                  "Lead sem nome"}
              </h1>

              {typedLead.course_interest && (
                <p className="mt-1 text-slate-400">
                  Interesse: {typedLead.course_interest}
                </p>
              )}
            </div>

            <span
              className={`w-fit rounded-full border px-3 py-1.5 text-sm font-medium ${stageClasses(
                typedLead.stage
              )}`}
            >
              {stageLabel(
                typedLead.stage
              )}
            </span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-slate-900 p-5">
              <h2 className="text-base font-semibold">
                Perfil do interessado
              </h2>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Curso de interesse
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.course_interest ||
                      "Não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Prova / objetivo
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.target_exam ||
                      "Não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Objetivo principal
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.main_goal ||
                      "Não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Nível atual
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.current_level ||
                      "Não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Quando pretende começar
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.desired_start ||
                      "Não informado"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-900 p-5">
              <h2 className="text-base font-semibold">
                Contato
              </h2>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Nome
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.name ||
                      "Não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    E-mail
                  </p>

                  {typedLead.email ? (
                    <a
                      href={`mailto:${typedLead.email}`}
                      className="mt-1 inline-block text-blue-300 hover:underline"
                    >
                      {typedLead.email}
                    </a>
                  ) : (
                    <p className="mt-1 text-slate-200">
                      Não informado
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Telefone / WhatsApp
                  </p>

                  {typedLead.phone ? (
                    whatsappNumber ? (
                      <a
                        href={`https://wa.me/${whatsappNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-emerald-300 hover:underline"
                      >
                        {typedLead.phone}
                      </a>
                    ) : (
                      <p className="mt-1 text-slate-200">
                        {typedLead.phone}
                      </p>
                    )
                  ) : (
                    <p className="mt-1 text-slate-200">
                      Não informado
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Preferência
                  </p>

                  <p className="mt-1 text-slate-200">
                    {typedLead.preferred_contact ||
                      "Não informado"}
                  </p>
                </div>
              </div>
            </section>

            {typedLead.summary && (
              <section className="rounded-2xl border border-white/10 bg-slate-900 p-5">
                <h2 className="text-base font-semibold">
                  Resumo do atendimento
                </h2>

                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  {typedLead.summary}
                </p>
              </section>
            )}

            <section className="rounded-2xl border border-white/10 bg-slate-900 p-5 text-xs text-slate-500">
              <p>
                Criado em{" "}
                {formatDate(
                  typedLead.created_at
                )}
              </p>

              <p className="mt-2">
                Atualizado em{" "}
                {formatDate(
                  typedLead.updated_at
                )}
              </p>
            </section>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="font-semibold">
                Conversa completa
              </h2>

              <p className="mt-1 text-xs text-slate-500">
                Histórico do atendimento realizado pelo Agente IA Waldemática.
              </p>
            </div>

            <div className="max-h-[760px] space-y-4 overflow-y-auto bg-slate-950/60 p-5">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                  Nenhuma mensagem encontrada para este lead.
                </div>
              ) : (
                messages.map((message) => {
                  const isUser =
                    message.role === "user";

                  return (
                    <div
                      key={message.id}
                      className={`flex ${
                        isUser
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                          isUser
                            ? "rounded-br-md bg-blue-600 text-white"
                            : "rounded-bl-md bg-slate-800 text-slate-100"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {message.content}
                        </p>

                        <p
                          className={`mt-2 text-[10px] ${
                            isUser
                              ? "text-blue-200"
                              : "text-slate-500"
                          }`}
                        >
                          {isUser
                            ? "Visitante"
                            : "Agente IA"}{" "}
                          ·{" "}
                          {formatDate(
                            message.created_at
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {conversation && (
              <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">
                Última mensagem:{" "}
                {formatDate(
                  conversation.last_message_at
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}