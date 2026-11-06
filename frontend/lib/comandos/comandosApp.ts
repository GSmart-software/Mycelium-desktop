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
} from "lucide-react";
import { IconoGrafo } from "@/components/workspace/IconoGrafo";
import { ATMOSFERAS } from "@/lib/atmosferas";
import { cerrarPestanaSinPerder, navegarHistorialSinPerder } from "@/lib/conflictosAbiertos";
import { ICONO_SALUD } from "@/lib/iconosDeTipo";
import { avisoModoDev } from "@/lib/modoDev";
import { CALENDAR_TAB_ID, GRAPH_TAB_ID } from "@/lib/pestanas";
import { abrirPestanaSalud } from "@/lib/saludPestana";
import { avisar } from "@/stores/avisosStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { hoy, nuevoRecordatorio } from "@/stores/recordatoriosStore";
import { allLeaves, findLeaf, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useVaultStore } from "@/stores/vaultStore";
import {
  enfocarDocumentoActivo,
  escribiendoEnEditor,
  hayModalAbierto,
  irAPanelContiguo,
  irAZona,
} from "@/lib/teclado/focoDom";
import { abrirNota, sincronizarUrl, urlDeNota } from "./navegar";
import type { Comando, ContextoComando } from "./registro";

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

/** Atmósfera del modo en uso (la del otro modo se cambia en Configuración). */
const claveAtmosfera = () =>
  usePreferencesStore.getState().modoOscuro ? ("atmosferaOscuro" as const) : ("atmosferaClaro" as const);

export const COMANDOS_APP: readonly Comando[] = [
  {
    id: "nota.nueva",
    titulo: "Nueva nota",
    detalle: "En la carpeta seleccionada",
    icono: FilePlus,
    categoria: "notas",
    ejecutar: async (ctx) => {
      const v = useVaultStore.getState();
      abrirNota(ctx.navegar, await v.createNota(v.activeFolderId), { editarTitulo: true });
    },
  },
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
  {
    id: "busqueda.vault",
    titulo: "Buscar en el contenido del vault",
    icono: Search,
    categoria: "navegacion",
    ejecutar: () => usePanelLayoutStore.setState({ activeSection: "search", lastSection: "search" }),
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
    ejecutar: () => usePanelLayoutStore.setState({ activeSection: "salud", lastSection: "salud" }),
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
  {
    id: "explorador.alternar",
    titulo: "Mostrar u ocultar el explorador",
    icono: PanelLeft,
    categoria: "paneles",
    muestraAtajoDe: "panel-izquierdo.alternar",
    ejecutar: () => usePanelLayoutStore.getState().toggleSection("explorer"),
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
    ejecutar: () => usePanelLayoutStore.getState().toggleLeft(),
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
];
