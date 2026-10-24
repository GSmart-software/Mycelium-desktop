// Smoke de la política de seguridad de contenido (CSP) de la app.
//
// Sirve el export estático (`out/`) con la MISMA CSP que `tauri.conf.json`, armada
// como la arma Tauri al servir cada HTML: los hashes de los `<script>` en línea de
// ese HTML se suman a `script-src` (en `style-src` no, porque está apagado con
// `dangerousDisableAssetCspModification`). Después abre la app en Chromium con un
// IPC de Tauri simulado sobre un vault de prueba, recorre las vistas que cargan
// contenido delicado —Markdown, Mermaid, KaTeX, imágenes del vault, vídeo
// embebido, Excalidraw, draw.io, lienzo, grafo— y falla si el navegador reporta
// una sola violación de la CSP (`securitypolicyviolation`, también dentro de los
// iframes del mismo origen) o un `eval` bloqueado en la consola.
//
// No lanza Tauri: el IPC es una imitación mínima (`__TAURI_INTERNALS__`) que
// responde lo justo para abrir un vault. El índice SQLite lo atiende un proceso
// de Python con `sqlite3` en memoria (Node 20 no trae `node:sqlite`). Las URLs
// del protocolo de assets (`http://asset.localhost/…`) se resuelven con
// `page.route` contra el vault de prueba.
//
// Lo que NO puede probar: el IPC real por `http://ipc.localhost` / `ipc:` (acá
// `invoke` es una función de JS) ni el visor de PDF de WebView2. Eso se confirma
// en la app.
//
//   npx next build  &&  node scripts/smoke-csp.mjs [--capturas <carpeta>] [--verboso]
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";

const FRONTEND = resolve(import.meta.dirname, "..");
const RAIZ = join(FRONTEND, "out");
const PUERTO = 3196;
const VERBOSO = process.argv.includes("--verboso");
const iCapturas = process.argv.indexOf("--capturas");
const CAPTURAS = iCapturas > 0 ? resolve(process.argv[iCapturas + 1]) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

if (!existsSync(join(RAIZ, "index.html")) || !existsSync(join(RAIZ, "drawio", "index.html"))) {
  console.error("FALLO: falta el export. Corré antes:  npm run build  (o npx next build)");
  process.exit(1);
}

// ── La CSP, como la arma Tauri ────────────────────────────────────────────────

const conf = JSON.parse(await readFile(join(FRONTEND, "src-tauri", "tauri.conf.json"), "utf8"));
const seguridad = conf.app.security;
if (seguridad.csp === null || typeof seguridad.csp !== "object") {
  console.error("FALLO: `app.security.csp` no es un mapa de directivas en tauri.conf.json.");
  process.exit(1);
}
const sinModificar = seguridad.dangerousDisableAssetCspModification ?? false;
const puedeModificar = (d) =>
  sinModificar === false || (Array.isArray(sinModificar) && !sinModificar.includes(d));

/** `tauri_utils::html2::normalize_script_for_csp`: CRLF y CR sueltos → LF. */
const normalizar = (s) => s.replace(/\r\n?/g, "\n");

/** Hashes de los `<script>` en línea no vacíos, como `inject_script_hashes`. */
function hashesEnLinea(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].length === 0) continue;
    hashes.push(`'sha256-${createHash("sha256").update(normalizar(m[1])).digest("base64")}'`);
  }
  return hashes;
}

function cspPara(html) {
  const mapa = structuredClone(seguridad.csp);
  if (puedeModificar("script-src")) {
    const hashes = hashesEnLinea(html);
    if (hashes.length > 0) {
      const actual = mapa["script-src"];
      const lista = Array.isArray(actual) ? actual : actual ? [actual] : [];
      if (!lista.includes("'self'")) lista.push("'self'");
      mapa["script-src"] = [...lista, ...hashes];
    }
  }
  return Object.entries(mapa)
    .map(([d, v]) => `${d} ${Array.isArray(v) ? v.join(" ") : v}`)
    .join("; ");
}

// ── Servidor estático con la CSP ─────────────────────────────────────────────

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
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const servidor = createServer(async (req, res) => {
  const pedido = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let ruta = join(RAIZ, normalize(pedido).replace(/^(\.\.[/\\])+/, ""));
  if (!ruta.startsWith(RAIZ)) {
    res.writeHead(403).end("no");
    return;
  }
  if (existsSync(ruta) && statSync(ruta).isDirectory()) ruta = join(ruta, "index.html");
  // Las rutas del export (`/workspace`) se sirven como `workspace.html`, igual que
  // el protocolo de Tauri cuando no encuentra el archivo exacto.
  if (!existsSync(ruta) && existsSync(`${ruta}.html`)) ruta = `${ruta}.html`;
  if (!existsSync(ruta)) {
    res.writeHead(404).end("no existe");
    return;
  }
  const tipo = MIME[extname(ruta).toLowerCase()] ?? "application/octet-stream";
  if (tipo.startsWith("text/html")) {
    const html = await readFile(ruta, "utf8");
    res.writeHead(200, { "Content-Type": tipo, "Content-Security-Policy": cspPara(html) });
    res.end(html);
    return;
  }
  res.writeHead(200, { "Content-Type": tipo });
  createReadStream(ruta).pipe(res);
});
await new Promise((ok) => servidor.listen(PUERTO, "127.0.0.1", ok));
const base = `http://127.0.0.1:${PUERTO}`;

// ── El vault de prueba ───────────────────────────────────────────────────────

const VAULT = await mkdtemp(join(tmpdir(), "mycelium-csp-"));
// PNG de 1×1 (rojo).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "mycelium",
  elements: [
    {
      id: "r1", type: "rectangle", x: 40, y: 40, width: 200, height: 80, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
      frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1,
      isDeleted: false, boundElements: [{ id: "t1", type: "text" }], updated: 1,
      link: null, locked: false,
    },
    {
      id: "t1", type: "text", x: 90, y: 68, width: 100, height: 25, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
      frameId: null, roundness: null, seed: 2, version: 1, versionNonce: 2,
      isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
      text: "Hola CSP", fontSize: 20, fontFamily: 5, textAlign: "center",
      verticalAlign: "middle", containerId: "r1", originalText: "Hola CSP",
      autoResize: true, lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});
const DRAWIO =
  '<mxfile><diagram id="d" name="Página-1"><mxGraphModel><root><mxCell id="0"/>' +
  '<mxCell id="1" parent="0"/><mxCell id="2" value="Caja" style="rounded=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root>' +
  "</mxGraphModel></diagram></mxfile>";
const CANVAS = JSON.stringify({
  nodes: [
    { id: "a", type: "text", text: "Tarjeta con **Markdown**", x: 0, y: 0, width: 240, height: 80 },
    { id: "b", type: "file", file: "Nota CSP.md", x: 320, y: 0, width: 300, height: 200 },
  ],
  edges: [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }],
});
const NOTA = `# Nota CSP

Texto con **negrita**, una [[Otra nota]] y \`código\`.

$$
\\int_0^1 x^2\\,dx = \\tfrac{1}{3}
$$

En línea: $e^{i\\pi} + 1 = 0$.

\`\`\`mermaid
graph LR
  A[Siembra] --> B[Cosecha]
\`\`\`

![[foto.png]]

![[Boceto.excalidraw]]

![[Diagrama.drawio]]

![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

- [ ] tarea
`;
await writeFile(join(VAULT, "Nota CSP.md"), NOTA);
await writeFile(join(VAULT, "Otra nota.md"), "# Otra nota\n\nVuelve a [[Nota CSP]].\n");
await writeFile(join(VAULT, "foto.png"), PNG);
await writeFile(join(VAULT, "Boceto.excalidraw"), EXCALIDRAW);
await writeFile(join(VAULT, "Diagrama.drawio"), DRAWIO);
await writeFile(join(VAULT, "Tablero.canvas"), CANVAS);

// ── Puente SQLite (Python) ───────────────────────────────────────────────────

const PUENTE_PY = `
import sys, json, sqlite3
if sqlite3.sqlite_version_info < (3, 33, 0):
    sys.stderr.write("FALLO: el SQLite de este Python es %s; hace falta 3.33 o mas (MYCELIUM_PYTHON)\\n" % sqlite3.sqlite_version)
    sys.exit(2)
dbs = {}
for linea in sys.stdin:
    p = json.loads(linea)
    try:
        con = dbs.get(p["db"])
        if con is None:
            con = sqlite3.connect(":memory:", isolation_level=None)
            con.row_factory = sqlite3.Row
            dbs[p["db"]] = con
        if p["op"] == "load":
            r = p["db"]
        else:
            cur = con.execute(p["query"], p.get("values") or [])
            if p["op"] == "select":
                r = [dict(f) for f in cur.fetchall()]
            else:
                r = [cur.rowcount if cur.rowcount >= 0 else 0, cur.lastrowid or 0]
        sys.stdout.write(json.dumps({"id": p["id"], "ok": r}) + "\\n")
    except Exception as e:
        sys.stdout.write(json.dumps({"id": p["id"], "error": str(e)}) + "\\n")
    sys.stdout.flush()
`;
const rutaPy = join(VAULT, "..", `puente-sql-${process.pid}.py`);
await writeFile(rutaPy, PUENTE_PY);
// El índice usa `UPDATE … FROM` (SQLite ≥ 3.33): en Windows se pide el Python 3
// más nuevo con el lanzador `py`. `MYCELIUM_PYTHON` lo fija a mano.
const [ejecutablePy, ...argsPy] = process.env.MYCELIUM_PYTHON
  ? [process.env.MYCELIUM_PYTHON]
  : process.platform === "win32"
    ? ["py", "-3"]
    : ["python3"];
const python = spawn(ejecutablePy, [...argsPy, "-I", "-X", "utf8", rutaPy], {
  stdio: ["pipe", "pipe", "inherit"],
});
let pythonVivo = true;
python.on("exit", (c) => {
  pythonVivo = false;
  if (c !== 0 && c !== null) console.error(`FALLO: el puente SQLite de Python salió con ${c}.`);
});
const pendientesSql = new Map();
let siguienteSql = 0;
let restoSql = "";
python.stdout.setEncoding("utf8");
python.stdout.on("data", (trozo) => {
  restoSql += trozo;
  let i;
  while ((i = restoSql.indexOf("\n")) >= 0) {
    const linea = restoSql.slice(0, i);
    restoSql = restoSql.slice(i + 1);
    const r = JSON.parse(linea);
    const p = pendientesSql.get(r.id);
    pendientesSql.delete(r.id);
    if ("error" in r) p.no(new Error(r.error));
    else p.ok(r.ok);
  }
});
function sql(op, args) {
  const id = siguienteSql++;
  if (!pythonVivo) return Promise.reject(new Error("el puente SQLite no está corriendo"));
  return new Promise((ok, no) => {
    pendientesSql.set(id, { ok, no });
    python.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
  });
}

// ── IPC simulado ─────────────────────────────────────────────────────────────

const EXT_NOTA = new Set(["md", "excalidraw", "base", "canvas", "drawio"]);
const tipoDe = (r) => {
  const ext = r.split(".").pop().toLowerCase();
  return ext === "md" ? "markdown" : ext;
};
const rutaEnVault = (rel) => {
  const abs = resolve(VAULT, rel);
  if (!abs.startsWith(VAULT)) throw new Error(`fuera del vault: ${rel}`);
  return abs;
};

async function recorrer() {
  const salida = { archivosMeta: [], otros: [], directorios: [] };
  async function ir(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      const rel = relative(VAULT, abs).split(sep).join("/");
      if (e.isDirectory()) {
        salida.directorios.push(rel);
        await ir(abs);
        continue;
      }
      const mtime = Math.floor((await stat(abs)).mtimeMs);
      const ext = e.name.split(".").pop().toLowerCase();
      if (EXT_NOTA.has(ext)) salida.archivosMeta.push({ rutaRelativa: rel, mtime, tipo: tipoDe(rel) });
      else salida.otros.push({ rutaRelativa: rel, mtime, tipo: ext });
    }
  }
  await ir(VAULT);
  return salida;
}

const desconocidos = new Set();
async function ipc(cmd, args) {
  switch (cmd) {
    case "plugin:sql|load":
      return sql("load", { db: args.db });
    case "plugin:sql|execute":
      return sql("execute", { db: args.db, query: args.query, values: args.values });
    case "plugin:sql|select":
      return sql("select", { db: args.db, query: args.query, values: args.values });
    case "get_abrir_ultimo":
      return true;
    case "listar_vaults":
      return [{ ruta: VAULT, nombre: "Vault CSP", ultimoAcceso: Date.now() }];
    case "recorrer_vault":
      return recorrer();
    case "leer_archivos":
      return Promise.all(
        args.rutas.map(async (r) => ({
          ruta_relativa: r,
          contenido: await readFile(rutaEnVault(r), "utf8"),
        })),
      );
    case "leer_archivo_texto": {
      const abs = rutaEnVault(args.rutaRel);
      return existsSync(abs) ? readFile(abs, "utf8") : null;
    }
    case "leer_archivo_visor": {
      const datos = await readFile(rutaEnVault(args.ruta));
      return { contenido: datos.toString("utf8"), bytes: datos.length, truncado: false, binario: false };
    }
    case "escribir_nota":
      await writeFile(rutaEnVault(args.rutaRel), args.contenido);
      return Date.now();
    case "leer_estado_vault":
    case "take_opened_files":
      return cmd === "take_opened_files" ? [] : null;
    case "mycignore_default":
      return ".*/\nnode_modules/\n";
    case "terminal_shells":
    case "updater_versiones":
      return [];
    case "plugin:event|listen":
      return Math.floor(Math.random() * 1e9);
    default:
      // Lo que no hace falta para abrir el vault: registrar_vault, iniciar_watcher,
      // marcar_acceso, escribir_estado_vault, el título de la ventana, eventos…
      if (!desconocidos.has(cmd)) {
        desconocidos.add(cmd);
        if (VERBOSO) console.log(`  (ipc sin simular: ${cmd})`);
      }
      return null;
  }
}

// Corre ANTES que cualquier script de la página, y fuera de la CSP (como los
// scripts de inicialización que inyecta el webview de Tauri).
const SIMULACION_TAURI = `
(() => {
  let siguiente = 1;
  const callbacks = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {},
    transformCallback(cb, once) {
      const id = siguiente++;
      callbacks.set(id, cb);
      window["_" + id] = cb;
      return id;
    },
    unregisterCallback(id) { callbacks.delete(id); delete window["_" + id]; },
    convertFileSrc(ruta, protocolo = "asset") {
      return "http://" + protocolo + ".localhost/" + encodeURIComponent(ruta);
    },
    invoke(cmd, args = {}) {
      return window.__ipcSimulado(cmd, args ?? {});
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  // Cada iframe del mismo origen (draw.io) reporta sus violaciones al de arriba.
  document.addEventListener("securitypolicyviolation", (e) => {
    const v = { directiva: e.effectiveDirective, bloqueado: e.blockedURI, muestra: e.sample,
      origen: e.sourceFile, linea: e.lineNumber, columna: e.columnNumber, documento: location.pathname };
    try { window.top.__violacionCsp(JSON.stringify(v)); } catch {}
  });
})();
`;

// ── Recorrido ────────────────────────────────────────────────────────────────

const violaciones = [];
let esperadas = 0;
const erroresConsola = [];
const navegador = await chromium.launch();
let codigo = 0;
try {
  const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } });
  await contexto.exposeFunction("__ipcSimulado", (cmd, args) => ipc(cmd, args));
  await contexto.exposeFunction("__violacionCsp", (json) => violaciones.push(JSON.parse(json)));
  await contexto.addInitScript(SIMULACION_TAURI);
  // El protocolo de assets de Tauri, contra el vault de prueba.
  await contexto.route(/^http:\/\/asset\.localhost\//, async (route) => {
    const ruta = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    try {
      const cuerpo = await readFile(ruta);
      await route.fulfill({
        status: 200,
        body: cuerpo,
        contentType: MIME[extname(ruta).toLowerCase()] ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  // Sin red en el smoke: el reproductor de YouTube se reemplaza por una página
  // vacía. Lo que se prueba es que la CSP deje montar el iframe, no YouTube.
  await contexto.route(/^https:\/\/(www\.youtube-nocookie\.com|www\.youtube\.com|player\.vimeo\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>video</title>" }),
  );

  const pagina = await contexto.newPage();
  pagina.on("console", (m) => {
    const t = m.text();
    // Las violaciones del documento ya llegan por `securitypolicyviolation`; la
    // consola se mira por las que no (las de un worker, por ejemplo). Se ignoran
    // los ecos de las esperadas (ver `descartarEsperadas`).
    if (/Skipped glyph subsetting/.test(t)) return;
    if (/Content Security Policy|unsafe-eval|Refused to/i.test(t)) erroresConsola.push(t);
    else if (VERBOSO && m.type() === "error") console.log(`  [consola] ${t.slice(0, 200)}`);
  });
  pagina.on("pageerror", (e) => {
    if (VERBOSO) console.log(`  [pageerror] ${e.message.slice(0, 200)}`);
    if (/Content Security Policy|unsafe-eval/i.test(e.message)) erroresConsola.push(e.message);
  });

  const captura = async (nombre) => {
    if (CAPTURAS) await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });
  };
  const paso = async (nombre, fn, { esperaViolaciones = false } = {}) => {
    const antes = violaciones.length;
    const antesConsola = erroresConsola.length;
    try {
      await fn();
      if (esperaViolaciones) {
        const bloqueadas = violaciones.splice(antes).length;
        erroresConsola.splice(antesConsola);
        console.log(`${bloqueadas > 0 ? "ok   " : "FALLO"} ${nombre} (${bloqueadas} bloqueos)`);
        if (bloqueadas === 0) codigo = 1;
      } else {
        await descartarEsperadas(antes);
        const nuevas = violaciones.length - antes + erroresConsola.length - antesConsola;
        console.log(`${nuevas === 0 ? "ok   " : "FALLO"} ${nombre}${nuevas ? ` (${nuevas} violaciones)` : ""}`);
      }
    } catch (e) {
      console.log(`FALLO ${nombre}: ${e.message.split("\n")[0]}`);
      codigo = 1;
    }
    await captura(nombre.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  };
  /**
   * Saca de la lista las violaciones que se esperan y no rompen nada:
   * Ya NO se espera ninguna `font-src` hacia esm.sh: Excalidraw suma esm.sh de
   *   respaldo a cada `FontFace` y Chromium evaluaba la CSP de todas las URLs al
   *   crearla (~230 violaciones al abrir un dibujo); `cargarExcalidraw()` saca ese
   *   respaldo del `src` (`lib/excalidraw.ts`). Si vuelven, es un fallo.
   * - `eval` desde una sonda de compatibilidad con `try/catch`: el polyfill
   *   `is-generator-function` (`Function("return function*() {}")`) y el
   *   `get-intrinsic` (`getEvalledConstructor`). Si falla, cae al camino sin eval.
   * - `eval` del embind de Emscripten (`createNamedFunction`, `Function("body",
   *   …)`) en el recorte de glifos de Excalidraw en el hilo principal. Excalidraw
   *   lo atrapa («Skipped glyph subsetting») e incrusta la fuente entera en el
   *   SVG: el dibujo se ve igual, el SVG pesa más. Es una degradación aceptada
   *   para no abrir `'unsafe-eval'` a toda la app.
   */
  const fuentes = new Map();
  const descartarEsperadas = async (desde) => {
    for (let i = violaciones.length - 1; i >= desde; i--) {
      const v = violaciones[i];
      let esperada = false;
      if (v.bloqueado === "eval" && v.origen?.startsWith(base) && v.linea) {
        if (!fuentes.has(v.origen)) fuentes.set(v.origen, await (await fetch(v.origen)).text());
        const linea = fuentes.get(v.origen).split("\n")[v.linea - 1] ?? "";
        const cerca = linea.slice(Math.max(0, v.columna - 300), v.columna + 300);
        esperada = /try\{return Function\("return function\*\(\) \{\}"\)\(\)\}catch/.test(cerca) ||
          /try\{return Function\('"use strict"; return \('/.test(cerca) ||
          /Function\("body",`return function \$\{/.test(cerca);
      }
      if (esperada) {
        violaciones.splice(i, 1);
        esperadas++;
      }
    }
  };
  const abrirEnExplorador = async (nombre) => {
    await pagina.getByText(nombre, { exact: true }).first().click();
  };

  await paso("arranque y apertura del vault", async () => {
    await pagina.goto(`${base}/`);
    await pagina.waitForURL(/\/workspace/, { timeout: 30000 });
    await pagina.getByText("Nota CSP.md", { exact: true }).first().waitFor({ timeout: 30000 });
  });

  await paso("nota: Markdown, KaTeX, imagen del vault, vídeo y embeds", async () => {
    await abrirEnExplorador("Nota CSP.md");
    await pagina.locator(".katex").first().waitFor({ timeout: 20000 });
    await pagina.locator("iframe[src*='youtube']").first().waitFor({ timeout: 20000 });
    await pagina.locator("img[src^='http://asset.localhost']").first().waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(4000); // embeds de Excalidraw y draw.io
  });

  await paso("vista de lectura: Mermaid", async () => {
    await pagina.getByRole("button", { name: /^Lectura/ }).first().click();
    // Mermaid marca su SVG con `aria-roledescription` (p. ej. `flowchart-v2`).
    await pagina.locator(".mic-preview svg[aria-roledescription]").first().waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(2000);
    await captura("vista-de-lectura");
    await pagina.getByRole("button", { name: /^En vivo/ }).first().click();
  });

  await paso("Excalidraw", async () => {
    await abrirEnExplorador("Boceto.excalidraw");
    await pagina.locator(".excalidraw canvas").first().waitFor({ timeout: 30000 });
    await pagina.waitForTimeout(3000);
  });

  await paso("draw.io", async () => {
    await abrirEnExplorador("Diagrama.drawio");
    const marco = pagina.frameLocator("iframe[src*='/drawio/']").first();
    await marco.locator(".geDiagramContainer").first().waitFor({ timeout: 60000 });
    await pagina.waitForTimeout(3000);
  });

  await paso("lienzo", async () => {
    await abrirEnExplorador("Tablero.canvas");
    await pagina.getByText("Markdown", { exact: true }).first().waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(1500);
  });

  await paso("grafo", async () => {
    await pagina.getByRole("button", { name: "Grafo de conexiones" }).click();
    await pagina.locator("canvas").first().waitFor({ timeout: 20000 });
    await pagina.waitForTimeout(4000);
  });

  await paso("Configuración → Licencias de terceros", async () => {
    await pagina.getByRole("button", { name: "Configuración" }).first().click();
    await pagina.getByRole("button", { name: "Licencias de terceros" }).click();
    const aviso = pagina.getByLabel("Avisos de licencia de terceros");
    await aviso.waitFor({ timeout: 20000 });
    const texto = await aviso.textContent();
    for (const esperado of ["Apache License", "SIL OPEN FONT LICENSE", "Paquetes de npm", "Crates de Rust"]) {
      if (!texto.includes(esperado)) throw new Error(`el aviso no menciona «${esperado}»`);
    }
    await captura("licencias-de-terceros");
    await pagina.keyboard.press("Escape");
  });

  // Lo que la CSP TIENE que cortar: estas violaciones se esperan (prueban el
  // bloqueo) y lo que se exige es que el código inyectado no haya corrido.
  await paso("la CSP corta handlers en línea, javascript: y la impresión", async () => {
    const corrio = await pagina.evaluate(async () => {
      const w = window;
      // 1. Un handler en línea inyectado en el documento (el vector de un nodo
      //    de enlace de un lienzo, o de HTML crudo en una nota).
      const div = document.createElement("div");
      div.innerHTML = '<img src="data:image/png;base64,AAAA" onerror="window.__xssHandler=1">';
      document.body.appendChild(div);
      // 2. Un enlace `javascript:`.
      const a = document.createElement("a");
      a.href = "javascript:window.__xssJs=1";
      document.body.appendChild(a);
      a.click();
      // 3. El iframe de impresión de `lib/export.ts`: `about:blank` + `doc.write`
      //    hereda la CSP del documento que lo crea.
      const marco = document.createElement("iframe");
      document.body.appendChild(marco);
      const doc = marco.contentDocument;
      doc.open();
      doc.write('<img src="data:image/png;base64,AAAA" onerror="top.__xssImpresion=1"><script>top.__xssImpresion2=1<\/script>');
      doc.close();
      await new Promise((r) => setTimeout(r, 1500));
      div.remove();
      a.remove();
      marco.remove();
      return [w.__xssHandler, w.__xssJs, w.__xssImpresion, w.__xssImpresion2].filter((x) => x !== undefined).length;
    });
    if (corrio > 0) throw new Error(`corrieron ${corrio} scripts inyectados`);
  }, { esperaViolaciones: true });

  if (VERBOSO && desconocidos.size > 0) console.log(`ipc sin simular: ${[...desconocidos].join(", ")}`);
} finally {
  await navegador.close();
  servidor.close();
  python.stdin.end();
  python.kill();
  await rm(VAULT, { recursive: true, force: true });
  await rm(rutaPy, { force: true });
}

if (violaciones.length > 0 || erroresConsola.length > 0) {
  console.log("\nViolaciones de la CSP:");
  for (const v of violaciones) console.log(`  ${JSON.stringify(v)}`);
  for (const e of erroresConsola) console.log(`  [consola] ${e.slice(0, 300)}`);
  codigo = 1;
}
if (esperadas > 0) {
  console.log(`\n(${esperadas} violaciones esperadas descartadas: sondas de eval con try/catch)`);
}
console.log(codigo === 0 ? "\nCSP: sin violaciones inesperadas." : "\nCSP: hay fallos (ver arriba).");
process.exit(codigo);
