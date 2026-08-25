import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const GRAPH_API_VERSION = "v26.0";
const HISTORY_LIMIT = 8;
const MEMORY_LIMIT = 20;
const SERVICES_LIMIT = 20;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

type MemoryUpdate = {
  fact_key: string;
  fact_value: string;
  confidence: number;
};

type AgentResult = {
  reply: string;
  memory_updates: MemoryUpdate[];
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN ||
    "wal-ai-webhook-2026";

  if (
    mode === "subscribe" &&
    token === verifyToken
  ) {
    return new NextResponse(challenge, {
      status: 200,
    });
  }

  return NextResponse.json(
    {
      error: "Falha na verificação do webhook.",
    },
    {
      status: 403,
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const change =
      body?.entry?.[0]?.changes?.[0];

    const value =
      change?.value;

    const message =
      value?.messages?.[0];

    const contact =
      value?.contacts?.[0];

    /*
     * Ignora status, leitura, entrega etc.
     */
    if (!message) {
      return NextResponse.json({
        status: "event_ignored",
      });
    }

    const from =
      message.from;

    const type =
      message.type;

    const whatsappMessageId =
      message.id;

    const text =
      type === "text"
        ? message?.text?.body?.trim()
        : null;

    const name =
      contact?.profile?.name ||
      "Sem nome";

    /*
     * Neste estágio respondemos apenas texto.
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
        {
          status: "configuration_error",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * 1. Localiza ou cria contato.
     */
    const {
      data: contactRecord,
      error: contactError,
    } =
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

    if (
      contactError ||
      !contactRecord
    ) {
      throw (
        contactError ||
        new Error(
          "Contato não encontrado."
        )
      );
    }

    /*
     * 2. Localiza conversa ativa.
     */
    let {
      data: conversation,
      error: conversationError,
    } =
      await supabase
        .from("conversations")
        .select("*")
        .eq(
          "contact_id",
          contactRecord.id
        )
        .eq("status", "active")
        .order(
          "last_message_at",
          {
            ascending: false,
          }
        )
        .limit(1)
        .maybeSingle();

    if (conversationError) {
      throw conversationError;
    }

    /*
     * 3. Cria conversa se necessário.
     */
    if (!conversation) {
      const {
        data,
        error,
      } =
        await supabase
          .from("conversations")
          .insert({
            contact_id:
              contactRecord.id,
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
     * 4. Salva mensagem recebida.
     * UNIQUE no whatsapp_message_id
     * evita respostas duplicadas.
     */
    const {
      error: userMessageError,
    } =
      await supabase
        .from("messages")
        .insert({
          conversation_id:
            conversation.id,

          role: "user",

          content: text,

          whatsapp_message_id:
            whatsappMessageId,
        });

    if (userMessageError) {
      if (
        userMessageError.code ===
        "23505"
      ) {
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
     * 5. Busca tudo que a IA precisa
     * em paralelo:
     *
     * - conversa recente
     * - memória persistente
     * - serviços/preços/prazos da @walbrasil.dev
     */
    const [
      recentMessagesResult,
      memoriesResult,
      servicesResult,
    ] = await Promise.all([
      supabase
        .from("messages")
        .select(
          "role, content, created_at"
        )
        .eq(
          "conversation_id",
          conversation.id
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(HISTORY_LIMIT),

      supabase
        .from("contact_memory")
        .select(
          "fact_key, fact_value, confidence, updated_at"
        )
        .eq(
          "contact_id",
          contactRecord.id
        )
        .order("updated_at", {
          ascending: false,
        })
        .limit(MEMORY_LIMIT),

      supabase
        .from("services")
        .select(`
          slug,
          name,
          description,
          price_min,
          price_max,
          delivery_min_days,
          delivery_max_days,
          notes
        `)
        .eq("active", true)
        .order("price_min", {
          ascending: true,
        })
        .limit(SERVICES_LIMIT),
    ]);

    if (
      recentMessagesResult.error
    ) {
      throw recentMessagesResult.error;
    }

    if (memoriesResult.error) {
      throw memoriesResult.error;
    }

    if (servicesResult.error) {
      throw servicesResult.error;
    }

    /*
     * 6. Histórico recente.
     */
    const conversationHistory =
      (
        recentMessagesResult.data ||
        []
      )
        .reverse()
        .map((item) => ({
          role:
            item.role ===
            "assistant"
              ? ("assistant" as const)
              : ("user" as const),

          content:
            item.content,
        }));

    /*
     * 7. Memória persistente compacta.
     */
    const persistentMemory =
      (
        memoriesResult.data ||
        []
      )
        .map(
          (memory) =>
            `${memory.fact_key}: ${memory.fact_value}`
        )
        .join("\n");

    /*
     * 8. Base comercial compacta.
     */
    const commercialServices =
      (
        servicesResult.data ||
        []
      )
        .map((service) => {
          const price =
            service.price_min !== null &&
            service.price_max !== null
              ? `R$ ${Number(
                  service.price_min
                ).toLocaleString(
                  "pt-BR"
                )} a R$ ${Number(
                  service.price_max
                ).toLocaleString(
                  "pt-BR"
                )}`
              : "sob consulta";

          const delivery =
            service.delivery_min_days !== null &&
            service.delivery_max_days !== null
              ? `${service.delivery_min_days} a ${service.delivery_max_days} dias`
              : "sob consulta";

          return [
            `SERVIÇO: ${service.name}`,
            `Descrição: ${service.description || "-"}`,
            `Faixa de preço: ${price}`,
            `Prazo típico: ${delivery}`,
            service.notes
              ? `Observação: ${service.notes}`
              : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");

    /*
     * 9. UMA chamada à OpenAI.
     *
     * Ela responde e identifica fatos
     * novos para memória persistente.
     */
    const aiResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você é o assistente comercial virtual da @walbrasil.dev

Você conversa com clientes pelo WhatsApp em português brasileiro.

Seu objetivo é compreender o que a pessoa precisa, explicar os serviços da WalBrasil.Dev de forma natural e ajudar o potencial cliente a avançar na decisão.

=========================
MEMÓRIA DO CONTATO
=========================

Use estes fatos quando forem relevantes.

Não diga que possui um banco de dados ou sistema de memória.

${persistentMemory || "Nenhuma memória persistente ainda."}

=========================
SERVIÇOS DA @walbrasil.dev
=========================

Esta é a base comercial oficial disponível neste momento:

${commercialServices || "Nenhum serviço comercial cadastrado."}

=========================
REGRAS COMERCIAIS
=========================

Quando o cliente perguntar se a @walbrasil.dev realiza determinado serviço, use a base comercial acima.

Quando o cliente perguntar preço:

- use somente as faixas cadastradas;
- não invente valores;
- deixe claro que é uma faixa inicial de referência;
- explique brevemente que o valor final depende do escopo;
- não fuja da pergunta se existir um serviço correspondente na base.

Quando o cliente perguntar prazo:

- use o prazo típico cadastrado;
- deixe claro que é uma estimativa inicial;
- o prazo final depende do escopo e da disponibilidade.

Se o projeto combinar dois ou mais serviços, não some preços mecanicamente.

Nesse caso, explique que será necessário analisar o conjunto para definir uma proposta.

Se o pedido não se encaixar claramente em nenhum serviço cadastrado, diga que é necessário analisar o escopo antes de estimar.

Não prometa desconto automaticamente.

Não prometa preço fechado sem conhecer o escopo.

Não invente funcionalidades que não estejam disponíveis no contexto.

=========================
CONVERSA
=========================

- Responda somente à mensagem atual do usuário.
- Nunca envie follow-up por iniciativa própria.
- Nunca cobre uma resposta.
- Nunca insista para continuar a conversa.
- Não repita perguntas já respondidas.
- Evite saudações repetidas.
- Prefira respostas curtas e naturais para WhatsApp.
- Normalmente use 1 ou 2 parágrafos curtos.
- Só escreva respostas longas quando solicitado.
- Não transforme toda resposta em pergunta.
- Se puder responder diretamente, responda diretamente.

=========================
MEMÓRIA DE LONGO PRAZO
=========================

Além da resposta, identifique somente fatos NOVOS e úteis que o usuário revelou explicitamente na mensagem atual.

Exemplos:

nome
idade
empresa
cidade
tipo_projeto
servico_interesse
orcamento
prazo
objetivo
preferencia_visual
preferencia_contato
cargo
segmento_empresa

Use fact_key curto, em português e snake_case.

Não salve fatos triviais.

Não salve inferências como fatos.

Não salve algo apenas porque apareceu no histórico.

Se o usuário corrigir informação anterior, reutilize a mesma fact_key com o novo valor.

Não salve senhas, tokens, credenciais, dados bancários ou documentos.

Não salve informações pessoais sensíveis.

Se não existir novo fato útil:
memory_updates deve ser vazio.

Use confidence 1.0 para fatos explicitamente declarados.
        `.trim(),

        input:
          conversationHistory,

        max_output_tokens: 320,

        text: {
          format: {
            type: "json_schema",

            name:
              "wal_ai_agent_response",

            strict: true,

            schema: {
              type: "object",

              properties: {
                reply: {
                  type: "string",
                },

                memory_updates: {
                  type: "array",

                  items: {
                    type: "object",

                    properties: {
                      fact_key: {
                        type: "string",
                      },

                      fact_value: {
                        type: "string",
                      },

                      confidence: {
                        type: "number",
                        minimum: 0,
                        maximum: 1,
                      },
                    },

                    required: [
                      "fact_key",
                      "fact_value",
                      "confidence",
                    ],

                    additionalProperties:
                      false,
                  },
                },
              },

              required: [
                "reply",
                "memory_updates",
              ],

              additionalProperties:
                false,
            },
          },
        },
      });

    /*
     * 10. Processa retorno estruturado.
     */
    const rawOutput =
      aiResponse.output_text;

    if (!rawOutput) {
      throw new Error(
        "OpenAI não retornou conteúdo."
      );
    }

    const agentResult =
      JSON.parse(
        rawOutput
      ) as AgentResult;

    const aiText =
      agentResult.reply?.trim();

    if (!aiText) {
      throw new Error(
        "Resposta da IA vazia."
      );
    }

    /*
     * 11. Filtra memória.
     */
    const memoryUpdates =
      (
        agentResult.memory_updates ||
        []
      )
        .filter(
          (memory) =>
            memory.fact_key &&
            memory.fact_value &&
            memory.confidence >=
              0.7
        )
        .slice(0, 5);

    const now =
      new Date().toISOString();

    const databaseOperations: PromiseLike<unknown>[] =
      [];

    /*
     * 12. Salva resposta.
     */
    databaseOperations.push(
      supabase
        .from("messages")
        .insert({
          conversation_id:
            conversation.id,

          role: "assistant",

          content: aiText,
        })
        .then((result) => {
          if (result.error) {
            throw result.error;
          }

          return result;
        })
    );

    /*
     * 13. Atualiza conversa.
     */
    databaseOperations.push(
      supabase
        .from("conversations")
        .update({
          last_message_at:
            now,
        })
        .eq(
          "id",
          conversation.id
        )
        .then((result) => {
          if (result.error) {
            throw result.error;
          }

          return result;
        })
    );

    /*
     * 14. Atualiza memória persistente.
     */
    if (
      memoryUpdates.length > 0
    ) {
      const memoryRows =
        memoryUpdates.map(
          (memory) => ({
            contact_id:
              contactRecord.id,

            fact_key:
              memory.fact_key
                .trim()
                .toLowerCase()
                .replace(
                  /[^a-z0-9_à-ÿ]/gi,
                  "_"
                )
                .replace(
                  /_+/g,
                  "_"
                ),

            fact_value:
              memory.fact_value.trim(),

            confidence:
              memory.confidence,

            source:
              "conversation",
          })
        );

      databaseOperations.push(
        supabase
          .from(
            "contact_memory"
          )
          .upsert(
            memoryRows,
            {
              onConflict:
                "contact_id,fact_key",
            }
          )
          .then((result) => {
            if (result.error) {
              throw result.error;
            }

            return result;
          })
      );
    }

    await Promise.all(
      databaseOperations
    );

    /*
     * 15. Envia resposta ao WhatsApp.
     */
    const whatsappResponse =
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              messaging_product:
                "whatsapp",

              recipient_type:
                "individual",

              to: from,

              type: "text",

              text: {
                preview_url:
                  false,

                body:
                  aiText,
              },
            }),
        }
      );

    const whatsappData =
      await whatsappResponse.json();

    if (
      !whatsappResponse.ok
    ) {
      console.error(
        "Erro ao enviar WhatsApp:",
        whatsappData
      );

      return NextResponse.json({
        status:
          "processed_but_send_failed",
      });
    }

    console.log(
      "=== WAL AI AGENT ==="
    );

    console.log(
      "Contato:",
      from
    );

    console.log(
      "Histórico:",
      conversationHistory.length
    );

    console.log(
      "Memórias:",
      memoriesResult.data
        ?.length || 0
    );

    console.log(
      "Serviços carregados:",
      servicesResult.data
        ?.length || 0
    );

    console.log(
      "Memórias atualizadas:",
      memoryUpdates
    );

    console.log(
      "Tokens:",
      aiResponse.usage
    );

    console.log(
      "===================="
    );

    return NextResponse.json({
      status: "ok",

      replySent: true,

      memoriesUpdated:
        memoryUpdates.length,

      servicesLoaded:
        servicesResult.data
          ?.length || 0,
    });
  } catch (error) {
    console.error(
      "Erro ao processar webhook:",
      error
    );

    return NextResponse.json(
      {
        status: "error",
      },
      {
        status: 500,
      }
    );
  }
}