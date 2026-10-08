"use client";

import { Ban, FileText, Maximize2, Redo2, Save, Trash2, Type, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  ALTO_TARJETA,
  ANCHO_TARJETA,
  anclaDe,
  buscarPorPrefijo,
  cajaDeNodos,
  colorCss,
  COLORES,
  encuadrar,
  ladosAutomaticos,
  lugarLibre,
  nodoArchivo,
  nodoTexto,
  nuevaArista,
  nuevoId,
  ordenDePintado,
  parsearCanvas,
  serializarCanvas,
  trazoArista,
  type Canvas,
  type Lado,
  type Nodo,
} from "@/lib/canvas";
import {
  abrir as abrirEnHistorial,
  accionDeTecla,
  cerrar as cerrarEnHistorial,
  deshacer,
  historialVacio,
  puedeDeshacer,
  puedeRehacer,
  registrar,
  rehacer,
  type Historial,
} from "@/lib/historialCanvas";
import { markMissingWikilinks } from "@/lib/editor/wikilink";
import { pedirSaltoAAncla } from "@/lib/editor/pendingMatch";
import { resolverReferencia } from "@/lib/wikilinks";
import { soltarFoco } from "@/lib/editor/tituloPendiente";
import { manejarClicDeEnlace } from "@/lib/enlacesExternos";
import { EVENTO_RECARGA } from "@/lib/eventos";
import { renderNota } from "@/lib/markdown";
import { avisoTocaA, hayQueRecargar } from "@/lib/recargaExterna";
import { notaDeRuta, rutaDeNota } from "@/lib/rutasNotas";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore, type TreeCarpeta, type TreeNota } from "@/stores/vaultStore";
import styles from "./CanvasView.module.css";

/** Milisegundos de calma antes de guardar (mismo criterio que el editor). */
const GUARDADO_MS = 700;
const LADOS: Lado[] = ["top", "right", "bottom", "left"];

type Vista = { x: number; y: number; escala: number };

/** Qué se está arrastrando ahora mismo. */
type Arrastre =
  | { tipo: "lienzo"; x0: number; y0: number; vx: number; vy: number }
  | { tipo: "nodo"; id: string; dx: number; dy: number }
  | { tipo: "tamano"; id: string; x0: number; y0: number; w0: number; h0: number }
  | { tipo: "arista"; desde: string; lado: Lado; x: number; y: number };

/**
 * El último lienzo que el usuario tocó (`DEF-137`). Con dos lienzos abiertos en
 * paneles distintos, Ctrl+Z tiene que deshacer en el que se estaba usando, no
 * en los dos: los atajos escuchan en la ventana y solo el que figura acá
 * responde.
 */
let lienzoActivo: symbol | null = null;

/**
 * Editor de canvas (`FUN-L-18`): lienzo infinito con tarjetas de markdown y de
 * nota, conectadas por flechas. Formato JSON Canvas, el de Obsidian.
 *
 * > [!note] Sin librería de nodos, y es deliberado
 * > La spec proponía React Flow. Se construyó a mano por tres motivos: el
 * > proyecto ya tiene pan, zoom y arrastre propios en `MiniGraph.tsx`; las dos
 * > funcionalidades anteriores se hicieron sin sumar dependencias; y lo que hace
 * > falta acá está acotado —cajas rectangulares, cuatro anclas fijas y beziers—,
 * > no un editor de nodos de propósito general. La alternativa era meter en el
 * > instalador una dependencia que no puedo probar dentro del WebView.
 */
export function CanvasView({ notaId }: { notaId: string }) {
  const router = useRouter();
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, escala: 1 });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [sucio, setSucio] = useState(false);
  const [eligiendoNota, setEligiendoNota] = useState(false);
  /** Solo mientras se arrastra el lienzo: apaga la selección de texto. */
  const [desplazando, setDesplazando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const arrastre = useRef<Arrastre | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const guardadoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Espejos del estado para la recarga desde disco (`FUN-L-26`), que corre fuera
  // del render: el lienzo que se ve, si hay cambios sin escribir y si se está
  // editando el texto de una tarjeta.
  const canvasRef = useRef<Canvas | null>(null);
  canvasRef.current = canvas;
  const sucioRef = useRef(false);
  const editandoRef = useRef<string | null>(null);
  editandoRef.current = editando;
  /**
   * Lo último que este lienzo sabe que está en disco: lo que leyó o lo que mandó
   * a guardar. Reconoce el eco del guardado propio (el mismo criterio que
   * `ultimoGuardadoRef` en `NoteEditor`, `DEF-117`).
   */
  const conocidoRef = useRef<string | null>(null);
  /**
   * Deshacer/rehacer (`DEF-137`): snapshots del documento, ver
   * `lib/historialCanvas.ts`. Vive en una ref porque lo tocan los manejadores
   * del puntero y del teclado, fuera del render; `puede` es lo que necesitan
   * los botones de la barra, y `tocarHistorial` lo recalcula después de cada
   * cambio del historial o del documento.
   */
  const historialRef = useRef<Historial<Canvas>>(historialVacio());
  const [puede, setPuede] = useState({ deshacer: false, rehacer: false });
  const tocarHistorial = useCallback(() => {
    const h = historialRef.current;
    const c = canvasRef.current;
    const deshacerOk = c !== null && puedeDeshacer(h, c);
    const rehacerOk = c !== null && puedeRehacer(h, c);
    setPuede((p) =>
      p.deshacer === deshacerOk && p.rehacer === rehacerOk
        ? p
        : { deshacer: deshacerOk, rehacer: rehacerOk },
    );
  }, []);
  const yoRef = useRef<symbol>(Symbol("lienzo"));

  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);

  // ── Carga ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const r = await api<{ contenido: string }>(
          `/notas/${encodeURIComponent(notaId)}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        if (cancelado) return;
        conocidoRef.current = r.contenido ?? "";
        setCanvas(parsearCanvas(r.contenido ?? ""));
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [notaId]);

  // ── Encuadre al abrir (`FUN-L-26`) ─────────────────────────────────────────
  //
  // Antes el lienzo abría mirando a (0, 0) al 100 %: uno grande quedaba
  // cortado. Ahora la primera vez que llega el contenido se encuadran todos los
  // nodos (sin agrandar uno chico más allá del 100 %). Solo esa vez: la recarga
  // desde disco conserva la cámara, y re-encuadrar en cada cambio de afuera
  // movería el lienzo debajo del usuario. Va en un efecto de layout para que el
  // primer cuadro ya salga encuadrado, sin un salto desde (0, 0).
  const encuadrePendienteRef = useRef(true);
  useLayoutEffect(() => {
    if (!encuadrePendienteRef.current || canvas === null) return;
    const host = hostRef.current;
    if (!host) return;
    encuadrePendienteRef.current = false;
    const r = host.getBoundingClientRect();
    const caja = cajaDeNodos(canvas.nodos);
    if (caja === null || r.width < 1 || r.height < 1) return;
    setVista(encuadrar(caja, { ancho: r.width, alto: r.height }));
  }, [canvas]);

  // ── Guardado con retardo ───────────────────────────────────────────────────
  const guardar = useCallback(
    async (c: Canvas) => {
      const contenido = serializarCanvas(c);
      // Antes del await: si el watcher avisa mientras el guardado viaja, lo que
      // encuentre en disco es esto, y no es un cambio de afuera.
      conocidoRef.current = contenido;
      try {
        await api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
          method: "PUT",
          token: useAuthStore.getState().accessToken,
          body: { contenido },
        });
        // Solo queda limpio si no se cambió nada mientras se guardaba: si no, lo
        // nuevo sigue pendiente (lo escribe el guardado ya programado) y una
        // recarga desde disco no debe pisarlo. Antes se limpiaba siempre.
        if (canvasRef.current !== c) return;
        sucioRef.current = false;
        setSucio(false);
        // Las tarjetas pueden traer `[[enlaces]]`: el grafo queda desactualizado.
        useGraphStore.getState().markStale();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [notaId],
  );

  /**
   * Pone `siguiente` en pantalla y programa el guardado. Es el único camino al
   * disco: un cambio, un deshacer y un rehacer se guardan igual.
   *
   * La ref se actualiza en el acto, sin esperar al render: un arrastre manda
   * varios cambios entre dos renders y cada uno parte del anterior. Antes esto
   * iba dentro del actualizador de `setCanvas`, con el temporizador como efecto
   * secundario adentro (lo que `DEF-135` enseñó a no hacer).
   */
  const aplicar = useCallback(
    (siguiente: Canvas) => {
      canvasRef.current = siguiente;
      setCanvas(siguiente);
      sucioRef.current = true;
      setSucio(true);
      if (guardadoRef.current) clearTimeout(guardadoRef.current);
      guardadoRef.current = setTimeout(() => void guardar(siguiente), GUARDADO_MS);
    },
    [guardar],
  );

  /**
   * Aplica un cambio al canvas y programa el guardado. Por defecto es un paso
   * del historial; con `enGesto` es parte del gesto abierto (un arrastre, la
   * edición de un texto), que entra como UN paso al cerrarse.
   */
  const cambiar = useCallback(
    (fn: (c: Canvas) => Canvas, enGesto = false) => {
      const prev = canvasRef.current;
      if (prev === null) return;
      const siguiente = fn(prev);
      if (siguiente === prev) return;
      if (!enGesto) historialRef.current = registrar(historialRef.current, prev, siguiente);
      aplicar(siguiente);
      if (!enGesto) tocarHistorial();
    },
    [aplicar, tocarHistorial],
  );

  /** Empieza un gesto que va a ser un solo paso del historial. */
  const abrirGesto = useCallback(
    (clave: string) => {
      const actual = canvasRef.current;
      if (actual === null) return;
      historialRef.current = abrirEnHistorial(historialRef.current, clave, actual);
      tocarHistorial();
    },
    [tocarHistorial],
  );

  /** Termina el gesto `clave`: si cambió algo, entra como un paso. */
  const cerrarGesto = useCallback(
    (clave: string) => {
      const actual = canvasRef.current;
      if (actual === null) return;
      historialRef.current = cerrarEnHistorial(historialRef.current, clave, actual);
      tocarHistorial();
    },
    [tocarHistorial],
  );

  /** Sale de la edición del texto de una tarjeta: su escritura es un paso. */
  const terminarEdicion = useCallback(() => {
    const id = editandoRef.current;
    if (id !== null) cerrarGesto(`texto:${id}`);
    setEditando(null);
  }, [cerrarGesto]);

  /** Deshace o rehace un paso. La selección se suelta si su tarjeta ya no está. */
  const moverEnHistorial = useCallback(
    (accion: "deshacer" | "rehacer") => {
      const actual = canvasRef.current;
      // Mientras se escribe en una tarjeta, Ctrl+Z es el del texto.
      if (actual === null || editandoRef.current !== null) return;
      // A mitad de un arrastre no: el gesto seguiría moviendo sobre lo deshecho.
      if (arrastre.current !== null) return;
      const r = (accion === "deshacer" ? deshacer : rehacer)(historialRef.current, actual);
      if (r === null) return;
      historialRef.current = r.historial;
      aplicar(r.documento);
      tocarHistorial();
      setSeleccion((s) => (s !== null && r.documento.nodos.some((n) => n.id === s) ? s : null));
    },
    [aplicar, tocarHistorial],
  );

  // ── Cambios de afuera (`FUN-L-26`) ─────────────────────────────────────────
  //
  // Cuando el archivo cambia en disco por fuera de la app (una IA desde la
  // terminal, otro editor), el watcher avisa con `EVENTO_RECARGA` y se relee.
  // No se toca un lienzo con cambios sin escribir ni uno con una tarjeta en
  // edición: se pisaría lo que el usuario está haciendo. La cámara (`vista`) no
  // es parte del archivo y queda como estaba; la selección, si la tarjeta sigue.
  useEffect(() => {
    async function recargar() {
      if (sucioRef.current || editandoRef.current !== null || canvasRef.current === null) return;
      let disco: string;
      try {
        const r = await api<{ contenido: string }>(
          `/notas/${encodeURIComponent(notaId)}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        disco = r.contenido ?? "";
      } catch {
        return; // Best-effort: si falla la relectura, lo que se ve queda como está.
      }
      // Re-chequear tras el await: el usuario pudo empezar a editar mientras tanto.
      if (editandoRef.current !== null || canvasRef.current === null) return;
      if (
        !hayQueRecargar({
          disco,
          sucio: sucioRef.current,
          conocido: conocidoRef.current,
          enPantalla: serializarCanvas(canvasRef.current),
        })
      )
        return;
      conocidoRef.current = disco;
      const nuevo = parsearCanvas(disco);
      // El historial se descarta (`DEF-137`): sus snapshots son de la versión
      // anterior del archivo, y deshacer hacia uno de ellos pisaría lo que llegó
      // de afuera mezclando las dos. Recargar es, para el historial, abrir de
      // nuevo el lienzo.
      historialRef.current = historialVacio();
      canvasRef.current = nuevo;
      setCanvas(nuevo);
      tocarHistorial();
      setSeleccion((s) => (s !== null && nuevo.nodos.some((n) => n.id === s) ? s : null));
    }
    function onRecarga(ev: Event) {
      if (avisoTocaA(ev, notaId)) void recargar();
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    return () => window.removeEventListener(EVENTO_RECARGA, onRecarga);
  }, [notaId, tocarHistorial]);

  // Al cerrar la pestaña puede quedar un guardado en vuelo: se fuerza.
  useEffect(
    () => () => {
      if (guardadoRef.current) clearTimeout(guardadoRef.current);
    },
    [],
  );

  // ── Coordenadas ────────────────────────────────────────────────────────────
  /** Punto del lienzo (no de la pantalla) bajo un evento del puntero. */
  const enLienzo = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const r = hostRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return {
        x: (e.clientX - r.left - vista.x) / vista.escala,
        y: (e.clientY - r.top - vista.y) / vista.escala,
      };
    },
    [vista],
  );

  // ── Puntero ────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const a = arrastre.current;
      if (a === null) return;
      if (a.tipo === "lienzo") {
        setVista((v) => ({ ...v, x: a.vx + (e.clientX - a.x0), y: a.vy + (e.clientY - a.y0) }));
        return;
      }
      const p = enLienzo(e);
      if (a.tipo === "nodo") {
        cambiar((c) => ({
          ...c,
          nodos: c.nodos.map((n) => (n.id === a.id ? { ...n, x: p.x - a.dx, y: p.y - a.dy } : n)),
        }), true);
      } else if (a.tipo === "tamano") {
        cambiar((c) => ({
          ...c,
          nodos: c.nodos.map((n) =>
            n.id === a.id
              ? {
                  ...n,
                  ancho: Math.max(120, a.w0 + (p.x - a.x0)),
                  alto: Math.max(60, a.h0 + (p.y - a.y0)),
                }
              : n,
          ),
        }), true);
      } else {
        arrastre.current = { ...a, x: p.x, y: p.y };
        // Redibuja la línea provisional sin tocar el documento.
        setVista((v) => ({ ...v }));
      }
    }

    function onUp(e: PointerEvent) {
      const a = arrastre.current;
      arrastre.current = null;
      setDesplazando(false);
      // Un arrastre entero —mover o redimensionar— es un solo paso.
      if (a?.tipo === "nodo" || a?.tipo === "tamano") cerrarGesto("arrastre");
      if (a?.tipo !== "arista") return;
      const destino = (e.target as HTMLElement | null)?.closest("[data-nodo]");
      const id = destino?.getAttribute("data-nodo");
      // Una flecha de un nodo a sí mismo no dice nada y el formato no la prevé.
      if (id === null || id === undefined || id === a.desde) {
        setVista((v) => ({ ...v }));
        return;
      }
      cambiar((c) => ({
        ...c,
        aristas: [
          ...c.aristas,
          { ...nuevaArista(nuevoId(c.aristas.map((x) => x.id)), a.desde, id), desdeLado: a.lado },
        ],
      }));
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [cambiar, cerrarGesto, enLienzo]);

  /**
   * Zoom hacia el cursor: lo que está bajo el puntero no se mueve.
   *
   * Sobre una tarjeta con scroll la rueda sirve para leerla, no para alejar el
   * lienzo — pero esa decisión **no se toma acá**: la toma la propia tarjeta,
   * que corta la propagación (ver `NodoVista`). El primer intento sí la tomaba
   * acá, buscando el cuerpo con `closest()` sobre la clase del módulo CSS, y no
   * funcionaba: si esa búsqueda falla por cualquier motivo, el zoom se dispara
   * igual. Que decida quien conoce su propio scroll es más simple y no depende
   * de acertar con un selector.
   */
  const onWheel = (e: React.WheelEvent) => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setVista((v) => {
      const escala = Math.min(3, Math.max(0.2, v.escala * factor));
      const k = escala / v.escala;
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      return { escala, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // ── Teclado ────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (seleccion === null || editando !== null) return;
      const activo = document.activeElement as HTMLElement | null;
      // El editor de notas es un `contenteditable`, no un INPUT: sin esto, borrar
      // con Retroceso en una nota de otro panel borraba la tarjeta seleccionada.
      if (activo?.tagName === "INPUT" || activo?.tagName === "TEXTAREA" || activo?.isContentEditable) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      // Al borrar un nodo se van también sus flechas: una arista suelta dejaría
      // el archivo inválido para cualquier otro lector del formato.
      cambiar((c) => ({
        nodos: c.nodos.filter((n) => n.id !== seleccion),
        aristas: c.aristas.filter((a) => a.desdeNodo !== seleccion && a.hastaNodo !== seleccion),
      }));
      setSeleccion(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seleccion, editando, cambiar]);

  // Deshacer y rehacer (`DEF-137`). Se escucha en la fase de captura para
  // adelantarse al Ctrl+Z del explorador (deshacer el último movimiento de un
  // archivo), que se aparta si la tecla ya fue atendida. Solo responde el
  // lienzo que se usó por última vez, si se ve, y nunca con el foco en un campo
  // de texto: ahí Ctrl+Z es el del campo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const accion = accionDeTecla(e);
      if (accion === null || e.defaultPrevented) return;
      if (lienzoActivo !== yoRef.current) return;
      const host = hostRef.current;
      if (host === null || host.getClientRects().length === 0) return;
      const foco = document.activeElement as HTMLElement | null;
      if (
        foco !== null &&
        (foco.isContentEditable || foco.tagName === "INPUT" || foco.tagName === "TEXTAREA")
      )
        return;
      if (editandoRef.current !== null) return;
      e.preventDefault();
      moverEnHistorial(accion);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [moverEnHistorial]);

  useEffect(() => {
    const yo = yoRef.current;
    return () => {
      if (lienzoActivo === yo) lienzoActivo = null;
    };
  }, []);

  // ── Crear ──────────────────────────────────────────────────────────────────
  /** Centro visible del lienzo, para soltar ahí lo que se cree. */
  const centro = () => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: (r.width / 2 - vista.x) / vista.escala - 130,
      y: (r.height / 2 - vista.y) / vista.escala - 70,
    };
  };

  /**
   * Id para una tarjeta nueva, elegido FUERA del actualizador de `cambiar`
   * (`DEF-135`). Antes se sorteaba adentro y desde ahí se marcaba la tarjeta en
   * edición: un actualizador de estado tiene que ser puro —React lo vuelve a
   * correr en desarrollo y se queda con una sola de las pasadas—, y con un id al
   * azar la tarjeta podía quedar con un id distinto del que se marcó «en
   * edición». La tarjeta nueva no abría su texto, el foco se quedaba en el botón
   * y el espacio tecleado para ella creaba otra.
   */
  const idNuevo = () => nuevoId((canvasRef.current?.nodos ?? []).map((n) => n.id));

  const agregarTexto = () => {
    const p = centro();
    const id = idNuevo();
    // Crear la tarjeta y escribir su texto es UN paso: el gesto se abre antes
    // de crearla, así que deshacer se lleva la tarjeta con lo escrito.
    abrirGesto(`texto:${id}`);
    // En el lugar libre más cercano al centro, no encima de otra tarjeta
    // (`DEF-150 h`). `lugarLibre` es pura: puede ir dentro del actualizador.
    cambiar((c) => {
      const q = lugarLibre(c.nodos, p, ANCHO_TARJETA, ALTO_TARJETA);
      return { ...c, nodos: [...c.nodos, nodoTexto(id, q.x, q.y)] };
    }, true);
    setEditando(id);
    setSeleccion(id);
  };

  const agregarNota = (notaDestino: string) => {
    const p = centro();
    const id = idNuevo();
    setEligiendoNota(false);
    // Se guarda la RUTA, no el id: es lo que pide el formato y lo que hace que
    // el canvas se abra en Obsidian (ver `lib/rutasNotas.ts`).
    cambiar((c) => {
      const nueva = nodoArchivo(id, p.x, p.y, rutaDeNota(notaDestino));
      const q = lugarLibre(c.nodos, p, nueva.ancho, nueva.alto); // `DEF-150 h`
      return { ...c, nodos: [...c.nodos, { ...nueva, x: q.x, y: q.y }] };
    });
    setSeleccion(id);
  };

  /** Pinta la tarjeta seleccionada. `undefined` la devuelve al color de Mycelium. */
  const pintar = (color: string | undefined) => {
    if (seleccion === null) return;
    // El mismo color no es un cambio: no debe dejar un paso que no hace nada.
    if (canvasRef.current?.nodos.find((n) => n.id === seleccion)?.color === color) return;
    cambiar((c) => ({
      ...c,
      nodos: c.nodos.map((n) => (n.id === seleccion ? { ...n, color } : n)),
    }));
  };

  const abrirPorTitulo = (titulo: string) => {
    const { nota: destino, ancla } = resolverReferencia(titulo, notas, carpetas);
    if (!destino) return;
    useTabsStore.getState().openNote(destino.id);
    router.replace(`/workspace?note=${encodeURIComponent(destino.id)}`);
    // `[[Nota#Encabezado]]`: además de abrirla, ir al encabezado (`DEF-141`).
    if (ancla) pedirSaltoAAncla(destino.id, ancla);
  };

  const abrirNota = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };

  const candidatasNota = useMemo(
    () => buscarPorPrefijo(notas.filter((n) => n.tipo === "markdown"), busqueda),
    [notas, busqueda],
  );

  const aristas = useMemo(() => {
    if (canvas === null) return [];
    const porId = new Map(canvas.nodos.map((n) => [n.id, n]));
    return canvas.aristas.flatMap((a) => {
      const desde = porId.get(a.desdeNodo);
      const hasta = porId.get(a.hastaNodo);
      if (!desde || !hasta) return [];
      const auto = ladosAutomaticos(desde, hasta);
      const trazo = trazoArista(
        desde,
        a.desdeLado ?? auto.desde,
        hasta,
        a.hastaLado ?? auto.hasta,
      );
      return [{ a, trazo }];
    });
  }, [canvas]);

  if (error !== null && canvas === null) {
    return <p className={styles.aviso}>No se pudo abrir el canvas: {error}</p>;
  }
  if (canvas === null) return <p className={styles.aviso}>Cargando el canvas…</p>;

  const provisional = arrastre.current?.tipo === "arista" ? arrastre.current : null;
  const nodoProvisional = provisional
    ? canvas.nodos.find((n) => n.id === provisional.desde)
    : undefined;

  // Grupos y tarjetas se pintan en capas separadas (`DEF-151`).
  const pintado = ordenDePintado(canvas.nodos);
  const vistaDe = (n: Nodo) => (
  <NodoVista
    key={n.id}
    nodo={n}
    seleccionado={seleccion === n.id}
    editando={editando === n.id}
    notas={notas}
    carpetas={carpetas}
    onSeleccionar={() => setSeleccion(n.id)}
    onEditar={() => {
      abrirGesto(`texto:${n.id}`);
      setEditando(n.id);
    }}
    onTerminarEdicion={terminarEdicion}
    onTexto={(texto) =>
      cambiar(
        (c) => ({
          ...c,
          nodos: c.nodos.map((x) => (x.id === n.id ? { ...x, texto } : x)),
        }),
        true,
      )
    }
    onArrastrar={(e) => {
      abrirGesto("arrastre");
      const p = enLienzo(e);
      arrastre.current = { tipo: "nodo", id: n.id, dx: p.x - n.x, dy: p.y - n.y };
    }}
    onRedimensionar={(e) => {
      abrirGesto("arrastre");
      const p = enLienzo(e);
      arrastre.current = {
        tipo: "tamano",
        id: n.id,
        x0: p.x,
        y0: p.y,
        w0: n.ancho,
        h0: n.alto,
      };
    }}
    onConectar={(lado, e) => {
      const p = enLienzo(e);
      arrastre.current = { tipo: "arista", desde: n.id, lado, x: p.x, y: p.y };
    }}
    onAbrirTitulo={abrirPorTitulo}
    onAbrirNota={abrirNota}
  />
  );

  return (
    <div
      className={styles.wrap}
      // Tocar el lienzo o su barra lo vuelve el destino de Ctrl+Z (`DEF-137`).
      onPointerDownCapture={() => {
        lienzoActivo = yoRef.current;
      }}
    >
      <header className={styles.barra}>
        <button
          type="button"
          className={styles.boton}
          onClick={(e) => {
            // El foco pasa al texto de la tarjeta nueva; el botón no se lo queda,
            // o un espacio tecleado para ella crearía otra (`DEF-135`).
            soltarFoco(e.currentTarget);
            agregarTexto();
          }}
        >
          <Type size={14} aria-hidden /> Tarjeta de texto
        </button>
        <button
          type="button"
          className={styles.boton}
          onClick={() => {
            setBusqueda("");
            setEligiendoNota((v) => !v);
          }}
          aria-expanded={eligiendoNota}
        >
          <FileText size={14} aria-hidden /> Tarjeta de nota
        </button>
        <button
          type="button"
          className={styles.boton}
          title="Volver al 100 %"
          onClick={() => setVista({ x: 0, y: 0, escala: 1 })}
        >
          <Maximize2 size={14} aria-hidden /> {Math.round(vista.escala * 100)}%
        </button>
        <button
          type="button"
          className={styles.boton}
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          disabled={!puede.deshacer}
          onClick={() => moverEnHistorial("deshacer")}
        >
          <Undo2 size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.boton}
          title="Rehacer (Ctrl+Y)"
          aria-label="Rehacer"
          disabled={!puede.rehacer}
          onClick={() => moverEnHistorial("rehacer")}
        >
          <Redo2 size={14} aria-hidden />
        </button>
        {seleccion !== null && (
          <span className={styles.paleta} role="group" aria-label="Color de la tarjeta">
            <button
              type="button"
              className={styles.muestraNinguno}
              title="Sin color (el de Mycelium)"
              onClick={() => pintar(undefined)}
            >
              <Ban size={12} aria-hidden />
            </button>
            {COLORES.map((c) => (
              <button
                key={c.preset}
                type="button"
                className={styles.muestra}
                style={{ background: c.css }}
                title={c.nombre}
                aria-label={c.nombre}
                onClick={() => pintar(c.preset)}
              />
            ))}
          </span>
        )}
        {seleccion !== null && (
          <button
            type="button"
            className={styles.boton}
            onClick={() => {
              cambiar((c) => ({
                nodos: c.nodos.filter((n) => n.id !== seleccion),
                aristas: c.aristas.filter(
                  (a) => a.desdeNodo !== seleccion && a.hastaNodo !== seleccion,
                ),
              }));
              setSeleccion(null);
            }}
          >
            <Trash2 size={14} aria-hidden /> Borrar
          </button>
        )}
        <span className={styles.estado}>
          {sucio ? (
            <>
              <Save size={12} aria-hidden /> guardando…
            </>
          ) : (
            "guardado"
          )}
        </span>
        {eligiendoNota && (
          <div className={styles.selector}>
            <input
              className={styles.buscador}
              autoFocus
              value={busqueda}
              placeholder="Buscar por el principio del nombre…"
              spellCheck={false}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEligiendoNota(false);
                // Enter con un único resultado: la elección obvia.
                if (e.key === "Enter" && candidatasNota.length === 1) {
                  agregarNota(candidatasNota[0].id);
                }
              }}
            />
            <p className={styles.selectorNota}>
              La tarjeta muestra la nota real, no una copia. Se busca por el{" "}
              <strong>principio</strong> del nombre.
            </p>
            <ul className={styles.selectorLista}>
              {candidatasNota.slice(0, 200).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => agregarNota(n.id)}>
                    {n.titulo}
                  </button>
                </li>
              ))}
            </ul>
            {candidatasNota.length === 0 && (
              <p className={styles.selectorNota}>Ninguna nota empieza por «{busqueda}».</p>
            )}
          </div>
        )}
      </header>

      {error !== null && <p className={styles.errorBarra}>{error}</p>}

      <div
        ref={hostRef}
        className={`${styles.lienzo} ${desplazando ? styles.desplazando : ""}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          // El fondo es TODO lo que no sea una tarjeta. Antes se exigía que el
          // evento cayera en el propio contenedor, pero `.mundo` lo cubre entero,
          // así que el arrastre no llegaba a empezar nunca: el puntero solo
          // seleccionaba texto.
          if ((e.target as HTMLElement).closest("[data-nodo]")) return;
          // Sin esto el navegador arranca una selección de texto y el lienzo se
          // "engancha" a mitad del gesto.
          e.preventDefault();
          setSeleccion(null);
          terminarEdicion();
          setDesplazando(true);
          arrastre.current = {
            tipo: "lienzo",
            x0: e.clientX,
            y0: e.clientY,
            vx: vista.x,
            vy: vista.y,
          };
        }}
      >
        <div
          className={styles.mundo}
          style={{
            transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`,
          }}
        >
          {/* Orden de pintado (`DEF-151`): grupos al fondo, encima las flechas y
              arriba las tarjetas. Si un grupo quedaba sobre el SVG, tapaba las
              flechas entre las tarjetas que contiene. */}
          {pintado.grupos.map(vistaDe)}

          {/* Las flechas no reciben el puntero: un clic las atraviesa. */}
          <svg className={styles.aristas} aria-hidden>
            <defs>
              <marker
                id="mic-canvas-punta"
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="4.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 9 4.5 L 0 9 z" fill="var(--mic-text-muted)" />
              </marker>
            </defs>
            {aristas.map(({ a, trazo }) => (
              <path
                key={a.id}
                d={trazo.d}
                className={styles.arista}
                markerEnd={a.hastaPunta === "none" ? undefined : "url(#mic-canvas-punta)"}
                markerStart={a.desdePunta === "arrow" ? "url(#mic-canvas-punta)" : undefined}
              />
            ))}
            {provisional && nodoProvisional && (
              <path
                className={styles.aristaProvisional}
                d={`M ${anclaDe(nodoProvisional, provisional.lado).x} ${
                  anclaDe(nodoProvisional, provisional.lado).y
                } L ${provisional.x} ${provisional.y}`}
              />
            )}
          </svg>

          {pintado.tarjetas.map(vistaDe)}
        </div>

        {canvas.nodos.length === 0 && (
          <p className={styles.vacio} data-fondo="1">
            Un lienzo vacío. Agregá una tarjeta de texto o de nota desde la barra de arriba.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Un nodo ───────────────────────────────────────────────────────────────────

/**
 * ¿Hay algo que desplazar entre el punto del evento y la tarjeta?
 *
 * Se recorre hacia arriba en vez de mirar un elemento concreto porque el que
 * desplaza cambia según el caso: el cuerpo de la tarjeta al leerla, y el
 * `textarea` cuando se está editando. Fijar uno solo dejaba el otro roto.
 */
function hayScroll(desde: EventTarget | null, hasta: HTMLElement | null): boolean {
  let el = desde instanceof HTMLElement ? desde : null;
  while (el !== null) {
    const desborda = el.scrollHeight > el.clientHeight;
    if (desborda) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    if (el === hasta) return false;
    el = el.parentElement;
  }
  return false;
}

function NodoVista({
  nodo,
  seleccionado,
  editando,
  notas,
  carpetas,
  onSeleccionar,
  onEditar,
  onTerminarEdicion,
  onTexto,
  onArrastrar,
  onRedimensionar,
  onConectar,
  onAbrirTitulo,
  onAbrirNota,
}: {
  nodo: Nodo;
  seleccionado: boolean;
  editando: boolean;
  notas: TreeNota[];
  carpetas: TreeCarpeta[];
  onSeleccionar: () => void;
  onEditar: () => void;
  onTerminarEdicion: () => void;
  onTexto: (t: string) => void;
  onArrastrar: (e: React.PointerEvent) => void;
  onRedimensionar: (e: React.PointerEvent) => void;
  onConectar: (lado: Lado, e: React.PointerEvent) => void;
  onAbrirTitulo: (titulo: string) => void;
  onAbrirNota: (id: string) => void;
}) {
  const cuerpoRef = useRef<HTMLDivElement>(null);
  // La tarjeta guarda una ruta; acá se traduce al id para encontrar la nota.
  const notaId =
    nodo.tipo === "file" && nodo.archivo !== undefined
      ? notaDeRuta(nodo.archivo, notas)
      : null;
  const nota = notaId !== null ? notas.find((n) => n.id === notaId) : undefined;
  const [contenido, setContenido] = useState<string | null>(null);

  // Una tarjeta de nota muestra el archivo REAL: se lee su contenido, no se copia.
  useEffect(() => {
    if (nodo.tipo !== "file" || nota === undefined) return;
    let cancelado = false;
    void api<{ contenido: string }>(`/notas/${encodeURIComponent(nota.id)}/contenido`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((r) => {
        if (!cancelado) setContenido(r.contenido ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [nodo.tipo, nota]);

  const html = useMemo(() => {
    if (nodo.tipo === "text") return renderNota(nodo.texto ?? "");
    if (nodo.tipo === "file") return renderNota(contenido ?? "");
    if (nodo.tipo === "link") return `<p><a href="${nodo.url ?? ""}">${nodo.url ?? ""}</a></p>`;
    return "";
  }, [nodo.tipo, nodo.texto, nodo.url, contenido]);

  // Los wikilinks rotos se marcan igual que en la vista de lectura.
  useEffect(() => {
    if (cuerpoRef.current) markMissingWikilinks(cuerpoRef.current, notas, carpetas);
  }, [html, notas, carpetas]);

  const clases = [
    styles.nodo,
    seleccionado ? styles.nodoSel : "",
    nodo.tipo === "group" ? styles.nodoGrupo : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Sin color, la tarjeta usa los tokens del tema (el aspecto por defecto). Con
  // color, solo se tiñen el borde y la cabecera: el cuerpo tiene que seguir
  // legible en los dos temas, así que el fondo apenas se matiza.
  const css = colorCss(nodo.color);
  const estiloColor = css
    ? ({
        borderColor: css,
        "--mic-canvas-color": css,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      data-nodo={nodo.id}
      className={clases}
      style={{ left: nodo.x, top: nodo.y, width: nodo.ancho, height: nodo.alto, ...estiloColor }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSeleccionar();
      }}
      // La rueda sobre una tarjeta que desborda es para leerla: se corta acá y
      // el lienzo ni se entera, así que no hay forma de que además haga zoom.
      // Si la tarjeta NO desborda no hay nada que desplazar y el evento sigue su
      // camino, que es lo que se quiere.
      onWheel={(e) => {
        if (hayScroll(e.target, e.currentTarget)) e.stopPropagation();
      }}
    >
      {/* Asa de arrastre propia: si lo fuera la tarjeta entera no se podría
          seleccionar texto ni pulsar un enlace dentro de ella. */}
      <div
        className={css ? `${styles.asa} ${styles.asaColor}` : styles.asa}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSeleccionar();
          onArrastrar(e);
        }}
        onDoubleClick={() => nodo.tipo === "text" && onEditar()}
      >
        <span className={styles.asaTitulo}>
          {nodo.tipo === "file"
            ? (nota?.titulo ?? nodo.archivo ?? "")
            : nodo.tipo === "group"
              ? (nodo.etiqueta ?? "Grupo")
              : "Texto"}
        </span>
        {nodo.tipo === "file" && nota !== undefined && (
          <button
            type="button"
            className={styles.abrir}
            title="Abrir la nota"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onAbrirNota(nota.id)}
          >
            Abrir
          </button>
        )}
      </div>

      <div className={styles.cuerpo}>
        {nodo.tipo === "file" && nota === undefined ? (
          // Criterio 10: borrar la nota no rompe el canvas, lo dice.
          <p className={styles.roto}>
            La nota <code>{nodo.archivo}</code> ya no existe.
          </p>
        ) : editando ? (
          <textarea
            className={styles.editor}
            autoFocus
            value={nodo.texto ?? ""}
            onChange={(e) => onTexto(e.target.value)}
            onBlur={onTerminarEdicion}
            onKeyDown={(e) => {
              if (e.key === "Escape") onTerminarEdicion();
              e.stopPropagation(); // Supr dentro del texto no borra la tarjeta
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            ref={cuerpoRef}
            className={`mic-preview ${styles.render}`}
            dangerouslySetInnerHTML={{ __html: html }}
            onDoubleClick={() => nodo.tipo === "text" && onEditar()}
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest("a");
              const href = a?.getAttribute("href") ?? "";
              // Una tarjeta puede traer un enlace web: al navegador (`FUN-S-20`).
              if (manejarClicDeEnlace(e, href)) return;
              if (href.startsWith("#wikilink:")) {
                e.preventDefault();
                onAbrirTitulo(decodeURIComponent(href.slice("#wikilink:".length)));
              } else if (href.startsWith("#tag:")) {
                e.preventDefault();
              }
            }}
          />
        )}
      </div>

      {/* Anclas de conexión, una por lado. */}
      {LADOS.map((lado) => (
        <span
          key={lado}
          className={`${styles.ancla} ${styles[`ancla_${lado}`]}`}
          title="Arrastrá hasta otra tarjeta para conectarlas"
          onPointerDown={(e) => {
            e.stopPropagation();
            onConectar(lado, e);
          }}
        />
      ))}

      <span
        className={styles.tirador}
        title="Redimensionar"
        onPointerDown={(e) => {
          e.stopPropagation();
          onRedimensionar(e);
        }}
      />
    </div>
  );
}
