// Smoke test de búsqueda global (HU-21) y conexiones/grafo (HU-30).
// Requiere backend y frontend corriendo, y las notas seed Hongos/Esporas/Lluvia
// (creadas por backend/test-search.ps1).
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // ── HU-21: panel de búsqueda desde el rail ──────────────────────
  await page.click("button[aria-label='Búsqueda global']");
  const input = page.locator("input[placeholder='Buscar en el vault…']");
  await input.waitFor({ timeout: 5000 });
  checks.panelAbre = true;
  checks.inputConFoco = await input.evaluate((el) => el === document.activeElement);

  // AND implícito: "lluvia micelio" → solo la nota Lluvia (CA6)
  await input.fill("lluvia micelio");
  await page.waitForTimeout(600);
  const resultados = page.locator("button >> span:text-is('Lluvia')");
  await resultados.first().waitFor({ timeout: 5000 });
  checks.andUnResultado =
    (await page.locator("ul li button").count()) === 1;
  checks.fragmentoResaltado =
    (await page.locator("mark.mic-search-hit").count()) > 0;

  // Clic en resultado → abre la nota y salta a la coincidencia (CA8)
  await resultados.first().click();
  await page.waitForSelector(".cm-content", { timeout: 10000 });
  await page.waitForTimeout(400);
  const seleccion = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  checks.abreNotaYSalta = seleccion.toLowerCase().includes("lluvia");

  // El panel de búsqueda sigue activo tras abrir un resultado: reusar el input.
  const input2 = page.locator("input[placeholder='Buscar en el vault…']");
  await input2.waitFor({ timeout: 5000 });

  // tag: filtro (CA5)
  await input2.fill("tag:micologia");
  await page.waitForTimeout(600);
  checks.tagFiltro =
    (await page.locator("button >> span:text-is('Hongos')").count()) === 1;

  // Sin resultados (CA + comportamiento detallado)
  await input2.fill("xyzqwnoexiste");
  await page.waitForTimeout(600);
  checks.sinResultados =
    (await page.locator("text=Sin resultados").count()) === 1;

  // Esc con campo vacío → restaura el explorer (CA9)
  await input2.fill("");
  await input2.press("Escape");
  await page.waitForTimeout(300);
  checks.escRestauraExplorer =
    (await page.locator("input[placeholder='Buscar en el vault…']").count()) === 0;

  // ── HU-30: panel derecho de conexiones ──────────────────────────
  // El explorer ya está restaurado tras Esc: abrir Esporas desde el árbol.
  await page.click("text=Esporas");
  await page.waitForSelector(".cm-content", { timeout: 10000 });

  // Abrir el panel derecho (Ctrl+Shift+\)
  await page.keyboard.press("Control+Shift+Backslash");
  await page.waitForSelector("[role=tab]:text-is('GRAFO')", { timeout: 5000 });
  checks.tabsVisibles =
    (await page.locator("[role=tab]:text-is('GRAFO')").count()) === 1 &&
    (await page.locator("[role=tab]:has-text('SALIENTES')").count()) === 1 &&
    (await page.locator("[role=tab]:has-text('RETRO')").count()) === 1;

  // SALIENTES de Esporas → Lluvia (CA6)
  await page.click("[role=tab]:has-text('SALIENTES')");
  checks.salientes =
    (await page.locator("button:text-is('Lluvia')").count()) >= 1;

  // RETRO de Esporas → Hongos con fragmento (CA7)
  await page.click("[role=tab]:has-text('RETRO')");
  checks.retro =
    (await page.locator("span:text-is('Hongos')").count()) >= 1;

  // Metadatos siempre visibles (CA9)
  checks.metadatos =
    (await page.locator("dt:text-is('Creada')").count()) === 1 &&
    (await page.locator("dt:text-is('Tamaño')").count()) === 1;

  // GRAFO renderiza canvas (CA2)
  await page.click("[role=tab]:text-is('GRAFO')");
  checks.grafoCanvas = (await page.locator("canvas").count()) >= 1;

  await page.screenshot({ path: "scripts/smoke-fase7.png" });
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-fase7-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
