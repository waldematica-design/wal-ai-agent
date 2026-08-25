import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const GRAPH_API_VERSION = "v26.0";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || "wal-ai-webhook-2026";

  if (mode === "subscribe" && token === verifyToken) {
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

    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      return NextResponse.json({ status: "ok" });
    }

    const from = message.from;
    const type = message.type;
    const whatsappMessageId = message.id;

    const text =
      type === "text"
        ? message?.text?.body?.trim()
        : null;

    const name =
      contact?.profile?.name || "Sem nome";

    if (type !== "text" || !text) {
      return NextResponse.json({ status: "ok" });
    }

    const accessToken =
      process.env.WHATSAPP_ACCESS_TOKEN;

    const phoneNumberId =
      process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (
      !accessToken ||
      !phoneNumberId ||
      !process.env.OPENAI_API_KEY ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SECRET_KEY
    ) {
      console.error(
        "Variáveis de ambiente obrigatórias não configuradas."
      );

      return NextResponse.json(
        { status: "configuration_error" },
        { status: 500 }
      );
    }

    /*
     * 1. Verifica se essa mensagem já foi processada.
     * A Meta pode reenviar webhooks.
     */
    if (whatsappMessageId) {
      const { data: existingMessage } =
        await supabase
          .from("messages")
          .select("id")
          .eq("whatsapp_message_id", whatsappMessageId)
          .maybeSingle();

      if (existingMessage) {
        console.log(
          "Mensagem duplicada ignorada:",
          whatsappMessageId
        );

        return NextResponse.json({
          status: "duplicate_ignored",
        });
      }
    }

    /*
     * 2. Localiza ou cria o contato.
     */
    let { data: contactRecord, error: contactError } =
      await supabase
        .from("contacts")
        .select("*")
        .eq("phone", from)
        .maybeSingle();

    if (contactError) {
      throw contactError;
    }

    if (!contactRecord) {
      const { data, error } =
        await supabase
          .from("contacts")
          .insert({
            phone: from,
            name,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      contactRecord = data;
    } else if (
      name &&
      name !== "Sem nome" &&
      contactRecord.name !== name
    ) {
      const { data, error } =
        await supabase
          .from("contacts")
          .update({
            name,
          })
          .eq("id", contactRecord.id)
          .select()
          .single();

      if (error) {
        throw error;
      }

      contactRecord = data;
    }

    /*
     * 3. Localiza ou cria uma conversa ativa.
     */
    let { data: conversation, error: conversationError } =
      await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactRecord.id)
        .eq("status", "active")
        .order("last_message_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (conversationError) {
      throw conversationError;
    }

    if (!conversation) {
      const { data, error } =
        await supabase
          .from("conversations")
          .insert({
            contact_id: contactRecord.id,
            status: "active",
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      conversation = data;
    }

    /*
     * 4. Salva a mensagem do usuário.
     */
    const { error: userMessageError } =
      await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          role: "user",
          content: text,
          whatsapp_message_id: whatsappMessageId,
        });

    if (userMessageError) {
      throw userMessageError;
    }

    /*
     * 5. Atualiza a última interação da conversa.
     */
    const { error: updateConversationError } =
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

    if (updateConversationError) {
      throw updateConversationError;
    }

    /*
     * 6. Busca as últimas 20 mensagens.
     *
     * O banco retorna da mais recente para a mais antiga.
     * Depois fazemos reverse() para enviar à IA
     * na ordem natural da conversa.
     */
    const { data: recentMessages, error: messagesError } =
      await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", {
          ascending: false,
        })
        .limit(20);

    if (messagesError) {
      throw messagesError;
    }

    const conversationHistory =
      (recentMessages || [])
        .reverse()
        .map((item) => ({
          role:
            item.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: item.content,
        }));

    /*
     * 7. Envia o histórico para a OpenAI.
     */
    const aiResponse =
      await openai.responses.create({
        model: "gpt-5.6",

        instructions: `
Você é o assistente virtual da Wal Brasil.

Converse de forma natural, clara, inteligente e profissional em português brasileiro.

Você está conversando pelo WhatsApp, então prefira respostas naturais e objetivas, sem textos excessivamente longos.

Use o histórico fornecido para manter continuidade real da conversa.

Não repita perguntas que o cliente já respondeu.

Não invente preços, prazos, produtos, serviços ou informações específicas da Wal Brasil que ainda não estejam disponíveis no contexto.

Se não souber alguma informação específica da empresa, diga isso naturalmente.

Seu objetivo neste estágio é conversar bem, compreender o contexto e manter uma interação natural.
        `.trim(),

        input: conversationHistory,
      });

    const aiText =
      aiResponse.output_text?.trim() ||
      "Desculpe, não consegui formular uma resposta agora.";

    /*
     * 8. Salva a resposta da IA.
     */
    const { error: assistantMessageError } =
      await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          role: "assistant",
          content: aiText,
        });

    if (assistantMessageError) {
      throw assistantMessageError;
    }

    /*
     * 9. Atualiza novamente a conversa.
     */
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    /*
     * 10. Envia a resposta pelo WhatsApp.
     */
    const whatsappResponse =
      await fetch(
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
              body: aiText,
            },
          }),
        }
      );

    const whatsappResponseData =
      await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error(
        "Erro ao enviar resposta pelo WhatsApp:",
        whatsappResponseData
      );

      return NextResponse.json(
        {
          status: "whatsapp_send_error",
          details: whatsappResponseData,
        },
        { status: 500 }
      );
    }

    console.log("=== MEMÓRIA ATUALIZADA ===");
    console.log("Contato:", contactRecord.id);
    console.log("Conversa:", conversation.id);
    console.log(
      "Mensagens no contexto:",
      conversationHistory.length
    );
    console.log("==========================");

    return NextResponse.json({
      status: "ok",
      replySent: true,
      conversationId: conversation.id,
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