// Smoke test de búsqueda en la nota (HU-31). Requiere backend y frontend corriendo.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

const checks = {};

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  await page.click(".cm-content");
  await page.keyboard.type("agua y micelio. el agua conecta. más agua aquí.");

  // Ctrl+F abre la barra con foco (CA1/CA2)
  await page.keyboard.press("Control+f");
  await page.waitForSelector("input[placeholder='Buscar en la nota…']", { timeout: 5000 });
  checks.ctrlFAbre = true;

  // Buscar "agua" → resaltados + contador (CA3, CA6, case-insensitive CA7)
  await page.keyboard.type("AGUA");
  await page.waitForSelector(".cm-searchMatch", { timeout: 5000 });
  checks.resaltados = (await page.locator(".cm-searchMatch").count()) === 3;
  checks.contador = (await page.locator("text=de 3").count()) > 0;

  // Reemplazo (CA8)
  await page.click("button[title='Reemplazar']");
  await page.fill("input[placeholder='Reemplazar por…']", "lluvia");
  await page.click("button:text-is('Reemplazar todos')");
  await page.waitForTimeout(300);
  const text = await page.evaluate(
    () => document.querySelector(".cm-content")?.textContent ?? "",
  );
  checks.reemplazoTotal = !text.includes("agua") && text.includes("lluvia");

  // Esc cierra y limpia resaltados (CA9)
  await page.click("input[placeholder='Buscar en la nota…']");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  checks.escCierra =
    (await page.locator("input[placeholder='Buscar en la nota…']").count()) === 0;
  checks.resaltadosLimpios = (await page.locator(".cm-searchMatch").count()) === 0;

  // Entry point del topbar (CA1a, HU-38)
  await page.click("button[title='Buscar en la nota activa (Ctrl+F)']");
  checks.topbarAbre =
    (await page.locator("input[placeholder='Buscar en la nota…']").count()) === 1;

  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} catch (error) {
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
