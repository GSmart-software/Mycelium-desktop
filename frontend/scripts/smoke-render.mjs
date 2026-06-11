// Smoke test de sintaxis extendida (HU-03) y Mermaid (HU-18).
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};

const MD = [
  "# Render",
  "",
  "| Col A | Col B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  "const x = 42;",
  "```",
  "",
  "Inline $f(x)=x^2$ y bloque:",
  "",
  "$$\\int_0^1 x\\,dx$$",
  "",
  "> [!WARNING]",
  "> Cuidado con las esporas.",
  "",
  "- [ ] pendiente",
  "- [x] hecho",
  "",
  "Nota al pie[^1].",
  "",
  "[^1]: El pie.",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
  "```mermaid",
  "esto no es mermaid valido {{{",
  "```",
].join("\n");

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  await page.click(".cm-content");
  // insertText evita la auto-continuación de markdown (Enter tras "> " o "- ")
  await page.keyboard.insertText(MD);
  await page.waitForTimeout(300);

  // Modo lectura → render completo
  await page.keyboard.press("Control+3");
  await page.waitForSelector(".mic-preview", { timeout: 5000 });

  checks.tabla = (await page.locator(".mic-preview table").count()) === 1;
  checks.highlightJs = (await page.locator(".mic-preview .hljs-keyword").count()) > 0;
  checks.katexInline = (await page.locator(".mic-preview .katex").count()) >= 2;
  checks.calloutWarning =
    (await page.locator(".mic-preview .mic-callout-warning").count()) === 1;
  checks.calloutTitulo =
    (await page.locator(".mic-preview .mic-callout-title:text('Advertencia')").count()) === 1;
  checks.checkboxes =
    (await page.locator(".mic-preview input[type=checkbox]").count()) === 2;
  checks.footnote = (await page.locator(".mic-preview .footnotes").count()) === 1;

  // Mermaid: un diagrama SVG válido + un error inline sin romper la nota
  await page.waitForSelector(".mic-preview .mic-mermaid svg", { timeout: 15000 });
  checks.mermaidSvg = true;
  await page.waitForSelector(".mic-preview .mic-mermaid-error", { timeout: 5000 });
  checks.mermaidErrorInline = true;
  checks.notaNoRota = (await page.locator(".mic-preview h1").count()) === 1;

  await page.screenshot({ path: "scripts/smoke-render.png", fullPage: false });
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-render-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
