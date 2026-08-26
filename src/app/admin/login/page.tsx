"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    const {
      error: loginError,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError("E-mail ou senha inválidos.");
      setLoading(false);
      return;
    }

    router.push("/admin/leads");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium text-blue-400">
            @walbrasil.dev
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            Administração
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Acesso restrito ao painel do Agente de IA.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        >
          <div>
            <label
              htmlFor="email"
              className="text-sm font-medium text-slate-300"
            >
              E-mail
            </label>

            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-500"
              placeholder="seu@email.com"
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-300"
            >
              Senha
            </label>

            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-500"
              placeholder="Sua senha"
            />
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}