import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const HISTORY_LIMIT = 10;
const MEMORY_LIMIT = 20;

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

type OfficialDataRequest = {
  needs_pricing: boolean;
  service_slugs: string[];
  needs_business_contact: boolean;
};

type FirstAgentResult = {
  reply: string;
  memory_updates: MemoryUpdate[];
  official_data: OfficialDataRequest;
};

type FinalAgentResult = {
  reply: string;
  memory_updates: MemoryUpdate[];
};

type ChatRequestBody = {
  message?: string;
  visitorToken?: string;
};

const memorySchema = {
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
    additionalProperties: false,
  },
} as const;

export async function POST(request: NextRequest) {
  try {
    if (
      !process.env.OPENAI_API_KEY ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SECRET_KEY
    ) {
      return NextResponse.json(
        {
          status: "configuration_error",
        },
        {
          status: 500,
        }
      );
    }

    const body = (await request.json()) as ChatRequestBody;

    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        {
          status: "invalid_message",
          error: "Mensagem vazia.",
        },
        {
          status: 400,
        }
      );
    }

    const visitorToken =
      body.visitorToken?.trim() || crypto.randomUUID();

    /*
     * VISITANTE
     */
    let {
      data: visitor,
      error: visitorLookupError,
    } = await supabase
      .from("web_visitors")
      .select("*")
      .eq("visitor_token", visitorToken)
      .maybeSingle();

    if (visitorLookupError) {
      throw visitorLookupError;
    }

    if (!visitor) {
      const { data, error } = await supabase
        .from("web_visitors")
        .insert({
          visitor_token: visitorToken,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      visitor = data;
    }

    /*
     * CONVERSA
     */
    let {
      data: conversation,
      error: conversationLookupError,
    } = await supabase
      .from("web_conversations")
      .select("*")
      .eq("visitor_id", visitor.id)
      .eq("status", "active")
      .order("last_message_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (conversationLookupError) {
      throw conversationLookupError;
    }

    if (!conversation) {
      const { data, error } = await supabase
        .from("web_conversations")
        .insert({
          visitor_id: visitor.id,
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
     * SALVA MENSAGEM
     */
    const { error: userMessageError } = await supabase
      .from("web_messages")
      .insert({
        conversation_id: conversation.id,
        role: "user",
        content: message,
      });

    if (userMessageError) {
      throw userMessageError;
    }

    /*
     * CONTEXTO ESSENCIAL
     */
    const [
      recentMessagesResult,
      memoriesResult,
      serviceIndexResult,
    ] = await Promise.all([
      supabase
        .from("web_messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", {
          ascending: false,
        })
        .limit(HISTORY_LIMIT),

      supabase
        .from("web_memory")
        .select(
          "fact_key, fact_value, confidence, updated_at"
        )
        .eq("visitor_id", visitor.id)
        .order("updated_at", {
          ascending: false,
        })
        .limit(MEMORY_LIMIT),

      supabase
        .from("services")
        .select("slug, name")
        .eq("active", true)
        .order("name", {
          ascending: true,
        }),
    ]);

    if (recentMessagesResult.error) {
      throw recentMessagesResult.error;
    }

    if (memoriesResult.error) {
      throw memoriesResult.error;
    }

    if (serviceIndexResult.error) {
      throw serviceIndexResult.error;
    }

    const conversationHistory = (
      recentMessagesResult.data || []
    )
      .slice()
      .reverse()
      .map((item) => ({
        role:
          item.role === "assistant"
            ? ("assistant" as const)
            : ("user" as const),
        content: item.content,
      }));

    const persistentMemory = (
      memoriesResult.data || []
    )
      .map(
        (memory) =>
          `${memory.fact_key}: ${memory.fact_value}`
      )
      .join("\n");

    const serviceIndex = (
      serviceIndexResult.data || []
    )
      .map(
        (service) =>
          `${service.slug} | ${service.name}`
      )
      .join("\n");

    /*
     * PRIMEIRA CHAMADA
     *
     * Esta já é o próprio agente.
     *
     * Se não precisar de dado oficial,
     * a resposta daqui vai direto ao cliente.
     */
    const firstResponse = await openai.responses.create({
      model: "gpt-5.4-mini",

      instructions: `
Você é o agente de IA do @walbrasil.dev e representa comercialmente os serviços oferecidos pelo próprio @walbrasil.dev.

Converse em português brasileiro de forma natural, inteligente, profissional e humana.

Entenda o que o cliente quer usando o contexto recente da conversa.

Não aja como menu, formulário ou árvore de decisão.

Converse com autonomia. Explique ideias, possibilidades e soluções normalmente.

Enquanto conseguir ajudar diretamente, continue a conversa sem encaminhar cedo demais para atendimento humano.

Não tente prolongar cada resposta artificialmente. Depois de responder adequadamente, você pode simplesmente esperar o cliente.

Não transforme "Se quiser, eu posso..." em um fechamento repetitivo.

Não invente preços, contatos, políticas, condições ou outros fatos oficiais do negócio.

Quando a resposta atual depender de um PREÇO oficial, indique isso em official_data.needs_pricing e identifique, pelo contexto, um ou mais slugs de serviços relevantes.

Uma intenção geral de pedir orçamento não exige apresentar preço imediatamente. O cliente pode ainda estar explicando o projeto.

Quando o projeto combinar vários serviços, podem existir vários service_slugs.

Quando a resposta atual depender concretamente do WhatsApp ou contato direto do Wal Brasil, indique official_data.needs_business_contact = true.

Não solicite contato oficial apenas porque seria possível oferecer atendimento humano.

Se nenhum dado oficial for necessário, responda normalmente e deixe todas as necessidades em false.

SERVIÇOS DISPONÍVEIS PARA IDENTIFICAÇÃO:

${serviceIndex || "Nenhum serviço cadastrado."}

MEMÓRIA ÚTIL DO VISITANTE:

${persistentMemory || "Nenhuma memória persistente relevante."}

Além da resposta, identifique somente fatos novos, úteis e explicitamente informados pelo cliente na mensagem atual.

Não transforme cada frase em memória.

Não armazene inferências.

Não armazene senhas, tokens, credenciais, documentos, dados bancários ou informações pessoais sensíveis.

Se não houver fato novo útil, memory_updates deve ser [].
      `.trim(),

      input: conversationHistory,

      max_output_tokens: 500,

      text: {
        format: {
          type: "json_schema",
          name: "walbrasil_agent_first_response",
          strict: true,

          schema: {
            type: "object",

            properties: {
              reply: {
                type: "string",
              },

              memory_updates: memorySchema,

              official_data: {
                type: "object",

                properties: {
                  needs_pricing: {
                    type: "boolean",
                  },

                  service_slugs: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },

                  needs_business_contact: {
                    type: "boolean",
                  },
                },

                required: [
                  "needs_pricing",
                  "service_slugs",
                  "needs_business_contact",
                ],

                additionalProperties: false,
              },
            },

            required: [
              "reply",
              "memory_updates",
              "official_data",
            ],

            additionalProperties: false,
          },
        },
      },
    });

    if (!firstResponse.output_text) {
      throw new Error(
        "OpenAI não retornou conteúdo."
      );
    }

    const firstResult = JSON.parse(
      firstResponse.output_text
    ) as FirstAgentResult;

    const validServiceSlugs = new Set(
      (serviceIndexResult.data || []).map(
        (service) => service.slug
      )
    );

    const requestedServiceSlugs = [
      ...new Set(
        (firstResult.official_data.service_slugs || [])
          .filter((slug) =>
            validServiceSlugs.has(slug)
          )
      ),
    ].slice(0, 5);

    const needsOfficialData =
      firstResult.official_data.needs_pricing ||
      firstResult.official_data.needs_business_contact;

    let finalReply = firstResult.reply.trim();

    let finalMemoryUpdates =
      firstResult.memory_updates || [];

    let officialContext = "";

    /*
     * SEGUNDA CHAMADA SOMENTE SE REALMENTE NECESSÁRIO
     */
    if (needsOfficialData) {
      const contexts: string[] = [];

      /*
       * PREÇOS
       */
      if (
        firstResult.official_data.needs_pricing &&
        requestedServiceSlugs.length > 0
      ) {
        const {
          data: services,
          error: servicesError,
        } = await supabase
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
          .in("slug", requestedServiceSlugs)
          .eq("active", true);

        if (servicesError) {
          throw servicesError;
        }

        if (services && services.length > 0) {
          const blocks = requestedServiceSlugs
            .map((slug) =>
              services.find(
                (service) => service.slug === slug
              )
            )
            .filter(Boolean)
            .map((service) => {
              if (!service) return "";

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
                  : "Sem faixa oficial cadastrada.";

              return `
SERVIÇO: ${service.name}
FAIXA INICIAL: ${price}
DESCRIÇÃO: ${service.description || "Não cadastrada."}
OBSERVAÇÕES: ${service.notes || "Nenhuma."}
              `.trim();
            });

          contexts.push(`
DADOS OFICIAIS DE PREÇO

${blocks.join("\n\n")}

As faixas são referências individuais.

Se houver vários serviços no mesmo projeto, não some automaticamente as faixas para criar subtotal, valor mínimo combinado ou "a partir de".

Explique que o valor final da solução integrada depende do conjunto do escopo.
          `.trim());
        }
      }

      if (
        firstResult.official_data.needs_pricing &&
        requestedServiceSlugs.length === 0
      ) {
        contexts.push(`
O cliente precisa de informação de preço, mas ainda não foi possível identificar com segurança um serviço oficial.

Não invente valores.

Se realmente necessário, peça somente a informação que falta para compreender o projeto.
        `.trim());
      }

      /*
       * CONTATO
       */
      if (
        firstResult.official_data.needs_business_contact
      ) {
        const {
          data: businessContact,
          error: businessContactError,
        } = await supabase
          .from("business_info")
          .select(
            "info_key, info_value, description"
          )
          .eq(
            "info_key",
            "whatsapp_wal_brasil"
          )
          .eq("active", true)
          .maybeSingle();

        if (businessContactError) {
          throw businessContactError;
        }

        if (businessContact) {
          const rawPhone =
            businessContact.info_value;

          let formattedPhone = rawPhone;

          if (/^55\d{11}$/.test(rawPhone)) {
            const ddd = rawPhone.slice(2, 4);
            const firstPart = rawPhone.slice(4, 9);
            const secondPart = rawPhone.slice(9);

            formattedPhone =
              `(${ddd}) ${firstPart}-${secondPart}`;
          }

          contexts.push(`
CONTATO OFICIAL DO WAL BRASIL

WhatsApp: ${formattedPhone}
Número internacional: ${rawPhone}
Link direto: https://wa.me/${rawPhone}
          `.trim());
        } else {
          contexts.push(`
O cliente deseja o contato do Wal Brasil, mas não existe contato oficial ativo disponível.

Não invente telefone ou link.
          `.trim());
        }
      }

      officialContext = contexts.join("\n\n");

      const finalResponse =
        await openai.responses.create({
          model: "gpt-5.4-mini",

          instructions: `
Você é o agente de IA do @walbrasil.dev.

Converse de forma natural, inteligente, profissional e humana.

Use o contexto da conversa.

Os dados oficiais abaixo foram recuperados porque são necessários para responder à mensagem atual.

Trate esses dados como fonte de verdade.

Não invente fatos comerciais ausentes.

Não transforme os dados em uma tabela mecânica se uma resposta natural for melhor.

Quando houver vários serviços, não some automaticamente as faixas de preço como orçamento fechado.

Não tente prolongar artificialmente a resposta.

MEMÓRIA ÚTIL:

${persistentMemory || "Nenhuma memória persistente relevante."}

DADOS OFICIAIS PARA ESTA RESPOSTA:

${officialContext}
          `.trim(),

          input: conversationHistory,

          max_output_tokens: 550,

          text: {
            format: {
              type: "json_schema",
              name: "walbrasil_agent_final_response",
              strict: true,

              schema: {
                type: "object",

                properties: {
                  reply: {
                    type: "string",
                  },

                  memory_updates: memorySchema,
                },

                required: [
                  "reply",
                  "memory_updates",
                ],

                additionalProperties: false,
              },
            },
          },
        });

      if (!finalResponse.output_text) {
        throw new Error(
          "OpenAI não retornou resposta final."
        );
      }

      const finalResult = JSON.parse(
        finalResponse.output_text
      ) as FinalAgentResult;

      finalReply = finalResult.reply.trim();

      finalMemoryUpdates =
        finalResult.memory_updates || [];
    }

    if (!finalReply) {
      throw new Error(
        "Resposta final vazia."
      );
    }

    /*
     * MEMÓRIA
     */
    const memoryUpdates = finalMemoryUpdates
      .filter(
        (memory) =>
          memory.fact_key &&
          memory.fact_value &&
          memory.confidence >= 0.7
      )
      .slice(0, 5);

    const now =
      new Date().toISOString();

    const operations: PromiseLike<unknown>[] = [];

    operations.push(
      supabase
        .from("web_messages")
        .insert({
          conversation_id: conversation.id,
          role: "assistant",
          content: finalReply,
        })
        .then((result) => {
          if (result.error) {
            throw result.error;
          }

          return result;
        })
    );

    operations.push(
      supabase
        .from("web_conversations")
        .update({
          last_message_at: now,
        })
        .eq("id", conversation.id)
        .then((result) => {
          if (result.error) {
            throw result.error;
          }

          return result;
        })
    );

    if (memoryUpdates.length > 0) {
      const rows = memoryUpdates.map(
        (memory) => ({
          visitor_id: visitor.id,

          fact_key: memory.fact_key
            .trim()
            .toLowerCase()
            .replace(
              /[^a-z0-9_à-ÿ]/gi,
              "_"
            )
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, ""),

          fact_value:
            memory.fact_value.trim(),

          confidence:
            memory.confidence,

          source:
            "web_chat",
        })
      );

      operations.push(
        supabase
          .from("web_memory")
          .upsert(rows, {
            onConflict:
              "visitor_id,fact_key",
          })
          .then((result) => {
            if (result.error) {
              throw result.error;
            }

            return result;
          })
      );
    }

    await Promise.all(operations);

    console.log(
      "=== AGENTE WEB @WALBRASIL.DEV ==="
    );

    console.log(
      "Precisou de segunda chamada:",
      needsOfficialData
    );

    console.log(
      "Preço solicitado:",
      firstResult.official_data.needs_pricing
    );

    console.log(
      "Serviços:",
      requestedServiceSlugs
    );

    console.log(
      "Contato solicitado:",
      firstResult.official_data.needs_business_contact
    );

    console.log(
      "Tokens primeira chamada:",
      firstResponse.usage
    );

    console.log(
      "================================"
    );

    return NextResponse.json({
      status: "ok",
      reply: finalReply,
      visitorToken,
      memoriesUpdated:
        memoryUpdates.length,
      usedOfficialData:
        needsOfficialData,
    });
  } catch (error) {
    console.error(
      "Erro no chat do site:",
      error
    );

    return NextResponse.json(
      {
        status: "error",
        error:
          "Não foi possível processar a mensagem.",
      },
      {
        status: 500,
      }
    );
  }
}