// Smoke test de temas y preferencias (HU-12/13/14/34). Requiere backend+frontend.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};
const html = () => page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  dark: document.documentElement.getAttribute("data-dark"),
  editorSize: getComputedStyle(document.documentElement)
    .getPropertyValue("--mic-editor-font-size").trim(),
  customCss: document.getElementById("mic-custom-css")?.textContent ?? "",
}));

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Abrir settings
  await page.click("button[aria-label='Configuración']");
  await page.waitForSelector("aside[aria-label='Configuración']", { timeout: 5000 });
  checks.drawerAbre = true;

  // ── HU-12: tema + modo oscuro ───────────────────────────────────
  await page.click("[role=tab]:text-is('Apariencia')");
  await page.click("button:has-text('Cantarela')");
  await page.waitForTimeout(150);
  checks.temaCantarela = (await html()).theme === "cantarela"; // CA1/CA6

  await page.click("button[aria-pressed]:has-text('Claro')");
  await page.waitForTimeout(150);
  checks.darkOn = (await html()).dark === "true"; // CA7

  // ── HU-14: tipografía ───────────────────────────────────────────
  await page.click("[role=tab]:text-is('Tipografía')");
  const slider = page.locator("#editorSize");
  await slider.fill("22");
  await page.waitForTimeout(150);
  checks.editorSize = (await html()).editorSize === "22px"; // CA2/CA5

  // ── HU-13/15: snippets de CSS (gestor estilo Obsidian) ──────────
  await page.click("[role=tab]:text-is('CSS')");
  checks.cssSnippetsUi =
    (await page.locator("button:has-text('Importar .css')").count()) === 1;

  // ── HU-34: perfil ───────────────────────────────────────────────
  await page.click("[role=tab]:text-is('Cuenta')");
  const nombre = page.locator("#acc-nombre");
  await nombre.fill("Dev Renombrado");
  await page.click("button:has-text('Guardar perfil')");
  await page.waitForSelector("text=Perfil actualizado.", { timeout: 5000 });
  checks.perfilGuardado = true;

  // Validación: contraseña corta deshabilita el botón
  await page.fill("#acc-actual", "micelio123");
  await page.fill("#acc-nueva", "corta");
  checks.pwdValidacion = await page
    .locator("button:has-text('Cambiar contraseña')")
    .isDisabled();

  // ── Persistencia: recargar y verificar tema+dark desde backend ──
  await page.waitForTimeout(600); // debounce de guardado de preferencias
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const after = await html();
  checks.persisteTema = after.theme === "cantarela";
  checks.persisteDark = after.dark === "true";

  await page.click("button[aria-label='Configuración']");
  await page.waitForSelector("aside[aria-label='Configuración']", { timeout: 5000 });
  await page.screenshot({ path: "scripts/smoke-fase8.png" });
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-fase8-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
