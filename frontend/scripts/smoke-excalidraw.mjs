// Smoke test de Excalidraw (HU-16/17). Requiere backend y frontend corriendo.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });

  // Insertar diagrama desde la toolbar (CA1a) → abre el modal
  await page.click("button[aria-label='Insertar diagrama Excalidraw']");
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  checks.modalAbre = true;

  // La referencia quedó en el documento
  const doc = await page.evaluate(
    () => document.querySelector(".cm-content")?.textContent ?? "",
  );
  checks.referenciaInsertada = /!\[\[[0-9a-f-]+\.excalidraw\]\]/.test(doc);

  // Guardar y cerrar (CA5)
  await page.click("button:text-is('Guardar y cerrar')");
  await page.waitForSelector(".excalidraw", { state: "detached", timeout: 10000 });
  checks.guardaYCierra = true;

  // Modo lectura: placeholder del diagrama vacío renderizado inline (CA2)
  await page.keyboard.press("Control+3");
  await page.waitForSelector(".mic-excalidraw-block", { timeout: 15000 });
  checks.bloqueEnPreview = true;

  // Clic en el diagrama → reabre el editor (CA3)
  await page.click(".mic-excalidraw-block");
  await page.waitForSelector(".excalidraw", { timeout: 30000 });
  checks.clicAbreEditor = true;
  await page.click("button:text-is('Guardar y cerrar')");
  await page.waitForSelector(".excalidraw", { state: "detached", timeout: 10000 });

  // Menú contextual con exportaciones (HU-17 CA1)
  await page.waitForSelector(".mic-excalidraw-block", { timeout: 10000 });
  await page.click(".mic-excalidraw-block", { button: "right" });
  await page.waitForSelector("button:text-is('Exportar como PNG')", { timeout: 5000 });
  checks.menuExportPng = true;
  checks.menuExportSvg =
    (await page.locator("button:text-is('Exportar como SVG')").count()) === 1;
  await page.keyboard.press("Escape");

  await page.screenshot({ path: "scripts/smoke-excalidraw.png" });
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-excalidraw-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
