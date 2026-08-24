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

  try {
    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (message) {
      const from = message.from;
      const type = message.type;
      const text = message.text?.body ?? null;
      const name = contact?.profile?.name ?? "Sem nome";

      console.log("=== WHATSAPP MESSAGE ===");
      console.log("Nome:", name);
      console.log("De:", from);
      console.log("Tipo:", type);
      console.log("Texto:", text);
      console.log("========================");
    } else {
      console.log("Evento do WhatsApp sem mensagem:");
      console.log(JSON.stringify(body, null, 2));
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Erro ao processar webhook:", error);

    return NextResponse.json(
      { status: "error" },
      { status: 500 }
    );
  }
}