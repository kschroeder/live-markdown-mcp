import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type Renderer from "markdown-it/lib/renderer.mjs";
import markdownItAnchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItTexmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import type { DiffHunk } from "@markdown-mcp/shared";
import { annotateSourceForMd } from "./diff-annotate";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.min.css";

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        }</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(markdownItAnchor, { level: [1, 2, 3, 4] });
md.use(markdownItFootnote);
md.use(markdownItTaskLists, { enabled: true, label: true });
md.use(markdownItTexmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: { throwOnError: false },
});

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens: Token[], idx: number, options: MarkdownIt.Options, env: unknown, self: Renderer) =>
    self.renderToken(tokens, idx, options));

md.renderer.rules.fence = (
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: unknown,
  self: Renderer
) => {
  const token = tokens[idx]!;
  if (token.info.trim() === "mermaid") {
    const code = token.content.replace(/\n$/, "");
    // data-src holds source; never put raw mermaid through a second sanitize pass that strips SVG later
    return `<div class="mermaid-wrap" data-mermaid="1"><pre class="mermaid-source" hidden>${md.utils.escapeHtml(code)}</pre><div class="mermaid" data-pending="1"></div></div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  const raw = md.render(source || "");
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["target", "rel", "class", "style", "data-mermaid", "data-pending", "hidden"],
  });
}

export function renderMarkdownWithDiffs(
  source: string,
  hunks: DiffHunk[],
  showChanges: boolean
): string {
  if (!showChanges || !hunks.length) {
    return renderMarkdown(source);
  }

  const annotated = annotateSourceForMd(source, hunks);
  return renderMarkdown(annotated);
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
let mermaidId = 0;

async function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Avoid hard crashes bubbling as uncaught transform errors
        suppressErrorRendering: false,
        theme:
          typeof document !== "undefined" &&
          document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : "default",
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

/**
 * Render each mermaid block with a unique id. Failures become a readable code
 * fallback so content after the diagram still shows.
 */
export async function runMermaid(root: HTMLElement): Promise<void> {
  const wraps = root.querySelectorAll<HTMLElement>(".mermaid-wrap[data-mermaid]");
  if (!wraps.length) {
    // Legacy bare .mermaid nodes
    const legacy = root.querySelectorAll<HTMLElement>(".mermaid[data-pending], .mermaid:not([data-processed])");
    if (!legacy.length) return;
  }

  let mermaid;
  try {
    mermaid = await getMermaid();
  } catch (err) {
    console.warn("mermaid load failed", err);
    return;
  }

  const theme =
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
  });

  const targets =
    wraps.length > 0
      ? [...wraps]
      : [...root.querySelectorAll<HTMLElement>(".mermaid")].map((el) => {
          const wrap = document.createElement("div");
          wrap.className = "mermaid-wrap";
          el.replaceWith(wrap);
          const pre = document.createElement("pre");
          pre.className = "mermaid-source";
          pre.hidden = true;
          pre.textContent = el.textContent ?? "";
          const host = document.createElement("div");
          host.className = "mermaid";
          wrap.append(pre, host);
          return wrap;
        });

  for (const wrap of targets) {
    if (wrap.dataset.done === "1") continue;
    const sourceEl = wrap.querySelector(".mermaid-source");
    const host = wrap.querySelector<HTMLElement>(".mermaid") ?? wrap;
    const code = (sourceEl?.textContent ?? host.textContent ?? "").trim();
    if (!code) {
      wrap.dataset.done = "1";
      continue;
    }

    const id = `mmd-${Date.now()}-${++mermaidId}`;
    try {
      const { svg } = await mermaid.render(id, code);
      host.innerHTML = svg;
      host.removeAttribute("data-pending");
      host.setAttribute("data-processed", "1");
      wrap.dataset.done = "1";
    } catch (err) {
      console.warn("mermaid render failed", err);
      host.removeAttribute("data-pending");
      host.innerHTML = `<pre class="mermaid-error"><code>${escapeHtml(code)}</code></pre><p class="mermaid-error-msg">Diagram failed to render — source shown above.</p>`;
      wrap.dataset.done = "1";
      // Remove any orphaned error SVG mermaid may have injected into body
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  }
}
