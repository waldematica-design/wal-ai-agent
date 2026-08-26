import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Lead = {
  id: string;
  name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  project_type: string | null;
  main_goal: string | null;
  requested_features: string | null;
  budget_range: string | null;
  desired_deadline: string | null;
  preferred_contact: string | null;
  stage: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
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
    hot: "Lead quente",
    human: "Atendimento humano",
    closed: "Encerrado",
  };

  return labels[stage] || stage;
}

function stageClasses(stage: string) {
  const classes: Record<string, string> = {
    new: "border-slate-600 bg-slate-800 text-slate-300",
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
    "border-slate-600 bg-slate-800 text-slate-300"
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

export default async function LeadsPage() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY;

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

  const { data, error } = await supabase
    .from("web_leads")
    .select(`
      id,
      name,
      company_name,
      email,
      phone,
      project_type,
      main_goal,
      requested_features,
      budget_range,
      desired_deadline,
      preferred_contact,
      stage,
      summary,
      created_at,
      updated_at
    `)
    .order("updated_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  const leads = (data || []) as Lead[];

  const totalLeads = leads.length;

  const qualifiedLeads = leads.filter(
    (lead) => lead.stage === "qualified"
  ).length;

  const hotLeads = leads.filter(
    (lead) => lead.stage === "hot"
  ).length;

  const humanLeads = leads.filter(
    (lead) => lead.stage === "human"
  ).length;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <header>
          <p className="text-sm font-medium text-blue-400">
            @walbrasil.dev
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Leads do Agente de IA
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Clientes e oportunidades identificadas
            automaticamente durante as conversas do
            agente.
          </p>
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Total de leads
            </p>

            <p className="mt-2 text-3xl font-bold">
              {totalLeads}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Qualificados
            </p>

            <p className="mt-2 text-3xl font-bold">
              {qualifiedLeads}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Leads quentes
            </p>

            <p className="mt-2 text-3xl font-bold">
              {hotLeads}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5">
            <p className="text-sm text-slate-400">
              Atendimento humano
            </p>

            <p className="mt-2 text-3xl font-bold">
              {humanLeads}
            </p>
          </div>
        </section>

        <section className="mt-8 space-y-5">
          {leads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900 p-10 text-center">
              <p className="text-slate-400">
                Nenhum lead identificado ainda.
              </p>
            </div>
          ) : (
            leads.map((lead) => {
              const whatsappNumber = lead.phone
                ? normalizePhoneForWhatsApp(
                    lead.phone
                  )
                : "";

              return (
                <article
                  key={lead.id}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900 p-5 transition hover:border-blue-500/40 hover:bg-slate-900/90"
                >
                  {/* Link invisível que torna o card inteiro clicável */}
                  <Link
                    href={`/admin/leads/${lead.id}`}
                    aria-label={`Abrir ficha do lead ${
                      lead.name ||
                      lead.company_name ||
                      ""
                    }`}
                    className="absolute inset-0 z-0"
                  />

                  <div className="pointer-events-none relative z-10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold transition group-hover:text-blue-300">
                          {lead.name ||
                            lead.company_name ||
                            "Lead sem nome"}
                        </h2>

                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${stageClasses(
                            lead.stage
                          )}`}
                        >
                          {stageLabel(lead.stage)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        <p className="text-xs text-slate-500">
                          Atualizado em{" "}
                          {formatDate(
                            lead.updated_at
                          )}
                        </p>

                        <span className="text-sm font-medium text-blue-400 opacity-0 transition group-hover:opacity-100">
                          Abrir ficha →
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Projeto
                        </p>

                        <p className="mt-1 text-sm text-slate-200">
                          {lead.project_type ||
                            "Não informado"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Objetivo
                        </p>

                        <p className="mt-1 text-sm text-slate-200">
                          {lead.main_goal ||
                            "Não informado"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Orçamento informado
                        </p>

                        <p className="mt-1 text-sm text-slate-200">
                          {lead.budget_range ||
                            "Não informado"}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Prazo desejado
                        </p>

                        <p className="mt-1 text-sm text-slate-200">
                          {lead.desired_deadline ||
                            "Não informado"}
                        </p>
                      </div>
                    </div>

                    {lead.requested_features && (
                      <div className="mt-5">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Funcionalidades
                        </p>

                        <p className="mt-1 text-sm leading-relaxed text-slate-200">
                          {
                            lead.requested_features
                          }
                        </p>
                      </div>
                    )}

                    <div className="mt-5 rounded-xl bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Contato
                      </p>

                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-slate-500">
                            Nome
                          </p>

                          <p className="mt-1 text-sm text-slate-200">
                            {lead.name ||
                              "Não informado"}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500">
                            Preferência
                          </p>

                          <p className="mt-1 text-sm text-slate-200">
                            {lead.preferred_contact ||
                              "Não informado"}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500">
                            E-mail
                          </p>

                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              className="pointer-events-auto relative z-20 mt-1 inline-block text-sm text-blue-300 hover:underline"
                            >
                              {lead.email}
                            </a>
                          ) : (
                            <p className="mt-1 text-sm text-slate-200">
                              Não informado
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="text-xs text-slate-500">
                            Telefone / WhatsApp
                          </p>

                          {lead.phone ? (
                            whatsappNumber ? (
                              <a
                                href={`https://wa.me/${whatsappNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="pointer-events-auto relative z-20 mt-1 inline-block text-sm text-emerald-300 hover:underline"
                              >
                                {lead.phone}
                              </a>
                            ) : (
                              <p className="mt-1 text-sm text-slate-200">
                                {lead.phone}
                              </p>
                            )
                          ) : (
                            <p className="mt-1 text-sm text-slate-200">
                              Não informado
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {lead.summary && (
                      <div className="mt-5 rounded-xl bg-slate-950/70 p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          Resumo do atendimento
                        </p>

                        <p className="mt-2 text-sm leading-relaxed text-slate-300">
                          {lead.summary}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-500">
                      <p>
                        Criado em{" "}
                        {formatDate(
                          lead.created_at
                        )}
                      </p>

                      <p>
                        Atualizado em{" "}
                        {formatDate(
                          lead.updated_at
                        )}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}