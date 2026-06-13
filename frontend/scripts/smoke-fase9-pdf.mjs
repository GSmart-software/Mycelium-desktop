// Smoke test de exportación a PDF desde la UI (HU-10). Requiere backend+frontend
// (Chromium ya descargado en el backend).
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
const checks = {};

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Crear una nota con contenido para exportar
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  await page.click(".cm-content");
  await page.keyboard.insertText("# Documento PDF\n\nParrafo con **negrita** y `codigo`.\n");
  await page.waitForTimeout(500);

  // Exportar como PDF (A4) desde el menú "..." del pane
  await page.click("button[aria-label='Opciones del pane']");
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.click("text=Exportar como PDF (A4)"),
  ]);
  checks.pdfDescarga = dl.suggestedFilename().endsWith(".pdf");

  const stream = await dl.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  checks.pdfValido = buf.subarray(0, 5).toString("ascii") === "%PDF-";
  checks.pdfTamano = buf.length > 1000;

  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
