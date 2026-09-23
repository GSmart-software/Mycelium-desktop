// Smoke test del editor de draw.io embebido (`FUN-L-20`).
//
// Comprueba lo que la spec (`docs/features/drawio.md`) pone como condición para
// seguir: que la webapp **empaquetada** se sirva desde el mismo origen que la
// app, que el modo embebido arranque, que el puente `postMessage` vaya y venga,
// y que guardar devuelva el XML (CA2, CA3, CA4, CA7).
//
// No necesita `next dev`: sirve el export estático (`out/`) con un servidor
// mínimo, así que basta con haber corrido `npx next build` antes.
//
//   node scripts/smoke-drawio.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const RAIZ = resolve(import.meta.dirname, "..", "out");
const PUERTO = 3199;

if (!existsSync(join(RAIZ, "drawio", "index.html"))) {
  console.error(
    "FALLO: falta out/drawio/index.html.\n" +
      "Corré antes:  npm run preparar-drawio  &&  npx next build",
  );
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/** Servidor estático mínimo sobre `out/`. */
const servidor = createServer((req, res) => {
  const pedido = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let ruta = join(RAIZ, normalize(pedido).replace(/^(\.\.[/\\])+/, ""));
  if (!ruta.startsWith(RAIZ)) {
    res.writeHead(403).end("no");
    return;
  }
  if (existsSync(ruta) && statSync(ruta).isDirectory()) ruta = join(ruta, "index.html");
  if (!existsSync(ruta)) {
    res.writeHead(404).end("no existe");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(ruta).toLowerCase()] ?? "application/octet-stream",
  });
  createReadStream(ruta).pipe(res);
});

await new Promise((ok) => servidor.listen(PUERTO, "127.0.0.1", ok));
const base = `http://127.0.0.1:${PUERTO}`;

const XML_DE_PRUEBA =
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1">' +
  "<root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>" +
  '<mxCell id="nodo1" value="Mycelium" style="rounded=1" vertex="1" parent="1">' +
  '<mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell>' +
  "</root></mxGraphModel>";

const checks = {};
const externas = [];
const erroresConsola = [];
/** Lo que el recorte se llevó y la webapp todavía pide: la señal de que una
 *  quita rompió algo que ningún check mira directamente. */
const faltantes = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// CA7: nada puede salir a la red. Se anota cualquier petición fuera del origen.
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) {
    externas.push(u);
  }
});
page.on("console", (m) => m.type() === "error" && erroresConsola.push(m.text()));
page.on("response", (r) => {
  if (r.status() === 404) faltantes.push(r.url().replace(base, ""));
});

try {
  // Página de prueba: un iframe al editor y el puente `postMessage` del host.
  // Es exactamente lo que hará `DrawioView`, reducido a lo mínimo.
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

  const resultado = await page.evaluate(
    async ({ xmlInicial }) => {
      const params = [
        "embed=1",
        "proto=json",
        "offline=1",
        "stealth=1",
        // Sin service worker: la app ya se sirve local, así que el SW no aporta
        // nada y sí arriesga servir una versión vieja tras actualizar el paquete.
        "pwa=0",
        "spin=1",
        "libraries=1",
        "noSaveBtn=0",
        "saveAndExit=0",
        "modified=unsavedChanges",
      ].join("&");

      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
      iframe.src = `/drawio/index.html?${params}`;
      document.body.appendChild(iframe);

      const eventos = [];
      const esperar = (nombre, ms = 60000) =>
        new Promise((ok, mal) => {
          const t = setTimeout(
            () => mal(new Error(`timeout esperando '${nombre}'; vistos: ${eventos.join(",")}`)),
            ms,
          );
          const h = (ev) => {
            if (ev.source !== iframe.contentWindow) return;
            let msg;
            try {
              msg = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (!eventos.includes(msg.event)) eventos.push(msg.event);
            if (msg.event === nombre) {
              clearTimeout(t);
              window.removeEventListener("message", h);
              ok(msg);
            }
          };
          window.addEventListener("message", h);
        });

      const enviar = (accion) =>
        iframe.contentWindow.postMessage(JSON.stringify(accion), "*");

      // 1. El editor avisa que está listo.
      const init = await esperar("init");

      // 2. Le pasamos el XML del archivo.
      const cargado = esperar("load");
      enviar({ action: "load", xml: xmlInicial, autosave: 1 });
      const load = await cargado;

      // 3. Autosave: un cambio real del modelo tiene que llegar solo. Es el
      //    mecanismo con el que Mycelium marca la pestaña como «sin guardar».
      //    `merge` no sirve para probarlo: entra con `ignoreChange`, justo para
      //    que un cambio venido del host no rebote como autosave.
      const autoguardado = esperar("autosave", 30000).catch(() => null);
      enviar({ action: "invokeAction", actionName: "selectAll" });
      enviar({ action: "invokeAction", actionName: "duplicate" });
      const autosave = await autoguardado;

      // 4. Guardar: no hay `action:'save'`; se invoca la acción del editor, que
      //    en modo embebido devuelve el XML por `postMessage`.
      const guardado = esperar("save");
      enviar({ action: "invokeAction", actionName: "save" });
      const save = await guardado;

      // 5. Exportar (la spec pide comprobar que la exportación sigue viva).
      const exportado = esperar("export");
      enviar({ action: "export", format: "xmlsvg" });
      const exp = await exportado;

      // 6. Las bibliotecas de formas y las plantillas: es lo que hay que volver
      //    a mirar después de CADA quita del recorte (spec § 3). Mismo origen,
      //    así que se puede contar lo que hay dentro del iframe.
      //    Las paletas son perezosas: se registran todas las bibliotecas (una
      //    `.geTitle` por cada una) pero solo dibujan sus formas las que están
      //    abiertas. Por eso se miran las dos cosas: cuántas bibliotecas hay y
      //    cuántas formas llegaron a dibujarse.
      const doc = iframe.contentDocument;
      const formasEnLaBarra = doc.querySelectorAll(".geSidebarContainer .geItem").length;
      const seccionesDeFormas = doc.querySelectorAll(".geSidebarContainer .geTitle").length;
      // Los stencils se cargan a demanda; que el registro exista y las formas
      // básicas estén resueltas es lo que dice que la maquinaria sigue entera.
      const w = iframe.contentWindow;
      const hayRegistroDeStencils =
        typeof w.mxStencilRegistry === "object" && w.mxStencilRegistry !== null;
      const hayFormasBasicas =
        typeof w.mxCellRenderer === "function" || typeof w.mxCellRenderer === "object";

      // Las plantillas salen de este índice: si el recorte se lo lleva, el
      // diálogo de plantillas abre vacío y no falla nada visible.
      let plantillas = 0;
      try {
        const r = await fetch("/drawio/templates/index.xml");
        const txt = await r.text();
        plantillas = (txt.match(/<template /g) ?? []).length;
      } catch {
        plantillas = -1;
      }

      return {
        init: init.event === "init",
        loadOk: load.event === "load",
        autosaveXml: autosave?.xml ?? "",
        xmlGuardado: save.xml ?? "",
        exportTieneDatos: typeof exp.data === "string" && exp.data.length > 1000,
        exportEsSvg: (exp.data ?? "").startsWith("data:image/svg+xml"),
        formasEnLaBarra,
        seccionesDeFormas,
        hayRegistroDeStencils,
        hayFormasBasicas,
        plantillas,
        eventos,
      };
    },
    { xmlInicial: XML_DE_PRUEBA },
  );

  checks.initRecibido = resultado.init;
  checks.loadAceptado = resultado.loadOk;
  checks.saveDevuelveXml = /<mxGraphModel|<mxfile/.test(resultado.xmlGuardado);
  checks.saveConservaElNodo = /Mycelium/.test(resultado.xmlGuardado);
  checks.autosaveLlegaSolo = /<mxGraphModel|<mxfile/.test(resultado.autosaveXml);
  checks.exportDevuelveSvg = resultado.exportEsSvg && resultado.exportTieneDatos;
  checks.sinPeticionesExternas = externas.length === 0;
  // Lo que hay que volver a mirar después de cada quita del recorte (spec § 3).
  checks.bibliotecasDeFormas = resultado.formasEnLaBarra >= 40;
  checks.seccionesDeFormas = resultado.seccionesDeFormas >= 100;
  checks.motorDeStencils = resultado.hayRegistroDeStencils && resultado.hayFormasBasicas;
  checks.plantillas = resultado.plantillas > 20;
  checks.nadaFaltante = faltantes.length === 0;

  await page.screenshot({ path: "scripts/smoke-drawio.png" });

  const todoBien = Object.values(checks).every(Boolean);
  console.log(
    JSON.stringify(
      {
        checks,
        medidas: {
          formasEnLaBarra: resultado.formasEnLaBarra,
          seccionesDeFormas: resultado.seccionesDeFormas,
          plantillas: resultado.plantillas,
        },
        eventos: resultado.eventos,
        peticionesExternas: externas.slice(0, 10),
        faltantes: faltantes.slice(0, 10),
        erroresConsola: erroresConsola.slice(0, 5),
        muestraXmlGuardado: resultado.xmlGuardado.slice(0, 200),
      },
      null,
      2,
    ),
  );
  if (!todoBien) process.exitCode = 1;
} catch (error) {
  await page.screenshot({ path: "scripts/smoke-drawio-error.png" });
  console.error("FALLO:", error.message);
  console.error("peticiones externas:", externas.slice(0, 10));
  console.error("errores de consola:", erroresConsola.slice(0, 10));
  process.exitCode = 1;
} finally {
  await browser.close();
  servidor.close();
}
