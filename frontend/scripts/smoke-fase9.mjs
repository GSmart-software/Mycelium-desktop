// Smoke test de import/export (HU-07/08/09). Requiere backend+frontend.
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mic-import-"));
const fileA = join(dir, "Importada A.md");
const fileB = join(dir, "Importada B.md");
const fileConf = join(dir, "Hongos.md"); // colisiona con la nota seed
writeFileSync(fileA, "# Importada A\n\nContenido de prueba A.");
writeFileSync(fileB, "# Importada B\n\nContenido de prueba B.");
writeFileSync(fileConf, "# Hongos duplicado\n\nDeberia renombrarse.");

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // ── HU-08: exportar nota como .md (menú contextual) ─────────────
  await page.click("text=Hongos", { button: "right" });
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("text=Exportar como .md"),
  ]);
  checks.exportMd = dl.suggestedFilename() === "Hongos.md";

  // ── HU-07: importar .md (input del explorer) ────────────────────
  const mdInput = page.locator('input[accept=".md,text/markdown"]');
  await mdInput.setInputFiles([fileA, fileB]);
  await page.waitForSelector("text=Importación completada", { timeout: 10000 });
  checks.importSummary = (await page.locator("text=2 nota(s) importada(s)").count()) === 1;
  await page.click("button:text-is('Listo')");
  await page.waitForSelector("text=Importada A", { timeout: 5000 });
  checks.notasEnArbol =
    (await page.locator("text=Importada A").count()) >= 1 &&
    (await page.locator("text=Importada B").count()) >= 1;

  // ── HU-07 CA4: conflicto de nombre → Renombrar ──────────────────
  await mdInput.setInputFiles([fileConf]);
  await page.waitForSelector("text=Conflicto de nombre", { timeout: 10000 });
  checks.conflictoModal = true;
  await page.click("button:text-is('Renombrar')");
  await page.waitForSelector("text=Importación completada", { timeout: 10000 });
  checks.conflictoResuelto = (await page.locator("text=1 nota(s) importada(s)").count()) === 1;
  await page.click("button:text-is('Listo')");

  // ── HU-09: exportar vault como ZIP ──────────────────────────────
  await page.click("button[aria-label='Configuración']");
  await page.click("[role=tab]:text-is('Vault')");
  const [zip] = await Promise.all([
    page.waitForEvent("download"),
    page.click("button:has-text('Exportar vault como ZIP')"),
  ]);
  checks.exportZip = /^vault-.*\.zip$/.test(zip.suggestedFilename());

  await page.screenshot({ path: "scripts/smoke-fase9.png" });
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-fase9-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors: consoleErrors.slice(0, 5) }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
