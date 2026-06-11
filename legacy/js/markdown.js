/* Mycelium — renderizador de Markdown con soporte de wikilinks [[...]] */
(function () {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ESC[c]);
  }

  function inline(text, resolver) {
    let out = escapeHtml(text);

    // proteger código en línea antes de aplicar el resto de reglas
    const codes = [];
    out = out.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });

    // imágenes ![alt](src)
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');

    // wikilinks [[destino|alias]] o [[destino#sección|alias]]
    out = out.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, _section, alias) => {
      const t = target.trim();
      const exists = resolver ? resolver(t) !== null : true;
      const cls = exists ? "wikilink" : "wikilink unresolved";
      const label = alias ? alias.trim() : t;
      return `<a class="${cls}" data-wikilink="${t}" href="#">${label}</a>`;
    });

    // enlaces [texto](url)
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a class="external" href="$2" target="_blank" rel="noopener">$1</a>');

    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/(^|[\s(>])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/(^|[\s(>])_([^_\n]+)_/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");

    // etiquetas #tag
    out = out.replace(/(^|\s)#([\p{L}\d_/-]+)/gu, '$1<span class="tag">#$2</span>');

    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
    return out;
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
  }

  function buildList(items, idx, resolver) {
    const base = items[idx].indent;
    const ordered = items[idx].ordered;
    let html = ordered ? "<ol>" : "<ul>";
    let i = idx;
    while (i < items.length && items[i].indent >= base) {
      if (items[i].indent > base) {
        const sub = buildList(items, i, resolver);
        html = html.replace(/<\/li>$/, sub.html + "</li>");
        i = sub.next;
        continue;
      }
      const task = items[i].text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === "x";
        html += `<li class="task${done ? " done" : ""}"><input type="checkbox" disabled${done ? " checked" : ""}> ${inline(task[2], resolver)}</li>`;
      } else {
        html += `<li>${inline(items[i].text, resolver)}</li>`;
      }
      i++;
    }
    html += ordered ? "</ol>" : "</ul>";
    return { html, next: i };
  }

  function parseBlocks(lines, resolver) {
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      // bloque de código cercado
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html += `<pre><code class="lang-${fence[1]}">${escapeHtml(buf.join("\n"))}</code></pre>`;
        continue;
      }

      // encabezados
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const n = h[1].length;
        html += `<h${n}>${inline(h[2], resolver)}</h${n}>`;
        i++;
        continue;
      }

      // regla horizontal
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += "<hr>"; i++; continue; }

      // cita
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        html += `<blockquote>${parseBlocks(buf, resolver)}</blockquote>`;
        continue;
      }

      // tabla
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const head = splitRow(line).map((c) => `<th>${inline(c, resolver)}</th>`).join("");
        i += 2;
        let rows = "";
        while (i < lines.length && lines[i].includes("|")) {
          rows += "<tr>" + splitRow(lines[i]).map((c) => `<td>${inline(c, resolver)}</td>`).join("") + "</tr>";
          i++;
        }
        html += `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
        continue;
      }

      // listas
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (!m) break;
          items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        }
        html += buildList(items, 0, resolver).html;
        continue;
      }

      // párrafo
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      html += `<p>${inline(buf.join("\n"), resolver).replace(/\n/g, "<br>")}</p>`;
    }
    return html;
  }

  function render(md, resolver) {
    return parseBlocks(String(md || "").split(/\r?\n/), resolver);
  }

  // extrae los destinos de los wikilinks (ignorando código) para construir el grafo
  function extractWikiLinks(md) {
    const cleaned = String(md || "").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    const out = [];
    const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(cleaned))) out.push(m[1].trim());
    return out;
  }

  window.MD = { render, extractWikiLinks, escapeHtml };
})();
