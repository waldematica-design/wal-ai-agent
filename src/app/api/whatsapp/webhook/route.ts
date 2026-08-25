import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const GRAPH_API_VERSION = "v26.0";
const HISTORY_LIMIT = 10;

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

    /*
     * Eventos de status, entrega, leitura etc.
     * NÃO geram resposta.
     */
    if (!message) {
      return NextResponse.json({
        status: "event_ignored",
      });
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

    /*
     * Nesta fase respondemos SOMENTE texto recebido
     * de um usuário.
     */
    if (
      !from ||
      !whatsappMessageId ||
      type !== "text" ||
      !text
    ) {
      return NextResponse.json({
        status: "message_ignored",
      });
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
     * 1. Localiza ou cria o contato.
     */
    const { data: contactRecord, error: contactError } =
      await supabase
        .from("contacts")
        .upsert(
          {
            phone: from,
            name,
          },
          {
            onConflict: "phone",
          }
        )
        .select()
        .single();

    if (contactError || !contactRecord) {
      throw contactError ||
        new Error("Contato não encontrado.");
    }

    /*
     * 2. Localiza conversa ativa.
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

    /*
     * 3. Cria conversa caso ainda não exista.
     */
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
     * 4. TRAVA PRINCIPAL CONTRA REPETIÇÕES.
     *
     * whatsapp_message_id possui índice UNIQUE.
     * Se a Meta reenviar a mesma mensagem,
     * o banco rejeita e nós NÃO chamamos a OpenAI
     * novamente e NÃO respondemos novamente.
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
      /*
       * PostgreSQL 23505 = violação de UNIQUE.
       */
      if (userMessageError.code === "23505") {
        console.log(
          "Webhook repetido ignorado:",
          whatsappMessageId
        );

        return NextResponse.json({
          status: "duplicate_ignored",
        });
      }

      throw userMessageError;
    }

    /*
     * 5. Busca apenas as últimas 10 mensagens.
     *
     * Menos contexto =
     * menos tokens +
     * menor custo +
     * menor latência.
     */
    const { data: recentMessages, error: messagesError } =
      await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", {
          ascending: false,
        })
        .limit(HISTORY_LIMIT);

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
     * 6. OpenAI.
     *
     * Modelo menor para priorizar:
     * - velocidade
     * - custo
     * - conversa comercial cotidiana
     */
    const aiResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você é o assistente virtual da Wal Brasil.

Converse naturalmente em português brasileiro.

Você atende pelo WhatsApp.

REGRAS IMPORTANTES:

- Responda apenas à mensagem atual do usuário.
- Nunca envie follow-up por iniciativa própria.
- Nunca cobre uma resposta.
- Nunca insista para o usuário continuar conversando.
- Nunca repita uma pergunta já respondida.
- Use o histórico apenas para manter continuidade.
- Prefira respostas curtas, naturais e úteis.
- Normalmente responda em 1 ou 2 parágrafos curtos.
- Só dê respostas longas quando o usuário pedir detalhes.
- Não invente preços, prazos, produtos, serviços ou condições da Wal Brasil.
- Se não souber uma informação específica da empresa, diga isso naturalmente.
- Evite saudações repetidas quando a conversa já estiver em andamento.
- Não transforme toda resposta em pergunta.
- Se a mensagem puder ser respondida diretamente, responda e encerre naturalmente.
        `.trim(),

        input: conversationHistory,

        max_output_tokens: 220,
      });

    const aiText =
      aiResponse.output_text?.trim() ||
      "Desculpe, não consegui responder agora.";

    /*
     * 7. Salva resposta e atualiza conversa
     * simultaneamente.
     */
    const now =
      new Date().toISOString();

    const [
      assistantInsert,
      conversationUpdate,
    ] = await Promise.all([
      supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          role: "assistant",
          content: aiText,
        }),

      supabase
        .from("conversations")
        .update({
          last_message_at: now,
        })
        .eq("id", conversation.id),
    ]);

    if (assistantInsert.error) {
      throw assistantInsert.error;
    }

    if (conversationUpdate.error) {
      throw conversationUpdate.error;
    }

    /*
     * 8. Envia UMA resposta pelo WhatsApp.
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
              preview_url: false,
              body: aiText,
            },
          }),
        }
      );

    const whatsappData =
      await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error(
        "Erro ao enviar WhatsApp:",
        whatsappData
      );

      /*
       * Importante:
       *
       * Retornamos 200 mesmo se a resposta de saída
       * falhar, porque a mensagem de entrada JÁ foi
       * processada.
       *
       * Isso evita que a Meta fique reenviando o
       * mesmo webhook e provocando novas respostas.
       */
      return NextResponse.json({
        status: "processed_but_send_failed",
      });
    }

    console.log(
      `Respondido ${from} | contexto: ${conversationHistory.length} mensagens`
    );

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