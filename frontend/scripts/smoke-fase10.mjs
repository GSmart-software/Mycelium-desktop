// Smoke test de la UI de compartición (HU-35/36). Requiere backend+frontend.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
// Aceptar el prompt de "Nueva carpeta" con un nombre único
const folderName = `Compartir UI ${Date.now()}`;
page.on("dialog", (d) => d.accept(folderName));

const checks = {};

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "dev@micelio.local");
  await page.fill("#password", "micelio123");
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Crear una carpeta
  await page.click("button[title='Nueva carpeta']");
  await page.waitForSelector(`text=${folderName}`, { timeout: 8000 });
  checks.carpetaCreada = true;

  // Menú contextual → Compartir → abre ShareModal
  await page.click(`text=${folderName}`, { button: "right" });
  await page.click("[role=menuitem]:text-is('Compartir')");
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  checks.modalAbre = (await page.locator(`text=Compartir «${folderName}»`).count()) === 1;
  checks.miembrosVacio =
    (await page.locator("text=Todavía no compartiste esta carpeta.").count()) === 1;

  // Compartir con un email inexistente → error del backend
  await page.fill("input[type=email]", "noexiste@micelio.local");
  await page.click("[role=dialog] button:has-text('Compartir')");
  await page.waitForSelector("text=No existe un usuario con ese email.", { timeout: 5000 });
  checks.errorEmailInexistente = true;

  // Cerrar modal
  await page.click("[role=dialog] button[aria-label='Cerrar']");
  await page.waitForTimeout(200);

  // Crear una nota dentro de la carpeta activa y abrirla → topbar Compartir activo
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 10000 });
  const shareBtn = page.locator("button:has(span:text-is('Compartir'))");
  await shareBtn.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.querySelector("span")?.textContent === "Compartir",
      );
      return b && !b.disabled;
    },
    { timeout: 8000 },
  );
  checks.topbarShareHabilitado = await shareBtn.isEnabled();
  await shareBtn.click();
  await page.waitForSelector("[role=dialog]", { timeout: 5000 });
  checks.topbarAbreModal = (await page.locator("[role=dialog]").count()) === 1;

  await page.screenshot({ path: "scripts/smoke-fase10.png" });
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-fase10-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
