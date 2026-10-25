import Link from "next/link";
import {
  createWaldematicaAdminDataClient,
  requireWaldematicaAdmin,
} from "@/lib/waldematica-admin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_LIST_SIZE = 1000;

type Conversation = {
  id: string;
  visitor_id: string;
  status: string;
  started_at: string;
  last_message_at: string;
};

type Visitor = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Lead = {
  visitor_id: string | null;
  course_interest: string | null;
  stage: string;
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function queryLink(page: number, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return `/admin/waldematica/conversas${query ? `?${query}` : ""}`;
}

export default async function ConversasWaldematicaPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; q?: string }>;
}) {
  await requireWaldematicaAdmin();
  const supabase = createWaldematicaAdminDataClient();
  const params = await searchParams;
  const search = (params.q || "").trim().slice(0, 120).toLocaleLowerCase("pt-BR");
  const requestedPage = Number.parseInt(params.pagina || "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;

  // Consultas limitadas para evitar paginação ilimitada e expor apenas o necessário.
  const { data: conversationData, error: conversationError } = await supabase
    .from("waldematica_conversations")
    .select("id,visitor_id,status,started_at,last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(MAX_LIST_SIZE);
  if (conversationError) throw conversationError;

  const conversations = (conversationData || []) as Conversation[];
  const visitorIds = [...new Set(conversations.map((item) => item.visitor_id))];
  let visitors: Visitor[] = [];
  let leads: Lead[] = [];

  if (visitorIds.length) {
    const [visitorsResult, leadsResult] = await Promise.all([
      supabase.from("waldematica_visitors")
        .select("id,name,email,phone")
        .in("id", visitorIds),
      supabase.from("waldematica_leads")
        .select("visitor_id,course_interest,stage")
        .in("visitor_id", visitorIds),
    ]);
    if (visitorsResult.error) throw visitorsResult.error;
    if (leadsResult.error) throw leadsResult.error;
    visitors = (visitorsResult.data || []) as Visitor[];
    leads = (leadsResult.data || []) as Lead[];
  }

  const visitorById = new Map(visitors.map((v) => [v.id, v]));
  const leadByVisitor = new Map(leads.filter((l) => l.visitor_id).map((l) => [l.visitor_id, l]));

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const visitor = visitorById.get(conv.visitor_id);
    const lead = leadByVisitor.get(conv.visitor_id);
    return [visitor?.name, visitor?.email, visitor?.phone, lead?.course_interest, conv.id]
      .some((value) => value?.toLocaleLowerCase("pt-BR").includes(search));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(pages, page);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const withoutLead = conversations.filter((conv) => !leadByVisitor.has(conv.visitor_id)).length;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-cyan-300">Histórico · Agente comercial</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Conversas da Waldemática</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
          Consulte os diálogos completos com os visitantes, inclusive aqueles que não se tornaram leads.
          Histórico somente de leitura; horários de Brasília.
        </p>

        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5"><p className="text-xs text-slate-400">Conversas localizadas</p><p className="mt-2 text-3xl font-bold">{conversations.length}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5"><p className="text-xs text-slate-400">Sem lead cadastrado</p><p className="mt-2 text-3xl font-bold text-amber-300">{withoutLead}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900 p-5"><p className="text-xs text-slate-400">Exibidas na busca</p><p className="mt-2 text-3xl font-bold text-cyan-300">{filtered.length}</p></div>
        </div>

        <form action="/admin/waldematica/conversas" method="get" className="mt-7 flex flex-col gap-3 sm:flex-row">
          <input name="q" type="search" defaultValue={params.q || ""} placeholder="Buscar nome, e-mail, telefone, curso ou ID" aria-label="Buscar conversas" className="min-h-12 flex-1 rounded-xl border border-white/15 bg-slate-900 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400" />
          <button type="submit" className="min-h-12 rounded-xl bg-cyan-400 px-6 text-sm font-bold text-slate-950 hover:bg-cyan-300">Buscar</button>
          {search && <Link href="/admin/waldematica/conversas" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-5 text-sm text-slate-300 hover:bg-slate-800">Limpar</Link>}
        </form>

        <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900" aria-label="Lista de conversas">
          {shown.length === 0 ? (
            <p className="p-8 text-sm text-slate-400">Nenhuma conversa corresponde à busca.</p>
          ) : shown.map((conv) => {
            const visitor = visitorById.get(conv.visitor_id);
            const lead = leadByVisitor.get(conv.visitor_id);
            const name = visitor?.name?.trim() || "Visitante não identificado";
            const contact = visitor?.email || visitor?.phone || "Sem contato informado";
            return (
              <Link key={conv.id} href={`/admin/waldematica/conversas/${conv.id}`} className="flex flex-col justify-between gap-3 border-b border-white/10 p-5 transition-colors last:border-0 hover:bg-cyan-400/5 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm">{name}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${lead ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{lead ? "Lead" : "Sem lead"}</span></div>
                  <p className="mt-1 break-all text-xs text-slate-400">{contact}</p>
                  {lead?.course_interest && <p className="mt-1 text-xs text-cyan-200">Interesse: {lead.course_interest}</p>}
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <p className="text-xs text-slate-300">{localDate(conv.last_message_at)}</p>
                  <p className="mt-1 text-xs text-cyan-300">Ler conversa completa →</p>
                </div>
              </Link>
            );
          })}
        </section>

        <div className="mt-5 flex items-center justify-between gap-4 text-xs text-slate-400">
          <span>Página {safePage} de {pages} · até {MAX_LIST_SIZE} conversas recentes</span>
          <div className="flex items-center gap-2">
            {safePage > 1 && <Link href={queryLink(safePage - 1, params.q || "")} className="rounded-lg border border-white/15 px-4 py-2 text-slate-200 hover:bg-slate-800">Anterior</Link>}
            {safePage < pages && <Link href={queryLink(safePage + 1, params.q || "")} className="rounded-lg border border-white/15 px-4 py-2 text-slate-200 hover:bg-slate-800">Próxima</Link>}
          </div>
        </div>
      </div>
    </main>
  );
}
