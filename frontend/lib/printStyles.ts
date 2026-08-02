/**
 * CSS autocontenido para el PDF (HU-10). Incluye los tokens de los dos temas y
 * el modo oscuro + un subconjunto de estilos del preview con reglas de salto de
 * página (CA5). KaTeX y highlight.js se cargan por CDN desde el backend.
 */
export const PRINT_CSS = `
[data-theme='bioluminiscencia'] {
  --mic-raw-base: #085041; --mic-raw-base-deep: #04342C; --mic-raw-accent: #0F6E56;
  --mic-raw-glow: #5DCAA5; --mic-raw-mist: #E1F5EE; --mic-raw-canvas: #F1EFE8;
  --mic-raw-ink: #2C2C2A; --mic-raw-ink-muted: #5F5E5A; --mic-amber-icon: #C9821E;
}
[data-theme='cantarela'] {
  --mic-raw-base: #633806; --mic-raw-base-deep: #412402; --mic-raw-accent: #854F0B;
  --mic-raw-glow: #EF9F27; --mic-raw-mist: #FAEEDA; --mic-raw-canvas: #FAF6EE;
  --mic-raw-ink: #2C2C2A; --mic-raw-ink-muted: #5F5E5A; --mic-amber-icon: #C9821E;
}
[data-theme='bioluminiscencia'][data-dark='true'] {
  --mic-raw-base: #04090e; --mic-raw-base-deep: #0b1d27; --mic-raw-accent: #19e6ff;
  --mic-raw-glow: #3dffc4; --mic-raw-canvas: #071219; --mic-raw-mist: #0a1a24;
  --mic-raw-ink: #c6e7e1; --mic-raw-ink-muted: #6e9a99;
}
[data-theme='cantarela'][data-dark='true'] {
  --mic-raw-base: #130d02; --mic-raw-base-deep: #2c200a; --mic-raw-accent: #c77f2e;
  --mic-raw-glow: #ffc247; --mic-raw-canvas: #1b1305; --mic-raw-mist: #241a08;
  --mic-raw-ink: #f6e8c8; --mic-raw-ink-muted: #ac9468;
}
:root {
  --mic-bg-canvas: var(--mic-raw-canvas); --mic-bg-surface: var(--mic-raw-mist);
  --mic-bg-code: var(--mic-raw-base-deep); --mic-text-primary: var(--mic-raw-ink);
  --mic-text-muted: var(--mic-raw-ink-muted); --mic-accent: var(--mic-raw-accent);
  --mic-glow: var(--mic-raw-glow);
}
html, body { margin: 0; padding: 0; background: var(--mic-bg-canvas); color: var(--mic-text-primary); }
.mic-preview {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 16px; line-height: 1.7; color: var(--mic-text-primary);
  background: var(--mic-bg-canvas); padding: 8px;
}
.mic-preview h1, .mic-preview h2, .mic-preview h3,
.mic-preview h4, .mic-preview h5, .mic-preview h6 {
  font-weight: 700; line-height: 1.25; margin: 1.2em 0 0.4em; page-break-after: avoid;
}
.mic-preview h1 { font-size: 1.9em; } .mic-preview h2 { font-size: 1.5em; }
.mic-preview h3 { font-size: 1.25em; } .mic-preview h4 { font-size: 1.1em; }
.mic-preview p { margin: 0.6em 0; }
.mic-preview a { color: var(--mic-accent); }
.mic-preview img, .mic-preview svg { max-width: 100%; height: auto; }
.mic-preview ul, .mic-preview ol { padding-left: 1.4em; margin: 0.5em 0; }
.mic-preview blockquote {
  margin: 0.8em 0; padding: 0.3em 1em; border-left: 4px solid var(--mic-glow);
  color: var(--mic-text-muted); page-break-inside: avoid;
}
.mic-preview pre {
  background: var(--mic-bg-code); border-radius: 8px; padding: 0.8em 1em;
  overflow: auto; page-break-inside: avoid;
}
.mic-preview code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 0.88em; }
.mic-preview :not(pre) > code {
  background: color-mix(in srgb, var(--mic-glow) 15%, transparent);
  padding: 0.1em 0.35em; border-radius: 4px;
}
.mic-preview table {
  border-collapse: collapse; width: 100%; margin: 0.8em 0; page-break-inside: avoid;
}
.mic-preview th, .mic-preview td {
  border: 1px solid color-mix(in srgb, var(--mic-raw-ink) 25%, transparent);
  padding: 0.4em 0.6em; text-align: left;
}
.mic-preview th { background: var(--mic-bg-surface); }
.mic-preview hr { border: none; border-top: 1px solid color-mix(in srgb, var(--mic-raw-ink) 20%, transparent); margin: 1.2em 0; }
.mic-preview .mic-callout {
  border-left: 4px solid var(--mic-glow); background: var(--mic-bg-surface);
  border-radius: 6px; padding: 0.6em 0.9em; margin: 0.8em 0; page-break-inside: avoid;
}
.mic-preview .mic-excalidraw-block, .mic-preview .mermaid { page-break-inside: avoid; text-align: center; }
.mic-preview .mic-wikilink { color: var(--mic-accent); text-decoration: none; }
.mic-preview .mic-tag { color: var(--mic-glow); }
/* Tarjeta de propiedades del frontmatter (FUN-M-04): antes el bloque salía como
   línea horizontal + título fantasma; ahora se imprime como tabla de metadatos. */
.mic-preview .mic-props {
  margin: 0 0 1.2em; padding: 0.5em 0.8em; border-radius: 6px;
  background: var(--mic-bg-surface); font-size: 0.9em; page-break-inside: avoid;
}
.mic-preview .mic-prop { display: flex; gap: 0.8em; padding: 0.15em 0; }
.mic-preview .mic-prop-clave { flex: 0 0 30%; color: var(--mic-text-muted); font-weight: 600; }
.mic-preview .mic-prop-icono { display: inline-block; width: 1.2em; opacity: 0.7; }
.mic-preview .mic-prop-pill, .mic-preview .mic-props .mic-tag-pill {
  display: inline-block; padding: 0.05em 0.45em; border-radius: 999px;
  background: color-mix(in srgb, var(--mic-glow) 15%, transparent); color: var(--mic-glow);
}
.mic-preview .mic-props-aviso { color: var(--mic-text-muted); font-style: italic; margin: 0 0 0.4em; }
`;

/** Opciones de exportación a PDF (DEF-024). */
export type PdfPrintOpts = {
  /** Fondo blanco + texto negro (por defecto). Si es false, usa el fondo/tema de Mycelium. */
  fondoBlanco: boolean;
  /** Conservar los colores de acento de Mycelium en el texto/enlaces/etiquetas. */
  colores: boolean;
  /** Renderizar los callouts como cajas; si no, como cita simple. */
  callouts: boolean;
  /** Aplicar la tipografía/estilos de Mycelium; si no, documento plano y sobrio. */
  estilosMycelium: boolean;
};

/** Opciones por defecto: PDF profesional (blanco, texto negro, sin acentos). */
export const PDF_OPTS_DEFAULT: PdfPrintOpts = {
  fondoBlanco: true,
  colores: false,
  callouts: true,
  estilosMycelium: true,
};

/** CSS mínimo y sobrio (cuando NO se aplican los estilos de Mycelium). */
const PRINT_CSS_MINIMO = `
html, body { margin: 0; padding: 0; background: #ffffff; color: #141414; }
.mic-preview {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 12pt; line-height: 1.5; color: #141414; background: #ffffff;
}
.mic-preview h1, .mic-preview h2, .mic-preview h3,
.mic-preview h4, .mic-preview h5, .mic-preview h6 {
  font-weight: 700; line-height: 1.25; margin: 1.1em 0 0.4em; page-break-after: avoid;
}
.mic-preview h1 { font-size: 1.7em; } .mic-preview h2 { font-size: 1.4em; }
.mic-preview h3 { font-size: 1.2em; }
.mic-preview p { margin: 0.6em 0; }
.mic-preview a { color: #141414; text-decoration: underline; }
.mic-preview img, .mic-preview svg { max-width: 100%; height: auto; }
.mic-preview ul, .mic-preview ol { padding-left: 1.4em; margin: 0.5em 0; }
.mic-preview blockquote { margin: 0.8em 0; padding: 0.3em 1em; border-left: 3px solid #bbb; color: #333; page-break-inside: avoid; }
.mic-preview pre { background: #f4f4f4; border-radius: 4px; padding: 0.8em 1em; overflow: auto; page-break-inside: avoid; }
.mic-preview code { font-family: Consolas, monospace; font-size: 0.9em; }
.mic-preview :not(pre) > code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
.mic-preview table { border-collapse: collapse; width: 100%; margin: 0.8em 0; page-break-inside: avoid; }
.mic-preview th, .mic-preview td { border: 1px solid #999; padding: 0.4em 0.6em; text-align: left; }
.mic-preview th { background: #f2f2f2; }
.mic-preview hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
.mic-preview .mic-callout { border-left: 3px solid #bbb; background: #f7f7f7; border-radius: 4px; padding: 0.6em 0.9em; margin: 0.8em 0; page-break-inside: avoid; }
.mic-preview .mic-excalidraw-block, .mic-preview .mermaid { page-break-inside: avoid; text-align: center; }
.mic-preview .mic-props { margin: 0 0 1.1em; padding: 0.5em 0.8em; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; page-break-inside: avoid; }
.mic-preview .mic-prop { display: flex; gap: 0.8em; padding: 0.15em 0; }
.mic-preview .mic-prop-clave { flex: 0 0 30%; color: #555; font-weight: 600; }
.mic-preview .mic-prop-icono { display: inline-block; width: 1.2em; opacity: 0.7; }
.mic-preview .mic-props-aviso { color: #555; font-style: italic; margin: 0 0 0.4em; }
`;

/**
 * CSS de impresión según las opciones (DEF-024). Compone una base (Mycelium o
 * mínima) + capas para fondo blanco/texto negro, quitar colores de acento y
 * aplanar callouts. El `padding` da los márgenes del documento (el `@page` va con
 * `margin: 0` para que el navegador NO dibuje su encabezado/pie de fecha/título).
 */
export function buildPrintCss(o: PdfPrintOpts): string {
  const partes: string[] = [o.estilosMycelium ? PRINT_CSS : PRINT_CSS_MINIMO];
  // Los márgenes los da `@page { margin }` (márgenes por página); no se añade
  // padding al contenido (ver nota en `export.ts` sobre el encabezado del navegador).

  if (o.fondoBlanco) {
    partes.push(`
      html, body, .mic-preview { background: #ffffff !important; color: #141414 !important; }
      .mic-preview h1, .mic-preview h2, .mic-preview h3,
      .mic-preview h4, .mic-preview h5, .mic-preview h6 { color: #141414 !important; }
      .mic-preview th { background: #f2f2f2 !important; }
      .mic-preview pre { background: #f4f4f4 !important; color: #141414 !important; }
      .mic-preview :not(pre) > code { background: #f0f0f0 !important; color: #141414 !important; }
      .mic-preview blockquote { color: #333 !important; }
    `);
  }

  if (!o.colores) {
    const texto = o.fondoBlanco ? "#141414" : "var(--mic-text-primary)";
    partes.push(`
      .mic-preview, .mic-preview * { color: ${texto} !important; }
      .mic-preview a, .mic-preview .mic-wikilink { text-decoration: underline; }
      .mic-preview blockquote, .mic-preview .mic-callout { border-left-color: #999 !important; }
    `);
  }

  if (!o.callouts) {
    partes.push(`
      .mic-preview .mic-callout {
        border-left: 3px solid #ccc !important; background: transparent !important;
        border-radius: 0 !important; padding: 0.3em 1em !important;
      }
    `);
  }

  return partes.join("\n");
}
