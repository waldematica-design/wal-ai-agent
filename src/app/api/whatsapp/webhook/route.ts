import { NextRequest, NextResponse } from "next/server";

const VERIFY_TOKEN = "wal-ai-webhook-2026";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { error: "Falha na verificação do webhook" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  console.log("Webhook WhatsApp recebido:");
  console.log(JSON.stringify(body, null, 2));

  return NextResponse.json({ status: "ok" });
}