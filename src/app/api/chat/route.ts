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
  service_slug: string | null;

  needs_business_contact: boolean;

  reasoning_summary: string;
};

type ChatRequestBody = {
  message?: string;
  visitorToken?: string;
};

export async function POST(request: NextRequest) {
  try {
    /*
     * =========================================================
     * 1. CONFIGURAÇÃO
     * =========================================================
     */

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

    const body =
      (await request.json()) as ChatRequestBody;

    const message =
      body.message?.trim();

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

    /*
     * =========================================================
     * 2. VISITANTE
     * =========================================================
     */

    const visitorToken =
      body.visitorToken?.trim() ||
      crypto.randomUUID();

    let {
      data: visitor,
      error: visitorLookupError,
    } = await supabase
      .from("web_visitors")
      .select("*")
      .eq(
        "visitor_token",
        visitorToken
      )
      .maybeSingle();

    if (visitorLookupError) {
      throw visitorLookupError;
    }

    if (!visitor) {
      const {
        data,
        error,
      } = await supabase
        .from("web_visitors")
        .insert({
          visitor_token:
            visitorToken,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      visitor = data;
    }

    /*
     * =========================================================
     * 3. CONVERSA ATIVA
     * =========================================================
     */

    let {
      data: conversation,
      error: conversationLookupError,
    } = await supabase
      .from("web_conversations")
      .select("*")
      .eq(
        "visitor_id",
        visitor.id
      )
      .eq(
        "status",
        "active"
      )
      .order(
        "last_message_at",
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle();

    if (
      conversationLookupError
    ) {
      throw conversationLookupError;
    }

    if (!conversation) {
      const {
        data,
        error,
      } = await supabase
        .from("web_conversations")
        .insert({
          visitor_id:
            visitor.id,

          status:
            "active",
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      conversation = data;
    }

    /*
     * =========================================================
     * 4. SALVA MENSAGEM DO CLIENTE
     * =========================================================
     */

    const {
      error: userMessageError,
    } = await supabase
      .from("web_messages")
      .insert({
        conversation_id:
          conversation.id,

        role:
          "user",

        content:
          message,
      });

    if (userMessageError) {
      throw userMessageError;
    }

    /*
     * =========================================================
     * 5. CARREGA CONTEXTO ESSENCIAL
     *
     * - histórico recente
     * - memória persistente
     * - índice mínimo de serviços
     *
     * Não carregamos preços,
     * prazos ou contato aqui.
     * =========================================================
     */

    const [
      recentMessagesResult,
      memoriesResult,
      serviceIndexResult,
    ] = await Promise.all([
      supabase
        .from("web_messages")
        .select(
          "role, content, created_at"
        )
        .eq(
          "conversation_id",
          conversation.id
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(
          HISTORY_LIMIT
        ),

      supabase
        .from("web_memory")
        .select(
          "fact_key, fact_value, confidence, updated_at"
        )
        .eq(
          "visitor_id",
          visitor.id
        )
        .order(
          "updated_at",
          {
            ascending: false,
          }
        )
        .limit(
          MEMORY_LIMIT
        ),

      supabase
        .from("services")
        .select(
          "slug, name"
        )
        .eq(
          "active",
          true
        )
        .order(
          "name",
          {
            ascending: true,
          }
        ),
    ]);

    if (
      recentMessagesResult.error
    ) {
      throw recentMessagesResult.error;
    }

    if (
      memoriesResult.error
    ) {
      throw memoriesResult.error;
    }

    if (
      serviceIndexResult.error
    ) {
      throw serviceIndexResult.error;
    }

    /*
     * =========================================================
     * 6. HISTÓRICO RECENTE
     * =========================================================
     */

    const recentMessages =
      recentMessagesResult.data ||
      [];

    const conversationHistory =
      recentMessages
        .slice()
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
     * Histórico textual para
     * interpretação interna.
     */
    const conversationContext =
      conversationHistory
        .map((item) => {
          const speaker =
            item.role ===
            "assistant"
              ? "AGENTE"
              : "CLIENTE";

          return `${speaker}: ${item.content}`;
        })
        .join("\n");

    /*
     * =========================================================
     * 7. MEMÓRIA PERSISTENTE
     * =========================================================
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
     * =========================================================
     * 8. ÍNDICE MÍNIMO DE SERVIÇOS
     *
     * Apenas slug + nome.
     * =========================================================
     */

    const serviceIndex =
      (
        serviceIndexResult.data ||
        []
      )
        .map(
          (service) =>
            `${service.slug} | ${service.name}`
        )
        .join("\n");

    /*
     * =========================================================
     * 9. ANALISADOR INTERNO
     *
     * Ele NÃO responde ao cliente.
     *
     * Apenas decide se a resposta atual
     * depende de:
     *
     * - preço oficial;
     * - contato oficial do Wal Brasil.
     *
     * Isso é interpretação semântica,
     * não árvore de palavras-chave.
     * =========================================================
     */

    const retrievalResponse =
      await openai.responses.create({
        model:
          "gpt-5.4-mini",

        instructions: `
Você atua apenas como analisador interno de contexto para um agente comercial.

Sua função NÃO é responder ao cliente.

Leia a conversa recente como um todo e determine quais dados oficiais do negócio são realmente necessários para que o agente responda adequadamente à mensagem atual.

Você deve analisar duas necessidades possíveis:

1. PREÇO OFICIAL

Determine se a resposta atual depende de consultar o preço oficial de um serviço.

Entenda referências contextuais como:
"esse projeto",
"nesse caso",
"e quanto ficaria?",
"quanto sairia?",
"quanto custa?",
ou outras formas naturais de continuar uma conversa.

Não dependa de palavras específicas. Interprete intenção e contexto.

Se a mensagem não depender de preço oficial:
needs_pricing = false.

Se depender de preço:
- use a conversa recente para identificar qual projeto está sendo discutido;
- escolha o serviço mais compatível entre os serviços disponíveis;
- retorne exatamente o slug cadastrado.

Se houver intenção clara de obter preço, mas ainda não for possível identificar com segurança o serviço:
needs_pricing = true
service_slug = null.

2. CONTATO OFICIAL DO WAL BRASIL

Determine se a resposta atual realmente precisa do dado oficial de contato do Wal Brasil.

needs_business_contact deve ser true quando o cliente estiver pedindo concretamente o contato, número, WhatsApp ou meio direto para falar com o Wal Brasil.

Também pode ser true quando, pelo estágio atual da conversa, o cliente está claramente solicitando falar diretamente com a pessoa responsável e a resposta adequada exige fornecer esse contato.

Não marque como true apenas porque o agente poderia, em tese, oferecer atendimento humano.

Se o cliente ainda está apenas conversando sobre o projeto e o agente consegue continuar ajudando normalmente:
needs_business_contact = false.

Não invente serviços nem dados de contato.

SERVIÇOS DISPONÍVEIS:

${serviceIndex || "Nenhum serviço cadastrado."}
        `.trim(),

        input: `
CONVERSA RECENTE:

${conversationContext}

MENSAGEM ATUAL:

${message}
        `.trim(),

        max_output_tokens:
          180,

        text: {
          format: {
            type:
              "json_schema",

            name:
              "business_retrieval_decision",

            strict:
              true,

            schema: {
              type:
                "object",

              properties: {
                needs_pricing: {
                  type:
                    "boolean",
                },

                service_slug: {
                  anyOf: [
                    {
                      type:
                        "string",
                    },
                    {
                      type:
                        "null",
                    },
                  ],
                },

                needs_business_contact: {
                  type:
                    "boolean",
                },

                reasoning_summary: {
                  type:
                    "string",
                },
              },

              required: [
                "needs_pricing",
                "service_slug",
                "needs_business_contact",
                "reasoning_summary",
              ],

              additionalProperties:
                false,
            },
          },
        },
      });

    if (
      !retrievalResponse.output_text
    ) {
      throw new Error(
        "A etapa de recuperação não retornou conteúdo."
      );
    }

    const retrievalDecision =
      JSON.parse(
        retrievalResponse.output_text
      ) as RetrievalDecision;

    /*
     * =========================================================
     * 10. RECUPERAÇÃO SELETIVA DE PREÇO
     * =========================================================
     */

    let officialPricingContext =
      "";

    if (
      retrievalDecision.needs_pricing &&
      retrievalDecision.service_slug
    ) {
      const {
        data: service,
        error: serviceError,
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
        .eq(
          "slug",
          retrievalDecision.service_slug
        )
        .eq(
          "active",
          true
        )
        .maybeSingle();

      if (serviceError) {
        throw serviceError;
      }

      if (service) {
        const price =
          service.price_min !==
            null &&
          service.price_max !==
            null
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

        officialPricingContext = `
DADOS OFICIAIS DE PREÇO

Serviço identificado:
${service.name}

Faixa inicial de referência:
${price}

Descrição:
${service.description || "Não cadastrada."}

Observações:
${service.notes || "Nenhuma observação adicional."}

Esses dados são a fonte oficial para esta resposta.
        `.trim();
      }
    }

    /*
     * Se há intenção de preço,
     * mas não conseguimos resolver
     * o serviço com segurança.
     */
    if (
      retrievalDecision.needs_pricing &&
      !officialPricingContext
    ) {
      officialPricingContext = `
O cliente deseja informação de preço, mas ainda não há dados suficientes para identificar com segurança qual serviço oficial deve ser usado como referência.

Não invente valor.

Use o contexto da conversa e, apenas se realmente necessário, peça uma informação curta que permita compreender melhor o projeto.
      `.trim();
    }

    /*
     * =========================================================
     * 11. RECUPERAÇÃO SELETIVA DO CONTATO
     *
     * O WhatsApp só é buscado quando
     * a conversa realmente precisa dele.
     * =========================================================
     */

    let officialContactContext =
      "";

    if (
      retrievalDecision.needs_business_contact
    ) {
      const {
        data: businessContact,
        error: businessContactError,
      } = await supabase
        .from(
          "business_info"
        )
        .select(
          "info_key, info_value, description"
        )
        .eq(
          "info_key",
          "whatsapp_wal_brasil"
        )
        .eq(
          "active",
          true
        )
        .maybeSingle();

      if (
        businessContactError
      ) {
        throw businessContactError;
      }

      if (businessContact) {
        const rawPhone =
          businessContact.info_value;

        let formattedPhone =
          rawPhone;

        /*
         * Formata números brasileiros
         * no padrão:
         * (17) 99680-2980
         *
         * Mantemos também o número
         * internacional para links.
         */
        if (
          /^55\d{11}$/.test(
            rawPhone
          )
        ) {
          const ddd =
            rawPhone.slice(
              2,
              4
            );

          const firstPart =
            rawPhone.slice(
              4,
              9
            );

          const secondPart =
            rawPhone.slice(
              9
            );

          formattedPhone =
            `(${ddd}) ${firstPart}-${secondPart}`;
        }

        officialContactContext = `
CONTATO OFICIAL DO WAL BRASIL

WhatsApp:
${formattedPhone}

Número internacional:
${rawPhone}

Link direto:
https://wa.me/${rawPhone}

Descrição:
${businessContact.description || "Contato oficial do Wal Brasil."}

Esses dados são a fonte oficial para esta resposta.
        `.trim();
      } else {
        officialContactContext = `
O cliente deseja falar diretamente com o Wal Brasil, mas não existe contato oficial ativo disponível na base neste momento.

Não invente número de telefone nem use placeholders.
        `.trim();
      }
    }

    /*
     * =========================================================
     * 12. CONTEXTO OFICIAL COMPACTO
     * =========================================================
     */

    const officialContexts =
      [
        officialPricingContext,
        officialContactContext,
      ]
        .filter(Boolean)
        .join("\n\n");

    /*
     * =========================================================
     * 13. AGENTE PRINCIPAL
     *
     * Esta é a única etapa que conversa
     * com o cliente.
     * =========================================================
     */

    const aiResponse =
      await openai.responses.create({
        model:
          "gpt-5.4-mini",

        instructions: `
Você representa comercialmente o @walbrasil.dev.

Quando o cliente estiver discutindo um projeto, serviço ou orçamento, não o oriente como se ele precisasse procurar outro desenvolvedor ou outra empresa. O atendimento é do próprio @walbrasil.dev.

Você pode estruturar ideias, requisitos, escopo e informações para ajudar o cliente a avançar no próprio atendimento.

Quando o cliente pedir para falar com uma pessoa, vendedor, técnico, responsável ou alguém que possa fechar o projeto, entenda isso naturalmente como um pedido para falar diretamente com o Wal Brasil.

Converse em português brasileiro de forma natural, inteligente, profissional e humana.

Entenda primeiro o que o cliente quer e use o contexto da conversa.

Não aja como menu de atendimento, formulário ou árvore de decisão.

Você pode conversar livremente, explicar possibilidades, discutir ideias, sugerir soluções e fazer perguntas quando elas realmente ajudarem.

Converse com autonomia e procure resolver o máximo possível diretamente com o cliente.

Não ofereça atendimento humano cedo demais e não use a transferência como fechamento padrão de respostas.

A opção de falar diretamente com o Wal Brasil existe como continuação natural do atendimento quando o cliente pedir uma pessoa, quiser avançar para proposta, negociação ou fechamento, ou quando a conversa chegar a um ponto em que a participação humana realmente agregue valor.

Enquanto você conseguir compreender, orientar e responder adequadamente, continue a conversa normalmente.

Não repita a oferta de contato humano se ela já tiver sido apresentada recentemente.

Não faça perguntas apenas para cumprir um roteiro.

Não repita informações que o cliente já forneceu.

Quando receber dados oficiais do negócio, trate-os como fonte de verdade.

Não invente preços, políticas, prazos, contatos ou outras informações comerciais que não tenham sido fornecidas oficialmente.

Adapte a resposta ao estágio e ao tom da conversa.

Prefira respostas adequadas para um chat de site: claras e naturais, sem serem artificialmente curtas.

Conduza a conversa de forma natural e deixe espaço para o cliente responder.

Não sinta necessidade de terminar todas as mensagens com uma pergunta, convite ou oferta de ajuda adicional.

Evite repetir fórmulas como "Se quiser, eu posso..." apenas para manter a conversa andando.

Sugira próximos passos somente quando isso realmente fizer sentido no contexto.

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

        input:
          conversationHistory,

        max_output_tokens:
          500,

        text: {
          format: {
            type:
              "json_schema",

            name:
              "walbrasil_web_agent_response",

            strict:
              true,

            schema: {
              type:
                "object",

              properties: {
                reply: {
                  type:
                    "string",
                },

                memory_updates: {
                  type:
                    "array",

                  items: {
                    type:
                      "object",

                    properties: {
                      fact_key: {
                        type:
                          "string",
                      },

                      fact_value: {
                        type:
                          "string",
                      },

                      confidence: {
                        type:
                          "number",

                        minimum:
                          0,

                        maximum:
                          1,
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
     * =========================================================
     * 14. PROCESSA RESPOSTA
     * =========================================================
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
     * =========================================================
     * 15. MEMÓRIA PERSISTENTE
     * =========================================================
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
        .slice(
          0,
          5
        );

    const now =
      new Date().toISOString();

    const databaseOperations: PromiseLike<unknown>[] =
      [];

    /*
     * Salva resposta.
     */
    databaseOperations.push(
      supabase
        .from(
          "web_messages"
        )
        .insert({
          conversation_id:
            conversation.id,

          role:
            "assistant",

          content:
            aiText,
        })
        .then(
          (result) => {
            if (
              result.error
            ) {
              throw result.error;
            }

            return result;
          }
        )
    );

    /*
     * Atualiza conversa.
     */
    databaseOperations.push(
      supabase
        .from(
          "web_conversations"
        )
        .update({
          last_message_at:
            now,
        })
        .eq(
          "id",
          conversation.id
        )
        .then(
          (result) => {
            if (
              result.error
            ) {
              throw result.error;
            }

            return result;
          }
        )
    );

    /*
     * Atualiza memória.
     */
    if (
      memoryUpdates.length >
      0
    ) {
      const memoryRows =
        memoryUpdates.map(
          (memory) => ({
            visitor_id:
              visitor.id,

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
                )
                .replace(
                  /^_+|_+$/g,
                  ""
                ),

            fact_value:
              memory.fact_value.trim(),

            confidence:
              memory.confidence,

            source:
              "web_chat",
          })
        );

      databaseOperations.push(
        supabase
          .from(
            "web_memory"
          )
          .upsert(
            memoryRows,
            {
              onConflict:
                "visitor_id,fact_key",
            }
          )
          .then(
            (result) => {
              if (
                result.error
              ) {
                throw result.error;
              }

              return result;
            }
          )
      );
    }

    await Promise.all(
      databaseOperations
    );

    /*
     * =========================================================
     * 16. LOGS
     * =========================================================
     */

    console.log(
      "=== AGENTE WEB @WALBRASIL.DEV ==="
    );

    console.log(
      "Visitor:",
      visitor.id
    );

    console.log(
      "Histórico carregado:",
      conversationHistory.length
    );

    console.log(
      "Memórias carregadas:",
      memoriesResult.data
        ?.length || 0
    );

    console.log(
      "Precisa consultar preço:",
      retrievalDecision.needs_pricing
    );

    console.log(
      "Serviço identificado:",
      retrievalDecision.service_slug
    );

    console.log(
      "Precisa contato oficial:",
      retrievalDecision.needs_business_contact
    );

    console.log(
      "Preço recuperado:",
      Boolean(
        officialPricingContext
      )
    );

    console.log(
      "Contato recuperado:",
      Boolean(
        officialContactContext
      )
    );

    console.log(
      "Resumo da decisão:",
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

    /*
     * =========================================================
     * 17. RESPOSTA PARA O SITE
     * =========================================================
     */

    return NextResponse.json({
      status:
        "ok",

      reply:
        aiText,

      visitorToken,

      memoriesUpdated:
        memoryUpdates.length,
    });
  } catch (error) {
    console.error(
      "Erro no chat do site:",
      error
    );

    return NextResponse.json(
      {
        status:
          "error",

        error:
          "Não foi possível processar a mensagem.",
      },
      {
        status:
          500,
      }
    );
  }
}