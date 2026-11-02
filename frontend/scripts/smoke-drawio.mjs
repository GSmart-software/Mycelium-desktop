// Smoke test del editor de draw.io embebido (`FUN-L-20`, `DEF-168`).
//
// Levanta **dos orígenes**, como en la app: uno para la página anfitriona (el
// papel de Mycelium) y otro para draw.io, servido como lo sirve Rust
// (`src-tauri/src/drawio_origen.rs`): su CSP de `src-tauri/drawio/csp.json`, la
// guarda de `src-tauri/drawio/guarda.js` al principio de cada HTML y los hashes
// de los scripts en línea. Comprueba:
//
// - que el modo embebido arranque y el puente `postMessage` vaya y venga
//   (`init`, `load`, `autosave`, `save` con el XML, `export` a SVG) con el
//   origen de destino fijado y validando origen y ventana (CA2, CA3);
// - que el renderizador de los embeds (sin cromado) devuelva el SVG;
// - que desde el iframe NO se alcance la app: `parent.document` falla, no hay
//   `__TAURI_INTERNALS__`, no puede navegar la ventana, y su CSP no le deja
//   pedir nada a otro origen (el IPC de Tauri incluido);
// - que draw.io abierto como página principal no arranque (la guarda);
// - que no salga nada a la red ni falte nada del recorte (CA4, CA7), y que
//   ocultar el iframe no lo recargue y mudarlo sí (`lib/drawioInstancias.ts`).
//
// No necesita `next build` ni `next dev`: sirve `public/drawio` directamente.
//
//   node scripts/smoke-drawio.mjs
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";
import { responderDrawio } from "./lib-drawio-origen.mjs";

// Los parámetros y las reglas salen de `lib/drawio.ts`, no de una copia a mano.
const rutaTs = fileURLToPath(new URL("../lib/drawio.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const drawio = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

const FRONTEND = resolve(import.meta.dirname, "..");
const RAIZ = join(FRONTEND, "public", "drawio");
const PUERTO_APP = 3199;
const PUERTO_DRAWIO = 3198;

if (!existsSync(join(RAIZ, "index.html"))) {
  console.error("FALLO: falta public/drawio/index.html.\nCorré antes:  npm run preparar-drawio");
  process.exit(1);
}

// ── draw.io, servido como lo sirve Rust (`lib-drawio-origen.mjs`) ─────────────

const origenApp = `http://localhost:${PUERTO_APP}`;
const origenDrawio = `http://127.0.0.1:${PUERTO_DRAWIO}`;
const baseDrawio = `${origenDrawio}/`;

const servidorDrawio = createServer(async (req, res) => {
  const r = await responderDrawio(RAIZ, new URL(req.url, "http://x").pathname, [origenApp]);
  res.writeHead(r.estado, r.cabeceras);
  res.end(r.cuerpo);
});

// La anfitriona: una página vacía con un `__TAURI_INTERNALS__` de mentira, para
// comprobar que el iframe no lo alcanza.
const servidorApp = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><title>Mycelium</title><body>" +
      "<script>window.__TAURI_INTERNALS__ = { invoke() { window.__invocado = true; } };</script>",
  );
});

await new Promise((ok) => servidorDrawio.listen(PUERTO_DRAWIO, "127.0.0.1", ok));
await new Promise((ok) => servidorApp.listen(PUERTO_APP, "localhost", ok));

const XML_DE_PRUEBA =
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="nodo1" value="Mycelium" style="rounded=1" vertex="1" parent="1">' +
  '<mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell>' +
  "</root></mxGraphModel>";

const checks = {};
const externas = [];
const erroresConsola = [];
const faltantes = [];
const violaciones = [];

const browser = await chromium.launch();
const contexto = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await contexto.exposeFunction("__violacionCsp", (v) => violaciones.push(v));
await contexto.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__violacionCsp?.(`${location.origin} ${e.effectiveDirective} ${e.blockedURI}`);
  });
});
const page = await contexto.newPage();

page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith(origenApp) && !u.startsWith(origenDrawio) && !/^(data|blob):/.test(u)) {
    externas.push(u);
  }
});
page.on("console", (m) => m.type() === "error" && erroresConsola.push(m.text()));
page.on("response", (r) => {
  if (r.status() === 404) faltantes.push(r.url());
});

/** El marco cuya URL empieza con `prefijo` (Playwright entra a marcos de otro origen). */
const marcoCon = (prefijo) => page.frames().find((f) => f.url().startsWith(prefijo));

try {
  await page.goto(`${origenApp}/`, { waitUntil: "domcontentloaded" });

  // Lo que hacen `lib/drawioInstancias.ts` y `lib/drawioRender.ts`, reducido.
  await page.evaluate(
    ({ urlEditor, urlRender, origen, destino, sandboxEditor, sandboxRender, allow, fuenteEsMensaje }) => {
      const esMensajeDeDrawio = new Function(`return (${fuenteEsMensaje})`)();
      const crear = (src, sandbox, estilo) => {
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", sandbox);
        if (allow) f.setAttribute("allow", allow);
        f.style.cssText = estilo;
        f.src = src;
        document.body.appendChild(f);
        return f;
      };
      const editor = crear(urlEditor, sandboxEditor, "position:fixed;inset:0;width:100%;height:100%;border:0");
      const render = crear(urlRender, sandboxRender, "position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden");
      const ajenos = [];
      window.__puente = { editor, render, eventos: { editor: [], render: [] }, ajenos };
      window.__esperar = (cual, nombre, ms = 60000) =>
        new Promise((ok, mal) => {
          const marco = window.__puente[cual];
          const t = setTimeout(
            () => mal(new Error(`timeout esperando '${nombre}' en ${cual}; vistos: ${window.__puente.eventos[cual].join(",")}`)),
            ms,
          );
          const h = (ev) => {
            if (!esMensajeDeDrawio(ev, marco.contentWindow, origen)) {
              if (ev.source === marco.contentWindow) ajenos.push(ev.origin);
              return;
            }
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (!window.__puente.eventos[cual].includes(msg.event)) window.__puente.eventos[cual].push(msg.event);
            if (msg.event === nombre) {
              clearTimeout(t);
              window.removeEventListener("message", h);
              ok(msg);
            }
          };
          window.addEventListener("message", h);
        });
      window.__enviar = (cual, accion) =>
        window.__puente[cual].contentWindow.postMessage(JSON.stringify(accion), destino);
      window.__inits = { editor: window.__esperar("editor", "init"), render: window.__esperar("render", "init") };
    },
    {
      urlEditor: drawio.urlDelEditor("claro", "es", baseDrawio),
      urlRender: drawio.urlDelRenderizador(baseDrawio),
      origen: origenDrawio,
      destino: drawio.destinoDeMensajes(origenDrawio),
      sandboxEditor: drawio.SANDBOX_EDITOR,
      sandboxRender: drawio.SANDBOX_RENDERIZADOR,
      allow: drawio.ALLOW_EDITOR,
      fuenteEsMensaje: drawio.esMensajeDeDrawio.toString(),
    },
  );

  const resultado = await page.evaluate(async (xmlInicial) => {
    const init = await window.__inits.editor;
    const cargado = window.__esperar("editor", "load");
    window.__enviar("editor", { action: "load", xml: xmlInicial, autosave: 1 });
    const load = await cargado;
    const autoguardado = window.__esperar("editor", "autosave", 30000).catch(() => null);
    window.__enviar("editor", { action: "invokeAction", actionName: "selectAll" });
    window.__enviar("editor", { action: "invokeAction", actionName: "duplicate" });
    const autosave = await autoguardado;
    const guardado = window.__esperar("editor", "save");
    window.__enviar("editor", { action: "invokeAction", actionName: "save" });
    const save = await guardado;
    const exportado = window.__esperar("editor", "export");
    window.__enviar("editor", { action: "export", format: "xmlsvg" });
    const exp = await exportado;

    // El renderizador de los embeds: `load` → `export` → SVG.
    await window.__inits.render;
    const renderCargado = window.__esperar("render", "load");
    window.__enviar("render", { action: "load", xml: xmlInicial, autosave: 1 });
    await renderCargado;
    const renderExportado = window.__esperar("render", "export");
    window.__enviar("render", { action: "export", format: "xmlsvg" });
    const svgRender = await renderExportado;

    // Desde la app tampoco se entra al iframe.
    let appLeeIframe = true;
    try { void window.__puente.editor.contentWindow.document.body; } catch { appLeeIframe = false; }

    return {
      init: init.event === "init",
      loadOk: load.event === "load",
      autosaveXml: autosave?.xml ?? "",
      xmlGuardado: save.xml ?? "",
      exportEsSvg: (exp.data ?? "").startsWith("data:image/svg+xml") && exp.data.length > 1000,
      renderEsSvg: (svgRender.data ?? "").startsWith("data:image/svg+xml") && svgRender.data.length > 1000,
      appLeeIframe,
      ajenos: window.__puente.ajenos.length,
    };
  }, XML_DE_PRUEBA);

  const editor = marcoCon(`${origenDrawio}/index.html?`);
  if (!editor) throw new Error("no aparece el marco del editor");

  // Bibliotecas de formas y plantillas, mirando adentro del marco (otro origen).
  const adentro = await editor.evaluate(async () => {
    let plantillas = -1;
    try {
      const txt = await (await fetch("templates/index.xml")).text();
      plantillas = (txt.match(/<template /g) ?? []).length;
    } catch {}
    return {
      formas: document.querySelectorAll(".geSidebarContainer .geItem").length,
      secciones: document.querySelectorAll(".geSidebarContainer .geTitle").length,
      stencils: typeof window.mxStencilRegistry === "object" && window.mxStencilRegistry !== null,
      plantillas,
    };
  });

  // Aislamiento: lo que el código de draw.io NO puede hacer.
  const aislamiento = await editor.evaluate(async ({ origenApp }) => {
    const r = {};
    try { void window.parent.document.title; r.parentDocument = "accesible"; } catch { r.parentDocument = "bloqueado"; }
    try { r.parentTauri = typeof window.parent.__TAURI_INTERNALS__ === "undefined" ? "no existe" : "accesible"; }
    catch { r.parentTauri = "bloqueado"; }
    try { r.parentTauriTop = typeof window.top.__TAURI_INTERNALS__ === "undefined" ? "no existe" : "accesible"; }
    catch { r.parentTauriTop = "bloqueado"; }
    r.tauriPropio = typeof window.__TAURI_INTERNALS__ === "undefined" && typeof window.__TAURI__ === "undefined";
    try { window.top.location.href = `${origenApp}/robado`; r.navegarTop = "sin error"; } catch { r.navegarTop = "bloqueado"; }
    // El IPC de Tauri (y cualquier otro origen): la CSP de draw.io lo corta.
    for (const [clave, url] of [["ipc", "http://ipc.localhost/plugin%3Asql%7Cselect"], ["app", `${origenApp}/`]]) {
      try { await fetch(url, { method: "POST", body: "{}" }); r[clave] = "llegó"; } catch { r[clave] = "bloqueado"; }
    }
    return r;
  }, { origenApp });
  await page.waitForTimeout(800);
  const urlTrasNavegar = page.url();
  const invocado = await page.evaluate(() => window.__invocado === true);

  // Ocultar no recarga; mudar de padre sí.
  await editor.evaluate(() => { window.__micVivo = true; });
  await page.evaluate(() => {
    const f = window.__puente.editor;
    f.style.display = "none";
    f.style.left = "40px";
    f.style.width = "640px";
    void f.offsetHeight;
    f.style.display = "block";
  });
  await page.waitForTimeout(600);
  const sobreviveAOcultar = await marcoCon(`${origenDrawio}/index.html?`)
    .evaluate(() => window.__micVivo === true).catch(() => false);
  await page.evaluate(() => {
    const otro = document.createElement("div");
    document.body.appendChild(otro);
    otro.appendChild(window.__puente.editor);
  });
  await page.waitForTimeout(1500);
  const sobreviveAMudarse = await marcoCon(`${origenDrawio}/index.html?`)
    .evaluate(() => window.__micVivo === true).catch(() => false);

  await page.screenshot({ path: "scripts/smoke-drawio.png" });

  // La guarda: draw.io abierto como página principal no arranca.
  const suelta = await contexto.newPage();
  await suelta.goto(drawio.urlDelEditor("claro", "es", baseDrawio), { waitUntil: "load" });
  await suelta.waitForTimeout(2500);
  const arrancoSuelto = await suelta.evaluate(
    () => typeof window.mxClient !== "undefined" || typeof window.EditorUi !== "undefined" ||
      document.querySelector(".geDiagramContainer") !== null,
  );
  await suelta.close();

  checks.initRecibido = resultado.init;
  checks.loadAceptado = resultado.loadOk;
  checks.autosaveLlegaSolo = /<mxGraphModel|<mxfile/.test(resultado.autosaveXml);
  checks.saveDevuelveXml = /<mxGraphModel|<mxfile/.test(resultado.xmlGuardado);
  checks.saveConservaElNodo = /Mycelium/.test(resultado.xmlGuardado);
  checks.exportDevuelveSvg = resultado.exportEsSvg;
  checks.renderizadorDevuelveSvg = resultado.renderEsSvg;
  checks.sinMensajesDeOtroOrigen = resultado.ajenos === 0;
  checks.bibliotecasDeFormas = adentro.formas >= 40;
  checks.seccionesDeFormas = adentro.secciones >= 100;
  checks.motorDeStencils = adentro.stencils;
  checks.plantillas = adentro.plantillas > 20;
  checks.laAppNoLeeElIframe = resultado.appLeeIframe === false;
  checks.iframeNoLeeParentDocument = aislamiento.parentDocument === "bloqueado";
  checks.iframeNoAlcanzaTauri = aislamiento.parentTauri === "bloqueado" && aislamiento.parentTauriTop === "bloqueado";
  checks.iframeSinTauriPropio = aislamiento.tauriPropio;
  checks.iframeNoNavegaLaVentana = aislamiento.navegarTop === "bloqueado" && urlTrasNavegar === `${origenApp}/`;
  checks.iframeNoLlegaAlIpc = aislamiento.ipc === "bloqueado" && aislamiento.app === "bloqueado";
  checks.nadieInvocoNada = invocado === false;
  checks.drawioSueltoNoArranca = arrancoSuelto === false;
  checks.ocultarNoRecarga = sobreviveAOcultar === true;
  checks.mudarloSiRecarga = sobreviveAMudarse === false;
  checks.sinPeticionesExternas = externas.length === 0;
  checks.nadaFaltante = faltantes.length === 0;
  // Las únicas violaciones de CSP admitidas son las que provoca el propio
  // smoke (el fetch al IPC y a la app desde el iframe).
  const inesperadas = violaciones.filter((v) => !/connect-src (http:\/\/ipc\.localhost|http:\/\/localhost:3199)/.test(v));
  checks.sinViolacionesDeCsp = inesperadas.length === 0;

  const todoBien = Object.values(checks).every(Boolean);
  console.log(
    JSON.stringify(
      {
        checks,
        medidas: adentro,
        aislamiento,
        peticionesExternas: externas.slice(0, 10),
        faltantes: faltantes.slice(0, 10),
        violaciones: inesperadas.slice(0, 10),
        erroresConsola: erroresConsola.slice(0, 5),
        muestraXmlGuardado: resultado.xmlGuardado.slice(0, 160),
      },
      null,
      2,
    ),
  );
  if (!todoBien) process.exitCode = 1;
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-drawio-error.png" }).catch(() => {});
  console.error("FALLO:", error.message);
  console.error("peticiones externas:", externas.slice(0, 10));
  console.error("violaciones:", violaciones.slice(0, 10));
  console.error("errores de consola:", erroresConsola.slice(0, 10));
  process.exitCode = 1;
} finally {
  await browser.close();
  servidorDrawio.close();
  servidorApp.close();
}
