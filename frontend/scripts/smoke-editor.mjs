// Smoke test del editor (HU-01/02/04/19). Requiere backend :5279 y frontend :3000.
import { chromium } from "playwright";

const consoleErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("dialog", (d) => void d.accept("Pruebas"));

const checks = {};

try {
  // Sin login en desktop: el workspace abre directo el vault local.
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Abrí una nota desde el explorador", { timeout: 20000 });

  // Crear nota → editor CodeMirror visible
  await page.click("button[title='Nueva nota']");
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  checks.editorVisible = true;

  // Escribir markdown
  await page.click(".cm-content");
  await page.keyboard.type("# Hola mundo");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Texto con **negrita** y un [[Destino]] y #etiqueta final");

  // Live preview: el heading (línea inactiva) oculta el # y aplica clase h1
  await page.waitForSelector(".mic-live-h1", { timeout: 5000 });
  const h1Text = await page.locator(".mic-live-h1").innerText();
  checks.h1SinMarcador = !h1Text.includes("#");

  // Cursor en la línea del heading → el # se revela (CA1/CA2)
  await page.click(".mic-live-h1");
  await page.waitForTimeout(200);
  const h1Activo = await page.locator(".mic-live-h1").innerText();
  checks.h1ConMarcadorActivo = h1Activo.includes("#");

  // Wikilink y tag decorados
  checks.wikilinkDecorado = (await page.locator(".mic-wikilink-cm").count()) > 0;
  checks.tagDecorado = (await page.locator(".mic-tag-cm").count()) > 0;

  // Toolbar: negrita sin selección inserta **** con cursor en el medio
  await page.click("button[aria-label='Negrita (Ctrl+B)']");
  await page.keyboard.type("fuerte");
  const docText = await page.evaluate(
    () => document.querySelector(".cm-content")?.textContent ?? "",
  );
  checks.toolbarNegrita = docText.includes("**fuerte**");

  // Modo split → preview con <h1>
  await page.click("button[title^='Dividido']");
  await page.waitForSelector(".mic-preview h1", { timeout: 5000 });
  checks.splitPreviewH1 = (
    await page.locator(".mic-preview h1").innerText()
  ).includes("Hola mundo");
  checks.splitNegrita = (await page.locator(".mic-preview strong").count()) > 0;
  checks.splitTagPill = (await page.locator(".mic-preview .mic-tag-pill").count()) > 0;

  // Modo read → editor oculto, preview centrado
  await page.click("button[title^='Lectura']");
  await page.waitForTimeout(200);
  checks.readEditorOculto = !(await page.locator(".cm-content").isVisible());

  // Modo raw → editor de vuelta (cursor preservado)
  await page.click("button[title^='Raw']");
  await page.waitForTimeout(200);
  checks.rawEditorVisible = await page.locator(".cm-content").isVisible();

  // Autoguardado: el dot pasa a "Sincronizado" en <= 15 s (HU-04)
  await page.waitForSelector("span[title='Sincronizado']", { timeout: 20000 });
  checks.syncVerde = true;

  // Recarga: contenido restaurado (IndexedDB/backend) y modo raw persistido
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".cm-content", { timeout: 20000 });
  const restored = await page.evaluate(
    () => document.querySelector(".cm-content")?.textContent ?? "",
  );
  checks.contenidoPersistido = restored.includes("Hola mundo");
  checks.modoPersistido =
    (await page
      .locator("button[title^='Raw']")
      .getAttribute("aria-pressed")) === "true";

  await page.screenshot({ path: "scripts/smoke-editor.png" });
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-editor-error.png" });
  console.error("FALLO:", error.message);
  console.log(JSON.stringify({ checks, consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
