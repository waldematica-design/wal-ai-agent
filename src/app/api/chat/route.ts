import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

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
      console.error("Variáveis de ambiente obrigatórias não configuradas.");

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
     * O navegador guardará este token.
     * Se for a primeira conversa, criamos um novo.
     */
    const visitorToken =
      body.visitorToken?.trim() || crypto.randomUUID();

    /*
     * 1. Procura o visitante.
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

    /*
     * 2. Cria visitante na primeira mensagem.
     */
    if (!visitor) {
      const {
        data,
        error,
      } = await supabase
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
     * 3. Procura conversa ativa.
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

    /*
     * 4. Cria conversa se necessário.
     */
    if (!conversation) {
      const {
        data,
        error,
      } = await supabase
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
     * 5. Salva mensagem do visitante.
     */
    const {
      error: userMessageError,
    } = await supabase
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
     * 6. Busca em paralelo:
     *
     * - histórico recente;
     * - memória persistente;
     * - serviços/preços/prazos.
     */
    const [
      recentMessagesResult,
      memoriesResult,
      servicesResult,
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

    if (recentMessagesResult.error) {
      throw recentMessagesResult.error;
    }

    if (memoriesResult.error) {
      throw memoriesResult.error;
    }

    if (servicesResult.error) {
      throw servicesResult.error;
    }

    /*
     * 7. Histórico recente.
     */
    const conversationHistory =
      (recentMessagesResult.data || [])
        .reverse()
        .map((item) => ({
          role:
            item.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),

          content: item.content,
        }));

    /*
     * 8. Memória persistente compacta.
     */
    const persistentMemory =
      (memoriesResult.data || [])
        .map(
          (memory) =>
            `${memory.fact_key}: ${memory.fact_value}`
        )
        .join("\n");

    /*
     * 9. Serviços comerciais.
     */
    const commercialServices =
      (servicesResult.data || [])
        .map((service) => {
          const price =
            service.price_min !== null &&
            service.price_max !== null
              ? `R$ ${Number(
                  service.price_min
                ).toLocaleString("pt-BR")} a R$ ${Number(
                  service.price_max
                ).toLocaleString("pt-BR")}`
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
     * 10. Uma única chamada à OpenAI.
     */
    const aiResponse = await openai.responses.create({
      model: "gpt-5.4-mini",

      instructions: `
Você é o assistente comercial virtual do @walbrasil.dev.

Você atende visitantes diretamente pelo site walbrasil.dev.

Seu objetivo é compreender o que a pessoa deseja criar, explicar os serviços disponíveis e ajudar o potencial cliente a avançar naturalmente na conversa.

Você representa uma marca profissional de desenvolvimento web, automações e soluções com inteligência artificial.

Não se apresente como uma grande agência ou equipe.

=========================
MEMÓRIA DO VISITANTE
=========================

Use estes fatos quando forem relevantes:

${persistentMemory || "Nenhuma memória persistente ainda."}

Não diga ao visitante que existe um banco de dados ou sistema de memória.

=========================
SERVIÇOS DO @WALBRASIL.DEV
=========================

${commercialServices || "Nenhum serviço comercial cadastrado."}

=========================
REGRAS COMERCIAIS
=========================

Quando o visitante perguntar se determinado serviço é realizado, use a base comercial acima.

Quando perguntar preço:

- use somente as faixas cadastradas;
- não invente valores;
- informe que são valores iniciais de referência;
- explique brevemente que o preço final depende do escopo;
- não fuja da pergunta quando existir um serviço correspondente.

Quando perguntar prazo:

- use o prazo típico cadastrado;
- explique que é uma estimativa inicial;
- o prazo final depende do escopo.

Se o projeto combinar vários serviços, não some valores mecanicamente.

Nesse caso, explique que o conjunto precisa ser analisado para uma proposta adequada.

Se algo não estiver na base comercial, não invente preço.

=========================
ESTILO DA CONVERSA
=========================

- Português brasileiro.
- Tom profissional, próximo e natural.
- Respostas curtas.
- Normalmente 1 ou 2 parágrafos.
- Não faça interrogatório.
- Faça no máximo uma pergunta relevante por resposta quando precisar entender melhor o projeto.
- Não repita perguntas já respondidas.
- Evite saudações repetidas.
- Não pressione o visitante.
- Não invente informações sobre o @walbrasil.dev.
- Responda diretamente quando puder.

=========================
MEMÓRIA DE LONGO PRAZO
=========================

Além da resposta, identifique apenas fatos NOVOS e úteis explicitamente informados pelo visitante na mensagem atual.

Exemplos de fact_key:

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

Não salve frases triviais.

Não transforme inferências em fatos.

Não salve informações apenas porque apareceram no histórico.

Se o visitante corrigir uma informação anterior, use novamente a mesma fact_key com o novo valor.

Não salve:
- senhas;
- tokens;
- credenciais;
- dados bancários;
- documentos;
- informações pessoais sensíveis.

Se não houver fato novo útil:
memory_updates deve ser [].

Use confidence 1.0 para fatos explicitamente declarados.
      `.trim(),

      input: conversationHistory,

      max_output_tokens: 320,

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
     * 11. Processa resposta.
     */
    const rawOutput = aiResponse.output_text;

    if (!rawOutput) {
      throw new Error("OpenAI não retornou conteúdo.");
    }

    const agentResult = JSON.parse(
      rawOutput
    ) as AgentResult;

    const aiText = agentResult.reply?.trim();

    if (!aiText) {
      throw new Error("Resposta da IA vazia.");
    }

    /*
     * 12. Filtra fatos úteis.
     */
    const memoryUpdates =
      (agentResult.memory_updates || [])
        .filter(
          (memory) =>
            memory.fact_key &&
            memory.fact_value &&
            memory.confidence >= 0.7
        )
        .slice(0, 5);

    /*
     * 13. Prepara operações do banco.
     */
    const now = new Date().toISOString();

    const databaseOperations: PromiseLike<unknown>[] = [];

    /*
     * Salva resposta do agente.
     */
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

    /*
     * Atualiza horário da conversa.
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
     * Atualiza memória.
     */
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
            .replace(/_+/g, "_"),

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

    console.log("=== WEB AGENT @WALBRASIL.DEV ===");
    console.log("Visitor:", visitor.id);
    console.log("Histórico:", conversationHistory.length);
    console.log(
      "Memórias carregadas:",
      memoriesResult.data?.length || 0
    );
    console.log(
      "Memórias atualizadas:",
      memoryUpdates.length
    );
    console.log(
      "Serviços carregados:",
      servicesResult.data?.length || 0
    );
    console.log("Tokens:", aiResponse.usage);
    console.log("===============================");

    /*
     * O visitorToken volta para o navegador,
     * que depois guardará em localStorage.
     */
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