// Smoke test del explorer (HU-22/23/24): crear, duplicar, eliminar,
// papelera y recuperación. Requiere backend :5279 y frontend :3000.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

// Acepta prompts (nombre de carpeta) y confirms (eliminaciones)
page.on("dialog", (dialog) => {
  if (dialog.type() === "prompt") void dialog.accept("Pruebas");
  else void dialog.accept();
});

const checks = {};

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Crear nota → aparece en el árbol y se abre (?note= en URL)
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector("text=Sin título", { timeout: 10000 });
  await page.waitForURL(/note=/, { timeout: 10000 });
  checks.crearNota = true;
  checks.urlConNota = page.url().includes("note=");

  // El área central y el topbar muestran el título (HU-20 / HU-38)
  checks.editorMuestraTitulo =
    (await page.locator("section >> text=Sin título").count()) > 0;

  // Duplicar via menú contextual → "Sin título 2"
  await page.click("aside span:text-is('Sin título')", { button: "right" });
  await page.click("button:text-is('Duplicar')");
  await page.waitForSelector("aside span:text-is('Sin título 2')", { timeout: 10000 });
  checks.duplicarConSufijo = true;

  // Crear carpeta (prompt → "Pruebas")
  await page.click("button[title='Nueva carpeta']");
  await page.waitForSelector("aside span:text-is('Pruebas')", { timeout: 10000 });
  checks.crearCarpeta = true;

  // Eliminar "Sin título 2" → papelera
  await page.click("aside span:text-is('Sin título 2')", { button: "right" });
  await page.click("button:text-is('Eliminar')");
  await page.waitForSelector("aside span:text-is('Sin título 2')", {
    state: "detached",
    timeout: 10000,
  });
  checks.eliminarNota = true;

  // Papelera: la nota aparece con días restantes, recuperar la restaura
  await page.click("button[aria-label=Papelera]");
  await page.waitForSelector("text=30 días restantes", { timeout: 10000 });
  checks.papeleraConDias = true;
  await page.click("button:text-is('Recuperar')");
  await page.waitForSelector("text=La papelera está vacía", { timeout: 10000 });
  checks.recuperar = true;

  // Volver al explorador: la nota recuperada está de nuevo
  await page.click("button[aria-label=Explorador]");
  await page.waitForSelector("aside span:text-is('Sin título 2')", { timeout: 10000 });
  checks.notaRestaurada = true;

  await page.screenshot({ path: "scripts/smoke-explorer.png" });
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-explorer-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
