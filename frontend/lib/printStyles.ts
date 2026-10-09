/**
 * CSS autocontenido para el PDF (HU-10). Incluye los tokens de los cinco temas
 * (Arrecife, `FUN-M-51`, GSmart, `FUN-M-52`, y Bioluminiscencia experimental,
 * `FUN-M-53`, con los mismos raw que styles/tokens.css) y
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
[data-theme='arrecife'] {
  --mic-raw-base: #F6F8FB; --mic-raw-base-deep: #1A212C; --mic-raw-accent: #2A6D82;
  --mic-raw-glow: #7444E4; --mic-raw-mist: #FFFFFF; --mic-raw-canvas: #EEF1F6;
  --mic-raw-ink: #1A212C; --mic-raw-ink-muted: #5C6672; --mic-amber-icon: #FFB300;
}
[data-theme='arrecife'][data-dark='true'] {
  --mic-raw-base: #191D26; --mic-raw-base-deep: #0F1218; --mic-raw-accent: #3AB8D8;
  --mic-raw-glow: #9B7AEB; --mic-raw-canvas: #14171E; --mic-raw-mist: #1D222C;
  --mic-raw-ink: #F7F9FC; --mic-raw-ink-muted: #8A9095;
}
[data-theme='gsmart'] {
  --mic-raw-base: #E8ECF1; --mic-raw-base-deep: #141E3C; --mic-raw-accent: #1F6FC4;
  --mic-raw-glow: #166A5E; --mic-raw-mist: #FFFFFF; --mic-raw-canvas: #F3F5F8;
  --mic-raw-ink: #1B1F24; --mic-raw-ink-muted: #4A525B; --mic-amber-icon: #E0A63A;
}
[data-theme='gsmart'][data-dark='true'] {
  --mic-raw-base: #2E3134; --mic-raw-base-deep: #18191B; --mic-raw-accent: #3B9BE8;
  --mic-raw-glow: #A3ECE2; --mic-raw-canvas: #1E2023; --mic-raw-mist: #25282B;
  --mic-raw-ink: #ECEFF2; --mic-raw-ink-muted: #B3B9C0;
}
[data-theme='bioexp'] {
  --mic-raw-base: #DCECEE; --mic-raw-base-deep: #062A33; --mic-raw-accent: #00707F;
  --mic-raw-glow: #00704F; --mic-raw-mist: #FFFFFF; --mic-raw-canvas: #EEF6F6;
  --mic-raw-ink: #0F2529; --mic-raw-ink-muted: #475F63; --mic-amber-icon: #C9821E;
}
[data-theme='bioexp'][data-dark='true'] {
  --mic-raw-base: #04090E; --mic-raw-base-deep: #0B1D27; --mic-raw-accent: #19E6FF;
  --mic-raw-glow: #3DFFC4; --mic-raw-canvas: #071219; --mic-raw-mist: #0A1A24;
  --mic-raw-ink: #C6E7E1; --mic-raw-ink-muted: #7FA9A7;
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
 * Lo que hace falta para imprimir **encima de los estilos de la app** (`DEF-116`).
 *
 * El PDF se arma con el CSS real de la ventana —el mismo de la vista de lectura—,
 * no con la copia reducida de `PRINT_CSS`, que se había quedado atrás: sin los
 * colores de los títulos, los callouts por tipo ni las etiquetas en píldora. Así
 * el PDF se parece a lo que se ve, y no vuelve a desfasarse con el próximo
 * cambio de diseño.
 *
 * Ese CSS es el de una app de escritorio —`html, body { height: 100% }`, una
 * hoja con ancho máximo— y hay que soltarlo para que el documento fluya en
 * páginas. Más los saltos de página.
 */
const PRINT_SOBRE_APP = `
html, body { height: auto !important; max-width: none !important; overflow: visible !important; margin: 0 !important; }
.mic-preview {
  height: auto !important; overflow: visible !important;
  max-width: none !important; padding: 0 !important; margin: 0 !important;
}
.mic-preview h1, .mic-preview h2, .mic-preview h3,
.mic-preview h4, .mic-preview h5, .mic-preview h6 { break-after: avoid; page-break-after: avoid; }
.mic-preview pre, .mic-preview table, .mic-preview blockquote, .mic-preview .mic-callout,
.mic-preview .mic-props, .mic-preview .mermaid, .mic-preview .mic-excalidraw-block {
  break-inside: avoid; page-break-inside: avoid;
}
.mic-preview img, .mic-preview svg { max-width: 100%; height: auto; }
`;

/**
 * CSS de impresión según las opciones (DEF-024).
 *
 * Con `conCssDeLaApp` (desktop, `DEF-116`) el documento ya trae el CSS real de la
 * ventana y el tema en sus atributos, y esto solo agrega lo del papel más las
 * capas de las opciones. Sin él —web, que imprime en el backend— se usa la copia
 * autocontenida `PRINT_CSS`.
 *
 * El `@page` va aparte, en quien arma el documento: `margin` da los márgenes por
 * página.
 */
export function buildPrintCss(o: PdfPrintOpts, conCssDeLaApp = false): string {
  const partes: string[] = [
    // Imprimir los colores TAL CUAL (`DEF-116`). Sin esto, Chromium —el motor de
    // la ventana de Mycelium— imprime en modo ahorro: no dibuja ningún fondo y
    // oscurece los colores claros del texto. Así ninguna opción de estilo se
    // veía en el PDF: el fondo del tema, la caja de los callouts, el bloque de
    // código y los colores de acento salían en blanco y negro. Las opciones de
    // `DEF-024` dependían en silencio de que el usuario tildara «Gráficos de
    // fondo» en el diálogo de impresión.
    "html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
  ];
  const sobreApp = o.estilosMycelium && conCssDeLaApp;
  partes.push(!o.estilosMycelium ? PRINT_CSS_MINIMO : sobreApp ? PRINT_SOBRE_APP : PRINT_CSS);

  if (o.fondoBlanco) {
    if (sobreApp) {
      // El documento va con el tema CLARO (quien lo arma no pone `data-dark`):
      // el texto ya es oscuro y los estilos se leen sobre claro. Solo falta que el
      // papel sea blanco y no el crema del lienzo.
      partes.push(`html, body, .mic-preview { background: #ffffff !important; }`);
    } else {
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
  }

  if (!o.colores) {
    // Sin colores DEL TEXTO: todo en la tinta. Los bordes y fondos de los
    // callouts no son texto: los decide «Estilar callouts».
    const texto = o.fondoBlanco ? "#141414" : "var(--mic-text-primary)";
    partes.push(`
      .mic-preview, .mic-preview * { color: ${texto} !important; }
      .mic-preview a, .mic-preview .mic-wikilink { text-decoration: underline; }
      .mic-preview blockquote { border-left-color: #999 !important; }
    `);
  }

  if (!o.callouts) {
    partes.push(`
      .mic-preview .mic-callout {
        border: none !important; border-left: 3px solid #ccc !important;
        background: transparent !important; border-radius: 0 !important;
        padding: 0.3em 1em !important; box-shadow: none !important;
      }
    `);
  }

  return partes.join("\n");
}

/** Escapa un valor para un atributo HTML entre comillas dobles. */
const escaparAtributo = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * El documento completo que se imprime (`DEF-116`). Puro: recibe todo lo que
 * sale de la ventana —su CSS y los atributos de su `<html>`: el tema, la
 * atmósfera, las variables de las tipografías, las preferencias de fuente— y lo
 * arma, así se puede probar fuera de la app.
 *
 * Con «Fondo blanco» se imprime con el tema **claro** aunque la app esté en
 * oscuro: `data-dark` se descarta.
 */
export function armarDocumentoImpresion(p: {
  css: string;
  atributos: Record<string, string>;
  html: string;
  titulo: string;
  pageSize: "A4" | "Letter";
  opts: PdfPrintOpts;
}): string {
  const atributos = { ...p.atributos };
  if (p.opts.fondoBlanco) delete atributos["data-dark"];
  const attrs = Object.entries(atributos)
    .map(([k, v]) => ` ${k}="${escaparAtributo(v)}"`)
    .join("");
  return (
    `<!doctype html><html${attrs}><head><meta charset="utf-8">` +
    `<title>${escaparAtributo(p.titulo)}</title>` +
    (p.css ? `<style>${p.css}</style>` : "") +
    `<style>@page { size: ${p.pageSize}; margin: 16mm; } ${buildPrintCss(p.opts, p.css !== "")}</style></head>` +
    `<body><div class="mic-preview">${p.html}</div></body></html>`
  );
}
