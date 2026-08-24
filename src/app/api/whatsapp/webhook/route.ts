import { NextRequest, NextResponse } from "next/server";

const GRAPH_API_VERSION = "v26.0";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || "wal-ai-webhook-2026";

  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook do WhatsApp verificado.");
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { error: "Falha na verificação do webhook." },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log(
      "Webhook recebido:",
      JSON.stringify(body, null, 2)
    );

    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      console.log("Evento sem mensagem de usuário.");
      return NextResponse.json({ status: "ok" });
    }

    const from = message.from;
    const type = message.type;
    const text =
      type === "text"
        ? message?.text?.body
        : null;

    const name =
      contact?.profile?.name || "Sem nome";

    console.log("=== WHATSAPP MESSAGE ===");
    console.log("Nome:", name);
    console.log("De:", from);
    console.log("Tipo:", type);
    console.log("Texto:", text);
    console.log("========================");

    if (type !== "text" || !text) {
      return NextResponse.json({ status: "ok" });
    }

    const accessToken =
      process.env.WHATSAPP_ACCESS_TOKEN;

    const phoneNumberId =
      process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      console.error(
        "WHATSAPP_ACCESS_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurado."
      );

      return NextResponse.json(
        { status: "configuration_error" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: from,
          type: "text",
          text: {
            body: "Olá! Sou o assistente virtual da Wal Brasil. Integração funcionando! 🚀",
          },
        }),
      }
    );

    const responseData = await response.json();

    console.log(
      "Resposta da API do WhatsApp:",
      JSON.stringify(responseData, null, 2)
    );

    if (!response.ok) {
      console.error(
        "Erro ao enviar resposta pelo WhatsApp:",
        responseData
      );

      return NextResponse.json(
        {
          status: "whatsapp_send_error",
          details: responseData,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "ok",
      replySent: true,
    });
  } catch (error) {
    console.error(
      "Erro ao processar webhook:",
      error
    );

    return NextResponse.json(
      { status: "error" },
      { status: 500 }
    );
  }
}