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
`;
