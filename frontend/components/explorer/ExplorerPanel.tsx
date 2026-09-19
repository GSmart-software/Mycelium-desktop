"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  Folder,
  FolderPlus,
  Upload,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICONO_OTRO_ARCHIVO, ICONO_POR_TIPO } from "@/lib/iconosDeTipo";
import { revelarEnSistema } from "@/lib/db/vaultFs";
import { api } from "@/lib/api";
import { baseInicial } from "@/lib/bases";
import { canvasInicial } from "@/lib/canvas";
import { carpetaEsporas, crearNotaDesdeEspora, listarEsporas } from "@/lib/esporasVault";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { listarOtrosArchivos, tabIdDeArchivo, type OtroArchivo } from "@/lib/otrosArchivos";
import { collectFromDataTransfer, collectFromFileList } from "@/lib/import";
import { useAuthStore } from "@/stores/authStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useImportStore } from "@/stores/importStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { HAY_COMPARTIR } from "@/lib/capacidades";
import { SharedSection } from "./SharedSection";
import {
  useVaultStore,
  type NotaTipo,
  type TreeCarpeta,
  type TreeNota,
} from "@/stores/vaultStore";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { MenuNuevo, type ItemNuevo } from "./MenuNuevo";
import styles from "./ExplorerPanel.module.css";
import { confirmar } from "@/lib/confirmar";

/**
 * DEF-023 P2: pane y zona (borde = dividir / centro = abrir) bajo un punto de
 * pantalla, por geometría de los cuerpos de pane (`[data-pane-id]`). Se usa el
 * punto REAL del puntero (no `elementFromPoint`, que en el WebView de Tauri
 * devuelve el ghost). `null` si el punto no cae en ningún pane.
 */
function paneObjetivoEnPunto(
  x: number,
  y: number,
): { paneId: string; edge: "top" | "bottom" | "left" | "right" | "center" } | null {
  const UMBRAL = 56; // px desde el borde para dividir; más adentro = centro
  for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const d = { top: y - r.top, bottom: r.bottom - y, left: x - r.left, right: r.right - x };
    const min = Math.min(d.top, d.bottom, d.left, d.right);
    const edge =
      min > UMBRAL
        ? "center"
        : min === d.top
          ? "top"
          : min === d.bottom
            ? "bottom"
            : min === d.left
              ? "left"
              : "right";
    return { paneId: el.dataset.paneId!, edge };
  }
  return null;
}

/**
 * Colisión para el arrastre interno: como la zona de cada carpeta cubre también
 * su contenido, varias zonas anidadas (y la raíz) se solapan bajo el puntero.
 * Gana la MÁS PEQUEÑA, que es la carpeta más profunda; la raíz (la mayor) solo
 * si el puntero no está dentro de ninguna carpeta. Así, soltar en el hueco de
 * una carpeta deja el archivo DENTRO de ella y no en la raíz.
 *
 * DEF-023 P2: si el PUNTERO está sobre un pane del área de trabajo, no colisiona
 * con ninguna carpeta (devuelve []), para que soltar ahí solo abra/divida y NO
 * mueva el archivo en el explorador (la decisión sigue al puntero, no al ghost).
 */
const dropMasProfundo: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (p && paneObjetivoEnPunto(p.x, p.y)) return [];
  const dentro = pointerWithin(args);
  if (dentro.length === 0) return rectIntersection(args);
  const area = (id: string | number) => {
    const r = args.droppableRects.get(id);
    return r ? r.width * r.height : Number.POSITIVE_INFINITY;
  };
  return [...dentro].sort((a, b) => area(a.id) - area(b.id));
};

type MenuState = { x: number; y: number; items: MenuItem[] } | null;
type RenameState = { type: "carpeta" | "nota"; id: string; valor: string } | null;

/**
 * Explorer del vault (HU-22/23/24): árbol de carpetas anidadas y notas,
 * menú contextual, rename inline, drag & drop y deshacer con Ctrl+Z.
 */

// Alias de los íconos de «crear»: JSX necesita un identificador con mayúscula.
// Salen del mismo mapa que el árbol y las pestañas, para que el botón que crea
// una tabla lleve el ícono con el que esa tabla se va a ver después.
const IconoDibujo = ICONO_POR_TIPO.excalidraw;
const IconoBase = ICONO_POR_TIPO.base;
const IconoCanvas = ICONO_POR_TIPO.canvas;

export function ExplorerPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeNoteId = searchParams.get("note");

  const vaults = useAuthStore((s) => s.vaults);
  // Ruta del vault en carpeta abierto (null en modo SQLite clásico): habilita
  // "Mostrar en el explorador", que solo tiene sentido con archivos en disco.
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const store = useVaultStore();
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<RenameState>(null);
  // Destino de un arrastre de archivos DESDE el SO (DEF-036/036b): id de la
  // carpeta bajo el cursor, `null` = raíz, `undefined` = no hay arrastre.
  const [osDropTarget, setOsDropTarget] = useState<string | null | undefined>(undefined);
  const [archivosCollapsed, setArchivosCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("mic-sec-archivos") === "1",
  );
  const toggleArchivos = () =>
    setArchivosCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mic-sec-archivos", next ? "1" : "0");
      return next;
    });
  // Colapso de "Compartido" elevado aquí para coordinar la división redimensionable
  // (DEF-023). Misma clave localStorage que antes usaba SharedSection.
  const [compartidosCollapsed, setCompartidosCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("mic-sec-compartido") === "1",
  );
  const toggleCompartidos = () =>
    setCompartidosCollapsed((v) => {
      const next = !v;
      localStorage.setItem("mic-sec-compartido", next ? "1" : "0");
      return next;
    });
  // Alto (px) del panel "Compartido" cuando está expandido; ajustable con el
  // divisor y persistido. Archivos ocupa el resto. (DEF-023)
  const [compartidosPx, setCompartidosPx] = useState(() => {
    if (typeof window === "undefined") return 200;
    const v = Number(localStorage.getItem("mic-split-compartido"));
    return Number.isFinite(v) && v > 0 ? v : 200;
  });
  const explorerRef = useRef<HTMLDivElement>(null);
  // El árbol de «Archivos»: una sola parada de Tab y navegación con flechas.
  const arbolRef = useRef<HTMLDivElement | null>(null);
  const onFocusFila = useFocoItineranteArbol(arbolRef);
  // Al terminar un renombrado (F2 o doble clic), el foco vuelve al árbol: el
  // campo desaparece y, sin esto, caía al <body> y el teclado tenía que
  // empezar de nuevo desde arriba. Se busca la fila por su id de antes (sirve
  // si se canceló); renombrada, el id —que es la ruta— ya cambió, y se usa la
  // parada del árbol.
  const renombradoAnteriorRef = useRef<RenameState>(null);
  useEffect(() => {
    const antes = renombradoAnteriorRef.current;
    renombradoAnteriorRef.current = renaming;
    if (!antes || renaming) return;
    const cuadro = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const arbol = arbolRef.current;
      const fila =
        arbol?.querySelector<HTMLElement>(`[data-arbol-id="${antes.type}:${CSS.escape(antes.id)}"]`) ??
        arbol?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
      fila?.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [renaming]);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<string | null>(null);

  const vaultId = vaults[0]?.id;

  useEffect(() => {
    if (vaultId) void store.loadTree(vaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId]);

  // Ctrl+Z deshace el último movimiento (HU-24 CA7)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key === "z" && store.lastMove) {
        event.preventDefault();
        void store.undoLastMove();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.lastMove]);

  const carpetasPorPadre = useMemo(() => {
    const map = new Map<string | null, TreeCarpeta[]>();
    for (const carpeta of store.carpetas) {
      const list = map.get(carpeta.padreId) ?? [];
      list.push(carpeta);
      map.set(carpeta.padreId, list);
    }
    return map;
  }, [store.carpetas]);

  // FUN-S-03: los archivos que Mycelium no indexa (PDF, imágenes, código…).
  // Se piden aparte y NO se mezclan con `store.notas`: meterlos ahí los metería
  // también en el autocompletado de `[[`, en la búsqueda y en el grafo, que es
  // justo lo que no son. Se recargan cuando cambia el árbol.
  const [otros, setOtros] = useState<OtroArchivo[]>([]);
  useEffect(() => {
    let vivo = true;
    void listarOtrosArchivos(rutaVault ?? "").then((lista) => {
      if (vivo) setOtros(lista);
    });
    return () => {
      vivo = false;
    };
  }, [rutaVault, store.notas, store.carpetas]);

  const otrosPorCarpeta = useMemo(() => {
    const map = new Map<string | null, OtroArchivo[]>();
    for (const otro of otros) {
      const list = map.get(otro.carpetaId) ?? [];
      list.push(otro);
      map.set(otro.carpetaId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" }));
    }
    return map;
  }, [otros]);

  const notasPorCarpeta = useMemo(() => {
    const map = new Map<string | null, TreeNota[]>();
    for (const nota of store.notas) {
      const list = map.get(nota.carpetaId) ?? [];
      list.push(nota);
      map.set(nota.carpetaId, list);
    }
    return map;
  }, [store.notas]);

  // Carpeta compartida si ella o algún ancestro tiene membresías (HU-35 CA5)
  const sharedSet = useMemo(() => new Set(store.sharedCarpetaIds), [store.sharedCarpetaIds]);
  const carpetasById = useMemo(
    () => new Map(store.carpetas.map((c) => [c.id, c])),
    [store.carpetas],
  );
  /** Carpeta que contiene el archivo abierto (null si está en la raíz). */
  const carpetaDelActivo = useMemo(
    () => store.notas.find((n) => n.id === activeNoteId)?.carpetaId ?? null,
    [activeNoteId, store.notas],
  );

  /**
   * La rama que lleva al archivo abierto, de su carpeta hasta la raíz
   * (`DEF-069`). Se marca entera y no solo la carpeta madre: se lee como un
   * rastro, y una carpeta plegada avisa igual de que el archivo está adentro.
   */
  const carpetasDelActivo = useMemo(() => {
    const cadena = new Set<string>();
    let actual = carpetaDelActivo;
    // Corta si vuelve a pasar por una carpeta ya vista: el árbol no debería
    // tener ciclos, pero recorrerlo a ciegas colgaría el panel.
    while (actual !== null && !cadena.has(actual)) {
      cadena.add(actual);
      actual = carpetasById.get(actual)?.padreId ?? null;
    }
    return cadena;
  }, [carpetaDelActivo, carpetasById]);


  const isCarpetaShared = useCallback(
    (id: string | null): boolean => {
      let current = id;
      while (current) {
        if (sharedSet.has(current)) return true;
        current = carpetasById.get(current)?.padreId ?? null;
      }
      return false;
    },
    [sharedSet, carpetasById],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const openNota = useCallback(
    (id: string) => {
      // Abrir en el pane activo aunque la URL ya apunte a esta nota
      useTabsStore.getState().openNote(id);
      router.replace(`/workspace?note=${id}`);
    },
    [router],
  );

  // Clic con la rueda: abre la nota en segundo plano (sin robar el foco).
  const openNotaBackground = useCallback(
    (id: string) => {
      useTabsStore.getState().openNoteBackground(id);
      const nid = useTabsStore.getState().activeNotaId();
      router.replace(nid ? `/workspace?note=${nid}` : "/workspace");
    },
    [router],
  );

  // Vista fantasma que sigue al puntero al arrastrar (DEF-034).
  const [dragGhost, setDragGhost] = useState<
    { kind: "nota" | "carpeta"; nombre: string; tipo?: NotaTipo } | null
  >(null);
  // JSX necesita un identificador con mayúscula, no un acceso a propiedad.
  const IconoArrastrado = ICONO_POR_TIPO[dragGhost?.tipo ?? "markdown"];

  /**
   * DEF-023 P2: coordenada de pantalla del puntero durante un drag de dnd-kit. Se
   * calcula con el evento activador + el desplazamiento acumulado (mismo cálculo
   * que usa la detección de colisiones de dnd-kit, fiable aunque el ghost del
   * `DragOverlay` tape el DOM y bloquee `pointermove`/`elementFromPoint`).
   */
  function puntoDelDrag(event: DragMoveEvent | DragEndEvent): { x: number; y: number } {
    const act = event.activatorEvent as MouseEvent | null;
    return { x: (act?.clientX ?? 0) + event.delta.x, y: (act?.clientY ?? 0) + event.delta.y };
  }

  /** Limpia el estado transitorio del arrastre de una nota (DEF-023 P2). */
  function limpiarDragNota() {
    useTabsStore.getState().setDraggingNota(null);
    useTabsStore.getState().setNotaDropTarget(null);
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("nota:")) {
      const notaId = id.replace("nota:", "");
      const nota = store.notas.find((n) => n.id === notaId);
      if (nota) setDragGhost({ kind: "nota", nombre: nota.titulo, tipo: nota.tipo });
      // DEF-023 P2: avisa a los panes para que muestren el previo de drop.
      useTabsStore.getState().setDraggingNota(notaId);
    } else if (id.startsWith("carpeta:")) {
      const carpeta = store.carpetas.find((c) => c.id === id.replace("carpeta:", ""));
      if (carpeta) setDragGhost({ kind: "carpeta", nombre: carpeta.nombre });
    }
  }

  // DEF-023 P2: mientras se arrastra una nota, publica la zona bajo el puntero
  // (usando el tracking fiable de dnd-kit) para que el pane muestre el previo.
  function onDragMove(event: DragMoveEvent) {
    if (!String(event.active.id).startsWith("nota:")) return;
    const { x, y } = puntoDelDrag(event);
    useTabsStore.getState().setNotaDropTarget(paneObjetivoEnPunto(x, y));
  }

  function onDragEnd(event: DragEndEvent) {
    setDragGhost(null);
    const dragged = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;

    // Soltar una nota FUERA del explorador la abre en un pane (DEF-023 P2): borde
    // = dividir, centro = abrir como pestaña. La zona se recalcula por geometría
    // desde el punto final del drag (fiable pese al ghost del DragOverlay).
    if (!over && dragged.startsWith("nota:")) {
      const nota = store.notas.find((n) => n.id === dragged.replace("nota:", ""));
      const { x, y } = puntoDelDrag(event);
      const objetivo = nota ? paneObjetivoEnPunto(x, y) : null;
      if (nota && objetivo) {
        if (objetivo.edge === "center") {
          useTabsStore.getState().openNotaInPane(nota.id, objetivo.paneId);
        } else {
          useTabsStore.getState().splitPaneWithNota(nota.id, objetivo.paneId, objetivo.edge);
        }
        router.replace(`/workspace?note=${nota.id}`);
      }
      limpiarDragNota();
      return;
    }

    limpiarDragNota();
    if (!over) return;

    const destinoId = over === "root" ? null : over.replace("folder:", "");

    if (dragged.startsWith("nota:")) {
      const notaId = dragged.replace("nota:", "");
      const nota = store.notas.find((n) => n.id === notaId);
      if (nota && nota.carpetaId !== destinoId) void store.moveNota(notaId, destinoId);
    } else if (dragged.startsWith("carpeta:")) {
      const carpetaId = dragged.replace("carpeta:", "");
      const carpeta = store.carpetas.find((c) => c.id === carpetaId);
      if (!carpeta || carpeta.padreId === destinoId) return;
      // No mover dentro de sí misma ni de sus hijos (HU-24 CA6)
      if (destinoId !== null && store.subtreeIds(carpetaId).has(destinoId)) return;
      void store.moveCarpeta(carpetaId, destinoId);
    }
  }

  /**
   * Entrada "Nueva desde Espora ▸" del menú de una carpeta (FUN-M-03). Se arma
   * al abrir el menú, con las plantillas del momento; la nota se crea en
   * `carpetaId` (la carpeta del clic derecho), no en la carpeta activa.
   */
  function esporasMenu(carpetaId: string | null): MenuItem {
    const esporas = listarEsporas(store.notas);
    return {
      label: "Nueva desde Espora",
      disabled: esporas.length === 0,
      title:
        esporas.length === 0
          ? `No hay plantillas en «${carpetaEsporas()}». Creá la primera desde el panel de Esporas.`
          : "Crear una nota a partir de una plantilla",
      submenu: esporas.map((espora) => ({
        label: espora.titulo,
        onClick: () =>
          void crearNotaDesdeEspora(espora, carpetaId)
            .then(openNota)
            .catch((e) => console.error("[esporas] no se pudo crear la nota:", e)),
      })),
    };
  }

  /**
   * Crea un `.base` con una vista mínima ya escrita. Una base vacía no mostraría
   * nada y parecería rota; con esto se abre mostrando el vault entero, que es de
   * donde el usuario va a partir para filtrar.
   */
  async function crearBase(carpetaId: string | null) {
    const id = await store.createNota(carpetaId, "base");
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: baseInicial() },
    });
    openNota(id);
  }

  /** Crea un `.canvas` vacío pero válido, para que abra sin caso especial. */
  async function crearCanvas(carpetaId: string | null) {
    const id = await store.createNota(carpetaId, "canvas");
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: canvasInicial() },
    });
    openNota(id);
  }

  function carpetaMenu(carpeta: TreeCarpeta): MenuItem[] {
    return [
      {
        label: "Nueva nota",
        onClick: () => void store.createNota(carpeta.id).then(openNota),
      },
      {
        label: "Nuevo dibujo Excalidraw",
        onClick: () => void store.createNota(carpeta.id, "excalidraw").then(openNota),
      },
      // Base (FUN-L-03): una tabla que agrega notas por sus propiedades. Se crea
      // con una vista mínima ya escrita, para que muestre algo desde el principio.
      {
        label: "Nueva base",
        onClick: () => void crearBase(carpeta.id),
      },
      {
        label: "Nuevo canvas",
        onClick: () => void crearCanvas(carpeta.id),
      },
      // Plantillas (FUN-M-03): crea EN ESTA carpeta, no en la activa. Sin
      // Esporas la entrada queda deshabilitada con el motivo, nunca oculta: es
      // la forma de que la funcionalidad se descubra.
      esporasMenu(carpeta.id),
      {
        label: "Nueva carpeta",
        onClick: () => {
          const nombre = window.prompt("Nombre de la carpeta:", "Nueva carpeta");
          if (nombre) void store.createCarpeta(nombre, carpeta.id);
        },
      },
      {
        label: "Importar archivos .md",
        onClick: () => {
          importTargetRef.current = carpeta.id;
          mdInputRef.current?.click();
        },
      },
      // Terminal integrada (FUN-L-07 CA4): solo en vault de carpeta, donde la
      // carpeta existe en disco (su id ES la ruta relativa).
      ...(rutaVault
        ? [
            {
              label: "Abrir terminal aquí",
              // La consola (xterm) se carga recién acá: el explorador está
              // siempre montado y no tiene por qué traerla al arrancar.
              onClick: async () => {
                const { crearTerminal } = await import("@/lib/terminal");
                const tabId = crearTerminal({ cwd: `${rutaVault}/${carpeta.id}` });
                router.replace(`/workspace?note=${encodeURIComponent(tabId)}`);
              },
            },
          ]
        : []),
      ...(HAY_COMPARTIR
        ? [
            {
              label: "Compartir",
              onClick: () =>
                useUiStore.getState().setShareTarget({ id: carpeta.id, nombre: carpeta.nombre }),
            },
            {
              label: "Gestionar acceso",
              onClick: () =>
                useUiStore.getState().setShareTarget({ id: carpeta.id, nombre: carpeta.nombre }),
            },
          ]
        : []),
      {
        label: "Renombrar",
        onClick: () =>
          setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre }),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              onClick: () => void revelarEnSistema(rutaVault, carpeta.id),
            },
          ]
        : []),
      {
        label: "Eliminar",
        danger: true,
        onClick: () => {
          const subtree = store.subtreeIds(carpeta.id);
          const count = store.notas.filter(
            (n) => n.carpetaId !== null && subtree.has(n.carpetaId),
          ).length;
          const message =
            count > 0
              ? `Eliminar "${carpeta.nombre}" mandará ${count} nota(s) a la papelera. ¿Continuar?`
              : `¿Eliminar la carpeta "${carpeta.nombre}"?`;
          void confirmar(message).then((ok) => {
            if (ok) void store.deleteCarpeta(carpeta.id);
          });
        },
      },
    ];
  }

  function notaMenu(nota: TreeNota): MenuItem[] {
    return [
      {
        label: "Renombrar",
        onClick: () => setRenaming({ type: "nota", id: nota.id, valor: nota.titulo }),
      },
      { label: "Duplicar", onClick: () => void store.duplicateNota(nota.id) },
      {
        label: "Exportar como .md",
        onClick: () => void exportNoteMd(nota.id, nota.titulo),
      },
      {
        label: "Exportar como PDF…",
        onClick: () => exportNotePdfActive(nota.id, nota.titulo),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              onClick: () => void revelarEnSistema(rutaVault, nota.id),
            },
          ]
        : []),
      {
        label: "Eliminar",
        danger: true,
        onClick: () => {
          useTabsStore.getState().closeNotaEverywhere(nota.id);
          void store.deleteNota(nota.id);
        },
      },
    ];
  }

  function commitRename() {
    if (!renaming) return;
    const valor = renaming.valor.trim();
    if (valor) {
      if (renaming.type === "carpeta") void store.renameCarpeta(renaming.id, valor);
      else void store.renameNota(renaming.id, valor);
    }
    setRenaming(null);
  }

  function renderCarpeta(carpeta: TreeCarpeta, nivel: number) {
    const isExpanded = store.expanded[carpeta.id] ?? false;
    // El fondo marca DÓNDE ESTÁS, y eso se deriva del archivo abierto: no es un
    // estado que alguien prenda y apague (`DEF-069`). Antes era
    // `activeFolderId`, o sea «la última carpeta pulsada», que se quedaba
    // marcada aunque estuvieras leyendo un archivo de otro lado y no volvía
    // sola al recuperar el foco en él.
    const isActive = carpetaDelActivo === carpeta.id;
    // La carpeta pulsada, que es OTRA cosa: el destino de «nota nueva»,
    // «carpeta nueva» e importar. Lleva una marca discreta y distinta, y solo
    // cuando no coincide con la de arriba, para no marcar dos veces lo mismo.
    const isSeleccionada = store.activeFolderId === carpeta.id && !isActive;

    return (
      <FolderDropZone
        key={carpeta.id}
        carpetaId={carpeta.id}
        onOsOver={() => setOsDropTarget(carpeta.id)}
        onOsFiles={(dt) => {
          setOsDropTarget(undefined);
          importarSoltados(dt, carpeta.id);
        }}
      >
        {(dropOver) => (
          <>
        <FolderRow
          carpeta={carpeta}
          nivel={nivel}
          expanded={isExpanded}
          active={isActive}
          seleccionada={isSeleccionada}
          contieneActivo={carpetasDelActivo.has(carpeta.id)}
          dropOver={dropOver || osDropTarget === carpeta.id}
          shared={isCarpetaShared(carpeta.id)}
          renaming={renaming?.type === "carpeta" && renaming.id === carpeta.id}
          renameValue={renaming?.valor ?? ""}
          onRenameChange={(valor) => setRenaming((r) => (r ? { ...r, valor } : r))}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRenaming(null)}
          onToggle={() => {
            store.toggleExpanded(carpeta.id);
            store.setActiveFolder(carpeta.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            store.setActiveFolder(carpeta.id);
            setMenu({ x: e.clientX, y: e.clientY, items: carpetaMenu(carpeta) });
          }}
          onDoubleClick={() =>
            setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre })
          }
        />
        {/* Este contenedor ya existía; lo nuevo es que ADEMÁS sangra y dibuja
            la guía vertical (`FUN-S-17`). La sangría deja de calcularse por
            fila (`depth * 14`): con padding se veía igual, pero no había
            ningún elemento que abarcara la rama del que colgar la línea, y es
            la línea la que dice hasta dónde llega cada carpeta. */}
        {isExpanded && (
          <div className={styles.rama}>
            {(carpetasPorPadre.get(carpeta.id) ?? []).map((sub) => renderCarpeta(sub, nivel + 1))}
            {(notasPorCarpeta.get(carpeta.id) ?? []).map((nota) => renderNota(nota, nivel + 1))}
            {(otrosPorCarpeta.get(carpeta.id) ?? []).map((otro) => (
              <OtroRow key={otro.ruta} otro={otro} nivel={nivel + 1} />
            ))}
          </div>
        )}
          </>
        )}
      </FolderDropZone>
    );
  }

  function renderNota(nota: TreeNota, nivel: number) {
    return (
      <NoteRow
        key={nota.id}
        nota={nota}
        nivel={nivel}
        active={activeNoteId === nota.id}
        shared={isCarpetaShared(nota.carpetaId)}
        renaming={renaming?.type === "nota" && renaming.id === nota.id}
        renameValue={renaming?.valor ?? ""}
        onRenameChange={(valor) => setRenaming((r) => (r ? { ...r, valor } : r))}
        onRenameCommit={commitRename}
        onRenameCancel={() => setRenaming(null)}
        onOpen={() => openNota(nota.id)}
        onOpenBackground={() => openNotaBackground(nota.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: notaMenu(nota) });
        }}
        onDoubleClick={() =>
          setRenaming({ type: "nota", id: nota.id, valor: nota.titulo })
        }
      />
    );
  }

  if (!vaultId) {
    return <p className={styles.empty}>Sin vault activo.</p>;
  }

  // DEF-036: importa los archivos soltados desde el SO en la carpeta DESTINO (la
  // que estaba bajo el cursor; `null` = raíz). Antes iba siempre a la carpeta
  // activa, ignorando dónde se soltó.
  const importarSoltados = (dataTransfer: DataTransfer, targetId: string | null) => {
    void collectFromDataTransfer(dataTransfer).then((files) => {
      const onlyMd = files.filter((f) => /\.md$/i.test(f.path) || !/\.[^/]+$/.test(f.path));
      if (onlyMd.length > 0) {
        useImportStore.getState().run(onlyMd, targetId, "Importación");
      }
    });
  };

  // Arrastre del divisor (DEF-023): el alto del panel Compartido = distancia del
  // cursor al borde inferior del explorador; Archivos ocupa el resto. Clamp para
  // dejar un mínimo a ambos. Se persiste al soltar.
  const onDivisorPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const cont = explorerRef.current;
    if (!cont) return;
    const onMove = (ev: PointerEvent) => {
      const rect = cont.getBoundingClientRect();
      const px = Math.round(rect.bottom - ev.clientY);
      const max = Math.max(60, rect.height - 160); // mínimo para Archivos
      setCompartidosPx(Math.max(60, Math.min(px, max)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setCompartidosPx((v) => {
        localStorage.setItem("mic-split-compartido", String(v));
        return v;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Lo que se crea desde el explorador, además de «Nueva nota».
  const accionesNuevo: ItemNuevo[] = [
    {
      label: "Nuevo dibujo Excalidraw",
      icono: IconoDibujo,
      onClick: () => void store.createNota(store.activeFolderId, "excalidraw").then(openNota),
    },
    {
      label: "Nueva base (tabla de notas)",
      icono: IconoBase,
      onClick: () => void crearBase(store.activeFolderId),
    },
    {
      label: "Nuevo canvas (notas en el espacio)",
      icono: IconoCanvas,
      onClick: () => void crearCanvas(store.activeFolderId),
    },
    {
      label: "Nueva carpeta",
      icono: FolderPlus,
      onClick: () => {
        const nombre = window.prompt("Nombre de la carpeta:", "Nueva carpeta");
        if (nombre) void store.createCarpeta(nombre, store.activeFolderId);
      },
    },
    {
      label: "Importar archivos .md",
      icono: Upload,
      onClick: () => {
        importTargetRef.current = store.activeFolderId;
        mdInputRef.current?.click();
      },
    },
  ];

  return (
    <div
      ref={explorerRef}
      className={`${styles.explorer} ${osDropTarget === null ? styles.osDragOver : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          // Raíz: si el cursor está sobre una carpeta, ese div hace stopPropagation
          // y fija su propio destino; aquí solo llega el área vacía/raíz.
          setOsDropTarget(null);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOsDropTarget(undefined);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const dt = e.dataTransfer;
        setOsDropTarget(undefined);
        importarSoltados(dt, null);
      }}
    >
      <input
        ref={mdInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void useImportStore
              .getState()
              .run(collectFromFileList(e.target.files), importTargetRef.current, "Importación");
          }
          e.target.value = "";
        }}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          title="Nueva nota"
          aria-label="Nueva nota"
          onClick={() => void store.createNota(store.activeFolderId).then(openNota)}
        >
          <FilePlus size={16} aria-hidden />
        </button>
        {/* Con espacio, cada acción a la vista; con el panel angosto, en
            «Nuevo ▾» (container query en .actions). */}
        {accionesNuevo.map(({ label, icono: Icono, onClick }) => (
          <button
            key={label}
            type="button"
            className={`${styles.actionButton} ${styles.soloAncho}`}
            title={label}
            aria-label={label}
            onClick={onClick}
          >
            <Icono size={16} />
          </button>
        ))}
        <div className={styles.soloAngosto}>
          <MenuNuevo items={accionesNuevo} />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={dropMasProfundo}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragGhost(null);
          limpiarDragNota();
        }}
      >
        {/* Panel "Archivos": ocupa el espacio libre y tiene su propio scroll. */}
        <div className={styles.paneArchivos}>
          <SectionHeader
            title="Archivos"
            collapsed={archivosCollapsed}
            onToggle={toggleArchivos}
          />
          {!archivosCollapsed && (
            <RootDropZone arbolRef={arbolRef} onFocusFila={onFocusFila} onClearActive={() => store.setActiveFolder(null)}>
              {(carpetasPorPadre.get(null) ?? []).map((carpeta) => renderCarpeta(carpeta, 1))}
              {(notasPorCarpeta.get(null) ?? []).map((nota) => renderNota(nota, 1))}
              {(otrosPorCarpeta.get(null) ?? []).map((otro) => (
                <OtroRow key={otro.ruta} otro={otro} nivel={1} />
              ))}
              {store.carpetas.length === 0 && store.notas.length === 0 && (
                <p className={styles.empty}>
                  Vault vacío. Creá tu primera nota con el botón de arriba.
                </p>
              )}
            </RootDropZone>
          )}
        </div>

        {/* Divisor arrastrable (DEF-023): solo con Compartido expandido. */}
        {HAY_COMPARTIR && !compartidosCollapsed && (
          <div
            className={styles.divisor}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Ajustar el tamaño de Compartido"
            onPointerDown={onDivisorPointerDown}
          />
        )}

        {/* Panel "Compartido": alto ajustable con su propio scroll; colapsado
            ocupa solo su cabecera. */}
        {HAY_COMPARTIR && (
          <div
            className={styles.paneCompartidos}
            style={
              compartidosCollapsed
                ? undefined
                : { height: `${compartidosPx}px`, overflowY: "auto", flexShrink: 0 }
            }
          >
            <SharedSection collapsed={compartidosCollapsed} onToggle={toggleCompartidos} />
          </div>
        )}

        {/* Sombra que sigue al puntero mientras se arrastra (DEF-034). */}
        <DragOverlay dropAnimation={null}>
          {dragGhost && (
            <div className={styles.dragGhost}>
              {dragGhost.kind === "carpeta" ? (
                <Folder size={15} className={styles.folderIcon} aria-hidden />
              ) : (
                // El MISMO mapa que usa la fila del árbol y la pestaña: la
                // sombra que sigue al puntero tiene que ser reconocible como lo
                // que se está arrastrando (`FUN-S-11`).
                <IconoArrastrado size={15} className={styles.noteIcon} aria-hidden />
              )}
              <span className={styles.name}>{dragGhost.nombre}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Cabecera colapsable de una sección del explorador (estilo paneles de VSCode). */
export function SectionHeader({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={styles.sectionHeader} onClick={onToggle}>
      {collapsed ? (
        <ChevronRight size={13} aria-hidden />
      ) : (
        <ChevronDown size={13} aria-hidden />
      )}
      <span>{title}</span>
    </button>
  );
}

// ── Filas ────────────────────────────────────────────────────────

type RowRenameProps = {
  renaming: boolean;
  renameValue: string;
  onRenameChange: (valor: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
};

function RenameInput({
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: Omit<RowRenameProps, "renaming">) {
  return (
    <input
      className={styles.renameInput}
      value={renameValue}
      autoFocus
      onChange={(e) => onRenameChange(e.target.value)}
      onBlur={onRenameCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onRenameCommit();
        if (e.key === "Escape") onRenameCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Zona de drop de una carpeta: cubre su fila Y su contenido expandido, así
 * soltar en cualquier parte del área de la carpeta la toma como destino (antes
 * solo la fila era droppable y soltar en el hueco de los hijos caía en la raíz).
 * También recibe los archivos arrastrados desde el SO (DEF-036).
 */
function FolderDropZone({
  carpetaId,
  onOsOver,
  onOsFiles,
  children,
}: {
  carpetaId: string;
  onOsOver: () => void;
  onOsFiles: (dt: DataTransfer) => void;
  children: (dropOver: boolean) => React.ReactNode;
}) {
  const drop = useDroppable({ id: `folder:${carpetaId}` });
  return (
    <div
      ref={drop.setNodeRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.stopPropagation(); // la carpeta más interna bajo el cursor gana
          onOsOver();
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        onOsFiles(e.dataTransfer);
      }}
    >
      {children(drop.isOver)}
    </div>
  );
}

/**
 * Semántica de árbol de una fila (critique 2026-09-19). Va DESPUÉS de los
 * atributos de dnd-kit y los pisa: dnd-kit la anunciaba como «botón
 * arrastrable», con instrucciones para arrastrar con el teclado que acá no
 * existen (solo hay `PointerSensor`), y le daba `tabIndex=0` a cada fila —140
 * paradas de Tab antes de la nota—. El foco itinerante lo reparte
 * `useFocoItineranteArbol`: todas en -1 y una sola en 0.
 */
function atributosDeFila(nivel: number) {
  return {
    role: "treeitem",
    "aria-level": nivel,
    tabIndex: -1,
    "aria-roledescription": undefined,
    "aria-describedby": undefined,
    "aria-pressed": undefined,
    "aria-disabled": undefined,
  } as const;
}

function FolderRow({
  carpeta,
  nivel,
  expanded,
  active,
  seleccionada,
  contieneActivo,
  shared,
  dropOver,
  onToggle,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  carpeta: TreeCarpeta;
  /** Profundidad en el árbol, desde 1 (`aria-level`). */
  nivel: number;
  expanded: boolean;
  /** Es la carpeta del archivo abierto: dónde estás (`DEF-069`). */
  active: boolean;
  /** Es la carpeta pulsada, destino de «nota nueva» e importar. Marca discreta. */
  seleccionada: boolean;
  /** Está en la rama que lleva al archivo abierto (`DEF-069`). */
  contieneActivo: boolean;
  shared: boolean;
  /** Resaltado de destino: arrastre interno sobre la zona de la carpeta o
   *  archivos del SO sobre ella (DEF-036b). Lo decide `FolderDropZone`. */
  dropOver?: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `carpeta:${carpeta.id}` });

  const className = [
    styles.row,
    styles.rowCarpeta,
    active ? styles.rowActive : "",
    seleccionada ? styles.rowSeleccionada : "",
    contieneActivo ? styles.rowEnRuta : "",
    dropOver ? styles.rowDropTarget : "",
    drag.isDragging ? styles.rowDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={drag.setNodeRef}
      className={className}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      {...drag.listeners}
      {...drag.attributes}
      {...atributosDeFila(nivel)}
      aria-expanded={expanded}
      data-arbol-id={`carpeta:${carpeta.id}`}
    >
      {expanded ? (
        <ChevronDown size={14} className={styles.chevron} aria-hidden />
      ) : (
        <ChevronRight size={14} className={styles.chevron} aria-hidden />
      )}
      <Folder size={15} className={styles.folderIcon} aria-hidden />
      {rename.renaming ? (
        <RenameInput {...rename} />
      ) : (
        // `title` para poder leer el nombre entero (`DEF-081`): la fila lo
        // corta con puntos suspensivos y, sin esto, no había forma de ver el
        // resto sin ensanchar el panel. El globo del sistema es lo único que
        // funciona acá sin código de posicionamiento: el panel tiene scroll, y
        // cualquier cosa nuestra habría que acotarla a la pantalla.
        <span className={styles.name} title={carpeta.nombre}>
          {carpeta.nombre}
        </span>
      )}
      {shared && !rename.renaming && (
        <Users size={12} className={styles.sharedIcon} aria-label="Compartida" />
      )}
    </div>
  );
}

function NoteRow({
  nota,
  nivel,
  active,
  shared,
  onOpen,
  onOpenBackground,
  onContextMenu,
  onDoubleClick,
  ...rename
}: {
  nota: TreeNota;
  /** Profundidad en el árbol, desde 1 (`aria-level`). */
  nivel: number;
  active: boolean;
  shared: boolean;
  onOpen: () => void;
  onOpenBackground: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
} & RowRenameProps) {
  const drag = useDraggable({ id: `nota:${nota.id}` });
  // Un ícono por tipo de archivo: markdown, dibujo y base se distinguen de un
  // vistazo en el árbol (antes una base se veía igual que una nota). El mapa
  // vive en `lib/iconosDeTipo` porque la pestaña contesta lo mismo (`FUN-S-11`).
  const Icon = ICONO_POR_TIPO[nota.tipo];

  // Lo que se lee en la fila, extensión incluida (`FUN-S-03`). Se calcula una
  // vez para que el texto y su `title` no puedan decir cosas distintas.
  const ext = EXTENSION_POR_TIPO[nota.tipo];
  const nombreVisible = ext !== undefined ? `${nota.titulo}.${ext}` : nota.titulo;

  const className = [
    styles.row,
    styles.rowHoja,
    active ? styles.rowActive : "",
    drag.isDragging ? styles.rowDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={drag.setNodeRef}
      className={className}
      onClick={onOpen}
      // Evita el auto-scroll del navegador al pulsar la rueda sobre la fila.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onOpenBackground();
        }
      }}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      {...drag.listeners}
      {...drag.attributes}
      {...atributosDeFila(nivel)}
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      data-arbol-id={`nota:${nota.id}`}
    >
      <Icon size={15} className={styles.noteIcon} aria-hidden />
      {rename.renaming ? (
        <RenameInput {...rename} />
      ) : (
        // FUN-S-03: un `.excalidraw`, un `.base` y un `.canvas` se veian iguales
        // que un markdown, porque el titulo va sin extension. Va PEGADA al
        // nombre y no en un `<span>` aparte: el usuario lee `nota.md`, un solo
        // texto, y no dos cosas separadas. El renombrado sigue editando solo el
        // titulo —la extension la decide el tipo de archivo, no el usuario— y
        // este texto no identifica nada: los ids y las rutas salen del indice.
        // `title` con el MISMO texto que se muestra, extensión incluida
        // (`DEF-081`): un globo que dijera otra cosa que la fila confundiría
        // más de lo que ayuda.
        <span className={styles.name} title={nombreVisible}>
          {nombreVisible}
        </span>
      )}
      {shared && !rename.renaming && (
        <Users size={12} className={styles.sharedIcon} aria-label="Compartido" />
      )}
    </div>
  );
}

/**
 * Un archivo del vault que Mycelium lista (`FUN-S-03`) y sabe abrir en un visor
 * de solo lectura (`FUN-L-11`).
 *
 * Se muestra atenuado para que se distinga de una nota de un vistazo. Al hacer
 * clic abre una **pestaña del workspace** con el visor que le corresponda a su
 * tipo; no se abre una nota, porque esto no es una nota: no está en el índice,
 * no aparece en la búsqueda del vault, ni en el autocompletado de `[[`, ni en
 * el grafo.
 */
function OtroRow({ otro, nivel }: { otro: OtroArchivo; nivel: number }) {
  const router = useRouter();
  const abrir = () => {
    const tabId = tabIdDeArchivo(otro.ruta);
    useTabsStore.getState().openNote(tabId);
    router.replace(`/workspace?note=${tabId}`);
  };
  return (
    <div
      className={`${styles.row} ${styles.rowHoja} ${styles.rowOtro}`}
      title={otro.ruta}
      {...atributosDeFila(nivel)}
      data-arbol-id={`otro:${otro.ruta}`}
      onClick={abrir}
      // Evita el auto-scroll del navegador al pulsar la rueda sobre la fila.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          useTabsStore.getState().openNoteBackground(tabIdDeArchivo(otro.ruta));
        }
      }}
    >
      <ICONO_OTRO_ARCHIVO size={15} className={styles.noteIcon} aria-hidden />
      {/* `otro.nombre` ya viene con la extensión: se lee `captura.png` de una
          pieza, igual que las notas. El `title` deja leerlo entero (`DEF-081`). */}
      <span className={styles.name} title={otro.nombre}>
        {otro.nombre}
      </span>
    </div>
  );
}

/**
 * Extensión que se muestra junto al nombre, por tipo de nota (`FUN-S-03`).
 *
 * **También el markdown.** Primero se omitió, por leer el enunciado del
 * backlog al pie de la letra («los archivos no-markdown»), pero omitirlo hace
 * que la única fila sin extensión sea la más común: se lee como si le faltara
 * algo, no como el caso normal. Con todas puestas, la columna es uniforme y la
 * extensión pasa a ser información y no una excepción.
 */
const EXTENSION_POR_TIPO: Record<string, string | undefined> = {
  markdown: "md",
  excalidraw: "excalidraw",
  base: "base",
  canvas: "canvas",
};

/**
 * Teclado del árbol (patrón de árbol de WAI-ARIA). Trabaja sobre el DOM porque
 * lo visible ES el DOM: una rama plegada no se renderiza, así que las filas en
 * orden de documento son exactamente las filas en pantalla.
 * - Arriba/abajo, Inicio/Fin: fila anterior/siguiente, primera/última.
 * - Derecha: abre la carpeta; si ya está abierta, baja a su primer hijo.
 * - Izquierda: cierra la carpeta; si no, sube a la carpeta que la contiene.
 * - Enter/Espacio: lo mismo que el clic (abrir el archivo o plegar la carpeta).
 * - Tecla Menú o Shift+F10: el menú contextual de la fila, como el clic
 *   derecho (renombrar, borrar, nueva nota adentro…). Sin esto, esas acciones
 *   no existían para el teclado.
 * - F2: renombrar, como el doble clic.
 */
function navegarArbol(e: React.KeyboardEvent<HTMLElement>) {
  const fila = e.target as HTMLElement;
  // Solo cuando el foco está en la FILA: dentro del campo de renombrar, las
  // flechas y el Enter son del campo.
  if (fila.getAttribute("role") !== "treeitem") return;
  const filas = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const i = filas.indexOf(fila);
  const nivel = Number(fila.getAttribute("aria-level"));
  const expandida = fila.getAttribute("aria-expanded");
  const ir = (j: number) => filas[Math.max(0, Math.min(filas.length - 1, j))]?.focus();

  switch (e.key) {
    case "ArrowDown":
      ir(i + 1);
      break;
    case "ArrowUp":
      ir(i - 1);
      break;
    case "Home":
      ir(0);
      break;
    case "End":
      ir(filas.length - 1);
      break;
    case "ArrowRight":
      if (expandida === "false") fila.click();
      else if (expandida === "true" && Number(filas[i + 1]?.getAttribute("aria-level")) === nivel + 1) ir(i + 1);
      break;
    case "ArrowLeft":
      if (expandida === "true") {
        fila.click();
      } else {
        for (let j = i - 1; j >= 0; j--) {
          if (Number(filas[j].getAttribute("aria-level")) === nivel - 1) {
            ir(j);
            break;
          }
        }
      }
      break;
    case "Enter":
    case " ":
      fila.click();
      break;
    case "ContextMenu":
    case "F10": {
      if (e.key === "F10" && !e.shiftKey) return;
      // Se dispara el mismo evento que el clic derecho, anclado bajo la fila:
      // el manejador de la fila arma el menú de siempre.
      const r = fila.getBoundingClientRect();
      fila.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }),
      );
      break;
    }
    case "F2":
      fila.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      break;
    default:
      return;
  }
  e.preventDefault();
}

/**
 * Una sola parada de Tab para todo el árbol (tabindex itinerante). Las filas
 * nacen con `tabIndex=-1` (`atributosDeFila`); acá se le da 0 a UNA: la que
 * tiene el foco, si no la última que lo tuvo, si no la nota abierta, si no la
 * primera. Corre después de cada render porque las ramas se abren y cierran:
 * la fila elegida puede haber dejado de existir.
 */
function useFocoItineranteArbol(arbolRef: React.MutableRefObject<HTMLDivElement | null>) {
  const ultimaRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const filas = [...(arbolRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    if (!filas.length) return;
    const elegida =
      filas.find((f) => f === document.activeElement) ??
      filas.find((f) => f.dataset.arbolId === ultimaRef.current) ??
      filas.find((f) => f.getAttribute("aria-selected") === "true") ??
      filas[0];
    for (const f of filas) f.tabIndex = f === elegida ? 0 : -1;
  });

  // Se engancha como `onFocus` del árbol (en React burbujea, como `focusin`):
  // la fila que recibe el foco —por teclado o por clic— pasa a ser la parada.
  return useCallback(
    (e: React.FocusEvent<HTMLElement>) => {
      const fila = e.target as HTMLElement;
      if (fila.getAttribute("role") !== "treeitem") return;
      ultimaRef.current = fila.dataset.arbolId ?? null;
      for (const f of arbolRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []) {
        f.tabIndex = f === fila ? 0 : -1;
      }
    },
    [arbolRef],
  );
}

/** Zona raíz: soltar aquí mueve a la raíz del vault; clic limpia la carpeta activa. */
function RootDropZone({
  children,
  onClearActive,
  arbolRef,
  onFocusFila,
}: {
  children: React.ReactNode;
  onClearActive: () => void;
  arbolRef: React.MutableRefObject<HTMLDivElement | null>;
  onFocusFila: (e: React.FocusEvent<HTMLElement>) => void;
}) {
  const drop = useDroppable({ id: "root" });
  return (
    <div
      ref={(el) => {
        drop.setNodeRef(el);
        arbolRef.current = el;
      }}
      role="tree"
      aria-label="Archivos del vault"
      className={drop.isOver ? `${styles.tree} ${styles.treeDropTarget}` : styles.tree}
      onKeyDown={navegarArbol}
      onFocus={onFocusFila}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClearActive();
      }}
    >
      {children}
    </div>
  );
}
