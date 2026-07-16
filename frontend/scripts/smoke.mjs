// Smoke test del workspace: abre el vault local y captura del shell.
// Requiere el frontend en :3000 ya corriendo (con la capa de datos disponible).
// Uso: node scripts/smoke.mjs
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });

  // Workspace: esperar el estado vacío del editor
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  const checks = {
    topbar: await page.isVisible("header"),
    railExplorador: await page.isVisible("button[aria-label=Explorador]"),
    panelIzquierdo: await page.isVisible("text=El explorador de notas"),
    botonCompartir: await page.isVisible("text=Compartir"),
  };

  // Toggle del panel izquierdo: clic en ícono activo lo colapsa (HU-28 CA8)
  await page.click("button[aria-label=Explorador]");
  await page.waitForTimeout(300);
  checks.panelColapsadoTrasToggle = !(await page.isVisible("text=El explorador de notas"));
  await page.click("button[aria-label=Explorador]");

  // Settings drawer desde el rail (HU-28 CA4)
  await page.click("button[aria-label='Configuración']");
  await page.waitForSelector("text=Configuración");
  checks.settingsDrawer = await page.isVisible("text=Apariencia");
  await page.keyboard.press("Escape");

  await page.screenshot({ path: "scripts/smoke-workspace.png", fullPage: false });

  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} finally {
  await browser.close();
}
