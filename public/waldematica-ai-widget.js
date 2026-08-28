(() => {
  "use strict";

  if (window.__WALDEMATICA_AI_WIDGET_LOADED__) {
    return;
  }

  window.__WALDEMATICA_AI_WIDGET_LOADED__ = true;

  const script = document.currentScript;

  const scriptBaseUrl = script?.src
    ? new URL(".", script.src).href
    : "https://wal-ai-agent.vercel.app/";

  const CONFIG = {
    apiUrl:
      script?.dataset.apiUrl ||
      "https://wal-ai-agent.vercel.app/api/waldematica/chat",
    title:
      script?.dataset.title ||
      "Agente IA Waldemática",
    subtitle:
      script?.dataset.subtitle ||
      "Online",
    buttonLabel:
      script?.dataset.buttonLabel ||
      "Fale com nossa IA",
    initialMessage:
      script?.dataset.initialMessage ||
      "Olá! 👋 Sou o Agente de IA da Waldemática. Posso te ajudar a conhecer os cursos, escolher a melhor opção para seu objetivo e tirar dúvidas sobre acesso, materiais e preparação. Como posso te ajudar?",
  };

  const VISITOR_TOKEN_KEY =
    "waldematica_ai_visitor_token";

  const STYLE_ID =
    "waldematica-ai-widget-styles";

  const ROOT_ID =
    "waldematica-ai-widget-root";

  function getPageContext() {
    const pathname =
      window.location.pathname || "/";

    const normalizedPath =
      pathname.length > 1
        ? pathname.replace(/\/+$/, "")
        : "/";

    const pageLabels = {
      "/": "Home do Waldemática",
      "/extensivo": "Curso Extensivo",
      "/curso-semiextensivo": "Curso Semiextensivo",
      "/curso-profmat": "Curso PROFMAT / ENA",
      "/revisao-1a-fase": "Revisão 1ª Fase",
      "/revisao-2a-fase": "Revisão 2ª Fase",
      "/padawan": "Planos Padawan 1 e Padawan 3",
      "/cursos-gratis": "Cursos Grátis",
      "/blog": "Blog Waldemática",
    };

    return {
      pathname,
      url: window.location.href,
      title: document.title || "",
      pageLabel:
        pageLabels[normalizedPath] ||
        "Página do site Waldemática",
    };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      :root {
        --wm-ai-blue: #0b43c9;
        --wm-ai-blue-dark: #072c89;
        --wm-ai-cyan: #13d7d0;
        --wm-ai-text: #13213a;
        --wm-ai-muted: #667085;
        --wm-ai-bg: #ffffff;
        --wm-ai-soft: #f3f7ff;
        --wm-ai-border: #dbe6f7;
        --wm-ai-shadow: 0 24px 70px rgba(14, 46, 105, 0.22);
      }

      #${ROOT_ID},
      #${ROOT_ID} * {
        box-sizing: border-box;
      }

      #${ROOT_ID} {
        position: relative;
        z-index: 2147483000;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
      }

      .wm-ai-launcher {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 2147483002;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-height: 54px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background:
          linear-gradient(
            135deg,
            var(--wm-ai-blue) 0%,
            #1068e8 62%,
            #0ebec0 135%
          );
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 750;
        cursor: pointer;
        box-shadow:
          0 16px 36px rgba(11, 67, 201, 0.28);
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          filter 160ms ease;
      }

      .wm-ai-launcher:hover {
        transform: translateY(-2px);
        box-shadow:
          0 20px 42px rgba(11, 67, 201, 0.34);
        filter: brightness(1.03);
      }

      .wm-ai-launcher:focus-visible,
      .wm-ai-close:focus-visible,
      .wm-ai-send:focus-visible,
      .wm-ai-textarea:focus-visible {
        outline: 3px solid rgba(19, 215, 208, 0.38);
        outline-offset: 2px;
      }

      .wm-ai-launcher-icon {
        display: grid;
        width: 27px;
        height: 27px;
        place-items: center;
        border-radius: 9px;
        background: rgba(255,255,255,0.16);
        font-size: 17px;
      }

      .wm-ai-panel {
        position: fixed;
        right: 22px;
        bottom: 88px;
        z-index: 2147483001;
        display: flex;
        width: min(410px, calc(100vw - 32px));
        height: min(620px, calc(100vh - 118px));
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--wm-ai-border);
        border-radius: 22px;
        background: var(--wm-ai-bg);
        box-shadow: var(--wm-ai-shadow);
        opacity: 0;
        visibility: hidden;
        transform: translateY(12px) scale(0.985);
        transform-origin: bottom right;
        transition:
          opacity 180ms ease,
          transform 180ms ease,
          visibility 180ms ease;
      }

      .wm-ai-panel.wm-ai-open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }

      .wm-ai-header {
        position: relative;
        display: flex;
        min-height: 78px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 15px 16px 15px 18px;
        overflow: hidden;
        color: #fff;
        background:
          radial-gradient(
            circle at 90% 0%,
            rgba(19, 215, 208, 0.38),
            transparent 36%
          ),
          linear-gradient(
            135deg,
            #07338f 0%,
            #0b43c9 62%,
            #0861d2 100%
          );
      }

      .wm-ai-brand {
        min-width: 0;
      }

      .wm-ai-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .wm-ai-logo {
        width: 42px;
        height: 42px;
        flex: 0 0 42px;
        display: block;
        object-fit: contain;
        border-radius: 50%;
        filter: drop-shadow(0 4px 10px rgba(0, 229, 255, 0.28));
      }

      .wm-ai-title {
        overflow: hidden;
        margin: 0;
        color: #fff;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .wm-ai-status {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        color: rgba(255,255,255,0.78);
        font-size: 11px;
        font-weight: 600;
      }

      .wm-ai-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #55ee9b;
        box-shadow: 0 0 0 3px rgba(85, 238, 155, 0.12);
      }

      .wm-ai-close {
        display: grid;
        width: 36px;
        height: 36px;
        flex: 0 0 36px;
        place-items: center;
        border: 0;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font: inherit;
        font-size: 23px;
        line-height: 1;
        cursor: pointer;
        transition: background 150ms ease;
      }

      .wm-ai-close:hover {
        background: rgba(255,255,255,0.18);
      }

      .wm-ai-messages {
        flex: 1;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 18px 15px;
        background:
          radial-gradient(
            circle at 15% 0%,
            rgba(11, 67, 201, 0.055),
            transparent 34%
          ),
          #f8fbff;
        overscroll-behavior: contain;
        scrollbar-width: none;
      }

      .wm-ai-messages::-webkit-scrollbar,
      .wm-ai-textarea::-webkit-scrollbar {
        width: 0;
        height: 0;
      }

      .wm-ai-message-row {
        display: flex;
        margin-bottom: 12px;
      }

      .wm-ai-message-row[data-role="user"] {
        justify-content: flex-end;
      }

      .wm-ai-message-row[data-role="assistant"] {
        justify-content: flex-start;
      }

      .wm-ai-bubble {
        max-width: 86%;
        padding: 11px 13px;
        border-radius: 17px;
        font-size: 13.5px;
        line-height: 1.52;
        overflow-wrap: anywhere;
      }

      .wm-ai-message-row[data-role="assistant"] .wm-ai-bubble {
        border: 1px solid #e1e9f5;
        border-bottom-left-radius: 5px;
        background: #fff;
        color: var(--wm-ai-text);
        box-shadow: 0 5px 16px rgba(30, 64, 126, 0.055);
      }

      .wm-ai-message-row[data-role="user"] .wm-ai-bubble {
        border-bottom-right-radius: 5px;
        background:
          linear-gradient(
            135deg,
            var(--wm-ai-blue) 0%,
            #1264e4 100%
          );
        color: #fff;
        box-shadow: 0 7px 18px rgba(11, 67, 201, 0.18);
        white-space: pre-wrap;
      }

      .wm-ai-bubble p {
        margin: 0 0 8px;
      }

      .wm-ai-bubble p:last-child {
        margin-bottom: 0;
      }

      .wm-ai-bubble ul,
      .wm-ai-bubble ol {
        margin: 8px 0;
        padding-left: 20px;
      }

      .wm-ai-bubble li {
        margin: 4px 0;
      }

      .wm-ai-bubble strong {
        font-weight: 800;
      }

      .wm-ai-bubble a {
        color: #075ec7;
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .wm-ai-thinking {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 66px;
      }

      .wm-ai-thinking-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: #7990b3;
        animation: wmAiPulse 1s infinite ease-in-out;
      }

      .wm-ai-thinking-dot:nth-child(2) {
        animation-delay: 120ms;
      }

      .wm-ai-thinking-dot:nth-child(3) {
        animation-delay: 240ms;
      }

      @keyframes wmAiPulse {
        0%, 60%, 100% {
          opacity: 0.34;
          transform: translateY(0);
        }

        30% {
          opacity: 1;
          transform: translateY(-3px);
        }
      }

      .wm-ai-form {
        flex: 0 0 auto;
        padding: 12px;
        border-top: 1px solid var(--wm-ai-border);
        background: #fff;
      }

      .wm-ai-input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
      }

      .wm-ai-textarea {
        width: 100%;
        min-height: 44px;
        max-height: 110px;
        flex: 1;
        resize: none;
        overflow-y: auto;
        padding: 11px 13px;
        border: 1px solid #ccd9eb;
        border-radius: 14px;
        background: #fbfdff;
        color: #16233c;
        font: inherit;
        font-size: 13px;
        line-height: 1.45;
        transition:
          border-color 150ms ease,
          box-shadow 150ms ease;
      }

      .wm-ai-textarea::placeholder {
        color: #98a4b8;
      }

      .wm-ai-textarea:focus {
        border-color: #4e86e8;
        box-shadow: 0 0 0 3px rgba(11, 67, 201, 0.08);
        outline: none;
      }

      .wm-ai-send {
        display: grid;
        width: 44px;
        height: 44px;
        flex: 0 0 44px;
        place-items: center;
        border: 0;
        border-radius: 14px;
        background:
          linear-gradient(
            135deg,
            var(--wm-ai-blue) 0%,
            #1264e4 100%
          );
        color: #fff;
        font: inherit;
        font-size: 19px;
        font-weight: 800;
        cursor: pointer;
        transition:
          opacity 150ms ease,
          transform 150ms ease;
      }

      .wm-ai-send:hover:not(:disabled) {
        transform: translateY(-1px);
      }

      .wm-ai-send:disabled {
        cursor: not-allowed;
        opacity: 0.42;
      }

      .wm-ai-footer-note {
        margin: 7px 0 0;
        color: #929db0;
        font-size: 9.5px;
        line-height: 1.3;
        text-align: center;
      }

      @media (max-width: 640px) {
        .wm-ai-launcher {
          right: 14px;
          bottom: 14px;
          min-width: 52px;
          min-height: 52px;
          padding: 0 15px;
        }

        .wm-ai-panel.wm-ai-open + .wm-ai-launcher {
          display: none;
        }

        .wm-ai-panel {
          inset: 0;
          width: 100vw;
          height: 100dvh;
          max-width: none;
          max-height: none;
          border: 0;
          border-radius: 0;
          transform: translateY(18px);
          transform-origin: center bottom;
        }

        .wm-ai-panel.wm-ai-open {
          transform: translateY(0);
        }

        .wm-ai-header {
          min-height: 72px;
          padding:
            max(12px, env(safe-area-inset-top))
            14px
            12px;
        }

        .wm-ai-messages {
          padding: 15px 12px;
        }

        .wm-ai-form {
          padding:
            10px
            10px
            max(10px, env(safe-area-inset-bottom));
        }

        .wm-ai-bubble {
          max-width: 90%;
          font-size: 14px;
        }

        body.wm-ai-lock-scroll {
          overflow: hidden !important;
          touch-action: none;
        }
      }

      @media (max-width: 380px) {
        .wm-ai-launcher-label {
          display: none;
        }

        .wm-ai-launcher {
          width: 54px;
          padding: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .wm-ai-panel,
        .wm-ai-launcher,
        .wm-ai-send {
          transition: none;
        }

        .wm-ai-thinking-dot {
          animation: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatInlineMarkdown(value) {
    let text = escapeHtml(value);

    text = text.replace(
      /\*\*(.+?)\*\*/g,
      "<strong>$1</strong>"
    );

    text = text.replace(
      /(^|[\s(])((?:https?:\/\/)[^\s<]+)/g,
      (match, prefix, rawUrl) => {
        const cleanUrl = rawUrl.replace(
          /[),.;!?]+$/g,
          ""
        );

        const suffix =
          rawUrl.slice(cleanUrl.length);

        return `${prefix}<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${suffix}`;
      }
    );

    return text;
  }

  function renderMarkdown(value) {
    const lines = String(value || "").split(/\r?\n/);
    const output = [];
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;

      output.push(
        `<p>${paragraph
          .map(formatInlineMarkdown)
          .join("<br>")}</p>`
      );

      paragraph = [];
    };

    const closeList = () => {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        closeList();
        continue;
      }

      const unordered =
        line.match(/^[-*]\s+(.+)$/);

      const ordered =
        line.match(/^\d+[.)]\s+(.+)$/);

      if (unordered) {
        flushParagraph();

        if (listType !== "ul") {
          closeList();
          output.push("<ul>");
          listType = "ul";
        }

        output.push(
          `<li>${formatInlineMarkdown(
            unordered[1]
          )}</li>`
        );

        continue;
      }

      if (ordered) {
        flushParagraph();

        if (listType !== "ol") {
          closeList();
          output.push("<ol>");
          listType = "ol";
        }

        output.push(
          `<li>${formatInlineMarkdown(
            ordered[1]
          )}</li>`
        );

        continue;
      }

      closeList();
      paragraph.push(line);
    }

    flushParagraph();
    closeList();

    return output.join("");
  }

  function createElement(
    tag,
    className,
    attributes = {}
  ) {
    const element =
      document.createElement(tag);

    if (className) {
      element.className = className;
    }

    Object.entries(attributes).forEach(
      ([key, value]) => {
        if (key === "text") {
          element.textContent = value;
        } else if (value !== undefined) {
          element.setAttribute(
            key,
            String(value)
          );
        }
      }
    );

    return element;
  }

  function buildWidget() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    injectStyles();

    const root =
      createElement("div", "");
    root.id = ROOT_ID;

    const panel =
      createElement(
        "section",
        "wm-ai-panel",
        {
          role: "dialog",
          "aria-modal": "false",
          "aria-label":
            "Chat com o Agente IA Waldemática",
        }
      );

    const header =
      createElement(
        "div",
        "wm-ai-header"
      );

    const brand =
      createElement(
        "div",
        "wm-ai-brand"
      );

    const titleRow =
      createElement(
        "div",
        "wm-ai-title-row"
      );

    const logo =
      createElement(
        "img",
        "wm-ai-logo",
        {
          src:
            script?.dataset.logoUrl ||
            `${scriptBaseUrl}waldematica-ai-logo.png`,
          alt: "Waldemática",
          draggable: "false",
        }
      );

    const titleBlock =
      createElement("div", "");

    const title =
      createElement(
        "p",
        "wm-ai-title",
        {
          text: CONFIG.title,
        }
      );

    const status =
      createElement(
        "div",
        "wm-ai-status"
      );

    const statusDot =
      createElement(
        "span",
        "wm-ai-status-dot",
        {
          "aria-hidden": "true",
        }
      );

    const statusText =
      createElement("span", "", {
        text: CONFIG.subtitle,
      });

    status.append(
      statusDot,
      statusText
    );

    titleBlock.append(
      title,
      status
    );

    titleRow.append(
      logo,
      titleBlock
    );

    brand.appendChild(titleRow);

    const closeButton =
      createElement(
        "button",
        "wm-ai-close",
        {
          type: "button",
          "aria-label": "Fechar chat",
          text: "×",
        }
      );

    header.append(
      brand,
      closeButton
    );

    const messages =
      createElement(
        "div",
        "wm-ai-messages",
        {
          "aria-live": "polite",
          "aria-relevant":
            "additions text",
        }
      );

    const form =
      createElement(
        "form",
        "wm-ai-form"
      );

    const inputRow =
      createElement(
        "div",
        "wm-ai-input-row"
      );

    const textarea =
      createElement(
        "textarea",
        "wm-ai-textarea",
        {
          rows: "1",
          placeholder:
            "Digite sua mensagem...",
          "aria-label":
            "Digite sua mensagem",
        }
      );

    const sendButton =
      createElement(
        "button",
        "wm-ai-send",
        {
          type: "submit",
          "aria-label":
            "Enviar mensagem",
          text: "➜",
        }
      );

    sendButton.disabled = true;

    inputRow.append(
      textarea,
      sendButton
    );

    const footerNote =
      createElement(
        "p",
        "wm-ai-footer-note",
        {
          text:
            "Atendimento Waldemática com Inteligência Artificial",
        }
      );

    form.append(
      inputRow,
      footerNote
    );

    panel.append(
      header,
      messages,
      form
    );

    const launcher =
      createElement(
        "button",
        "wm-ai-launcher",
        {
          type: "button",
          "aria-label":
            "Abrir Agente IA Waldemática",
        }
      );

    const launcherIcon =
      createElement(
        "span",
        "wm-ai-launcher-icon",
        {
          text: "✦",
          "aria-hidden": "true",
        }
      );

    const launcherLabel =
      createElement(
        "span",
        "wm-ai-launcher-label",
        {
          text: CONFIG.buttonLabel,
        }
      );

    launcher.append(
      launcherIcon,
      launcherLabel
    );

    root.append(
      panel,
      launcher
    );

    document.body.appendChild(root);

    let isOpen = false;
    let isLoading = false;
    let historyLoaded = false;
    let historyLoading = false;

    function clearMessages() {
      messages.innerHTML = "";
    }

    async function loadHistory() {
      if (historyLoaded || historyLoading) {
        return;
      }

      historyLoading = true;

      try {
        const visitorToken =
          window.localStorage.getItem(
            VISITOR_TOKEN_KEY
          );

        if (!visitorToken) {
          if (!messages.children.length) {
            addMessage(
              "assistant",
              CONFIG.initialMessage
            );
          }

          historyLoaded = true;
          return;
        }

        const historyUrl =
          new URL(CONFIG.apiUrl);

        historyUrl.searchParams.set(
          "visitorToken",
          visitorToken
        );

        const response =
          await fetch(historyUrl.toString(), {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            cache: "no-store",
          });

        let data = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (
          !response.ok ||
          !Array.isArray(data?.messages)
        ) {
          throw new Error(
            data?.error ||
              `Erro HTTP ${response.status}`
          );
        }

        clearMessages();

        if (data.messages.length > 0) {
          data.messages.forEach((item) => {
            if (
              item?.role === "user" ||
              item?.role === "assistant"
            ) {
              addMessage(
                item.role,
                String(item.content || "")
              );
            }
          });
        } else {
          addMessage(
            "assistant",
            CONFIG.initialMessage
          );
        }

        historyLoaded = true;
      } catch (error) {
        console.error(
          "[Waldemática IA] Erro ao carregar histórico:",
          error
        );

        if (!messages.children.length) {
          addMessage(
            "assistant",
            CONFIG.initialMessage
          );
        }
      } finally {
        historyLoading = false;
      }
    }

    function scrollToBottom() {
      window.requestAnimationFrame(() => {
        messages.scrollTop =
          messages.scrollHeight;
      });
    }

    function addMessage(
      role,
      content
    ) {
      const row =
        createElement(
          "div",
          "wm-ai-message-row"
        );

      row.dataset.role = role;

      const bubble =
        createElement(
          "div",
          "wm-ai-bubble"
        );

      if (role === "assistant") {
        bubble.innerHTML =
          renderMarkdown(content);
      } else {
        bubble.textContent = content;
      }

      row.appendChild(bubble);
      messages.appendChild(row);

      scrollToBottom();

      return row;
    }

    function addThinking() {
      const row =
        createElement(
          "div",
          "wm-ai-message-row"
        );

      row.dataset.role = "assistant";
      row.dataset.thinking = "true";

      const bubble =
        createElement(
          "div",
          "wm-ai-bubble"
        );

      const dots =
        createElement(
          "div",
          "wm-ai-thinking",
          {
            "aria-label":
              "Agente pensando",
          }
        );

      for (let index = 0; index < 3; index += 1) {
        dots.appendChild(
          createElement(
            "span",
            "wm-ai-thinking-dot"
          )
        );
      }

      bubble.appendChild(dots);
      row.appendChild(bubble);
      messages.appendChild(row);
      scrollToBottom();

      return row;
    }

    function setOpen(nextOpen) {
      isOpen = nextOpen;

      panel.classList.toggle(
        "wm-ai-open",
        isOpen
      );

      launcher.setAttribute(
        "aria-expanded",
        String(isOpen)
      );

      launcher.setAttribute(
        "aria-label",
        isOpen
          ? "Fechar Agente IA Waldemática"
          : "Abrir Agente IA Waldemática"
      );

      launcherIcon.textContent =
        isOpen ? "×" : "✦";

      launcherLabel.textContent =
        isOpen
          ? "Fechar"
          : CONFIG.buttonLabel;

      if (window.matchMedia(
        "(max-width: 640px)"
      ).matches) {
        document.body.classList.toggle(
          "wm-ai-lock-scroll",
          isOpen
        );
      }

      if (isOpen) {
        loadHistory();

        window.setTimeout(() => {
          textarea.focus();
          scrollToBottom();
        }, 120);
      }
    }

    function autoResizeTextarea() {
      textarea.style.height = "auto";

      textarea.style.height =
        `${Math.min(
          textarea.scrollHeight,
          110
        )}px`;
    }

    function syncSendButton() {
      sendButton.disabled =
        isLoading ||
        !textarea.value.trim();
    }

    async function sendMessage(
      message
    ) {
      if (isLoading) {
        return;
      }

      const trimmed =
        message.trim();

      if (!trimmed) {
        return;
      }

      addMessage(
        "user",
        trimmed
      );

      textarea.value = "";
      autoResizeTextarea();

      isLoading = true;
      syncSendButton();

      textarea.placeholder =
        "Você pode continuar digitando...";

      const thinkingRow =
        addThinking();

      window.setTimeout(() => {
        textarea.focus();
      }, 0);

      try {
        const visitorToken =
          window.localStorage.getItem(
            VISITOR_TOKEN_KEY
          );

        const response =
          await fetch(CONFIG.apiUrl, {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              message: trimmed,
              visitorToken:
                visitorToken ||
                undefined,
              pageContext:
                getPageContext(),
            }),
          });

        let data = null;

        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (
          !response.ok ||
          !data?.reply
        ) {
          throw new Error(
            data?.error ||
              `Erro HTTP ${response.status}`
          );
        }

        if (data.visitorToken) {
          window.localStorage.setItem(
            VISITOR_TOKEN_KEY,
            data.visitorToken
          );
        }

        thinkingRow.remove();

        addMessage(
          "assistant",
          data.reply
        );
      } catch (error) {
        console.error(
          "[Waldemática IA] Erro no chat:",
          error
        );

        thinkingRow.remove();

        addMessage(
          "assistant",
          "Não consegui responder agora. Tente novamente em alguns instantes."
        );
      } finally {
        isLoading = false;

        textarea.placeholder =
          "Digite sua mensagem...";

        syncSendButton();

        window.setTimeout(() => {
          textarea.focus();
        }, 80);
      }
    }

    launcher.addEventListener(
      "click",
      () => {
        setOpen(!isOpen);
      }
    );

    closeButton.addEventListener(
      "click",
      () => {
        setOpen(false);
      }
    );

    textarea.addEventListener(
      "input",
      () => {
        autoResizeTextarea();
        syncSendButton();
      }
    );

    textarea.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          if (!isLoading) {
            form.requestSubmit();
          }
        }
      }
    );

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        sendMessage(
          textarea.value
        );
      }
    );

    window.addEventListener(
      "resize",
      () => {
        if (
          !window.matchMedia(
            "(max-width: 640px)"
          ).matches
        ) {
          document.body.classList.remove(
            "wm-ai-lock-scroll"
          );
        } else if (isOpen) {
          document.body.classList.add(
            "wm-ai-lock-scroll"
          );
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          isOpen
        ) {
          setOpen(false);
          launcher.focus();
        }
      }
    );

    const existingVisitorToken =
      window.localStorage.getItem(
        VISITOR_TOKEN_KEY
      );

    if (existingVisitorToken) {
      loadHistory();
    } else {
      addMessage(
        "assistant",
        CONFIG.initialMessage
      );
      historyLoaded = true;
    }
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      buildWidget,
      { once: true }
    );
  } else {
    buildWidget();
  }
})();
