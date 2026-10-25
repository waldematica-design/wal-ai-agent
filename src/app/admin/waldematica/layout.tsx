import type { ReactNode } from "react";
import Link from "next/link";
import { requireWaldematicaAdmin } from "@/lib/waldematica-admin";

export default async function WaldematicaAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireWaldematicaAdmin();

  return (
    <>
      <nav aria-label="Administração do agente Waldemática" className="border-b border-cyan-400/15 bg-slate-950 px-5 py-3 text-slate-100">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 sm:gap-5">
          <span className="mr-auto text-xs font-bold tracking-[.14em] text-cyan-300">WALDEMÁTICA · ADMIN</span>
          <Link href="/admin/waldematica/conversas" className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10">
            Conversas do Agente
          </Link>
          <Link href="/admin/waldematica/leads" className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white">
            Leads
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
