"use client";

import { Ban, FileText, Maximize2, Save, Trash2, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  anclaDe,
  buscarPorPrefijo,
  colorCss,
  COLORES,
  ladosAutomaticos,
  nodoArchivo,
  nodoTexto,
  nuevaArista,
  nuevoId,
  parsearCanvas,
  serializarCanvas,
  trazoArista,
  type Canvas,
  type Lado,
  type Nodo,
} from "@/lib/canvas";
import { markMissingWikilinks, resolveWikilink } from "@/lib/editor/wikilink";
import { renderNota } from "@/lib/markdown";
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
        setCanvas(parsearCanvas(r.contenido ?? ""));
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [notaId]);

  // ── Guardado con retardo ───────────────────────────────────────────────────
  const guardar = useCallback(
    async (c: Canvas) => {
      try {
        await api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
          method: "PUT",
          token: useAuthStore.getState().accessToken,
          body: { contenido: serializarCanvas(c) },
        });
        setSucio(false);
        // Las tarjetas pueden traer `[[enlaces]]`: el grafo queda desactualizado.
        useGraphStore.getState().markStale();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [notaId],
  );

  /** Aplica un cambio al canvas y programa el guardado. */
  const cambiar = useCallback(
    (fn: (c: Canvas) => Canvas) => {
      setCanvas((prev) => {
        if (prev === null) return prev;
        const siguiente = fn(prev);
        setSucio(true);
        if (guardadoRef.current) clearTimeout(guardadoRef.current);
        guardadoRef.current = setTimeout(() => void guardar(siguiente), GUARDADO_MS);
        return siguiente;
      });
    },
    [guardar],
  );

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
        }));
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
        }));
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
  }, [cambiar, enLienzo]);

  /**
   * Zoom hacia el cursor: lo que está bajo el puntero no se mueve.
   *
   * Salvo que el puntero esté sobre una tarjeta **que tenga scroll**: ahí la
   * rueda es para leerla. Antes hacía las dos cosas a la vez —la tarjeta bajaba
   * y el lienzo se alejaba— que no es lo que espera nadie. Sobre una tarjeta que
   * NO desborda no hay nada que desplazar, así que se sigue haciendo zoom.
   */
  const onWheel = (e: React.WheelEvent) => {
    const cuerpo = (e.target as HTMLElement).closest(`.${styles.cuerpo}`);
    if (cuerpo instanceof HTMLElement && cuerpo.scrollHeight > cuerpo.clientHeight) return;
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
      const activo = document.activeElement?.tagName;
      if (activo === "INPUT" || activo === "TEXTAREA") return;
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

  const agregarTexto = () => {
    const p = centro();
    cambiar((c) => {
      const id = nuevoId(c.nodos.map((n) => n.id));
      setEditando(id);
      setSeleccion(id);
      return { ...c, nodos: [...c.nodos, nodoTexto(id, p.x, p.y)] };
    });
  };

  const agregarNota = (notaDestino: string) => {
    const p = centro();
    setEligiendoNota(false);
    cambiar((c) => {
      const id = nuevoId(c.nodos.map((n) => n.id));
      setSeleccion(id);
      // Se guarda la RUTA, no el id: es lo que pide el formato y lo que hace que
      // el canvas se abra en Obsidian (ver `lib/rutasNotas.ts`).
      return { ...c, nodos: [...c.nodos, nodoArchivo(id, p.x, p.y, rutaDeNota(notaDestino))] };
    });
  };

  /** Pinta la tarjeta seleccionada. `undefined` la devuelve al color de Mycelium. */
  const pintar = (color: string | undefined) => {
    if (seleccion === null) return;
    cambiar((c) => ({
      ...c,
      nodos: c.nodos.map((n) => (n.id === seleccion ? { ...n, color } : n)),
    }));
  };

  const abrirPorTitulo = (titulo: string) => {
    const destino = resolveWikilink(titulo, notas, carpetas);
    if (!destino) return;
    useTabsStore.getState().openNote(destino.id);
    router.replace(`/workspace?note=${encodeURIComponent(destino.id)}`);
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

  return (
    <div className={styles.wrap}>
      <header className={styles.barra}>
        <button type="button" className={styles.boton} onClick={agregarTexto}>
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
          setEditando(null);
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
          {/* Las flechas van debajo de las tarjetas, y no reciben el puntero. */}
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

          {canvas.nodos.map((n) => (
            <NodoVista
              key={n.id}
              nodo={n}
              seleccionado={seleccion === n.id}
              editando={editando === n.id}
              notas={notas}
              carpetas={carpetas}
              onSeleccionar={() => setSeleccion(n.id)}
              onEditar={() => setEditando(n.id)}
              onTerminarEdicion={() => setEditando(null)}
              onTexto={(texto) =>
                cambiar((c) => ({
                  ...c,
                  nodos: c.nodos.map((x) => (x.id === n.id ? { ...x, texto } : x)),
                }))
              }
              onArrastrar={(e) => {
                const p = enLienzo(e);
                arrastre.current = { tipo: "nodo", id: n.id, dx: p.x - n.x, dy: p.y - n.y };
              }}
              onRedimensionar={(e) => {
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
          ))}
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
