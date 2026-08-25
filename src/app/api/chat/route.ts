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

    /*
     * =========================================================
     * 2. VISITANTE
     * =========================================================
     */

    const visitorToken =
      body.visitorToken?.trim() || crypto.randomUUID();

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
     * =========================================================
     * 4. SALVA A MENSAGEM ATUAL
     * =========================================================
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
     * =========================================================
     * 5. CARREGA SOMENTE CONTEXTO ESSENCIAL
     *
     * Histórico recente
     * Memória persistente
     * Índice mínimo dos serviços
     *
     * IMPORTANTE:
     * preços, prazos e descrições NÃO são carregados aqui.
     * =========================================================
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

    /*
     * =========================================================
     * 6. HISTÓRICO RECENTE
     * =========================================================
     */

    const recentMessages =
      recentMessagesResult.data || [];

    const conversationHistory = recentMessages
      .slice()
      .reverse()
      .map((item) => ({
        role:
          item.role === "assistant"
            ? ("assistant" as const)
            : ("user" as const),

        content: item.content,
      }));

    /*
     * Versão textual para a etapa de interpretação.
     */
    const conversationContext = conversationHistory
      .map((item) => {
        const speaker =
          item.role === "assistant" ? "AGENTE" : "CLIENTE";

        return `${speaker}: ${item.content}`;
      })
      .join("\n");

    /*
     * =========================================================
     * 7. MEMÓRIA PERSISTENTE COMPACTA
     * =========================================================
     */

    const persistentMemory = (
      memoriesResult.data || []
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
     * A etapa de interpretação conhece apenas:
     * slug + nome.
     *
     * Ela NÃO recebe preço.
     * =========================================================
     */

    const serviceIndex = (
      serviceIndexResult.data || []
    )
      .map(
        (service) =>
          `${service.slug} | ${service.name}`
      )
      .join("\n");

    /*
     * =========================================================
     * 9. DECISÃO INTELIGENTE DE RECUPERAÇÃO
     *
     * Essa chamada NÃO escreve a resposta ao cliente.
     *
     * Ela apenas interpreta a conversa:
     *
     * - a resposta atual realmente depende de preço?
     * - se sim, qual serviço está sendo discutido?
     *
     * Não usamos lista de palavras-chave em TypeScript.
     * O modelo interpreta semanticamente a conversa.
     * =========================================================
     */

    const retrievalResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você atua apenas como analisador interno de contexto para um agente comercial.

Sua função NÃO é responder ao cliente.

Leia a conversa recente como um todo e determine se, para responder adequadamente à mensagem atual, é necessário consultar o preço oficial de um serviço.

Entenda referências contextuais como:
"esse projeto",
"nesse caso",
"e quanto ficaria?",
"e isso?",
"quanto sairia?",
ou outras formas naturais de continuar a conversa.

Não dependa de palavras específicas. Interprete intenção e contexto.

Se a mensagem atual não depender de preço oficial, needs_pricing deve ser false.

Se depender de preço:
- use a conversa recente para identificar o projeto em discussão;
- escolha o serviço mais compatível entre os serviços disponíveis;
- retorne exatamente o slug cadastrado.

Se o cliente estiver pedindo preço, mas o contexto ainda não permitir identificar com segurança o serviço, needs_pricing deve ser true e service_slug deve ser null.

Não invente serviços.

SERVIÇOS DISPONÍVEIS:

${serviceIndex || "Nenhum serviço cadastrado."}
        `.trim(),

        input: `
CONVERSA RECENTE:

${conversationContext}

MENSAGEM ATUAL:

${message}
        `.trim(),

        max_output_tokens: 150,

        text: {
          format: {
            type: "json_schema",

            name: "pricing_retrieval_decision",

            strict: true,

            schema: {
              type: "object",

              properties: {
                needs_pricing: {
                  type: "boolean",
                },

                service_slug: {
                  anyOf: [
                    {
                      type: "string",
                    },
                    {
                      type: "null",
                    },
                  ],
                },

                reasoning_summary: {
                  type: "string",
                },
              },

              required: [
                "needs_pricing",
                "service_slug",
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
     * =========================================================
     * 10. RECUPERAÇÃO SELETIVA
     *
     * Só consultamos preço se a conversa realmente precisar.
     * =========================================================
     */

    let officialCommercialContext = "";

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
        .eq("active", true)
        .maybeSingle();

      if (serviceError) {
        throw serviceError;
      }

      if (service) {
        const price =
          service.price_min !== null &&
          service.price_max !== null
            ? `R$ ${Number(
                service.price_min
              ).toLocaleString(
                "pt-BR"
              )} a R$ ${Number(
                service.price_max
              ).toLocaleString("pt-BR")}`
            : "Não há faixa oficial cadastrada.";

        officialCommercialContext = `
DADOS OFICIAIS RECUPERADOS DO NEGÓCIO

Serviço identificado: ${service.name}
Faixa inicial de referência: ${price}

Descrição:
${service.description || "Não cadastrada."}

Observações:
${service.notes || "Nenhuma observação adicional."}

Esses dados são a fonte oficial para esta resposta.
        `.trim();
      }
    }

    /*
     * Se existe intenção de preço, mas ainda não conseguimos
     * identificar o serviço, informamos isso ao modelo.
     *
     * Ele decide naturalmente se precisa perguntar algo.
     */
    if (
      retrievalDecision.needs_pricing &&
      !officialCommercialContext
    ) {
      officialCommercialContext = `
A conversa indica que o cliente deseja informação de preço, mas ainda não há informação suficiente para identificar com segurança qual serviço oficial deve ser usado como referência.

Não invente um valor.

Use o contexto da conversa e, somente se realmente necessário, peça uma informação curta que permita entender melhor o projeto.
      `.trim();
    }

    /*
     * =========================================================
     * 11. CHAMADA PRINCIPAL
     *
     * Este é o agente que conversa de verdade.
     *
     * Prompt permanente propositalmente curto.
     * =========================================================
     */

    const aiResponse =
      await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você é o agente de IA do @walbrasil.dev.

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

Não invente preços, políticas, prazos ou outras informações comerciais que não tenham sido fornecidas oficialmente.

Adapte a resposta ao estágio e ao tom da conversa.

Prefira respostas adequadas para um chat de site: claras e naturais, sem serem artificialmente curtas.

Conduza a conversa de forma natural e deixe espaço para o cliente responder.

Não sinta necessidade de terminar todas as mensagens com uma pergunta, convite ou oferta de ajuda adicional.

Evite repetir fórmulas como "Se quiser, eu posso..." apenas para manter a conversa andando. Sugira próximos passos somente quando isso realmente fizer sentido no contexto.

MEMÓRIA ÚTIL DO VISITANTE:

${persistentMemory || "Nenhuma memória persistente relevante."}

${
  officialCommercialContext
    ? `CONTEXTO OFICIAL PARA ESTA RESPOSTA:

${officialCommercialContext}`
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

Se não houver fato novo útil, memory_updates deve ser [].

Use confidence 1.0 quando o fato tiver sido declarado explicitamente.
        `.trim(),

        input: conversationHistory,

        max_output_tokens: 500,

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

    /*
     * =========================================================
     * 12. PROCESSA RESPOSTA
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
      JSON.parse(rawOutput) as AgentResult;

    const aiText =
      agentResult.reply?.trim();

    if (!aiText) {
      throw new Error(
        "Resposta da IA vazia."
      );
    }

    /*
     * =========================================================
     * 13. MEMÓRIA PERSISTENTE
     * =========================================================
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

    /*
     * Salva resposta.
     */
    databaseOperations.push(
      supabase
        .from("web_messages")
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
     * Atualiza conversa.
     */
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

    /*
     * Atualiza fatos persistentes.
     */
    if (memoryUpdates.length > 0) {
      const memoryRows =
        memoryUpdates.map(
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

            source: "web_chat",
          })
        );

      databaseOperations.push(
        supabase
          .from("web_memory")
          .upsert(memoryRows, {
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

    await Promise.all(
      databaseOperations
    );

    /*
     * =========================================================
     * 14. LOGS DE DESENVOLVIMENTO
     *
     * Isso vai nos permitir conferir se a recuperação
     * contextual está funcionando como planejado.
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
      memoriesResult.data?.length || 0
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
      "Resumo da decisão:",
      retrievalDecision.reasoning_summary
    );

    console.log(
      "Preço recuperado:",
      Boolean(officialCommercialContext)
    );

    console.log(
      "Memórias atualizadas:",
      memoryUpdates.length
    );

    console.log(
      "Tokens etapa recuperação:",
      retrievalResponse.usage
    );

    console.log(
      "Tokens resposta principal:",
      aiResponse.usage
    );

    console.log(
      "================================"
    );

    /*
     * =========================================================
     * 15. RESPOSTA PARA O SITE
     * =========================================================
     */

    return NextResponse.json({
      status: "ok",
      reply: aiText,
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