import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const HISTORY_LIMIT = 10;
const MEMORY_LIMIT = 20;
const MAX_COURSES_PER_TURN = 5;
const MAX_BUSINESS_INFO_PER_TURN = 8;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const ALLOWED_ORIGINS = new Set([
  "https://waldematica.com.br",
  "https://www.waldematica.com.br",
  "https://wal-ai-agent.vercel.app",
  "http://localhost:3000",
]);

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(
  request: NextRequest,
  body: unknown,
  init: ResponseInit = {}
) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...getCorsHeaders(request),
      ...(init.headers || {}),
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new NextResponse(null, {
      status: 403,
      headers: getCorsHeaders(request),
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

type MemoryUpdate = {
  memory_key: string;
  memory_value: string;
  confidence: number;
};

type OfficialDataRequest = {
  needs_course_data: boolean;
  course_slugs: string[];
  business_info_keys: string[];
};

type LeadStage =
  | "new"
  | "interested"
  | "qualified"
  | "hot"
  | "human"
  | "closed";

type LeadUpdate = {
  should_update: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  target_exam: string | null;
  course_interest: string | null;
  main_goal: string | null;
  current_level: string | null;
  desired_start: string | null;
  preferred_contact: string | null;
  stage: LeadStage | null;
  summary: string | null;
};

type FirstAgentResult = {
  reply: string;
  memory_updates: MemoryUpdate[];
  official_data: OfficialDataRequest;
  lead_update: LeadUpdate;
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
      memory_key: {
        type: "string",
      },
      memory_value: {
        type: "string",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: ["memory_key", "memory_value", "confidence"],
    additionalProperties: false,
  },
} as const;

function formatCurrency(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function cleanMemoryKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(
        request,
        {
          status: "forbidden_origin",
          error: "Origem não autorizada.",
        },
        {
          status: 403,
        }
      );
    }

    /*
     * =========================================================
     * CONFIGURAÇÃO
     * =========================================================
     */

    if (
      !process.env.OPENAI_API_KEY ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SECRET_KEY
    ) {
      return jsonResponse(
      request,

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
      return jsonResponse(
      request,

        {
          status: "invalid_message",
          error: "Mensagem vazia.",
        },
        {
          status: 400,
        }
      );
    }

    const visitorToken = body.visitorToken?.trim() || crypto.randomUUID();

    /*
     * =========================================================
     * VISITANTE
     * =========================================================
     */

    const {
      data: visitorData,
      error: visitorLookupError,
    } = await supabase
      .from("waldematica_visitors")
      .select("*")
      .eq("visitor_token", visitorToken)
      .maybeSingle();

    if (visitorLookupError) {
      throw visitorLookupError;
    }

    let visitor = visitorData;
    const now = new Date().toISOString();

    if (!visitor) {
      const { data, error } = await supabase
        .from("waldematica_visitors")
        .insert({
          visitor_token: visitorToken,
          first_seen_at: now,
          last_seen_at: now,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      visitor = data;
    } else {
      const { error } = await supabase
        .from("waldematica_visitors")
        .update({
          last_seen_at: now,
          updated_at: now,
        })
        .eq("id", visitor.id);

      if (error) {
        throw error;
      }
    }

    /*
     * =========================================================
     * CONVERSA ATIVA
     * =========================================================
     */

    const {
      data: conversationData,
      error: conversationLookupError,
    } = await supabase
      .from("waldematica_conversations")
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

    let conversation = conversationData;

    if (!conversation) {
      const { data, error } = await supabase
        .from("waldematica_conversations")
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
     * SALVA MENSAGEM DO VISITANTE
     * =========================================================
     */

    const { error: userMessageError } = await supabase
      .from("waldematica_messages")
      .insert({
        conversation_id: conversation.id,
        visitor_id: visitor.id,
        role: "user",
        content: message,
      });

    if (userMessageError) {
      throw userMessageError;
    }

    /*
     * =========================================================
     * CONTEXTO ESSENCIAL
     * =========================================================
     */

    const [
      recentMessagesResult,
      memoriesResult,
      courseIndexResult,
      businessInfoIndexResult,
    ] = await Promise.all([
      supabase
        .from("waldematica_messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", {
          ascending: false,
        })
        .limit(HISTORY_LIMIT),

      supabase
        .from("waldematica_memory")
        .select("memory_key, memory_value, confidence, updated_at")
        .eq("visitor_id", visitor.id)
        .order("updated_at", {
          ascending: false,
        })
        .limit(MEMORY_LIMIT),

      supabase
        .from("waldematica_courses")
        .select("slug, name, access_duration, short_description, best_for")
        .eq("active", true)
        .order("name", {
          ascending: true,
        }),

      supabase
        .from("waldematica_business_info")
        .select("info_key, description")
        .eq("active", true)
        .order("info_key", {
          ascending: true,
        }),
    ]);

    if (recentMessagesResult.error) {
      throw recentMessagesResult.error;
    }

    if (memoriesResult.error) {
      throw memoriesResult.error;
    }

    if (courseIndexResult.error) {
      throw courseIndexResult.error;
    }

    if (businessInfoIndexResult.error) {
      throw businessInfoIndexResult.error;
    }

    /*
     * =========================================================
     * HISTÓRICO RECENTE
     * =========================================================
     */

    const conversationHistory = (recentMessagesResult.data || [])
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
     * =========================================================
     * MEMÓRIA PERSISTENTE
     * =========================================================
     */

    const persistentMemory = (memoriesResult.data || [])
      .map((memory) => `${memory.memory_key}: ${memory.memory_value}`)
      .join("\n");

    /*
     * =========================================================
     * ÍNDICES MÍNIMOS
     * =========================================================
     */

    const courseIndex = (courseIndexResult.data || [])
      .map(
        (course) =>
          `${course.slug} | ${course.name} | acesso: ${
            course.access_duration || "não cadastrado"
          } | resumo: ${
            course.short_description || "não cadastrado"
          } | indicado para: ${
            course.best_for || "não cadastrado"
          }`
      )
      .join("\n");

    const businessInfoIndex = (businessInfoIndexResult.data || [])
      .map(
        (item) =>
          `${item.info_key} | ${item.description || "Informação oficial Waldemática"}`
      )
      .join("\n");

    /*
     * =========================================================
     * PRIMEIRA CHAMADA
     *
     * - conversa normalmente;
     * - decide se precisa consultar dados oficiais;
     * - atualiza memória;
     * - qualifica lead silenciosamente.
     * =========================================================
     */

    const firstResponse = await openai.responses.create({
      model: "gpt-5.4-mini",

      instructions: `
Você é o Agente de IA oficial da Waldemática e atende visitantes do site waldematica.com.br.

Converse em português brasileiro de forma natural, inteligente, didática, acolhedora e direta.

Você representa comercialmente a Waldemática, mas não deve agir como vendedor insistente.

Seu papel é compreender o objetivo do visitante, explicar os cursos, ajudar a comparar opções, orientar sobre qual curso faz mais sentido e esclarecer dúvidas pré-compra.

Não aja como menu, formulário, questionário ou árvore de decisão.

Não faça perguntas apenas para coletar dados.

Use o contexto recente da conversa e a memória útil do visitante.

Quando conseguir ajudar diretamente, ajude.

Não encaminhe cedo demais para atendimento humano.

Não termine toda resposta com "Se quiser, posso..." ou frases equivalentes.

Não invente preços, duração de acesso, bônus, conteúdo, links, políticas, formas de pagamento, condições comerciais ou qualquer outro fato oficial.

=========================
DADOS OFICIAIS
=========================

Você recebe abaixo apenas índices mínimos.

Quando a resposta atual depender de informações oficiais de um curso, marque:

official_data.needs_course_data = true

e informe em official_data.course_slugs somente os slugs dos cursos necessários.

Isso inclui perguntas ou comparações sobre:
- preço;
- duração de acesso;
- público-alvo;
- indicação;
- conteúdo;
- trilha;
- bônus;
- materiais;
- Tutor IA;
- suporte;
- diferenças entre cursos;
- página oficial;
- checkout;
- qualquer detalhe comercial específico de um curso.

REGRA OBRIGATÓRIA PARA RECOMENDAÇÕES:

Sempre que o visitante pedir:
- qual curso escolher;
- qual curso é melhor para ele;
- comparação entre cursos;
- mudança de recomendação porque mudou prazo, objetivo ou prova;
- orientação entre dois ou mais planos;
- indicação de produto com base no contexto da conversa;

você DEVE marcar official_data.needs_course_data = true antes de dar a recomendação final.

Em official_data.course_slugs, inclua os cursos plausivelmente relevantes para aquela decisão, usando TODO o índice disponível, especialmente tempo de acesso, resumo e indicação de cada plano.

Quando o visitante informa um prazo concreto, dê prioridade na seleção dos slugs aos planos cujo tempo de acesso e indicação sejam compatíveis com esse prazo. Por exemplo, uma mudança importante de 6 meses para 3 meses exige reconsiderar também qualquer plano de 3 meses disponível no índice.

Não escolha um produto comercial apenas de memória, do nome do plano ou de uma resposta anterior.

Quando o visitante muda uma condição importante — por exemplo, prazo, prova ou objetivo — reavalie a recomendação consultando novamente os cursos oficiais pertinentes.

A primeira resposta pode ser provisória, pois será substituída pela resposta final após a consulta oficial. Não invente uma recomendação definitiva sem retrieval.

Uma pergunta geral como "vocês têm curso de matemática?" pode ser respondida naturalmente sem consultar tudo.

Quando a resposta depender de uma política ou informação geral da Waldemática, inclua em:

official_data.business_info_keys

somente as chaves necessárias.

Isso inclui, por exemplo:
- reembolso;
- prazo de liberação por forma de pagamento;
- renovação;
- desconto de renovação;
- plataforma de vendas;
- cursos grátis;
- blog;
- links institucionais.

Não solicite dados oficiais que não sejam necessários para responder à mensagem atual.

CURSOS DISPONÍVEIS PARA IDENTIFICAÇÃO:

${courseIndex || "Nenhum curso cadastrado."}

INFORMAÇÕES GERAIS DISPONÍVEIS:

${businessInfoIndex || "Nenhuma informação geral cadastrada."}

=========================
RECOMENDAÇÃO DE CURSO
=========================

Quando o visitante pedir ajuda para escolher um curso, raciocine principalmente sobre:
- objetivo;
- prova alvo;
- tempo disponível;
- amplitude dos conteúdos que precisa estudar;
- se quer preparação completa, trilha específica ou assunto isolado.

Não recomende automaticamente o curso mais caro.

A recomendação deve procurar o produto mais adequado ao contexto informado.

Se ainda faltar uma informação realmente decisiva, faça no máximo uma pergunta natural por vez.

=========================
MEMÓRIA
=========================

MEMÓRIA ÚTIL DO VISITANTE:

${persistentMemory || "Nenhuma memória persistente relevante."}

Identifique somente fatos novos, úteis e explicitamente informados pelo visitante na mensagem atual.

Boas memórias incluem:
- nome;
- prova alvo;
- curso de interesse;
- objetivo de estudo;
- nível declarado;
- tempo disponível;
- quando pretende começar;
- preferência explícita de contato.

Não armazene inferências.

Não armazene senhas, tokens, credenciais, documentos, dados bancários ou dados pessoais sensíveis.

Se não houver fato novo útil:
memory_updates = [].

=========================
LEAD
=========================

Mantenha silenciosamente um resumo estruturado do potencial aluno quando houver informação comercial útil.

Isso NÃO é um formulário.

Não faça perguntas apenas para preencher campos.

Use somente informações que surgirem naturalmente.

lead_update.should_update deve ser false quando não houver informação comercial útil nova ou evolução relevante.

Campos:

name:
nome informado explicitamente.

email:
e-mail informado explicitamente.

phone:
telefone ou WhatsApp informado explicitamente.

target_exam:
prova, vestibular, concurso ou objetivo principal, como ENEM, FUVEST, UNICAMP, UNESP ou PROFMAT/ENA.

course_interest:
curso ou plano pelo qual demonstrou interesse.

main_goal:
principal objetivo de estudo.

current_level:
nível ou dificuldade que o próprio visitante descreveu.

desired_start:
quando pretende começar, se informar.

preferred_contact:
preferência explícita de contato.

summary:
resumo curto e útil do estágio atual do atendimento.

stage:

new:
ainda não existe interesse comercial claro.

interested:
há interesse real em algum curso ou solução.

qualified:
objetivo e necessidade já estão razoavelmente compreendidos.

hot:
o visitante demonstra intenção concreta de comprar, pede link de compra, condição comercial ou está decidindo entre opções finais.

human:
pede explicitamente falar com o Professor Wal ou atendimento humano.

closed:
use apenas quando houver contexto claro de encerramento comercial.

Não force mudança de estágio em toda mensagem.

Se nenhuma mudança fizer sentido:
stage = null.
      `.trim(),

      input: conversationHistory,

      max_output_tokens: 750,

      text: {
        format: {
          type: "json_schema",
          name: "waldematica_agent_first_response",
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
                  needs_course_data: {
                    type: "boolean",
                  },

                  course_slugs: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },

                  business_info_keys: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                },

                required: [
                  "needs_course_data",
                  "course_slugs",
                  "business_info_keys",
                ],

                additionalProperties: false,
              },

              lead_update: {
                type: "object",

                properties: {
                  should_update: {
                    type: "boolean",
                  },

                  name: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  email: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  phone: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  target_exam: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  course_interest: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  main_goal: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  current_level: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  desired_start: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  preferred_contact: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },

                  stage: {
                    anyOf: [
                      {
                        type: "string",
                        enum: [
                          "new",
                          "interested",
                          "qualified",
                          "hot",
                          "human",
                          "closed",
                        ],
                      },
                      {
                        type: "null",
                      },
                    ],
                  },

                  summary: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                },

                required: [
                  "should_update",
                  "name",
                  "email",
                  "phone",
                  "target_exam",
                  "course_interest",
                  "main_goal",
                  "current_level",
                  "desired_start",
                  "preferred_contact",
                  "stage",
                  "summary",
                ],

                additionalProperties: false,
              },
            },

            required: [
              "reply",
              "memory_updates",
              "official_data",
              "lead_update",
            ],

            additionalProperties: false,
          },
        },
      },
    });

    if (!firstResponse.output_text) {
      throw new Error("OpenAI não retornou conteúdo.");
    }

    const firstResult = JSON.parse(
      firstResponse.output_text
    ) as FirstAgentResult;

    /*
     * =========================================================
     * VALIDA SOLICITAÇÕES DE DADOS OFICIAIS
     * =========================================================
     */

    const validCourseSlugs = new Set(
      (courseIndexResult.data || []).map((course) => course.slug)
    );

    const requestedCourseSlugs = [
      ...new Set(
        (firstResult.official_data.course_slugs || []).filter((slug) =>
          validCourseSlugs.has(slug)
        )
      ),
    ].slice(0, MAX_COURSES_PER_TURN);

    const validBusinessInfoKeys = new Set(
      (businessInfoIndexResult.data || []).map((item) => item.info_key)
    );

    const requestedBusinessInfoKeys = [
      ...new Set(
        (firstResult.official_data.business_info_keys || []).filter((key) =>
          validBusinessInfoKeys.has(key)
        )
      ),
    ].slice(0, MAX_BUSINESS_INFO_PER_TURN);

    const needsOfficialData =
      (firstResult.official_data.needs_course_data &&
        requestedCourseSlugs.length > 0) ||
      requestedBusinessInfoKeys.length > 0;

    let finalReply = firstResult.reply.trim();
    let finalMemoryUpdates = firstResult.memory_updates || [];

    /*
     * =========================================================
     * RECUPERAÇÃO OFICIAL
     * =========================================================
     */

    if (needsOfficialData) {
      const contexts: string[] = [];

      /*
       * DADOS DOS CURSOS
       */
      if (
        firstResult.official_data.needs_course_data &&
        requestedCourseSlugs.length > 0
      ) {
        const { data: courses, error: coursesError } = await supabase
          .from("waldematica_courses")
          .select(`
            slug,
            name,
            short_description,
            full_description,
            target_audience,
            main_goal,
            recommended_level,
            access_duration,
            included_content,
            study_path,
            has_video_lessons,
            has_pdfs,
            has_exercise_lists,
            has_assessments,
            has_ai_tutor,
            has_support,
            bonuses,
            not_included,
            best_for,
            not_best_for,
            differentiators,
            price_cash,
            installment_count,
            installment_value,
            sales_page_url,
            checkout_url
          `)
          .in("slug", requestedCourseSlugs)
          .eq("active", true);

        if (coursesError) {
          throw coursesError;
        }

        if (courses && courses.length > 0) {
          const blocks = requestedCourseSlugs
            .map((slug) => courses.find((course) => course.slug === slug))
            .filter(Boolean)
            .map((course) => {
              if (!course) {
                return "";
              }

              const cashPrice = formatCurrency(course.price_cash);
              const installmentValue = formatCurrency(course.installment_value);

              const paymentText =
                course.installment_count &&
                installmentValue &&
                course.installment_count > 1
                  ? `${course.installment_count}x de ${installmentValue}${
                      cashPrice ? ` ou ${cashPrice} à vista` : ""
                    }`
                  : cashPrice || "Preço não cadastrado.";

              return `
CURSO: ${course.name}
SLUG: ${course.slug}
RESUMO: ${course.short_description || "Não cadastrado."}
DESCRIÇÃO: ${course.full_description || "Não cadastrada."}
PÚBLICO-ALVO: ${course.target_audience || "Não cadastrado."}
OBJETIVO: ${course.main_goal || "Não cadastrado."}
NÍVEL INDICADO: ${course.recommended_level || "Não cadastrado."}
TEMPO DE ACESSO: ${course.access_duration || "Não cadastrado."}
CONTEÚDOS/MATERIAIS: ${course.included_content || "Não cadastrado."}
TRILHA/ORGANIZAÇÃO: ${course.study_path || "Não cadastrada."}
VIDEOAULAS: ${course.has_video_lessons ? "Sim" : "Não"}
PDFs: ${course.has_pdfs ? "Sim" : "Não"}
LISTAS DE EXERCÍCIOS: ${course.has_exercise_lists ? "Sim" : "Não"}
AVALIAÇÕES: ${course.has_assessments ? "Sim" : "Não"}
TUTOR IA: ${course.has_ai_tutor ? "Sim" : "Não"}
SUPORTE: ${course.has_support ? "Sim" : "Não"}
BÔNUS: ${course.bonuses || "Nenhum bônus cadastrado."}
NÃO INCLUÍDO: ${course.not_included || "Nenhuma restrição adicional cadastrada."}
MAIS INDICADO PARA: ${course.best_for || "Não cadastrado."}
MENOS INDICADO PARA: ${course.not_best_for || "Não cadastrado."}
DIFERENCIAIS: ${course.differentiators || "Não cadastrados."}
PREÇO ATUAL: ${paymentText}
PÁGINA OFICIAL: ${course.sales_page_url || "Não cadastrada."}
CHECKOUT: ${course.checkout_url || "Não cadastrado."}
              `.trim();
            });

          contexts.push(`
DADOS OFICIAIS DOS CURSOS

${blocks.join("\n\n")}

Use somente os dados acima como fatos comerciais.

Quando comparar cursos, explique as diferenças de forma natural e recomende com base no objetivo do visitante.

Não recomende automaticamente o produto mais caro.

Se algum campo estiver "Não cadastrado", não invente a informação.
          `.trim());
        }
      }

      /*
       * INFORMAÇÕES GERAIS
       */
      if (requestedBusinessInfoKeys.length > 0) {
        const { data: businessInfo, error: businessInfoError } = await supabase
          .from("waldematica_business_info")
          .select("info_key, info_value, description")
          .in("info_key", requestedBusinessInfoKeys)
          .eq("active", true);

        if (businessInfoError) {
          throw businessInfoError;
        }

        if (businessInfo && businessInfo.length > 0) {
          const blocks = requestedBusinessInfoKeys
            .map((key) =>
              businessInfo.find((item) => item.info_key === key)
            )
            .filter(Boolean)
            .map((item) => {
              if (!item) {
                return "";
              }

              return `
CHAVE: ${item.info_key}
INFORMAÇÃO OFICIAL: ${item.info_value}
DESCRIÇÃO: ${item.description || "Sem descrição adicional."}
              `.trim();
            });

          contexts.push(`
INFORMAÇÕES GERAIS OFICIAIS DA WALDEMÁTICA

${blocks.join("\n\n")}

Trate essas informações como fonte de verdade e não invente condições ausentes.
          `.trim());
        }
      }

      const officialContext = contexts.join("\n\n");

      /*
       * =========================================================
       * SEGUNDA CHAMADA
       * =========================================================
       */

      const finalResponse = await openai.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Você é o Agente de IA oficial da Waldemática.

Converse em português brasileiro de forma natural, inteligente, didática, acolhedora e direta.

Use o contexto recente da conversa.

Os dados abaixo foram recuperados da base oficial da Waldemática porque são necessários para responder à mensagem atual.

Trate esses dados como fonte de verdade.

Não invente fatos comerciais ausentes.

Quando houver mais de um curso, compare apenas os pontos relevantes à dúvida do visitante.

Não transforme a resposta em tabela ou catálogo mecânico quando uma explicação natural for melhor.

Não pressione o visitante para comprar.

Se houver um checkout oficial e o visitante pedir para comprar, você pode fornecer o link diretamente.

Se houver página oficial e ela for útil para a dúvida atual, você pode fornecê-la.

Não tente prolongar artificialmente a conversa.

MEMÓRIA ÚTIL:

${persistentMemory || "Nenhuma memória persistente relevante."}

DADOS OFICIAIS PARA ESTA RESPOSTA:

${officialContext}
        `.trim(),

        input: conversationHistory,

        max_output_tokens: 650,

        text: {
          format: {
            type: "json_schema",
            name: "waldematica_agent_final_response",
            strict: true,
            schema: {
              type: "object",

              properties: {
                reply: {
                  type: "string",
                },

                memory_updates: memorySchema,
              },

              required: ["reply", "memory_updates"],

              additionalProperties: false,
            },
          },
        },
      });

      if (!finalResponse.output_text) {
        throw new Error("OpenAI não retornou resposta final.");
      }

      const finalResult = JSON.parse(
        finalResponse.output_text
      ) as FinalAgentResult;

      finalReply = finalResult.reply.trim();
      finalMemoryUpdates = finalResult.memory_updates || [];
    }

    if (!finalReply) {
      throw new Error("Resposta final vazia.");
    }

    /*
     * =========================================================
     * MEMÓRIA
     * =========================================================
     */

    const memoryUpdates = finalMemoryUpdates
      .filter(
        (memory) =>
          memory.memory_key &&
          memory.memory_value &&
          memory.confidence >= 0.7
      )
      .slice(0, 5);

    const operations: PromiseLike<unknown>[] = [];

    /*
     * SALVA RESPOSTA
     */
    operations.push(
      supabase
        .from("waldematica_messages")
        .insert({
          conversation_id: conversation.id,
          visitor_id: visitor.id,
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

    /*
     * ATUALIZA CONVERSA
     */
    operations.push(
      supabase
        .from("waldematica_conversations")
        .update({
          last_message_at: now,
          updated_at: now,
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
     * =========================================================
     * ATUALIZA MEMÓRIA
     * =========================================================
     */

    if (memoryUpdates.length > 0) {
      const rows = memoryUpdates
        .map((memory) => ({
          visitor_id: visitor.id,
          memory_key: cleanMemoryKey(memory.memory_key),
          memory_value: memory.memory_value.trim(),
          confidence: memory.confidence,
          updated_at: now,
        }))
        .filter((row) => row.memory_key && row.memory_value);

      if (rows.length > 0) {
        operations.push(
          supabase
            .from("waldematica_memory")
            .upsert(rows, {
              onConflict: "visitor_id,memory_key",
            })
            .then((result) => {
              if (result.error) {
                throw result.error;
              }

              return result;
            })
        );
      }
    }

    /*
     * =========================================================
     * ATUALIZA LEAD SILENCIOSAMENTE
     * =========================================================
     */

    const leadUpdate = firstResult.lead_update;

    if (leadUpdate.should_update) {
      const leadRow: Record<string, unknown> = {
        visitor_id: visitor.id,
        updated_at: now,
      };

      if (leadUpdate.name) {
        leadRow.name = leadUpdate.name.trim();
      }

      if (leadUpdate.email) {
        leadRow.email = leadUpdate.email.trim();
      }

      if (leadUpdate.phone) {
        leadRow.phone = leadUpdate.phone.trim();
      }

      if (leadUpdate.target_exam) {
        leadRow.target_exam = leadUpdate.target_exam.trim();
      }

      if (leadUpdate.course_interest) {
        leadRow.course_interest = leadUpdate.course_interest.trim();
      }

      if (leadUpdate.main_goal) {
        leadRow.main_goal = leadUpdate.main_goal.trim();
      }

      if (leadUpdate.current_level) {
        leadRow.current_level = leadUpdate.current_level.trim();
      }

      if (leadUpdate.desired_start) {
        leadRow.desired_start = leadUpdate.desired_start.trim();
      }

      if (leadUpdate.preferred_contact) {
        leadRow.preferred_contact = leadUpdate.preferred_contact.trim();
      }

      if (leadUpdate.summary) {
        leadRow.summary = leadUpdate.summary.trim();
      }

      if (leadUpdate.stage) {
        leadRow.stage = leadUpdate.stage;
      }

      operations.push(
        supabase
          .from("waldematica_leads")
          .upsert(leadRow, {
            onConflict: "visitor_id",
          })
          .then((result) => {
            if (result.error) {
              throw result.error;
            }

            return result;
          })
      );

      /*
       * Espelha contato básico no visitante quando informado.
       */
      const visitorUpdate: Record<string, unknown> = {
        updated_at: now,
        last_seen_at: now,
      };

      if (leadUpdate.name) {
        visitorUpdate.name = leadUpdate.name.trim();
      }

      if (leadUpdate.email) {
        visitorUpdate.email = leadUpdate.email.trim();
      }

      if (leadUpdate.phone) {
        visitorUpdate.phone = leadUpdate.phone.trim();
      }

      if (
        leadUpdate.name ||
        leadUpdate.email ||
        leadUpdate.phone
      ) {
        operations.push(
          supabase
            .from("waldematica_visitors")
            .update(visitorUpdate)
            .eq("id", visitor.id)
            .then((result) => {
              if (result.error) {
                throw result.error;
              }

              return result;
            })
        );
      }
    }

    await Promise.all(operations);

    /*
     * =========================================================
     * LOGS
     * =========================================================
     */

    console.log("=== AGENTE IA WALDEMÁTICA ===");

    console.log("Precisou de segunda chamada:", needsOfficialData);

    console.log("Cursos solicitados:", requestedCourseSlugs);

    console.log(
      "Informações gerais solicitadas:",
      requestedBusinessInfoKeys
    );

    console.log("Lead atualizado:", leadUpdate.should_update);

    console.log("E-mail capturado:", leadUpdate.email ? "sim" : "não");

    console.log("Telefone capturado:", leadUpdate.phone ? "sim" : "não");

    console.log("Estágio sugerido:", leadUpdate.stage);

    console.log("Tokens primeira chamada:", firstResponse.usage);

    console.log("================================");

    /*
     * =========================================================
     * RESPOSTA
     * =========================================================
     */

    return jsonResponse(
      request,
{
      status: "ok",
      reply: finalReply,
      visitorToken,
      memoriesUpdated: memoryUpdates.length,
      usedOfficialData: needsOfficialData,
      leadUpdated: leadUpdate.should_update,
    });
  } catch (error) {
    console.error("Erro no chat Waldemática:", error);

    return jsonResponse(
      request,

      {
        status: "error",
        error: "Não foi possível processar a mensagem.",
      },
      {
        status: 500,
      }
    );
  }
}
