"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ImportDialogs } from "@/components/explorer/ImportDialogs";
import { PaneTree } from "@/components/panes/PaneTree";
import { Recordatorios } from "@/components/recordatorios/TarjetaRecordatorio";
import { AppTopbar } from "@/components/workspace/AppTopbar";
import { Avisos } from "@/components/workspace/Avisos";
import { BarraEstado } from "@/components/workspace/BarraEstado";
import { DialogoConfirmar } from "@/components/workspace/DialogoConfirmar";
import { PaletaComandos } from "@/components/workspace/PaletaComandos";
import { CapturaRapida } from "@/components/workspace/CapturaRapida";
import { FileOpenBridge } from "@/components/workspace/FileOpenBridge";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { Rail } from "@/components/workspace/Rail";
import { UpdateDialog } from "@/components/workspace/UpdateDialog";
import { useAuthStore } from "@/stores/authStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useUiStore } from "@/stores/uiStore";
import { useTabsStore } from "@/stores/tabsStore";
import { navegarHistorialSinPerder } from "@/lib/conflictosAbiertos";
import { COMANDOS_APP } from "@/lib/comandos/comandosApp";
import { sincronizarUrl } from "@/lib/comandos/navegar";
import { useDespachadorAtajos, useRegistrarComandos } from "@/lib/comandos/useComandos";
import { useTecladoZonas } from "@/lib/teclado/useTecladoZonas";
import { useRecientesStore } from "@/stores/recientesStore";
import { useVaultStore } from "@/stores/vaultStore";
import { AperturaVault } from "@/components/vault/AperturaVault";
import { FranjaVentana } from "@/components/ventana/FranjaVentana";
import { rutaVaultPersistida, useVaultSessionStore } from "@/stores/vaultSessionStore";
import { registrarNavegadorMcp } from "@/lib/mcpControl";
import { listarOtrosArchivos, RUTA_MYCIGNORE } from "@/lib/otrosArchivos";
import { escucharCambiosVault } from "@/lib/vaultWatch";
import styles from "./workspace.module.css";
// Las fórmulas (`FUN-M-58`): el editor en vivo, la lectura, los embeds, las
// tarjetas y la exportación a PDF —que copia las hojas de la ventana— viven
// todos en el workspace. Antes iba en el layout raíz, en todas las rutas.
import "katex/dist/katex.min.css";

export default function WorkspacePage() {
  return (
    <Suspense>
      <FileOpenBridge />
      <WorkspaceGuard />
    </Suspense>
  );
}

/**
 * Guard del workspace: sin un vault abierto no hay nada que mostrar, porque sin
 * vault no hay capa de datos. Si se entra directo a `/workspace` tras una recarga
 * (o en una ventana nueva, `?vault=`) y no hay vault abierto en runtime, primero
 * se reabre ese vault; si no hay ninguno que reabrir, o no se pudo, se va a la
 * selección de vaults. Hasta el 2026-09-26 ese caso caía en un workspace vacío,
 * sin carpeta: el «modo SQLite clásico», ya retirado.
 */
function WorkspaceGuard() {
  const router = useRouter();
  const bootstrapRef = useRef(false);
  // Suscrito, no leído con `getState()`: si no, al cambiar `abriendo` este
  // componente no se volvería a pintar y la pantalla de carga no aparecería (ni
  // se iría) nunca.
  const abriendoVault = useVaultSessionStore((s) => s.abriendo);
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);

  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    let cancelado = false;
    void (async () => {
      // Reabrir el vault si no hay uno abierto.
      //
      // Dos orígenes, y el orden importa: `?vault=` lo pone la ventana NUEVA que
      // abre `FUN-L-16` —arranca con su `sessionStorage` vacío, así que el vault
      // tiene que viajar en la URL— y manda sobre lo persistido, que es de esta
      // ventana y de una sesión anterior.
      if (useVaultSessionStore.getState().rutaActual !== null) return;
      const pedido = new URLSearchParams(window.location.search).get("vault");
      const ruta = pedido ?? rutaVaultPersistida();
      // Si no hay vault que reabrir, o no se pudo —lo mas probable es que ya lo
      // tenga otra ventana (`FUN-L-16`): reclamarlo falla a proposito—, se va al
      // selector para elegir otro: es lo unico util que se puede hacer desde aca.
      const ok = ruta !== null && (await useVaultSessionStore.getState().abrir(ruta));
      if (!ok && !cancelado) router.replace("/vaults");
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // El tema, la tipografía y el CSS propio (HU-12/14/13) los aplica
  // `vaultSessionStore.abrir` al cargar los ajustes del vault: son del vault.

  if (rutaVault === null) {
    // El vault también se abre solo al arrancar (ajuste "abrir el último"), y
    // ese camino mostraba un «Cargando…» mudo: el defecto pedía la misma
    // pantalla de carga en los dos (`DEF-042`).
    if (abriendoVault) return <AperturaVault />;
    return (
      <main className={styles.loading}>
        <FranjaVentana />
        <p>Cargando…</p>
      </main>
    );
  }

  return <WorkspaceShell />;
}

/**
 * Shell del workspace: grid de 4 columnas × 2 filas (docs/DESIGN_SYSTEM.md).
 * HU-38 (topbar) + HU-28 (rail) + HU-29 (paneles) + HU-20 (URL ?note=).
 */
function WorkspaceShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeNoteId = searchParams.get("note");

  // Un selector por campo (`FUN-M-58`, A-H8): con el store entero, cada
  // `setRightWidth` —uno por `pointermove` al redimensionar el panel de la
  // nota— volvía a dibujar el shell y todo lo que cuelga de él.
  const activeSection = usePanelLayoutStore((s) => s.activeSection);
  const leftWidth = usePanelLayoutStore((s) => s.leftWidth);
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;
  const notas = useVaultStore((s) => s.notas);
  const reconciledRef = useRef(false);
  const archivosReconciliadosRef = useRef(false);
  // La carpeta abierta: el guard no monta el shell sin ella.
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);

  // Escuchar cambios EXTERNOS del vault en carpeta: el watcher nativo emite
  // `vault-cambios` y `escucharCambiosVault` reindexa (incremental) y refresca la
  // UI. Se re-suscribe si cambia la carpeta abierta y se limpia al desmontar/salir
  // para no duplicar listeners (fase 5, solo-desktop).
  useEffect(() => {
    if (!rutaVault) return;
    let dispose: (() => void) | null = null;
    let vigente = true;
    void escucharCambiosVault().then((unlisten) => {
      if (vigente) dispose = unlisten;
      else unlisten(); // se desmontó antes de resolver: limpiar de inmediato
    });
    return () => {
      vigente = false;
      dispose?.();
    };
  }, [rutaVault]);

  // Comprobación de actualizaciones (FUN-L-14). Va acá, en el shell ya montado,
  // y no en el arranque de la app: así el diálogo solo puede aparecer cuando
  // Mycelium ya es usable, nunca por delante de él. `comprobarAlArrancar` no
  // bloquea, decide sola si toca hoy y calla si no hay conexión, así que este
  // efecto es "dispararlo y olvidarse". Un pequeño retardo deja que el vault
  // termine de cargar antes de competir por la red y por la atención.
  useEffect(() => {
    const t = setTimeout(() => void useUpdaterStore.getState().comprobarAlArrancar(), 4000);
    return () => clearTimeout(t);
  }, []);

  // Cargar el árbol del vault al entrar, aunque el explorador esté colapsado:
  // hace falta para los títulos de las pestañas y para reconciliar el layout
  // restaurado. Idempotente (treeSeq descarta recargas solapadas).
  useEffect(() => {
    if (vaultId && useVaultStore.getState().vaultId !== vaultId) {
      void useVaultStore.getState().loadTree(vaultId);
    }
  }, [vaultId]);

  // Una vez cargado el árbol, descartar del layout restaurado las pestañas cuyas
  // notas ya no existen (borradas mientras el sistema estaba cerrado).
  //
  // Se exige que el árbol sea el de ESTE vault, no solo que no esté vacío
  // (`DEF-044`): es una operación destructiva, y corriéndola contra la lista del
  // vault anterior se llevaba por delante las pestañas recién restauradas.
  // Hoy `abrir()` ya vacía el árbol al cambiar de vault, así que esto no debería
  // poder pasar — pero la comprobación es de una línea y lo que hay al otro lado
  // es perder las pestañas del usuario.
  useEffect(() => {
    if (reconciledRef.current || notas.length === 0) return;
    if (useVaultStore.getState().vaultId !== vaultId) return;
    reconciledRef.current = true;
    useTabsStore.getState().reconcileNotes(new Set(notas.map((n) => n.id)));
  }, [notas, vaultId]);

  // Lo mismo para las pestañas de visor (`FUN-L-11`), que apuntan a archivos que
  // NO están en el índice: su lista válida hay que pedirla aparte, al mismo
  // comando que las lista en el explorador. Sin esto, un archivo borrado o
  // renombrado desde fuera dejaría una pestaña fantasma que falla al pintarse.
  //
  // Corre después del árbol y no en paralelo por lo mismo que arriba: es
  // destructivo, y con el vault todavía cambiando se llevaría por delante
  // pestañas recién restauradas.
  useEffect(() => {
    if (archivosReconciliadosRef.current || !rutaVault) return;
    archivosReconciliadosRef.current = true;
    void listarOtrosArchivos(rutaVault).then((lista) => {
      // El `.mycignore` no está en la lista (empieza con punto) pero su pestaña
      // es legítima (`FUN-S-25`): sin esto se cerraría en cada arranque.
      const validas = new Set(lista.map((a) => a.ruta)).add(RUTA_MYCIGNORE);
      useTabsStore.getState().reconcileArchivos(validas);
    });
  }, [rutaVault]);

  // El MCP de control (`FUN-L-09`) abre pestañas con foco por la misma vía que
  // un clic: poniendo la nota en la URL. Mientras el workspace no esté montado
  // no hay navegador, y los pedidos reciben `OCUPADA`.
  useEffect(() => {
    registrarNavegadorMcp((notaId) => router.replace(`/workspace?note=${encodeURIComponent(notaId)}`));
    return () => registrarNavegadorMcp(null);
  }, [router]);

  // La URL es la fuente de navegación (HU-20): abrir la nota en el pane activo
  useEffect(() => {
    if (!activeNoteId) return;
    useTabsStore.getState().openNote(activeNoteId);
    // Acá y no en `openNote`: esto se dispara con CUALQUIER forma de llegar a
    // una nota (clic en el árbol, enlace, paleta, historial), que es justo lo
    // que «reciente» quiere decir.
    useRecientesStore.getState().recordar(activeNoteId);
  }, [activeNoteId]);

  // Los comandos de la app y sus atajos (`FUN-XL-04`, Parte 1): el catálogo
  // único que lista la paleta. El despachador dispara los atajos globales
  // —Ctrl+O, Ctrl+P, Ctrl+,, Ctrl+F, Ctrl+\, Ctrl+Tab, Ctrl+W, Ctrl+Shift+T,
  // Alt+←/→— desde el registro (HU-25 CA4/CA7, HU-29, DEF-040).
  const navegar = useCallback((url: string) => router.replace(url), [router]);
  useRegistrarComandos(COMANDOS_APP);
  useDespachadorAtajos(navegar);
  // Las zonas del teclado, su resaltado y los dos modos de los documentos
  // (navegar / escribir, Esc y Enter) (`FUN-XL-04`, Parte 2).
  useTecladoZonas();

  /**
   * Botones auxiliares del ratón (DEF-040): 3 = atrás, 4 = adelante. Hasta
   * ahora navegaban el historial del WEBVIEW (la pila de `router.push` de todas
   * las aperturas, global y sin relación con el pane), que es justamente lo que
   * hacía que "atrás" mostrara cualquier cosa — e incluso podía salirse del
   * workspace. Se cancelan en `mousedown`/`auxclick` (así Chromium no navega) y
   * se enrutan al historial de la pestaña activa.
   */
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      const { activePaneId } = useTabsStore.getState();
      // Sin perder lo de una nota en conflicto con el disco (`DEF-177`).
      void navegarHistorialSinPerder(activePaneId, event.button === 3 ? -1 : 1).then(
        (navego) => navego && sincronizarUrl(navegar),
      );
    }
    function onAuxClick(event: MouseEvent) {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    }
    window.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("auxclick", onAuxClick, { capture: true });
    return () => {
      window.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("auxclick", onAuxClick, { capture: true });
    };
  }, [navegar]);

  return (
    <div
      className={styles.workspace}
      style={
        {
          "--mic-panel-left-width": activeSection !== null ? `${leftWidth}px` : "0px",
        } as React.CSSProperties
      }
    >
      {/* Primera parada de Tab: sin esto, llegar a la nota con el teclado
          costaba recorrer barra superior, rail y el árbol entero. */}
      <a href="#contenido" className={styles.saltar} onClick={saltarALaNota}>
        Saltar a la nota
      </a>
      <AppTopbar />
      <Rail />
      <LeftPanel />
      <EditorArea />
      <BarraEstado />
      <AjustesPerezosos />
      <ImportDialogs />
      <UpdateDialog />
      <PaletaComandos />
      {/* La captura rápida (FUN-L-33): Ctrl+Shift+Espacio. */}
      <CapturaRapida />
      <Avisos />
      {/* Tarjetas de aviso y modal del calendario (FUN-L-22). */}
      <Recordatorios />
      <DialogoConfirmar />
    </div>
  );
}

/**
 * «Saltar a la nota»: deja el foco donde se escribe o se lee, no en el `<main>`
 * vacío. Con varios panes, en el que tiene la pestaña activa; si no hay nota
 * abierta, en el `<main>` mismo.
 */
/**
 * Configuración se carga recién la primera vez que se abre (`FUN-M-58`, C-H4
 * de la auditoría de eficiencia del 2026-11-01): con sus diez secciones, el
 * editor de CSS y el framework de IA que importa `VaultSection`, eran cientos
 * de KB que el workspace cargaba de entrada para una ventana que casi nunca
 * está abierta. El fallback es nulo: el chunk sale del disco de la app y la
 * ventana aparece en el mismo instante.
 */
const VentanaAjustes = dynamic(
  () => import("@/components/settings/VentanaAjustes").then((m) => m.VentanaAjustes),
  { ssr: false },
);

/**
 * Monta la ventana en la primera apertura y la deja montada: así conserva,
 * como antes, la categoría que el usuario dejó elegida entre una apertura y
 * otra (cerrada, `VentanaAjustes` devuelve `null`).
 */
function AjustesPerezosos() {
  const abierto = useUiStore((s) => s.settingsOpen);
  const [usada, setUsada] = useState(false);
  if (abierto && !usada) setUsada(true);
  return usada || abierto ? <VentanaAjustes /> : null;
}

function saltarALaNota(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const main = document.getElementById("contenido");
  const destino =
    main?.querySelector<HTMLElement>(".cm-content") ??
    main?.querySelector<HTMLElement>(".mic-preview") ??
    main;
  // La vista de lectura es un <div>: sin el atributo no recibe el foco.
  if (destino && !destino.isContentEditable && !destino.hasAttribute("tabindex")) {
    destino.tabIndex = -1;
  }
  destino?.focus();
}

/** Área central: árbol de panes con pestañas (HU-25/26/27). Es el `<main>` del
 *  workspace: el landmark al que salta un lector de pantalla para ir al
 *  contenido, salteando la barra superior, el rail y el explorador. */
function EditorArea() {
  const root = useTabsStore((s) => s.root);
  return (
    <main id="contenido" tabIndex={-1} className={styles.editorArea}>
      <PaneTree node={root} />
    </main>
  );
}
