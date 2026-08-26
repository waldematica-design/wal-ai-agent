import Script from "next/script";

export default function TesteAgenteWaldematicaPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #eef5ff 0%, #ffffff 58%, #f7fbff 100%)",
        color: "#14213d",
        padding: "56px 24px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "7px 11px",
            borderRadius: "999px",
            background: "#e7efff",
            color: "#0b43c9",
            fontSize: "12px",
            fontWeight: 800,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Ambiente de teste
        </div>

        <h1
          style={{
            maxWidth: "760px",
            margin: "24px 0 14px",
            fontSize: "clamp(36px, 6vw, 68px)",
            lineHeight: 0.98,
            letterSpacing: "-0.045em",
          }}
        >
          Agente IA
          <br />
          <span style={{ color: "#0b43c9" }}>Waldemática</span>
        </h1>

        <p
          style={{
            maxWidth: "650px",
            margin: 0,
            color: "#5d6b82",
            fontSize: "18px",
            lineHeight: 1.65,
          }}
        >
          Esta página existe apenas para testarmos o novo widget antes de
          integrá-lo ao waldematica.com.br. Abra o botão no canto inferior
          direito e converse normalmente com o agente.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "14px",
            marginTop: "42px",
          }}
        >
          {[
            ["Teste 1", "Pergunte quais cursos estão disponíveis."],
            ["Teste 2", "Peça preço e tempo de acesso do Extensivo."],
            [
              "Teste 3",
              "Diga seu objetivo e prazo e peça uma recomendação.",
            ],
          ].map(([title, text]) => (
            <article
              key={title}
              style={{
                padding: "20px",
                border: "1px solid #dce6f5",
                borderRadius: "18px",
                background: "rgba(255,255,255,0.82)",
                boxShadow: "0 12px 34px rgba(25, 61, 120, 0.07)",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: "8px",
                  color: "#0b43c9",
                }}
              >
                {title}
              </strong>

              <span
                style={{
                  color: "#667085",
                  lineHeight: 1.55,
                }}
              >
                {text}
              </span>
            </article>
          ))}
        </div>
      </div>

      <Script
        src="/waldematica-ai-widget.js"
        strategy="afterInteractive"
        data-api-url="http://localhost:3000/api/waldematica/chat"
        data-title="Agente IA Waldemática"
        data-subtitle="Online"
        data-button-label="Fale com nossa IA"
      />
    </main>
  );
}
