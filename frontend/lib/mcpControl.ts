/**
 * El MCP de control en el frontend (`FUN-L-09`, Parte 1; spec en
 * `docs/features/mcp-control.md`). Solo desktop.
 *
 * Tres cosas:
 *
 * 1. **El interruptor**: encender o apagar el canal de ESTA ventana
 *    (`mcp_control_encender` / `mcp_control_apagar`, `src-tauri/src/control.rs`)
 *    y mantener el `.mcp.json` del vault, donde Claude Code encuentra el
 *    servidor.
 * 2. **La escucha**: Rust pasa cada pedido del servidor como evento
 *    `mcp-pedido` a esta ventana; acá se atiende y se contesta con
 *    `mcp_responder`. Si no se contesta en 10 s, Rust responde `OCUPADA`.
 * 3. **Las operaciones**: `estado` y `abrir`, sobre los stores que ya existen
 *    (`tabsStore`, `vaultStore`, `syncStore`). La lógica pura —resolver el
 *    objetivo, el salto, las candidatas— está en `lib/mcpControlLogica.ts`.
 *    Desde la Parte 2, las del calendario (`lib/mcpCalendario.ts`).
 * 4. **El registro de actividad** (Parte 2): cada operación —salvo `estado`—
 *    queda en `.mycelium/actividad.jsonl` con su efecto, lo que falló y cómo
 *    deshacerla (`stores/actividadIaStore.ts`, panel del rail).
 */
import { invoke } from "@tauri-apps/api/core";
import { seRegistra, type Resultado } from "@/lib/actividadIa";
import * as calendario from "@/lib/mcpCalendario";
import { FalloCalendario, type Atendido } from "@/lib/mcpCalendario";
import { setPendingMatch } from "@/lib/editor/pendingMatch";
import { ARCHIVO_MCP_JSON, fusionarMcpJson, quitarDeMcpJson } from "@/lib/ia/mcpJson";
import { mismaRuta, resolverObjetivo, resolverSalto, tipoParaIa, type IrA } from "@/lib/mcpControlLogica";
import { tabIdDeArchivo, rutaDeTabArchivo } from "@/lib/otrosArchivos";
import {
  CALENDAR_TAB_ID,
  GRAPH_TAB_ID,
  tipoDePestana,
  tituloDePestana,
} from "@/lib/pestanas";
import { nombreDeVault } from "@/lib/vaultMode";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { useSyncStore } from "@/stores/syncStore";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { ETIQUETA_ETAPA, useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";

// ── El protocolo con Rust ───────────────────────────────────────────────────

/** Un pedido tal como lo emite `control.rs`. */
type Pedido = { id: string; op: string; args: Record<string, unknown>; vault: string };

/** Error tipificado (spec § 3.1). */
type ErrorMcp = { codigo: string; mensaje: string; datos: unknown };

/** Lo que se le devuelve a Rust: `control.rs::armar_respuesta` le pone el id. */
type Respuesta = { ok: true; resultado: unknown } | { ok: false; error: ErrorMcp };

class FalloMcp extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

const fallo = (codigo: string, mensaje: string, datos: unknown = null) => new FalloMcp(codigo, mensaje, datos);

// ── Navegación ──────────────────────────────────────────────────────────────

/**
 * Cómo pone el workspace la URL en la nota activa (`router.replace`). La URL
 * es la fuente de navegación de la app (HU-20): abrir con foco sin tocarla
 * dejaría la pestaña activa desincronizada de lo que una recarga reabriría. La
 * registra `WorkspaceShell` al montarse; sin ella no hay workspace en pantalla.
 */
let navegar: ((notaId: string) => void) | null = null;

export function registrarNavegadorMcp(fn: ((notaId: string) => void) | null): void {
  navegar = fn;
}

// ── La escucha ──────────────────────────────────────────────────────────────

let escuchando: Promise<void> | null = null;

/**
 * Instala, una vez por webview, el oyente de `mcp-pedido`. Escucha solo los
 * eventos dirigidos a ESTA ventana (Rust los emite con `emit_to` a su
 * etiqueta) y además comprueba el vault: con varias ventanas abiertas, cada
 * una atiende únicamente lo suyo (`FUN-L-16`).
 */
function asegurarEscucha(): Promise<void> {
  escuchando ??= (async () => {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().listen<Pedido>("mcp-pedido", (evento) => {
      void contestar(evento.payload);
    });
  })().catch((e) => {
    escuchando = null;
    throw e;
  });
  return escuchando;
}

async function contestar(pedido: Pedido): Promise<void> {
  const sesion = useVaultSessionStore.getState();
  const propia = sesion.rutaActual ?? sesion.rutaAbriendo;
  if (propia === null || !mismaRuta(pedido.vault, propia)) return;
  const actividad = useActividadIaStore.getState();
  actividad.pedidoRecibido();
  let respuesta: Respuesta;
  let atendido: Atendido | null = null;
  try {
    atendido = await atender(pedido);
    respuesta = { ok: true, resultado: atendido.resultado };
  } catch (e) {
    respuesta =
      e instanceof FalloMcp || e instanceof FalloCalendario
        ? { ok: false, error: { codigo: e.codigo, mensaje: e.message, datos: e.datos } }
        : { ok: false, error: { codigo: "INVALIDO", mensaje: `Falló en Mycelium: ${String(e)}`, datos: null } };
  }
  registrar(pedido.op, respuesta, atendido);
  await invoke("mcp_responder", { id: pedido.id, respuesta }).catch((e) =>
    console.warn("[mcp] no se pudo contestar el pedido", pedido.op, e),
  );
}

/** Deja la operación en el registro de actividad (spec § 2.3), si es de las que se registran. */
function registrar(op: string, respuesta: Respuesta, atendido: Atendido | null): void {
  const resultado: Resultado = respuesta.ok ? "hecho" : respuesta.error.codigo === "RECHAZADO" ? "rechazado" : "fallo";
  if (!seRegistra(op, resultado)) return;
  try {
    if (respuesta.ok) {
      const a = atendido?.actividad;
      useActividadIaStore.getState().registrar({
        op,
        resultado,
        efecto: a?.efecto ?? "Hecho.",
        ...(a?.objetivo ? { objetivo: a.objetivo } : {}),
        ...(a?.deshacer ? { deshacer: a.deshacer } : {}),
      });
    } else {
      useActividadIaStore.getState().registrar({
        op,
        resultado,
        efecto: respuesta.error.mensaje,
        codigo: respuesta.error.codigo,
      });
    }
  } catch (e) {
    // El registro nunca impide contestar.
    console.warn("[mcp] no se pudo registrar la actividad", op, e);
  }
}

/** El vault no está listo para operar: se está abriendo, o el workspace no está montado. */
function comprobarListo(): void {
  const sesion = useVaultSessionStore.getState();
  if (sesion.abriendo) {
    throw fallo("OCUPADA", "Mycelium está abriendo el vault.", {
      etapa: sesion.etapa ? ETIQUETA_ETAPA[sesion.etapa] : "abriendo",
      reintentar_en_ms: 1500,
    });
  }
  if (navegar === null || useVaultStore.getState().vaultId === null) {
    throw fallo("OCUPADA", "La ventana de Mycelium todavía está cargando el vault.", {
      etapa: "cargando el árbol del vault",
      reintentar_en_ms: 1000,
    });
  }
}

async function atender(pedido: Pedido): Promise<Atendido> {
  comprobarListo();
  const args = pedido.args ?? {};
  switch (pedido.op) {
    case "estado":
      return { resultado: estado() };
    case "abrir":
      return abrir(args);
    case "recordatorios":
      return calendario.recordatorios(args);
    case "recordatorio_crear":
      return calendario.crear(args);
    case "recordatorio_editar":
      return calendario.editar(args);
    case "recordatorio_completar":
      return calendario.completar(args);
    case "recordatorio_borrar":
      return calendario.borrar(args);
    default:
      throw fallo("INVALIDO", `Operación desconocida: ${pedido.op}.`);
  }
}

// ── estado ──────────────────────────────────────────────────────────────────

type PestanaIa = { titulo: string; ruta: string | null; tipo: string; activa: boolean; sin_guardar: boolean };
type PanelIa = { panel: number; activo: boolean; pestanas: PestanaIa[] };

/** Estados del editor que significan «hay algo que no está en disco». */
const SIN_GUARDAR = new Set(["local", "syncing", "error"]);

/** Las pestañas por panel, en el orden en que se ven (izquierda→derecha, arriba→abajo). */
function paneles(): PanelIa[] {
  const { root, activePaneId } = useTabsStore.getState();
  const { notas } = useVaultStore.getState();
  const sesiones = useTerminalStore.getState().sesiones;
  const sync = useSyncStore.getState().byNota;
  return allLeaves(root).map((hoja, i) => ({
    panel: i + 1,
    activo: hoja.id === activePaneId,
    pestanas: hoja.tabs.map((t) => {
      const clase = tipoDePestana(t.notaId);
      const nota = clase === "nota" ? notas.find((n) => n.id === t.notaId) : undefined;
      return {
        titulo: tituloDePestana(t.notaId, notas, sesiones),
        ruta: clase === "nota" ? t.notaId : clase === "archivo" ? rutaDeTabArchivo(t.notaId) : null,
        tipo: clase === "nota" ? tipoParaIa(nota?.tipo ?? "markdown") : clase === "enlaces" ? "referencias" : clase,
        activa: t.id === hoja.activeTabId,
        sin_guardar: clase === "nota" && SIN_GUARDAR.has(sync[t.notaId] ?? ""),
      };
    }),
  }));
}

function estado() {
  const ruta = useVaultSessionStore.getState().rutaActual ?? "";
  return { vault: { ruta, nombre: nombreDeVault(ruta) }, etapa: "lista", paneles: paneles() };
}

// ── abrir ───────────────────────────────────────────────────────────────────

type Destino = { id: string; titulo: string; ruta: string | null; tipo: string; markdown: boolean };

/** El objetivo → la pestaña que hay que abrir, o el error que lo explica. */
function destinoDe(objetivo: string): { destino: Destino; ancla: string | null } {
  const { notas, carpetas, otros } = useVaultStore.getState();
  const r = resolverObjetivo(objetivo, notas, carpetas, otros);
  switch (r.tipo) {
    case "grafo":
      return { destino: { id: GRAPH_TAB_ID, titulo: "Grafo de conexiones", ruta: null, tipo: "grafo", markdown: false }, ancla: null };
    case "calendario":
      return { destino: { id: CALENDAR_TAB_ID, titulo: "Calendario", ruta: null, tipo: "calendario", markdown: false }, ancla: null };
    case "nota":
      return {
        destino: { id: r.nota.id, titulo: r.nota.titulo, ruta: r.nota.id, tipo: tipoParaIa(r.nota.tipo), markdown: r.nota.tipo === "markdown" },
        ancla: r.ancla,
      };
    case "archivo":
      return {
        destino: { id: tabIdDeArchivo(r.ruta), titulo: r.ruta.slice(r.ruta.lastIndexOf("/") + 1), ruta: r.ruta, tipo: "archivo", markdown: false },
        ancla: null,
      };
    case "ambiguo":
      throw fallo("AMBIGUO", `Hay ${r.rutas.length} notas que responden a «${objetivo}».`, { rutas: r.rutas });
    case "no-encontrado":
      throw fallo("NO_ENCONTRADO", `No hay ninguna nota ni archivo «${objetivo}» en el vault.`, { candidatas: r.candidatas });
  }
}

/** El `ir_a` que mandó el servidor (ya validado allá), o `null`. */
function irADe(args: Record<string, unknown>, ancla: string | null): IrA | null {
  const v = args.ir_a as Record<string, unknown> | null | undefined;
  if (v && typeof v === "object") {
    if (typeof v.encabezado === "string") return { encabezado: v.encabezado };
    if (typeof v.linea === "number") return { linea: v.linea };
    if (typeof v.texto === "string") return { texto: v.texto };
  }
  return ancla ? { encabezado: ancla } : null;
}

/** El panel y la pestaña donde está abierto `id`; prefiere el panel activo. */
function dondeEsta(id: string): { panel: number; hojaId: string; tabId: string; visible: boolean } | null {
  const { root, activePaneId } = useTabsStore.getState();
  const hojas = allLeaves(root);
  const orden = [...hojas].sort((a, b) => Number(b.id === activePaneId) - Number(a.id === activePaneId));
  for (const h of orden) {
    const t = h.tabs.find((x) => x.notaId === id);
    if (t) return { panel: hojas.indexOf(h) + 1, hojaId: h.id, tabId: t.id, visible: h.activeTabId === t.id };
  }
  return null;
}

/** Muestra la nota en el explorador: abre el panel y despliega sus carpetas. */
function revelar(notaId: string): boolean {
  const { notas, carpetas } = useVaultStore.getState();
  const nota = notas.find((n) => n.id === notaId);
  if (!nota) return false;
  const expandir: Record<string, boolean> = {};
  const vistas = new Set<string>();
  for (let id = nota.carpetaId; id && !vistas.has(id); ) {
    vistas.add(id);
    expandir[id] = true;
    id = carpetas.find((c) => c.id === id)?.padreId ?? null;
  }
  useVaultStore.setState((s) => ({ expanded: { ...s.expanded, ...expandir } }));
  const layout = usePanelLayoutStore.getState();
  if (layout.activeSection !== "explorer") layout.toggleSection("explorer");
  return true;
}

async function abrir(args: Record<string, unknown>): Promise<Atendido> {
  const objetivo = typeof args.objetivo === "string" ? args.objetivo : "";
  const conFoco = args.foco === true;
  const { destino, ancla } = destinoDe(objetivo);
  const irA = irADe(args, ancla);
  const avisos: string[] = [];

  // El salto se resuelve contra el archivo ANTES de abrir: un encabezado que
  // no existe es un error, y no conviene haber abierto la pestaña para nada.
  let linea: number | null = null;
  let descripcionSalto: string | null = null;
  if (irA) {
    if (!destino.markdown) {
      throw fallo("INVALIDO", `«ir_a» solo aplica a notas markdown; «${destino.titulo}» es ${destino.tipo}.`);
    }
    const ruta = useVaultSessionStore.getState().rutaActual!;
    const contenido = await invoke<string | null>("leer_archivo_texto", { vaultRuta: ruta, rutaRel: destino.id });
    const s = resolverSalto(contenido ?? "", irA);
    if (!s.ok) throw fallo(s.codigo, s.mensaje, s.datos);
    linea = s.linea;
    descripcionSalto = s.descripcion;
  }

  const previa = dondeEsta(destino.id);
  const tabs = useTabsStore.getState();
  if (conFoco) {
    if (previa) tabs.activateTab(previa.hojaId, previa.tabId);
    else tabs.openNote(destino.id);
    navegar?.(destino.id);
  } else if (!previa) {
    // Sin robar el foco (spec § 3.5): pestaña permanente en segundo plano. Si
    // el panel estaba vacío, `openNoteBackground` la abre visible, porque no
    // hay nada que tapar; se refleja en la URL igual que un clic.
    tabs.openNoteBackground(destino.id);
  }
  const ahora = dondeEsta(destino.id);
  if (!ahora) throw fallo("INVALIDO", `No se pudo abrir «${destino.titulo}».`);
  const enFoco = conFoco || (!previa && ahora.visible && useTabsStore.getState().activePaneId === ahora.hojaId);
  if (!conFoco && enFoco) navegar?.(destino.id);

  let salto: string | null = null;
  if (linea !== null) {
    if (conFoco || !ahora.visible) {
      // El editor monta la pestaña al mostrarla y consume el salto; si ya
      // estaba montado, lo atiende el evento.
      setPendingMatch(destino.id, { linea });
      if (conFoco) {
        window.dispatchEvent(new CustomEvent("micelio:goto-match", { detail: { notaId: destino.id, linea } }));
        salto = `Saltó a ${descripcionSalto}.`;
      } else {
        salto = `Cuando el usuario la mire, el cursor va a estar en ${descripcionSalto}.`;
      }
    } else {
      avisos.push(
        `La nota ya está a la vista del usuario: no se movió su cursor a ${descripcionSalto}. ` +
          "Para llevarlo ahí, repetí con foco: true.",
      );
    }
  }

  const revelado = args.revelar === true && destino.ruta !== null && revelar(destino.id);
  if (args.revelar === true && !revelado) avisos.push("Esto no tiene lugar en el explorador: no se reveló.");

  const efecto =
    `${previa ? "Mostró" : "Abrió"} «${destino.titulo}» en el panel ${ahora.panel}` +
    (enFoco ? ", con el foco" : ", en segundo plano") +
    (descripcionSalto && salto ? `, en ${descripcionSalto}` : "") +
    ".";
  return {
    resultado: {
      abierto: { titulo: destino.titulo, ruta: destino.ruta, tipo: destino.tipo },
      panel: ahora.panel,
      foco: enFoco,
      ya_estaba: previa !== null,
      salto,
      revelado,
      avisos,
      paneles: paneles(),
    },
    actividad: {
      efecto,
      objetivo:
        destino.id === GRAPH_TAB_ID
          ? { tipo: "grafo" }
          : destino.id === CALENDAR_TAB_ID
            ? { tipo: "calendario" }
            : { tipo: "nota", ruta: destino.id },
    },
  };
}

// ── El interruptor y el `.mcp.json` ─────────────────────────────────────────

/** Dónde está el servidor MCP (junto al ejecutable) y si de verdad está. */
export async function binarioMcp(): Promise<{ ruta: string; existe: boolean }> {
  return invoke<{ ruta: string; existe: boolean }>("mcp_ruta_binario");
}

async function leerMcpJson(vault: string): Promise<string | null> {
  return invoke<string | null>("leer_archivo_texto", { vaultRuta: vault, rutaRel: ARCHIVO_MCP_JSON });
}

/**
 * Registra el servidor en el `.mcp.json` del vault, fusionando con lo que el
 * usuario tenga. No escribe si ya estaba igual. Devuelve si **creó** el
 * archivo, o `null` si no escribió nada (no había binario o ya estaba).
 */
export async function asegurarMcpJson(vault: string): Promise<{ escrito: boolean; creado: boolean; binario: boolean }> {
  const bin = await binarioMcp();
  if (!bin.existe) return { escrito: false, creado: false, binario: false };
  const { texto, cambia, creado } = fusionarMcpJson(await leerMcpJson(vault), bin.ruta, vault);
  if (!cambia) return { escrito: false, creado: false, binario: true };
  await invoke("escribir_nota", { vaultRuta: vault, rutaRel: ARCHIVO_MCP_JSON, contenido: texto });
  return { escrito: true, creado, binario: true };
}

/**
 * Quita el servidor del `.mcp.json`. Si quedó vacío y lo había creado
 * Mycelium (`borrarSiVacio`), borra el archivo; si era del usuario, lo deja.
 */
export async function quitarMcpJson(vault: string, borrarSiVacio: boolean): Promise<void> {
  const actual = await leerMcpJson(vault);
  if (actual === null) return;
  const { texto, cambia } = quitarDeMcpJson(actual);
  if (texto === null) {
    if (borrarSiVacio) await invoke("mcp_config_borrar", { vaultRuta: vault });
    else if (cambia) await invoke("escribir_nota", { vaultRuta: vault, rutaRel: ARCHIVO_MCP_JSON, contenido: "{}\n" });
    return;
  }
  if (cambia) await invoke("escribir_nota", { vaultRuta: vault, rutaRel: ARCHIVO_MCP_JSON, contenido: texto });
}

/** Abre el canal de esta ventana para `vault`. */
async function abrirCanal(vault: string): Promise<void> {
  const actividad = useActividadIaStore.getState();
  try {
    await asegurarEscucha();
    await invoke<string>("mcp_control_encender", { ruta: vault });
    actividad.fijarCanal(true);
  } catch (e) {
    actividad.fijarCanal(false, String((e as Error)?.message ?? e));
    throw e;
  }
}

/** Cierra el canal de esta ventana. */
async function cerrarCanal(): Promise<void> {
  await invoke("mcp_control_apagar");
  useActividadIaStore.getState().fijarCanal(false);
}

/**
 * Al abrir un vault (`vaultSessionStore.abrir`, con las preferencias ya
 * cargadas): si el control está encendido, escucha y refresca el `.mcp.json`
 * (la ruta del binario cambia si se reinstaló en otro lado, o entre la app
 * instalada y la de desarrollo); si no, se asegura de que no quede un canal de
 * otro vault. Nunca lanza: el vault se abre igual.
 */
export async function sincronizarControlAlAbrir(vault: string): Promise<void> {
  try {
    if (usePrefsVaultStore.getState().prefs.controlIa) {
      await abrirCanal(vault);
      await asegurarMcpJson(vault);
    } else {
      await cerrarCanal();
    }
  } catch (e) {
    console.warn("[mcp] no se pudo preparar el control de la IA:", e);
  }
}

/**
 * Lo que hace el interruptor de Configuración → Vault. Devuelve el texto
 * para el aviso. Lanza si no se pudo (y deja la preferencia como estaba).
 */
export async function cambiarControl(vault: string, encender: boolean): Promise<string> {
  const prefs = usePrefsVaultStore.getState();
  if (encender) {
    await abrirCanal(vault);
    prefs.set("controlIa", true);
    const r = await asegurarMcpJson(vault);
    if (r.creado) prefs.set("mcpJsonCreado", true);
    if (!r.binario) {
      return (
        "Control encendido, pero no se encontró el servidor MCP junto a Mycelium, así que el " +
        ".mcp.json no se escribió (en desarrollo: npm run preparar-mcp -- --dev)."
      );
    }
    return (
      "Control encendido. Claude Code lo toma al abrir una sesión nueva en este vault " +
      "(la primera vez te pide aprobar el servidor «mycelium» del .mcp.json)."
    );
  }
  await cerrarCanal();
  prefs.set("controlIa", false);
  await quitarMcpJson(vault, prefs.prefs.mcpJsonCreado);
  prefs.set("mcpJsonCreado", false);
  return "Control apagado: ningún proceso puede pedirle a Mycelium que muestre nada.";
}
