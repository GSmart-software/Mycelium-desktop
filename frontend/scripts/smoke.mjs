// Smoke test del workspace: login con el usuario seed y captura del shell.
// Requiere backend en :5279 y frontend en :3000 ya corriendo.
// Uso: node scripts/smoke.mjs
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");

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

  // Settings drawer desde el avatar (HU-38 CA6)
  await page.click("button[aria-label='Abrir configuración']");
  await page.waitForSelector("text=Cerrar sesión");
  checks.settingsDrawer = await page.isVisible("text=dev@micelio.local");
  await page.keyboard.press("Escape");

  await page.screenshot({ path: "scripts/smoke-workspace.png", fullPage: false });

  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} finally {
  await browser.close();
}
