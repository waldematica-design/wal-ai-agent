import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createClient as createSessionClient } from "@/lib/supabase/server";

/** Verifica identidade e autorização; nunca autoriza somente por estar logado. */
export async function requireWaldematicaAdmin() {
  const sessionClient = await createSessionClient();
  const { data: { user }, error: userError } = await sessionClient.auth.getUser();

  if (userError || !user) {
    redirect("/admin/login?next=/admin/waldematica/conversas");
  }

  // Reutiliza a lista de administradores já presente no projeto.
  // RLS: cada usuário pode consultar apenas sua própria associação.
  const { data: membership, error: membershipError } = await sessionClient
    .from("tecerale_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    notFound();
  }

  return user.id;
}

/** Somente no servidor, e exclusivamente após requireWaldematicaAdmin(). */
export function createWaldematicaAdminDataClient() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error("SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios no servidor.");
  }

  return createServiceClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
