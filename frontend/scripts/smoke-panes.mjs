// Smoke test de pestañas y panes (HU-25/26/27). Requiere backend y frontend.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("dialog", (d) => void d.accept());

const checks = {};

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Dos notas → dos pestañas en el mismo pane (CA1/CA2)
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  await page.click(".cm-content");
  await page.keyboard.type("nota A");
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector("aside span:text-is('Sin título 2')", { timeout: 15000 });
  await page.waitForTimeout(400);
  checks.dosTabs = (await page.locator("[role=tab]").count()) === 2;

  // Cambiar de pestaña actualiza la URL (HU-20)
  await page.click("[role=tab]:has-text('Sin título'):not(:has-text('2'))");
  await page.waitForTimeout(300);
  checks.urlCambia = page.url().includes("note=");

  // Cerrar pestaña con × (CA4)
  await page.click("[role=tab]:has-text('Sin título 2') button");
  await page.waitForTimeout(300);
  checks.cerrarTab = (await page.locator("[role=tab]").count()) === 1;

  // Ctrl+Shift+T reabre la última cerrada (CA7)
  await page.keyboard.press("Control+Shift+T");
  await page.waitForTimeout(400);
  checks.reabrirTab = (await page.locator("[role=tab]").count()) === 2;

  // Split: arrastrar pestaña al borde derecho (CA9 / HU-26 CA1)
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.dispatchEvent("[role=tab]:has-text('Sin título 2')", "dragstart", { dataTransfer });
  await page.waitForSelector("[data-edge='right']", { timeout: 5000 });
  await page.dispatchEvent("[data-edge='right']", "dragover", { dataTransfer });
  await page.dispatchEvent("[data-edge='right']", "drop", { dataTransfer });
  await page.waitForTimeout(500);
  checks.splitCreado = (await page.locator("[role=tablist]").count()) === 2;

  // Misma nota en dos panes → espejo en tiempo real (CA detallado / HU-26 CA6)
  // El pane nuevo (derecha) está activo; activar pane izquierdo y abrir la misma nota
  await page.click("[role=tablist] >> nth=0");
  await page.click("aside span:text-is('Sin título 2')");
  await page.waitForTimeout(500);
  const editors = page.locator(".cm-content");
  checks.dosEditores = (await editors.count()) === 2;
  await editors.first().click();
  await page.keyboard.type("espejo ");
  await page.waitForTimeout(400);
  const textRight = await editors.nth(1).textContent();
  checks.espejoEnVivo = (textRight ?? "").includes("espejo");

  // HU-27: vincular pane derecho como preview del izquierdo
  await page.click("[role=tablist] >> nth=1 >> button[aria-label='Opciones del pane']");
  await page.click("button:has-text('Vincular como preview')");
  await page.waitForSelector("text=Preview vinculado", { timeout: 5000 });
  checks.badgeVinculado = true;
  checks.previewVinculadoRender =
    (await page.locator(".mic-preview").count()) >= 1;

  // Desvincular y cerrar todo → estado vacío (CA5)
  await page.click("[role=tablist] >> nth=1 >> button[aria-label='Opciones del pane']");
  await page.click("button:has-text('Desvincular preview')");
  await page.waitForTimeout(300);

  await page.screenshot({ path: "scripts/smoke-panes.png" });
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-panes-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
