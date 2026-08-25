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

type AgentResult = {
  reply: string;
  memory_updates: MemoryUpdate[];
};

type RetrievalDecision = {
  needs_pricing: boolean;
  service_slugs: string[];
  needs_business_contact: boolean;
  reasoning_summary: string;
};

type ChatRequestBody = {
  message?: string;
  visitorToken?: string;
};

export async function POST(request: NextRequest) {
  try {
    if (
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

    const conversationContext = conversationHistory
      .map((item) => {
        const speaker =
          item.role === "assistant" ? "AGENTE" : "CLIENTE";

        return `${speaker}: ${item.content}`;
      })
      .join("\n");

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
     * ANALISADOR INTERNO
     *
     * Agora pode resolver vários serviços no mesmo projeto.
     */
    const retrievalResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você atua como analisador interno de contexto para um agente comercial.

Você NÃO responde ao cliente.

Analise a conversa recente e identifique somente os dados oficiais que a resposta atual precisa recuperar.

PREÇO

Determine se a resposta depende de informação oficial de preço.

Use toda a conversa recente para compreender referências indiretas e projetos compostos.

Um projeto pode envolver nenhum, um ou vários serviços cadastrados.

Se o cliente estiver pedindo o valor de um projeto que combina vários serviços, retorne todos os slugs relevantes em service_slugs.

Não some preços e não invente serviços.

Se a resposta não precisar de preço:
needs_pricing = false
service_slugs = []

Se precisar de preço e o contexto permitir identificar os serviços:
needs_pricing = true
service_slugs = [slugs correspondentes]

Se precisar de preço mas o contexto ainda não permitir identificar com segurança nenhum serviço:
needs_pricing = true
service_slugs = []

CONTATO

Determine se a resposta atual realmente precisa do contato oficial do Wal Brasil.

needs_business_contact deve ser true quando o cliente estiver pedindo concretamente o WhatsApp, telefone, contato direto ou estiver claramente solicitando falar com a pessoa responsável pelo atendimento.

Não marque como true simplesmente porque seria possível oferecer atendimento humano.

Enquanto o agente conseguir continuar ajudando normalmente, o contato humano não é necessário.

SERVIÇOS DISPONÍVEIS:

${serviceIndex || "Nenhum serviço cadastrado."}
        `.trim(),

        input: `
CONVERSA RECENTE:

${conversationContext}

MENSAGEM ATUAL:

${message}
        `.trim(),

        max_output_tokens: 220,

        text: {
          format: {
            type: "json_schema",

            name: "business_retrieval_decision",

            strict: true,

            schema: {
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

                reasoning_summary: {
                  type: "string",
                },
              },

              required: [
                "needs_pricing",
                "service_slugs",
                "needs_business_contact",
                "reasoning_summary",
              ],

              additionalProperties: false,
            },
          },
        },
      });

    if (!retrievalResponse.output_text) {
      throw new Error(
        "A etapa de recuperação não retornou conteúdo."
      );
    }

    const retrievalDecision = JSON.parse(
      retrievalResponse.output_text
    ) as RetrievalDecision;

    /*
     * Garante apenas slugs realmente existentes.
     */
    const validServiceSlugs = new Set(
      (serviceIndexResult.data || []).map(
        (service) => service.slug
      )
    );

    const requestedServiceSlugs = [
      ...new Set(
        (retrievalDecision.service_slugs || []).filter(
          (slug) => validServiceSlugs.has(slug)
        )
      ),
    ].slice(0, 5);

    /*
     * PREÇOS OFICIAIS
     */
    let officialPricingContext = "";

    if (
      retrievalDecision.needs_pricing &&
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
        const orderedServices = requestedServiceSlugs
          .map((slug) =>
            services.find(
              (service) => service.slug === slug
            )
          )
          .filter(Boolean);

        const blocks = orderedServices.map((service) => {
          if (!service) {
            return "";
          }

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
              : "Não há faixa oficial cadastrada.";

          return `
SERVIÇO: ${service.name}
FAIXA INICIAL: ${price}
DESCRIÇÃO: ${service.description || "Não cadastrada."}
OBSERVAÇÕES: ${service.notes || "Nenhuma."}
          `.trim();
        });

        officialPricingContext = `
DADOS OFICIAIS DE PREÇO

${blocks.join("\n\n")}

As faixas acima são referências individuais dos serviços cadastrados.

Quando o projeto combinar mais de um serviço, não trate a soma das faixas como orçamento fechado. Use os dados para orientar a conversa e explique naturalmente que a proposta final depende do conjunto do escopo.
        `.trim();
      }
    }

    if (
      retrievalDecision.needs_pricing &&
      !officialPricingContext
    ) {
      officialPricingContext = `
O cliente deseja informação de preço, mas ainda não foi possível identificar com segurança um serviço oficial correspondente.

Não invente valores.

Use a conversa recente e, apenas se realmente necessário, peça uma informação curta que permita compreender melhor o projeto.
      `.trim();
    }

    /*
     * CONTATO OFICIAL
     */
    let officialContactContext = "";

    if (retrievalDecision.needs_business_contact) {
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

        officialContactContext = `
CONTATO OFICIAL DO WAL BRASIL

WhatsApp: ${formattedPhone}
Número internacional: ${rawPhone}
Link direto: https://wa.me/${rawPhone}

${businessContact.description || ""}
        `.trim();
      } else {
        officialContactContext = `
O cliente deseja falar diretamente com o Wal Brasil, mas não existe contato oficial ativo disponível.

Não invente telefone e não use placeholders.
        `.trim();
      }
    }

    const officialContexts = [
      officialPricingContext,
      officialContactContext,
    ]
      .filter(Boolean)
      .join("\n\n");

    /*
     * AGENTE PRINCIPAL
     */
    const aiResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você é o agente de IA do @walbrasil.dev e representa comercialmente os serviços oferecidos pelo próprio @walbrasil.dev.

Converse em português brasileiro de forma natural, inteligente, profissional e humana.

Entenda o que o cliente quer usando o contexto da conversa.

Assuma, salvo quando o cliente disser claramente o contrário, que os serviços e projetos discutidos podem ser realizados pelo próprio @walbrasil.dev.

Não oriente o cliente como se ele precisasse procurar outro desenvolvedor, técnico, vendedor ou empresa para executar aquilo que está discutindo com você.

Você pode conversar livremente, explicar possibilidades, discutir soluções e raciocinar tecnicamente.

Não aja como menu de atendimento, formulário ou árvore de decisão.

Não faça perguntas apenas para cumprir roteiro.

Converse com autonomia e procure resolver o máximo possível diretamente com o cliente.

Não ofereça atendimento humano cedo demais.

Enquanto conseguir compreender, orientar e responder adequadamente, continue a conversa normalmente.

Quando o cliente pedir contato direto, pessoa responsável, proposta, negociação ou fechamento, você pode encaminhá-lo naturalmente para falar com o Wal Brasil usando os dados oficiais recebidos.

Não repita essa oferta sem necessidade.

Quando receber dados oficiais do negócio, trate-os como fonte de verdade.

Não invente preços, prazos, contatos, políticas ou condições comerciais ausentes.

Se receber dados oficiais de vários serviços que fazem parte do mesmo projeto, considere o conjunto do contexto.

Não some automaticamente faixas de preço como se fossem um orçamento fechado.

Adapte a resposta ao estágio, intenção e tom da conversa.

Deixe a conversa respirar.

Não tente prolongar artificialmente cada resposta.

Depois de responder adequadamente, você pode simplesmente encerrar a mensagem e esperar o cliente.

Sugira próximos passos somente quando eles surgirem naturalmente e realmente agregarem valor.

Evite transformar expressões como "Se quiser, eu posso..." em um fechamento repetitivo.

MEMÓRIA ÚTIL DO VISITANTE:

${persistentMemory || "Nenhuma memória persistente relevante."}

${
  officialContexts
    ? `CONTEXTO OFICIAL PARA ESTA RESPOSTA:

${officialContexts}`
    : ""
}

Além da resposta, identifique somente fatos novos, úteis e explicitamente informados pelo cliente na mensagem atual que possam ajudar em conversas futuras.

Não transforme cada frase em memória.

Exemplos úteis:
nome
empresa
cidade
tipo_projeto
servico_interesse
orcamento
prazo
objetivo
funcionalidades
preferencia_visual
preferencia_contato
segmento_empresa

Use fact_key curto em português e snake_case.

Não armazene inferências como fatos.

Se o cliente corrigir informação anterior, reutilize a mesma fact_key.

Não armazene senhas, tokens, credenciais, dados bancários, documentos ou informações pessoais sensíveis.

Se não houver fato novo útil:
memory_updates deve ser [].

Use confidence 1.0 quando o fato tiver sido declarado explicitamente.
        `.trim(),

        input: conversationHistory,

        max_output_tokens: 550,

        text: {
          format: {
            type: "json_schema",

            name: "walbrasil_web_agent_response",

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

                    additionalProperties: false,
                  },
                },
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

    const rawOutput = aiResponse.output_text;

    if (!rawOutput) {
      throw new Error(
        "OpenAI não retornou conteúdo."
      );
    }

    const agentResult = JSON.parse(
      rawOutput
    ) as AgentResult;

    const aiText = agentResult.reply?.trim();

    if (!aiText) {
      throw new Error(
        "Resposta da IA vazia."
      );
    }

    /*
     * MEMÓRIA
     */
    const memoryUpdates = (
      agentResult.memory_updates || []
    )
      .filter(
        (memory) =>
          memory.fact_key &&
          memory.fact_value &&
          memory.confidence >= 0.7
      )
      .slice(0, 5);

    const now = new Date().toISOString();

    const databaseOperations: PromiseLike<unknown>[] =
      [];

    databaseOperations.push(
      supabase
        .from("web_messages")
        .insert({
          conversation_id: conversation.id,
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

    databaseOperations.push(
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
      const memoryRows = memoryUpdates.map(
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

          fact_value: memory.fact_value.trim(),

          confidence: memory.confidence,

          source: "web_chat",
        })
      );

      databaseOperations.push(
        supabase
          .from("web_memory")
          .upsert(memoryRows, {
            onConflict: "visitor_id,fact_key",
          })
          .then((result) => {
            if (result.error) {
              throw result.error;
            }

            return result;
          })
      );
    }

    await Promise.all(databaseOperations);

    /*
     * LOGS
     */
    console.log(
      "=== AGENTE WEB @WALBRASIL.DEV ==="
    );

    console.log(
      "Visitor:",
      visitor.id
    );

    console.log(
      "Histórico:",
      conversationHistory.length
    );

    console.log(
      "Precisa preço:",
      retrievalDecision.needs_pricing
    );

    console.log(
      "Serviços identificados:",
      requestedServiceSlugs
    );

    console.log(
      "Precisa contato:",
      retrievalDecision.needs_business_contact
    );

    console.log(
      "Preço recuperado:",
      Boolean(officialPricingContext)
    );

    console.log(
      "Contato recuperado:",
      Boolean(officialContactContext)
    );

    console.log(
      "Decisão:",
      retrievalDecision.reasoning_summary
    );

    console.log(
      "Memórias atualizadas:",
      memoryUpdates.length
    );

    console.log(
      "Tokens recuperação:",
      retrievalResponse.usage
    );

    console.log(
      "Tokens resposta:",
      aiResponse.usage
    );

    console.log(
      "================================"
    );

    return NextResponse.json({
      status: "ok",
      reply: aiText,
      visitorToken,
      memoriesUpdated: memoryUpdates.length,
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