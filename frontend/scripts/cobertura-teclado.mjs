// Recorrido de cobertura del teclado (`FUN-XL-04`, Parte 7, pedido del usuario).
//
// Se conecta por CDP a la app de desarrollo YA ABIERTA (con un vault cargado),
// recorre la ventana **solo con el teclado** y lista los elementos interactivos
// visibles que no pudo alcanzar, con su selector, su zona y una captura de
// pantalla con el elemento marcado.
//
// Uso (PowerShell, con `tauri dev` corriendo con el puerto de depuración 9222):
//
//   cd desktop/frontend
//   node scripts/cobertura-teclado.mjs --salida C:\ruta\a\capturas
//
// Opciones:
//   --salida <carpeta>   Dónde dejar las capturas y el informe (`cobertura.json`,
//                        `cobertura.md`). Por defecto, `./cobertura-teclado`.
//   --cdp <url>          Por defecto `http://localhost:9222`.
//   --sin-pestanas       No recorre las pestañas abiertas con Ctrl+Tab.
//   --max-capturas <n>   Cuántos huecos se fotografían (por defecto 40).
//
// Qué teclas usa: Tab, Shift+Tab, F6, Shift+F6, flechas, Enter, Esc y Ctrl+Tab
// (para pasar de pestaña). Nada más. Las reglas de seguridad, para que el
// recorrido no cambie el vault:
//
// - **Nunca escribe texto.** No manda letras, números ni espacios.
// - **Enter solo sobre un documento seleccionado** (`[data-documento]` con el
//   foco en él mismo): es «entrar a escribir», que no modifica nada. Nunca
//   sobre un botón, una fila del árbol ni una opción.
// - **Las flechas solo donde mueven el foco o la vista**: filas del árbol,
//   pestañas, días del calendario, filas de una tabla, tarjetas del lienzo, el
//   grafo, botones de una lista. Nunca en un `select`, un `radio`, un campo
//   numérico o de rango, un divisor de tamaño, la consola ni un editor.
// - **No hace Tab dentro de un editor** (CodeMirror indentaría) ni de un
//   `textarea`: al llegar a uno, lo registra y sale con Esc.
// - **Nunca entra a un iframe** (draw.io, PDF) a propósito; si el foco cae en
//   uno, lo registra y sale con F6.
//
// No lanza la app ni la cierra; se desconecta al terminar.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

// ── opciones ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : porDefecto;
};
const SALIDA = resolve(opcion("--salida", "cobertura-teclado"));
const CDP = opcion("--cdp", "http://localhost:9222");
const MAX_CAPTURAS = Number(opcion("--max-capturas", "40"));
const CON_PESTANAS = !args.includes("--sin-pestanas");
const MAX_TAB_POR_ZONA = 120;
const MAX_FLECHAS = 25;

// ── conexión ──────────────────────────────────────────────────────────────

async function conectar() {
  let ultimo;
  for (let i = 0; i < 4; i++) {
    try {
      const navegador = await chromium.connectOverCDP(CDP, { timeout: 15000 });
      const paginas = navegador.contexts().flatMap((c) => c.pages());
      const pagina = paginas.find((p) => p.url().includes("localhost:3000")) ?? paginas[0];
      if (!pagina) throw new Error("no hay ninguna página abierta");
      return { navegador, pagina };
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

// ── lo que corre dentro de la página ──────────────────────────────────────

/**
 * Instala el registro en la página: un `focusin` que anota cada elemento que
 * tuvo el foco, y el inventario de lo interactivo visible. Todo vive en
 * `window.__cobertura` y se puede volver a instalar sin perder lo anotado.
 */
function instalar() {
  const w = window;
  if (w.__cobertura) return;
  const SEL = [
    "a[href]",
    "button",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "iframe",
    "[role='button']",
    "[role='tab']",
    "[role='treeitem']",
    "[role='option']",
    "[role='menuitem']",
    "[role='menuitemcheckbox']",
    "[role='menuitemradio']",
    "[role='link']",
    "[role='checkbox']",
    "[role='switch']",
    "[role='separator'][tabindex]",
    "[role='gridcell'] button",
    "[tabindex]:not([tabindex='-1'])",
    "[data-nodo]",
    "canvas[tabindex]",
    ".cm-content",
    ".xterm",
  ].join(", ");
  /** Lo que cuenta como alcanzado al enfocar `el`: él, o el editor o la consola que lo contiene. */
  const representante = (el) =>
    el.closest?.(".cm-content") ?? el.closest?.(".xterm") ?? el;
  const alcanzados = new Set();
  const inventario = new Map();
  document.addEventListener(
    "focusin",
    (e) => {
      if (e.target instanceof Element) alcanzados.add(representante(e.target));
    },
    true,
  );
  if (document.activeElement && document.activeElement !== document.body) {
    alcanzados.add(representante(document.activeElement));
  }

  const visible = (el) => {
    if (el.closest("[aria-hidden='true'], [inert], .mic-pistas")) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const describir = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const clases = [...el.classList].slice(0, 2);
    if (clases.length) s += `.${clases.join(".")}`;
    for (const a of ["role", "data-nodo", "data-dia", "aria-label", "title", "type"]) {
      const v = el.getAttribute(a);
      if (v) s += `[${a}="${v.slice(0, 40)}"]`;
    }
    return s;
  };
  const texto = (el) =>
    (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

  w.__cobertura = {
    representante,
    /** Suma al inventario lo interactivo visible de ahora. */
    inventariar() {
      for (const cand of document.querySelectorAll(SEL)) {
        const el = representante(cand);
        if (inventario.has(el) || !visible(el)) continue;
        // Lo de adentro de un editor o de una consola no cuenta aparte.
        if (el !== cand && (el.classList.contains("cm-content") || el.classList.contains("xterm"))) continue;
        inventario.set(el, {
          selector: describir(el),
          texto: texto(el),
          zona: el.closest("[data-zona]")?.getAttribute("data-zona") ?? "fuera de las zonas",
          visto: Date.now(),
        });
      }
      return inventario.size;
    },
    /** Qué tiene el foco ahora, en pocas palabras. */
    foco() {
      const el = document.activeElement;
      if (!el || el === document.body) return { tipo: "body" };
      const tipo =
        el instanceof HTMLIFrameElement
          ? "marco"
          : el.closest(".cm-content")
            ? "editor"
            : el.closest(".xterm")
              ? "consola"
              : el.hasAttribute("data-documento")
                ? "documento"
                : el instanceof HTMLTextAreaElement || el.isContentEditable
                  ? "texto"
                  : el instanceof HTMLSelectElement
                    ? "select"
                    : el instanceof HTMLInputElement
                      ? `input:${el.type}`
                      : el.getAttribute("role") === "separator"
                        ? "separador"
                        : "otro";
      const zonas = [...document.querySelectorAll("[data-zona]")].filter((z) => z.getClientRects().length > 0);
      const zona = el.closest("[data-zona]");
      return {
        tipo,
        selector: describir(el),
        zona: zona?.getAttribute("data-zona") ?? null,
        indiceZona: zona ? zonas.indexOf(zona) : -1,
        totalZonas: zonas.length,
        modal: document.querySelector("[aria-modal='true']") !== null,
      };
    },
    /** Las pestañas del panel activo (para recorrerlas con Ctrl+Tab). */
    pestanasDelPanel() {
      const doc = document.activeElement?.closest?.("[data-zona='panel']") ?? document.querySelector("[data-zona='panel']");
      return doc ? doc.querySelectorAll("[role='tab']").length : 0;
    },
    /** Lo que quedó sin alcanzar, con la caja de ahora (si se sigue viendo). */
    huecos() {
      const salida = [];
      for (const [el, d] of inventario) {
        if (alcanzados.has(el)) continue;
        const r = el.isConnected ? el.getBoundingClientRect() : null;
        salida.push({ ...d, enPantalla: !!r && visible(el), caja: r && { x: r.x, y: r.y, w: r.width, h: r.height } });
      }
      return { total: inventario.size, alcanzados: inventario.size - salida.length, huecos: salida };
    },
    /** Marca un rectángulo para la captura. */
    marcar(caja) {
      const m = document.createElement("div");
      m.id = "__cobertura-marca";
      Object.assign(m.style, {
        position: "fixed",
        left: `${caja.x - 3}px`,
        top: `${caja.y - 3}px`,
        width: `${caja.w + 6}px`,
        height: `${caja.h + 6}px`,
        border: "3px solid #ff2d55",
        zIndex: "2147483647",
        pointerEvents: "none",
      });
      document.body.appendChild(m);
    },
    desmarcar() {
      document.getElementById("__cobertura-marca")?.remove();
    },
  };
}

// ── el recorrido ──────────────────────────────────────────────────────────

const pasos = [];
let pagina;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const foco = () => pagina.evaluate(() => window.__cobertura.foco());
const inventariar = () => pagina.evaluate(() => window.__cobertura.inventariar());

async function tecla(t) {
  await pagina.keyboard.press(t);
  await pausa(90);
  const f = await foco();
  pasos.push({ tecla: t, ...f });
  return f;
}

/** Tipos de foco donde una flecha no cambia nada del vault. */
const FLECHAS_SEGURAS = new Set(["otro", "documento"]);
/** Tipos de foco donde Tab escribiría o donde no hay que quedarse. */
const TRAMPAS = new Set(["editor", "consola", "marco", "texto"]);

/** Sale de un editor, una consola o un marco sin escribir nada. */
async function salirDeTrampa(f) {
  if (f.tipo === "editor" || f.tipo === "texto") return tecla("Escape");
  // La consola y draw.io se quedan con Esc: F6 los saca (y Shift+F6 vuelve).
  await tecla("F6");
  return tecla("Shift+F6");
}

/** Prueba las flechas sobre el elemento con el foco, mientras muevan el foco. */
async function explorarConFlechas() {
  for (const t of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    let previo = (await foco()).selector;
    for (let i = 0; i < MAX_FLECHAS; i++) {
      const f = await foco();
      if (!FLECHAS_SEGURAS.has(f.tipo) || f.modal) return;
      // Un documento seleccionado no reacciona a las flechas; solo su contenido.
      if (f.tipo === "documento") return;
      const g = await tecla(t);
      if (g.selector === previo) break;
      previo = g.selector;
    }
  }
}

/** Recorre con Tab la zona donde está el foco, hasta salir de ella o dar la vuelta. */
async function recorrerZona() {
  const inicio = await foco();
  const vistos = new Set([inicio.selector]);
  await inventariar();
  for (let i = 0; i < MAX_TAB_POR_ZONA; i++) {
    let f = await foco();
    if (TRAMPAS.has(f.tipo)) {
      await salirDeTrampa(f);
      return;
    }
    await explorarConFlechas();
    f = await tecla("Tab");
    await inventariar();
    if (TRAMPAS.has(f.tipo)) {
      await salirDeTrampa(f);
      return;
    }
    if (f.zona !== inicio.zona || f.indiceZona !== inicio.indiceZona) return;
    if (vistos.has(f.selector)) return;
    vistos.add(f.selector);
  }
}

/** Pone el foco en la zona `indice` (en el orden de F6). */
async function irAZona(indice) {
  for (let i = 0; i < 12; i++) {
    const f = await foco();
    if (f.indiceZona === indice) return true;
    await tecla("F6");
  }
  return false;
}

/** Con un documento seleccionado: entrar a escribir (Enter), mirar y volver. */
async function probarDocumento() {
  const f = await foco();
  if (f.tipo !== "documento") return;
  const g = await tecla("Enter");
  await inventariar();
  if (TRAMPAS.has(g.tipo)) {
    await salirDeTrampa(g);
    return;
  }
  // Adentro de un lienzo, una tabla, el calendario o el grafo: las flechas.
  await explorarConFlechas();
  await tecla("Escape");
}

async function recorrerZonas() {
  await tecla("Escape");
  await tecla("Escape");
  await tecla("F6");
  const { totalZonas } = await foco();
  for (let z = 0; z < totalZonas; z++) {
    if (!(await irAZona(z))) continue;
    await inventariar();
    await probarDocumento();
    await irAZona(z);
    await recorrerZona();
  }
  // Y hacia atrás, por si F6 y Tab dejaron algo de lado.
  for (let i = 0; i < totalZonas; i++) await tecla("Shift+F6");
}

async function recorrerPestanas() {
  // Al primer panel de la división.
  for (let i = 0; i < 12; i++) {
    const f = await foco();
    if (f.zona === "panel") break;
    await tecla("F6");
  }
  const n = await pagina.evaluate(() => window.__cobertura.pestanasDelPanel());
  for (let i = 0; i < n; i++) {
    await tecla("Control+Tab");
    await pausa(400); // que monte la pestaña
    await inventariar();
    const f = await foco();
    const z = f.indiceZona;
    await probarDocumento();
    await irAZona(z);
    await recorrerZona();
    await irAZona(z);
  }
}

// ── el informe ────────────────────────────────────────────────────────────

async function informar() {
  await mkdir(SALIDA, { recursive: true });
  const { total, alcanzados, huecos } = await pagina.evaluate(() => window.__cobertura.huecos());
  let capturas = 0;
  for (const h of huecos) {
    if (capturas >= MAX_CAPTURAS || !h.enPantalla || !h.caja) continue;
    const archivo = `hueco-${String(capturas + 1).padStart(2, "0")}.png`;
    await pagina.evaluate((c) => window.__cobertura.marcar(c), h.caja);
    await pagina.screenshot({ path: join(SALIDA, archivo) });
    await pagina.evaluate(() => window.__cobertura.desmarcar());
    h.captura = archivo;
    capturas++;
  }
  const porcentaje = total ? Math.round((alcanzados / total) * 1000) / 10 : 100;
  await writeFile(
    join(SALIDA, "cobertura.json"),
    JSON.stringify({ fecha: new Date().toISOString(), total, alcanzados, porcentaje, huecos, pasos }, null, 2),
  );
  const lineas = [
    `# Cobertura del teclado`,
    ``,
    `${alcanzados} de ${total} elementos interactivos alcanzados (${porcentaje} %), en ${pasos.length} teclas.`,
    ``,
    `| Zona | Elemento | Texto | Captura |`,
    `|---|---|---|---|`,
    ...huecos.map((h) => `| ${h.zona} | \`${h.selector.replace(/\|/g, "\\|")}\` | ${h.texto.replace(/\|/g, "\\|")} | ${h.captura ?? (h.enPantalla ? "" : "(ya no se ve)")} |`),
  ];
  await writeFile(join(SALIDA, "cobertura.md"), lineas.join("\n"));
  console.log(`cobertura: ${alcanzados}/${total} (${porcentaje} %), ${huecos.length} huecos, ${capturas} capturas en ${SALIDA}`);
}

// ── principal ─────────────────────────────────────────────────────────────

const { navegador, pagina: p } = await conectar();
pagina = p;
try {
  await pagina.bringToFront().catch(() => undefined);
  await pagina.evaluate(instalar);
  await inventariar();
  await recorrerZonas();
  if (CON_PESTANAS) await recorrerPestanas();
  await informar();
} finally {
  // Solo se desconecta: la app sigue abierta.
  await navegador.close().catch(() => undefined);
}
