import type { ReactNode } from "react";

type Chunk = { kind: "text" | "bold" | "link"; text: string; href?: string };

// Reconhece apenas negrito e links HTTP(S); jamais executa HTML da resposta da IA.
function tokens(source: string): Chunk[] {
  const result: Chunk[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>]+)/g;
  let lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) result.push({ kind: "text", text: source.slice(lastIndex, start) });
    if (match[1]) {
      result.push({ kind: "bold", text: match[1] });
    } else if (match[2] && match[3]) {
      result.push({ kind: "link", text: match[2], href: match[3] });
    } else if (match[4]) {
      const clean = match[4].replace(/[.,;!?]+$/, "");
      result.push({ kind: "link", text: clean, href: clean });
      if (clean.length < match[4].length) {
        result.push({ kind: "text", text: match[4].slice(clean.length) });
      }
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < source.length) result.push({ kind: "text", text: source.slice(lastIndex) });
  return result;
}

function renderLine(line: string): ReactNode[] {
  return tokens(line).map((item, index) => {
    if (item.kind === "bold") return <strong key={index} className="font-semibold text-white">{item.text}</strong>;
    if (item.kind === "link") return (
      <a key={index} href={item.href} target="_blank" rel="noopener noreferrer"
        className="inline-block max-w-full break-all rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-semibold text-cyan-200 underline underline-offset-2 hover:bg-cyan-400/20">
        {item.text}
      </a>
    );
    return <span key={index}>{item.text}</span>;
  });
}

export function AdminMessageContent({ content }: { content: string }) {
  return (
    <div className="break-words text-sm leading-relaxed">
      {content.split(/\r?\n/).map((line, index) => (
        <div key={index} className={line.trim() ? "min-h-[1.3em]" : "h-3"}>{renderLine(line)}</div>
      ))}
    </div>
  );
}
