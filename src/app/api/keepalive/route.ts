import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = { "Cache-Control": "no-store" };

function authorized(request: NextRequest): boolean {
  const secret = process.env.SUPABASE_KEEPALIVE_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || !auth?.startsWith("Bearer ")) return false;

  const expected = Buffer.from(secret, "utf8");
  const provided = Buffer.from(auth.slice(7), "utf8");

  return (
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: noCache },
    );
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.error("Keepalive: missing server-side Supabase credentials");
    return NextResponse.json(
      { ok: false, error: "Service unavailable" },
      { status: 503, headers: noCache },
    );
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Uma consulta SELECT real, sem expor ou alterar registros.
    const { error } = await supabase
      .from("waldematica_courses")
      .select("slug")
      .limit(1);

    if (error) {
      console.error("Keepalive: Supabase query failed:", error.message);
      return NextResponse.json(
        { ok: false, error: "Database query failed" },
        { status: 503, headers: noCache },
      );
    }

    return NextResponse.json(
      { ok: true, service: "wal-ai-agent-supabase", checkedAt: new Date().toISOString() },
      { status: 200, headers: noCache },
    );
  } catch (error) {
    console.error("Keepalive: request failed:", error);
    return NextResponse.json(
      { ok: false, error: "Database connection failed" },
      { status: 503, headers: noCache },
    );
  }
}
