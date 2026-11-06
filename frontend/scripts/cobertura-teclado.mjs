// Recorrido de cobertura del teclado (`FUN-XL-04`, Parte 7, pedido del usuario;
// rehecho para la navegación por niveles del 2026-11-06).
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
// Qué teclas usa: las de la navegación por niveles —Ctrl+flechas (moverse),
// Enter (entrar) y Esc (salir)—, F6 para ir de sección en sección, las
// flechas solas dentro de las listas, F10 (contar lo que tiene pista) y
// Ctrl+Tab (para pasar de pestaña). **No usa Tab**: desde el rediseño, Tab no
// recorre la ventana, así que lo alcanzable es lo que se alcanza así. Las
// reglas de seguridad, para que el recorrido no cambie el vault:
//
// - **Nunca escribe texto.** No manda letras, números ni espacios.
// - **Enter solo sobre una sección elegida, el título de un grupo o un
//   documento seleccionado** (entrar, que no modifica nada; un grupo plegado se
//   despliega, que solo cambia la vista). Nunca sobre un botón, una fila del
//   árbol ni una opción: ahí Enter los ejecutaría.
// - **Ctrl+flechas nunca en un editor** (es suyo: saltar de palabra) ni en una
//   consola, un `select` o un campo que no sea de texto. En un campo de texto,
//   Ctrl+←/→ salta de palabra (no mueve el foco) y Ctrl+↑/↓ sale del campo.
// - **Nunca Ctrl+Shift+flechas**: en un lienzo mueve la tarjeta.
// - **Las flechas solo donde mueven el foco o la vista**: filas del árbol,
//   pestañas, días del calendario, filas de una tabla, tarjetas del lienzo, el
//   grafo, botones de una lista. Nunca en un `select`, un `radio`, un campo
//   numérico o de rango, un divisor de tamaño, la consola ni un editor.
// - Al llegar a un editor o un `textarea`, lo registra y sale con Esc.
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
/** Cuántos pasos de Ctrl+flecha en una dirección, como mucho, en un barrido. */
const MAX_PASOS = 60;
/** Cuántas filas baja un barrido, como mucho. */
const MAX_FILAS = 80;
const MAX_FLECHAS = 25;
/** En listas de una sola parada (árbol, pestañas, filas, grillas), hasta el final. */
const MAX_FLECHAS_LISTA = 300;

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
 * `window.__cobertura`. Cada corrida lo reinstala desde cero.
 */
function instalar() {
  const w = window;
  // Cada corrida empieza de cero: reusar la instalación de una corrida anterior
  // en la misma página arrastraba lo anotado y las funciones viejas.
  w.__cobertura?.detener?.();
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
  const alEnfocar = (e) => {
    if (e.target instanceof Element) alcanzados.add(representante(e.target));
  };
  document.addEventListener("focusin", alEnfocar, true);
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
    if (s.visibility === "hidden" || s.display === "none") return false;
    // Que se vea de verdad, como hacen las pistas: algo de él tiene que estar en
    // el punto. Sin esto contaban los paneles de las pestañas en segundo plano,
    // que siguen en el DOM tapados por la visible, y lo recortado por un scroll.
    const puntos = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]];
    return puntos.some(([fx, fy]) => {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const e = document.elementFromPoint(x, y);
      return !!e && (e === el || el.contains(e));
    });
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
    detener() {
      document.removeEventListener("focusin", alEnfocar, true);
    },
    /** Con las pistas abiertas (F10): lo que tiene una cuenta como alcanzado. */
    sumarPistas() {
      for (const el of document.querySelectorAll("[data-con-pista]")) alcanzados.add(representante(el));
    },
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
                : el.hasAttribute("data-zona")
                  ? "seccion"
                : el.hasAttribute("data-grupo-titulo") || el.hasAttribute("data-grupo")
                  ? "grupo"
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
/** Tipos de foco donde Ctrl+flechas solo mueve el foco (es la navegación por niveles). */
const CTRL_SEGURO = new Set(["otro", "documento", "seccion", "grupo", "separador", "input:text", "input:search", "input:checkbox"]);
/** Tipos de foco donde no hay que quedarse. */
const TRAMPAS = new Set(["editor", "consola", "marco", "texto"]);

/** Sale de un editor, una consola o un marco sin escribir nada. */
async function salirDeTrampa(f) {
  if (f.tipo === "editor" || f.tipo === "texto") return tecla("Escape");
  // La consola y draw.io se quedan con Esc: F6 los saca (y Shift+F6 vuelve).
  await tecla("F6");
  return tecla("Shift+F6");
}

/** Prueba las flechas solas sobre el elemento con el foco, mientras muevan el foco. */
async function explorarConFlechas() {
  for (const t of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    let previo = (await foco()).selector;
    const enLista = await pagina.evaluate(() => !!document.activeElement?.closest("[role=tree],[role=tablist],[role=listbox],[role=grid],tbody,[role=menu]"));
    for (let i = 0; i < (enLista ? MAX_FLECHAS_LISTA : MAX_FLECHAS); i++) {
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

/**
 * Ctrl+`dir` mientras mueva el foco (y sea seguro). Devuelve si se movió al
 * menos una vez. En cada elemento nuevo prueba las flechas solas (listas) y,
 * sobre un documento, entra y lo recorre.
 */
async function avanzar(dir, unaVez = false) {
  let movido = false;
  for (let i = 0; i < (unaVez ? 1 : MAX_PASOS); i++) {
    const f = await foco();
    if (TRAMPAS.has(f.tipo)) {
      await salirDeTrampa(f);
      return movido;
    }
    if (!CTRL_SEGURO.has(f.tipo) || f.modal) return movido;
    const g = await tecla(`Control+${dir}`);
    await inventariar();
    if (g.selector === f.selector) return movido;
    movido = true;
    if (g.tipo === "documento") await probarDocumento();
    if (g.tipo === "grupo") await recorrerGrupo();
  }
  return movido;
}

/**
 * Barre el nivel actual como se lee una página: arriba a la izquierda, después
 * cada «renglón» hacia la derecha y de vuelta, y un paso hacia abajo, hasta
 * que ya no baja. Solo con Ctrl+flechas.
 */
async function barrer() {
  await avanzar("ArrowUp");
  await avanzar("ArrowLeft");
  for (let fila = 0; fila < MAX_FILAS; fila++) {
    await explorarConFlechas();
    await avanzar("ArrowRight");
    await avanzar("ArrowLeft");
    if (!(await avanzar("ArrowDown", true))) return;
  }
}

/** Cuántos grupos anidados se recorren, como mucho. */
let profundidadDeGrupos = 0;

/**
 * Con el título de un grupo elegido (el explorador: botones, Bandeja,
 * Archivos): entra (Enter), barre lo de adentro —con Ctrl+flechas no sale del
 * grupo— y vuelve a su título con Esc. Desde el título, el barrido sigue con
 * los otros grupos de la sección.
 */
async function recorrerGrupo() {
  const inicio = await foco();
  if (inicio.tipo !== "grupo" || profundidadDeGrupos >= 3) return;
  profundidadDeGrupos++;
  try {
    const f = await tecla("Enter");
    await inventariar();
    if (f.selector === inicio.selector) return;
    if (TRAMPAS.has(f.tipo)) {
      await salirDeTrampa(f);
      return;
    }
    await contarPistas();
    await barrer();
    await tecla("Escape");
  } finally {
    profundidadDeGrupos--;
  }
}

/** Con una sección elegida: entra (Enter), barre sus elementos y vuelve a elegirla. */
async function recorrerZona() {
  const inicio = await foco();
  if (inicio.tipo !== "seccion") return;
  await inventariar();
  const f = await tecla("Enter");
  await inventariar();
  if (TRAMPAS.has(f.tipo)) {
    await salirDeTrampa(f);
    return;
  }
  // Las pistas de adentro de la sección (F10 por sección).
  await contarPistas();
  // Si se entró al título de un grupo (el explorador), también lo de adentro.
  if (f.tipo === "grupo") await recorrerGrupo();
  await barrer();
}

/** Pone el foco en la zona `indice` (en el orden de F6): queda elegida. */
async function irAZona(indice) {
  for (let i = 0; i < 12; i++) {
    const f = await foco();
    if (f.indiceZona === indice && f.tipo === "seccion") return true;
    await tecla("F6");
  }
  return false;
}

/** Con un documento seleccionado: entrar (Enter), barrer lo de adentro y volver. */
async function probarDocumento() {
  const f = await foco();
  if (f.tipo !== "documento") return;
  const g = await tecla("Enter");
  await inventariar();
  if (TRAMPAS.has(g.tipo)) {
    await salirDeTrampa(g);
    return;
  }
  // Adentro de un lienzo, una tabla, el calendario o el grafo: las flechas,
  // y Ctrl+flechas entre lo que haya (botones de la vista, tarjetas).
  await explorarConFlechas();
  for (const dir of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) await avanzar(dir);
  await tecla("Escape");
}

async function recorrerZonas() {
  await tecla("Escape");
  await tecla("Escape");
  // F6 hasta caer en una zona: si el foco arrancó dentro de un marco (draw.io),
  // el primer F6 puede dejarlo en `body`, sin zona, y `totalZonas` saldría
  // vacío, salteando todo el recorrido (visto en la primera corrida).
  let f0 = await tecla("F6");
  for (let i = 0; i < 8 && (!f0.zona || f0.zona === "-" || !f0.totalZonas); i++) f0 = await tecla("F6");
  const { totalZonas } = f0;
  // En el nivel de secciones, F10 da una pista por sección y los controles
  // sueltos entre ellas (los divisores de la vista dividida).
  await contarPistas();
  for (let z = 0; z < totalZonas; z++) {
    if (!(await irAZona(z))) continue;
    await recorrerZona();
  }
  // Y las secciones con Ctrl+flechas, desde la última elegida.
  await irAZona(0);
  for (const dir of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) await avanzar(dir);
}

/** F10: lo que tiene una pista (`data-con-pista`) se alcanza con el teclado. */
async function contarPistas() {
  await tecla("F10");
  await pausa(400);
  await pagina.evaluate(() => window.__cobertura.sumarPistas());
  await tecla("Escape");
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
