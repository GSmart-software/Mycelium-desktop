/**
 * Los comandos de la app (`FUN-XL-04`, Parte 1): los de la paleta y los atajos
 * globales del workspace, en el catálogo único (`registro.ts`). El workspace
 * los registra al montarse (`useRegistrarComandos`).
 *
 * El orden importa: es el de la paleta. Los que hoy solo son un atajo van al
 * final con `enPaleta: false`; sumarlos a la paleta es una decisión de las
 * partes siguientes.
 *
 * Para agregar un comando: un id estable `area.accion`, y lo que necesite lo
 * lee de los stores al ejecutarse (nunca un closure de un componente). Los de
 * desarrollador llevan `soloDev: true` (ver `docs/features/modo-dev.md`).
 */
import {
  BellPlus,
  BookOpen,
  CalendarDays,
  FilePlus,
  FileText,
  HeartPulse,
  History,
  Inbox,
  PanelLeft,
  PanelRight,
  Palette,
  Search,
  Settings,
  SunMoon,
  Terminal,
  TextSearch,
  ToggleLeft,
  Undo2,
  Wrench,
  X,
  ArrowLeftRight,
  Command,
  Columns2,
  SquareDashedMousePointer,
  Keyboard,
  PenLine,
  BookOpenText,
  FileCode,
  FilePlus2,
  Rows2,
  SquareX,
  PanelLeftDashed,
  Files,
  CircleDot,
  Bot,
  Trash2,
  FolderPlus,
  MousePointerClick,
} from "lucide-react";
import { IconoGrafo } from "@/components/workspace/IconoGrafo";
import { ATMOSFERAS } from "@/lib/atmosferas";
import { cerrarPestanaSinPerder, navegarHistorialSinPerder } from "@/lib/conflictosAbiertos";
import { carpetaDestino, crearYAbrir, pedirYCrearCarpeta } from "@/lib/crear";
import { ICONO_POR_TIPO, ICONO_SALUD } from "@/lib/iconosDeTipo";
import { avisoModoDev } from "@/lib/modoDev";
import { CALENDAR_TAB_ID, GRAPH_TAB_ID, seDuplicaAlDividir } from "@/lib/pestanas";
import { abrirPestanaSalud } from "@/lib/saludPestana";
import { avisar } from "@/stores/avisosStore";
import { usePanelLayoutStore, type RailSection } from "@/stores/panelLayoutStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { hoy, nuevoRecordatorio } from "@/stores/recordatoriosStore";
import { allLeaves, findLeaf, useTabsStore } from "@/stores/tabsStore";
import { EXPLORER_TAB, useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useVaultStore } from "@/stores/vaultStore";
import {
  enfocarDocumentoActivo,
  enfocarSeccionIzquierda,
  escribiendoEnEditor,
  focoEnElPanelIzquierdo,
  hayModalAbierto,
  irAPanelContiguo,
  irAZona,
} from "@/lib/teclado/focoDom";
import { abrirPistas, cerrarPistas, pistasVisibles } from "@/lib/teclado/pistasDom";
import { EVENTO_VISTA_NOTA } from "./eventos";
import { abrirNota, sincronizarUrl, urlDeNota } from "./navegar";
import { OPCIONES_NUEVO, type OpcionNuevo } from "./nuevo";
import type { Comando, ContextoComando, IconoComando } from "./registro";

/**
 * Enciende o apaga el modo desarrollador y lo confirma con un aviso. El estado
 * se relee de Rust si todavía no se cargó (se carga unos segundos después de
 * arrancar), para no «apagar» un modo que en realidad estaba encendido.
 */
export async function alternarModoDev(activar?: boolean) {
  const store = useUpdaterStore.getState();
  const actual = (store.estado ?? (await store.cargarEstado()))?.dev ?? false;
  const destino = activar ?? !actual;
  await store.setDev(destino);
  avisar(avisoModoDev(destino));
}

/** Pasa a la pestaña siguiente (o anterior) del pane activo, con vuelta. */
function ciclarPestana(ctx: ContextoComando, delta: -1 | 1) {
  const { root, activePaneId, activateTab } = useTabsStore.getState();
  const pane = allLeaves(root).find((l) => l.id === activePaneId);
  if (!pane || pane.tabs.length < 2) return;
  const i = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
  const destino = pane.tabs[(i + delta + pane.tabs.length) % pane.tabs.length];
  const veniaEscribiendo = escribiendoEnEditor();
  activateTab(pane.id, destino.id);
  ctx.navegar("/workspace?note=" + encodeURIComponent(destino.notaId));
  enfocarDocumentoActivo(veniaEscribiendo);
}

/** Historial de la pestaña activa, sin perder lo de una nota en conflicto (`DEF-177`). */
function navegarHistorialActivo(ctx: ContextoComando, delta: -1 | 1) {
  const { activePaneId } = useTabsStore.getState();
  void navegarHistorialSinPerder(activePaneId, delta).then((navego) => navego && sincronizarUrl(ctx.navegar));
}

// ── crear y mostrar/ocultar (`FUN-XL-04`, Parte 4) ──

/** El ícono de cada opción de «Nuevo…»: el del tipo de archivo, como en el árbol. */
const ICONO_NUEVO: Record<OpcionNuevo["tipo"], IconoComando> = {
  nota: ICONO_POR_TIPO.markdown,
  carpeta: FolderPlus,
  lienzo: ICONO_POR_TIPO.canvas,
  tabla: ICONO_POR_TIPO.base,
  dibujo: ICONO_POR_TIPO.excalidraw,
  diagrama: ICONO_POR_TIPO.drawio,
  espora: CircleDot,
};

/**
 * Las secciones del rail que se abren con un comando propio. La búsqueda
 * (`busqueda.vault`) y la salud (`salud.panel`) ya tenían el suyo.
 */
const SECCIONES_DEL_RAIL: readonly { id: string; seccion: RailSection; titulo: string; icono: IconoComando }[] = [
  { id: "explorador", seccion: "explorer", titulo: "Abrir el explorador", icono: Files },
  { id: "esporas", seccion: "esporas", titulo: "Abrir el panel de Esporas", icono: CircleDot },
  { id: "calendario", seccion: "calendario", titulo: "Abrir el panel del calendario", icono: CalendarDays },
  { id: "consolas", seccion: "terminal", titulo: "Abrir el panel de consolas", icono: Terminal },
  { id: "actividad", seccion: "actividad", titulo: "Abrir la actividad de la IA", icono: Bot },
  { id: "papelera", seccion: "trash", titulo: "Abrir la papelera", icono: Trash2 },
];

/**
 * Abre una sección en el panel izquierdo (no la alterna: si ya está, se queda)
 * y le pone el foco: el árbol en el explorador, el campo en la búsqueda, lo
 * primero en el resto. Si el panel muestra una pestaña anclada a pantalla
 * completa, vuelve a la sección.
 */
function abrirSeccion(seccion: RailSection) {
  usePanelLayoutStore.setState({ activeSection: seccion, lastSection: seccion });
  const dock = useSidebarViewerStore.getState();
  if (dock.mode === "full" && dock.tabs.includes(dock.activeTab)) dock.activar(EXPLORER_TAB);
  enfocarSeccionIzquierda(seccion === "search");
}

/** Oculta el panel izquierdo; si el foco estaba ahí, pasa al documento activo y no se pierde en `body`. */
function ocultarPanelIzquierdo() {
  const teniaElFoco = focoEnElPanelIzquierdo();
  usePanelLayoutStore.setState({ activeSection: null });
  if (teniaElFoco) enfocarDocumentoActivo(false);
}

/** ¿El panel activo tiene una pestaña a la vista? */
function hayPestanaActiva() {
  const { root, activePaneId } = useTabsStore.getState();
  return !!findLeaf(root, activePaneId)?.activeTabId;
}

/**
 * Divide el panel activo como el menú «⋯» de su barra de pestañas: el mismo
 * archivo a los dos lados si se puede (`FUN-S-35`).
 */
function dividirPanelActivo(ctx: ContextoComando, lado: "right" | "bottom") {
  const tabs = useTabsStore.getState();
  const notaId = tabs.activeNotaId();
  if (!notaId) return;
  const tipo = useVaultStore.getState().notas.find((n) => n.id === notaId)?.tipo;
  tabs.splitActivePane(tabs.activePaneId, lado, seDuplicaAlDividir(notaId, tipo));
  sincronizarUrl(ctx.navegar);
  enfocarDocumentoActivo(false);
}

/**
 * Cierra el panel activo de la división: sus pestañas una por una, sin perder
 * lo de una nota en conflicto con el disco (`DEF-138`). Si una no se cierra,
 * se detiene ahí.
 */
async function cerrarPanelActivo(ctx: ContextoComando) {
  const { root, activePaneId } = useTabsStore.getState();
  const hoja = findLeaf(root, activePaneId);
  if (!hoja || allLeaves(root).length < 2) return;
  for (const t of [...hoja.tabs]) {
    if (!(await cerrarPestanaSinPerder(activePaneId, t.id))) break;
  }
  sincronizarUrl(ctx.navegar);
  enfocarDocumentoActivo(false);
}

/**
 * Ancla la pestaña activa en el panel lateral, como arrastrarla ahí: se cierra
 * en el área de trabajo y se ve debajo de la sección (`DEF-023 P3`). Abre el
 * panel si estaba cerrado.
 */
async function anclarPestanaActiva(ctx: ContextoComando) {
  const { root, activePaneId } = useTabsStore.getState();
  const hoja = findLeaf(root, activePaneId);
  const tab = hoja?.tabs.find((t) => t.id === hoja.activeTabId);
  if (!tab) return;
  if (!(await cerrarPestanaSinPerder(activePaneId, tab.id))) return;
  useSidebarViewerStore.getState().dock(tab.notaId);
  if (usePanelLayoutStore.getState().activeSection === null) usePanelLayoutStore.getState().toggleLeft();
  sincronizarUrl(ctx.navegar);
  enfocarDocumentoActivo(false);
}

/**
 * Pasa a la pestaña anclada siguiente o anterior del panel lateral. A pantalla
 * completa, la sección cuenta como una pestaña más (la primera).
 */
function ciclarAnclada(delta: -1 | 1) {
  const { tabs, activeTab, mode, activar } = useSidebarViewerStore.getState();
  const lista = mode === "full" ? [EXPLORER_TAB, ...tabs] : tabs;
  if (!lista.length) return;
  const i = lista.indexOf(activeTab);
  activar(lista[i < 0 ? (delta > 0 ? 0 : lista.length - 1) : (i + delta + lista.length) % lista.length]);
  if (usePanelLayoutStore.getState().activeSection === null) usePanelLayoutStore.getState().toggleLeft();
}

/** Atmósfera del modo en uso (la del otro modo se cambia en Configuración). */
const claveAtmosfera = () =>
  usePreferencesStore.getState().modoOscuro ? ("atmosferaOscuro" as const) : ("atmosferaClaro" as const);

/** Las vistas de una nota, en el orden de sus atajos (Ctrl+1..4). */
const VISTAS_DE_NOTA = [
  { id: "en-vivo", modo: "live", nombre: "En vivo", icono: PenLine },
  { id: "dividido", modo: "split", nombre: "Dividido", icono: Columns2 },
  { id: "lectura", modo: "read", nombre: "Lectura", icono: BookOpenText },
  { id: "crudo", modo: "raw", nombre: "Crudo", icono: FileCode },
] as const;

export const COMANDOS_APP: readonly Comando[] = [
  // Ctrl+N (`FUN-XL-04`, Parte 4): en la carpeta seleccionada del explorador,
  // o en la raíz, con el título en edición para nombrarla enseguida.
  {
    id: "nota.nueva",
    titulo: "Nueva nota",
    detalle: "En la carpeta seleccionada",
    icono: FilePlus,
    categoria: "notas",
    atajos: [{ ctrl: true, code: "KeyN" }],
    ejecutar: (ctx) => crearYAbrir(ctx.navegar, "nota"),
  },
  // Ctrl+Shift+N: el menú «Nuevo…», con flechas, Enter y Esc.
  {
    id: "crear.nuevo",
    titulo: "Nuevo…",
    detalle: "Nota, carpeta, canvas, base, dibujo, diagrama o desde una Espora",
    icono: FilePlus2,
    categoria: "notas",
    atajos: [{ ctrl: true, shift: true, code: "KeyN" }],
    ejecutar: () => {
      const ui = useUiStore.getState();
      ui.setNuevo(ui.nuevo ? null : "tipos");
    },
  },
  ...OPCIONES_NUEVO.filter((o) => o.tipo !== "nota").map(
    (o): Comando => ({
      id: o.comando,
      titulo: o.titulo,
      detalle: o.tipo === "espora" ? "Elegir la plantilla" : "En la carpeta seleccionada",
      icono: ICONO_NUEVO[o.tipo],
      categoria: "notas",
      ejecutar: (ctx) => {
        if (o.tipo === "espora") return useUiStore.getState().setNuevo("esporas");
        if (o.tipo === "carpeta") return pedirYCrearCarpeta(carpetaDestino());
        return crearYAbrir(ctx.navegar, o.tipo);
      },
    }),
  ),
  // La captura rápida (FUN-L-33). Su tecla la atiende `CapturaRapida`, en
  // captura. Un cuadro después, para que la paleta termine de cerrarse y
  // devolver el foco antes de que la cajita lo tome.
  {
    id: "bandeja.capturar",
    titulo: "Captura rápida",
    detalle: "anotar en la Bandeja del vault",
    icono: Inbox,
    categoria: "notas",
    atajos: [{ ctrl: true, shift: true, code: "Space" }],
    manejadorPropio: true,
    ejecutar: () => {
      requestAnimationFrame(() => useUiStore.getState().setCaptura(true));
    },
  },
  // Ctrl+Shift+F (`FUN-XL-04`, Parte 4): la búsqueda global con el cursor en
  // su campo, como en VS Code y Obsidian.
  {
    id: "busqueda.vault",
    titulo: "Buscar en el contenido del vault",
    icono: Search,
    categoria: "navegacion",
    atajos: [{ ctrl: true, shift: true, code: "KeyF" }],
    ignorarSiPrevenido: true,
    ejecutar: () => abrirSeccion("search"),
  },
  {
    id: "grafo.abrir",
    titulo: "Abrir el grafo de conexiones",
    icono: IconoGrafo,
    categoria: "navegacion",
    ejecutar: (ctx) => abrirNota(ctx.navegar, GRAPH_TAB_ID),
  },
  {
    id: "calendario.abrir",
    titulo: "Abrir el calendario",
    icono: CalendarDays,
    categoria: "navegacion",
    ejecutar: (ctx) => abrirNota(ctx.navegar, CALENDAR_TAB_ID),
  },
  // Salud del vault (FUN-L-30): el mismo panel que el ícono del rail.
  {
    id: "salud.panel",
    titulo: "Revisar la salud del vault",
    detalle: "Enlaces rotos, huérfanas y títulos duplicados",
    icono: HeartPulse,
    categoria: "vault",
    ejecutar: () => abrirSeccion("salud"),
  },
  // La pestaña de salud (FUN-L-32): el tablero con las gráficas. Cierra el
  // panel de salud si es el que está a la vista.
  {
    id: "salud.pestana",
    titulo: "Abrir la salud del vault en una pestaña",
    detalle: "El tablero: qué hay, qué pesa, la red y los problemas",
    icono: ICONO_SALUD,
    categoria: "vault",
    ejecutar: (ctx) => abrirPestanaSalud((id) => ctx.navegar(urlDeNota(id))),
  },
  // El informe como nota (FUN-L-32): revisa, lo guarda en la carpeta de
  // informes y lo abre. Los fallos los avisa `generarInformeSalud`.
  {
    id: "salud.informe",
    titulo: "Generar informe de salud del vault",
    detalle: "Una nota con los problemas y las gráficas",
    icono: FileText,
    categoria: "vault",
    ejecutar: async (ctx) => {
      const { generarInformeSalud } = await import("@/lib/informeSaludVault");
      await generarInformeSalud({ navegar: (id) => ctx.navegar(urlDeNota(id)) }).catch(() => undefined);
    },
  },
  {
    id: "recordatorio.nuevo",
    titulo: "Nuevo recordatorio",
    detalle: "Para hoy, en el calendario",
    icono: BellPlus,
    categoria: "vault",
    ejecutar: () => nuevoRecordatorio(hoy()),
  },
  // Ctrl+Shift+E (`FUN-XL-04`, Parte 4), además de Ctrl+\ (el panel izquierdo
  // entero). Si el dibujo de Excalidraw ya usó la tecla (exportar), no actúa.
  {
    id: "explorador.alternar",
    titulo: "Mostrar u ocultar el explorador",
    icono: PanelLeft,
    categoria: "paneles",
    atajos: [{ ctrl: true, shift: true, code: "KeyE" }],
    ignorarSiPrevenido: true,
    ejecutar: () => {
      if (usePanelLayoutStore.getState().activeSection === "explorer") ocultarPanelIzquierdo();
      else abrirSeccion("explorer");
    },
  },
  // Cada sección del rail, en el panel izquierdo y con el foco adentro. Sin
  // atajo de fábrica (la búsqueda y la salud tienen los suyos arriba).
  ...SECCIONES_DEL_RAIL.map(
    (s): Comando => ({
      id: `seccion.${s.id}`,
      titulo: s.titulo,
      icono: s.icono,
      categoria: "navegacion",
      ejecutar: () => abrirSeccion(s.seccion),
    }),
  ),
  // Dividir, cerrar el panel y anclar (`FUN-XL-04`, Parte 4): lo del menú «⋯»
  // de la barra de pestañas, sin mouse.
  {
    id: "panel.dividir-derecha",
    titulo: "Dividir a la derecha",
    detalle: "El mismo archivo a los dos lados",
    icono: Columns2,
    categoria: "paneles",
    disponible: () => hayPestanaActiva(),
    ejecutar: (ctx) => dividirPanelActivo(ctx, "right"),
  },
  {
    id: "panel.dividir-abajo",
    titulo: "Dividir hacia abajo",
    detalle: "El mismo archivo arriba y abajo",
    icono: Rows2,
    categoria: "paneles",
    disponible: () => hayPestanaActiva(),
    ejecutar: (ctx) => dividirPanelActivo(ctx, "bottom"),
  },
  {
    id: "panel.cerrar",
    titulo: "Cerrar el panel activo",
    detalle: "Cierra todas sus pestañas",
    icono: SquareX,
    categoria: "paneles",
    disponible: () => allLeaves(useTabsStore.getState().root).length > 1,
    ejecutar: (ctx) => cerrarPanelActivo(ctx),
  },
  {
    id: "pestana.anclar-lateral",
    titulo: "Anclar la pestaña en el panel lateral",
    detalle: "Se ve debajo de la sección del panel izquierdo",
    icono: PanelLeftDashed,
    categoria: "pestanas",
    disponible: () => hayPestanaActiva(),
    ejecutar: (ctx) => anclarPestanaActiva(ctx),
  },
  {
    id: "lateral.siguiente",
    titulo: "Siguiente pestaña anclada del panel lateral",
    icono: ArrowLeftRight,
    categoria: "paneles",
    disponible: () => useSidebarViewerStore.getState().tabs.length > 0,
    ejecutar: () => ciclarAnclada(1),
  },
  {
    id: "lateral.anterior",
    titulo: "Pestaña anclada anterior del panel lateral",
    icono: ArrowLeftRight,
    categoria: "paneles",
    disponible: () => useSidebarViewerStore.getState().tabs.length > 0,
    ejecutar: () => ciclarAnclada(-1),
  },
  {
    id: "consola.nueva",
    titulo: "Nueva consola",
    icono: Terminal,
    categoria: "app",
    ejecutar: async (ctx) => {
      const { crearTerminal } = await import("@/lib/terminal");
      ctx.navegar(urlDeNota(crearTerminal()));
    },
  },
  {
    id: "apariencia.modo",
    titulo: () => (usePreferencesStore.getState().modoOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"),
    icono: SunMoon,
    categoria: "apariencia",
    ejecutar: () => usePreferencesStore.getState().toggleDark(),
  },
  // Ctrl+, abre Configuración: el atajo que traen VS Code y Obsidian (crítica
  // de Configuración, 2026-09-20).
  {
    id: "configuracion.abrir",
    titulo: "Abrir la configuración",
    icono: Settings,
    categoria: "app",
    atajos: [{ ctrl: true, code: "Comma" }],
    atajoEnTitulo: true,
    ejecutar: () => useUiStore.getState().setSettingsOpen(true),
  },
  // La ayuda integrada (`FUN-L-27`). F1 lo atiende `AyudaGlobal`, en captura y
  // en toda la app (también en el selector de vaults).
  {
    id: "ayuda.abrir",
    titulo: "Ayuda",
    detalle: "Cómo se usa Mycelium",
    icono: BookOpen,
    categoria: "app",
    atajos: [{ code: "F1" }],
    manejadorPropio: true,
    ejecutar: () => useUiStore.getState().abrirAyuda(),
  },
  // La hoja de atajos (`FUN-XL-04`, Parte 3): Ctrl+Shift+/ —el «?» de un
  // teclado de EE. UU.— por posición (`Slash` con Shift).
  {
    id: "atajos.hoja",
    titulo: "Ver los atajos de teclado",
    detalle: "La hoja con todos los atajos",
    icono: Keyboard,
    categoria: "app",
    atajos: [{ ctrl: true, shift: true, code: "Slash" }],
    ejecutar: () => {
      const ui = useUiStore.getState();
      ui.setHojaAtajos(!ui.hojaAtajos);
    },
  },
  {
    id: "atajos.configurar",
    titulo: "Cambiar los atajos de teclado",
    detalle: "Configuración → Atajos de teclado",
    icono: Keyboard,
    categoria: "app",
    ejecutar: () => useUiStore.getState().abrirAjustes("atajos"),
  },
  // F10: el modo pistas (`FUN-XL-04`, Parte 5): una letra sobre cada cosa
  // clicable; escribirla es el clic. En captura, como F6, para que funcione
  // desde la consola y desde CodeMirror; y siempre con `preventDefault`, que
  // F10 suelta abre el «modo menú» de Windows. Con un diálogo abierto, las
  // pistas son las de adentro del diálogo.
  {
    id: "pistas.mostrar",
    titulo: "Mostrar las pistas para hacer clic con el teclado",
    icono: MousePointerClick,
    categoria: "navegacion",
    atajos: [{ code: "F10" }],
    enCaptura: true,
    // Se abren dos cuadros después: desde la paleta, que se cierra antes de
    // ejecutar, hay que esperar a que React la desmonte; si no, las pistas
    // serían las de la paleta.
    ejecutar: () => {
      if (pistasVisibles()) cerrarPistas();
      else requestAnimationFrame(() => requestAnimationFrame(abrirPistas));
    },
  },
  ...ATMOSFERAS.map(
    (a): Comando => ({
      id: `apariencia.atmosfera-${a.id}`,
      titulo: `Atmósfera: ${a.nombre}`,
      detalle: () => {
        const { modoOscuro, prefs } = usePreferencesStore.getState();
        return prefs[claveAtmosfera()] === a.id ? `En uso en modo ${modoOscuro ? "oscuro" : "claro"}` : a.descripcion;
      },
      icono: Palette,
      categoria: "apariencia",
      ejecutar: () => usePreferencesStore.getState().setPref(claveAtmosfera(), a.id),
    }),
  ),
  // ── Comandos de desarrollador (`FUN-S-36`): solo con el modo dev ──
  {
    id: "dev.desactivar",
    titulo: "Desactivar el modo desarrollador",
    icono: ToggleLeft,
    categoria: "dev",
    soloDev: true,
    ejecutar: () => alternarModoDev(false),
  },
  {
    id: "dev.herramientas",
    titulo: "Abrir las herramientas de desarrollador",
    icono: Wrench,
    categoria: "dev",
    soloDev: true,
    // F12 y Ctrl+Shift+I los atiende `DevToolsHotkey`, para todos y según el
    // interruptor del vault; este comando no depende de él (`forzar`).
    atajos: [{ code: "F12" }, { ctrl: true, shift: true, code: "KeyI" }],
    manejadorPropio: true,
    ejecutar: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("alternar_devtools", { forzar: true });
    },
  },

  // ── Atajos globales del workspace (HU-25, HU-29, DEF-040): por ahora fuera
  // de la paleta ──
  // Ctrl+O: ir a una nota. Ctrl+P / Ctrl+Shift+P: paleta de comandos
  // (rediseño del cascarón): los atajos de la categoría en Obsidian y VS Code.
  {
    id: "paleta.notas",
    titulo: "Ir a una nota",
    icono: Search,
    categoria: "navegacion",
    enPaleta: false,
    atajos: [{ ctrl: true, code: "KeyO" }],
    ejecutar: () => useUiStore.getState().setPaleta("notas"),
  },
  {
    id: "paleta.comandos",
    titulo: "Ejecutar un comando",
    icono: Command,
    categoria: "navegacion",
    enPaleta: false,
    atajos: [
      { ctrl: true, code: "KeyP" },
      { ctrl: true, shift: true, code: "KeyP" },
    ],
    ejecutar: () => useUiStore.getState().setPaleta("comandos"),
  },
  // Ctrl+F abre la búsqueda en la nota, no el buscador del navegador.
  {
    id: "nota.buscar",
    titulo: "Buscar en la nota",
    icono: TextSearch,
    categoria: "notas",
    enPaleta: false,
    atajos: [{ ctrl: true, code: "KeyF" }],
    ejecutar: () => useUiStore.getState().setSearchInNoteOpen(true),
  },
  {
    id: "panel-izquierdo.alternar",
    titulo: "Mostrar u ocultar el panel izquierdo",
    icono: PanelLeft,
    categoria: "paneles",
    enPaleta: false,
    atajos: [{ ctrl: true, code: "Backslash" }],
    ejecutar: () => {
      if (usePanelLayoutStore.getState().activeSection === null) {
        usePanelLayoutStore.getState().toggleLeft();
      } else {
        ocultarPanelIzquierdo();
      }
    },
  },
  // El panel derecho es de cada pane (`DEF-060`): actúa sobre el que tiene el foco.
  {
    id: "panel-derecho.alternar",
    titulo: "Mostrar u ocultar el panel de la nota",
    icono: PanelRight,
    categoria: "paneles",
    enPaleta: false,
    atajos: [{ ctrl: true, shift: true, code: "Backslash" }],
    ejecutar: () => {
      const { activePaneId, togglePanelMeta } = useTabsStore.getState();
      togglePanelMeta(activePaneId);
    },
  },
  // Ctrl+Tab / Ctrl+Shift+Tab: ciclar las pestañas del pane activo, en el
  // orden en que están. Es el atajo que trae quien viene de VS Code.
  {
    id: "pestana.siguiente",
    titulo: "Pestaña siguiente",
    icono: ArrowLeftRight,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ ctrl: true, code: "Tab" }],
    ejecutar: (ctx) => ciclarPestana(ctx, 1),
  },
  {
    id: "pestana.anterior",
    titulo: "Pestaña anterior",
    icono: ArrowLeftRight,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ ctrl: true, shift: true, code: "Tab" }],
    ejecutar: (ctx) => ciclarPestana(ctx, -1),
  },
  {
    id: "pestana.cerrar",
    titulo: "Cerrar la pestaña",
    icono: X,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ ctrl: true, code: "KeyW" }],
    ejecutar: (ctx) => {
      // Sin perder lo de una nota en conflicto con el disco (`DEF-138`).
      const { activePaneId, root } = useTabsStore.getState();
      const activa = findLeaf(root, activePaneId)?.activeTabId;
      const veniaEscribiendo = escribiendoEnEditor();
      if (activa) {
        void cerrarPestanaSinPerder(activePaneId, activa).then((cerrada) => {
          if (!cerrada) return;
          sincronizarUrl(ctx.navegar);
          // El foco no puede quedar en `body` (ni meterse en una consola).
          enfocarDocumentoActivo(veniaEscribiendo);
        });
      }
    },
  },
  {
    id: "pestana.reabrir",
    titulo: "Reabrir la última pestaña cerrada",
    icono: Undo2,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ ctrl: true, shift: true, code: "KeyT" }],
    ejecutar: (ctx) => {
      const veniaEscribiendo = escribiendoEnEditor();
      useTabsStore.getState().reopenLastClosed();
      sincronizarUrl(ctx.navegar);
      enfocarDocumentoActivo(veniaEscribiendo);
    },
  },
  // Alt+←/→: historial de la pestaña activa (DEF-040). Si el editor ya
  // consumió la pulsación, no se duplica la acción.
  {
    id: "historial.atras",
    titulo: "Atrás en el historial de la pestaña",
    icono: History,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ alt: true, code: "ArrowLeft" }],
    ignorarSiPrevenido: true,
    ejecutar: (ctx) => navegarHistorialActivo(ctx, -1),
  },
  {
    id: "historial.adelante",
    titulo: "Adelante en el historial de la pestaña",
    icono: History,
    categoria: "pestanas",
    enPaleta: false,
    atajos: [{ alt: true, code: "ArrowRight" }],
    ignorarSiPrevenido: true,
    ejecutar: (ctx) => navegarHistorialActivo(ctx, 1),
  },

  // ── Zonas y paneles (`FUN-XL-04`, Parte 2) ──
  // F6 / Shift+F6 recorren las zonas: rail, panel izquierdo, cada panel de la
  // división (y su panel de enlaces), barra de estado. En captura, para salir
  // también de la consola y de CodeMirror. Con un diálogo modal abierto, no.
  {
    id: "zona.siguiente",
    titulo: "Ir a la zona siguiente",
    icono: SquareDashedMousePointer,
    categoria: "navegacion",
    enPaleta: false,
    atajos: [{ code: "F6" }],
    enCaptura: true,
    disponible: () => !hayModalAbierto(),
    ejecutar: () => irAZona(1),
  },
  {
    id: "zona.anterior",
    titulo: "Ir a la zona anterior",
    icono: SquareDashedMousePointer,
    categoria: "navegacion",
    enPaleta: false,
    atajos: [{ shift: true, code: "F6" }],
    enCaptura: true,
    disponible: () => !hayModalAbierto(),
    ejecutar: () => irAZona(-1),
  },
  // Ctrl+Alt+←/→: al panel contiguo de la pantalla dividida. ↑/↓ no: con
  // Ctrl+Alt son el multicursor de CodeMirror.
  {
    id: "panel.izquierda",
    titulo: "Ir al panel de la izquierda",
    icono: Columns2,
    categoria: "paneles",
    enPaleta: false,
    atajos: [{ ctrl: true, alt: true, code: "ArrowLeft" }],
    disponible: () => !hayModalAbierto(),
    ejecutar: () => irAPanelContiguo("izquierda"),
  },
  {
    id: "panel.derecha",
    titulo: "Ir al panel de la derecha",
    icono: Columns2,
    categoria: "paneles",
    enPaleta: false,
    atajos: [{ ctrl: true, alt: true, code: "ArrowRight" }],
    disponible: () => !hayModalAbierto(),
    ejecutar: () => irAPanelContiguo("derecha"),
  },

  // ── Las vistas de una nota (`FUN-XL-04`, Parte 3) ──
  // Ctrl+1..4: En vivo, Dividido, Lectura, Crudo. Antes las atendía
  // `NoteEditor` por `e.key`, que da «1» también en el teclado numérico: ahora
  // van por posición (`Digit1`…`Digit4`), y Ctrl+Num1..4 quedan libres (regla
  // del usuario, 2026-11-06). El editor del panel activo escucha el evento.
  ...VISTAS_DE_NOTA.map(
    (v, i): Comando => ({
      id: `editor.vista-${v.id}`,
      titulo: `Cambiar a la vista ${v.nombre}`,
      icono: v.icono,
      categoria: "editor",
      enPaleta: false,
      atajos: [{ ctrl: true, code: `Digit${i + 1}` }],
      ejecutar: () => window.dispatchEvent(new CustomEvent(EVENTO_VISTA_NOTA, { detail: v.modo })),
    }),
  ),
];
