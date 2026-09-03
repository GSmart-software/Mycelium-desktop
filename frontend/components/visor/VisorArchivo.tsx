"use client";

import { ExternalLink, FileWarning, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { SearchBar } from "@/components/editor/SearchBar";
import {
  abrirConSistema,
  extensionDeRuta,
  formatearBytes,
  leerArchivoVisor,
  nombreDeRuta,
  tipoDeVisor,
  urlDeArchivo,
  escribirArchivoVisor,
  sePuedeEditar,
  type ArchivoVisor,
} from "@/lib/otrosArchivos";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./VisorArchivo.module.css";

/**
 * Visor de los archivos del vault que **no** son notas (`FUN-L-11`): texto y
 * código, PDF e imágenes.
 *
 * **De solo lectura, a propósito.** Mycelium no los indexa ni los respalda:
 * escribir en algo que no está bajo su cuidado es la peor combinación posible.
 * Por eso acá no hay guardado, ni edición, ni autoguardado — se leen, se buscan
 * y se cierran.
 *
 * Cada tipo llega por el camino que le corresponde y la diferencia no es un
 * detalle: el texto por IPC (`leer_archivo_visor`, que corta por tamaño y avisa
 * si no decodifica) y el PDF/imagen por el protocolo `asset:`, que los sirve en
 * trozos sin pasarlos a base64 ni duplicarlos en memoria.
 */
export function VisorArchivo({ ruta, isActivePane }: { ruta: string; isActivePane: boolean }) {
  const vault = useVaultSessionStore((s) => s.rutaActual);
  const nombre = nombreDeRuta(ruta);
  const tipo = tipoDeVisor(extensionDeRuta(ruta));

  const abrirFuera = () => {
    if (vault) void abrirConSistema(vault, ruta).catch(() => {});
  };

  return (
    <div className={styles.visor}>
      <header className={styles.cabecera}>
        <span className={styles.nombre} title={ruta}>
          {nombre}
        </span>
        <span className={styles.soloLectura}>Solo lectura</span>
        <span className={styles.espacio} />
        <button
          type="button"
          className={styles.accion}
          onClick={abrirFuera}
          title="Abrir con la aplicación del sistema"
        >
          <ExternalLink size={14} aria-hidden />
          Abrir con el sistema
        </button>
      </header>

      {tipo === "texto" ? (
        <VisorTexto ruta={ruta} vault={vault} isActivePane={isActivePane} onAbrirFuera={abrirFuera} />
      ) : tipo === "pdf" ? (
        <VisorPdf ruta={ruta} vault={vault} />
      ) : tipo === "imagen" ? (
        <VisorImagen ruta={ruta} vault={vault} />
      ) : (
        <Aviso
          titulo="Mycelium no puede mostrar este archivo"
          detalle="No es texto ni un tipo que sepa dibujar. Se puede abrir con la aplicación que el sistema tenga asociada."
          onAbrirFuera={abrirFuera}
        />
      )}
    </div>
  );
}

/** Mensaje a pantalla completa con la salida de emergencia. */
function Aviso({
  titulo,
  detalle,
  onAbrirFuera,
}: {
  titulo: string;
  detalle: string;
  onAbrirFuera: () => void;
}) {
  return (
    <div className={styles.aviso}>
      <FileWarning size={28} aria-hidden className={styles.avisoIcono} />
      <p className={styles.avisoTitulo}>{titulo}</p>
      <p className={styles.avisoDetalle}>{detalle}</p>
      <button type="button" className={styles.accion} onClick={onAbrirFuera}>
        <ExternalLink size={14} aria-hidden />
        Abrir con el sistema
      </button>
    </div>
  );
}

/**
 * Texto y código: monoespaciado con números de línea. **Sin resaltado de
 * sintaxis** — eso es `FUN-S-09` y va aparte.
 *
 * Las líneas se pintan en dos `<pre>` (números y contenido) y no en un elemento
 * por línea: un archivo de 2 MB son decenas de miles de líneas, y decenas de
 * miles de nodos serían un panel que tarda segundos en aparecer y se arrastra al
 * desplazarse. Con dos nodos de texto, además, `buscarEnDom` recorre el
 * contenido de un tirón.
 */
function VisorTexto({
  ruta,
  vault,
  isActivePane,
  onAbrirFuera,
}: {
  ruta: string;
  vault: string | null;
  isActivePane: boolean;
  onAbrirFuera: () => void;
}) {
  const [datos, setDatos] = useState<ArchivoVisor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // FUN-M-26: editar es un modo al que se ENTRA, no el estado por defecto.
  // Estos archivos no se indexan, no van a la papelera y no tienen historial:
  // un guardado equivocado no se deshace desde la app.
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");
  const [sucio, setSucio] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<number | null>(null);
  const numerosRef = useRef<HTMLPreElement>(null);
  const textoRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!vault) return;
    let vivo = true;
    setDatos(null);
    setError(null);
    setEditando(false);
    setSucio(false);
    setAviso(null);
    setConflicto(null);
    void leerArchivoVisor(vault, ruta)
      .then((d) => {
        if (vivo) setDatos(d);
      })
      .catch((e) => {
        if (vivo) setError(String(e));
      });
    return () => {
      vivo = false;
    };
  }, [vault, ruta]);

  async function guardar(forzar: boolean) {
    if (!vault || datos === null) return;
    setAviso(null);
    try {
      const res = await escribirArchivoVisor(
        vault,
        ruta,
        borrador,
        forzar ? null : (conflicto ?? datos.mtime),
      );
      if (!res.guardado) {
        // No es un error: el archivo cambió en disco y la decisión es del
        // usuario. Se guarda el mtime nuevo para poder reintentar contra él.
        setConflicto(res.mtime);
        return;
      }
      setDatos({ ...datos, contenido: borrador, mtime: res.mtime });
      setSucio(false);
      setConflicto(null);
    } catch (e) {
      setAviso(typeof e === "string" ? e : "No se pudo guardar el archivo.");
    }
  }

  function salirDeEdicion() {
    if (sucio && !window.confirm("Hay cambios sin guardar. ¿Salir y descartarlos?")) return;
    setEditando(false);
    setSucio(false);
    setConflicto(null);
    setAviso(null);
  }

  // Los números se derivan del contenido y no cambian mientras no cambie: se
  // memorizan para no reconstruir la cadena entera en cada render de la barra
  // de búsqueda.
  const { lineas, numeros } = useMemo(() => {
    const texto = datos?.contenido ?? "";
    // Un `\n` final no es una línea más: es el cierre de la última.
    const cuerpo = texto.endsWith("\n") ? texto.slice(0, -1) : texto;
    const total = cuerpo === "" ? 0 : cuerpo.split("\n").length;
    let nums = "";
    for (let i = 1; i <= total; i += 1) nums += `${i}\n`;
    return { lineas: cuerpo, numeros: nums };
  }, [datos]);

  if (error !== null) {
    return (
      <Aviso
        titulo="El archivo ya no está donde estaba"
        detalle="Puede haberse borrado, renombrado o movido desde fuera de Mycelium."
        onAbrirFuera={onAbrirFuera}
      />
    );
  }
  if (datos === null) return <p className={styles.cargando}>Leyendo el archivo…</p>;
  if (datos.binario) {
    return (
      <Aviso
        titulo="Mycelium no puede mostrar este archivo"
        detalle="Su contenido no es texto (o está en una codificación que Mycelium no entiende). Mostrarlo igual solo llenaría la pantalla de símbolos sin sentido."
        onAbrirFuera={onAbrirFuera}
      />
    );
  }

  return (
    <>
      {isActivePane && !editando && (
        <SearchBar
          getView={() => null}
          getPreview={() => textoRef.current}
          modoLectura
          placeholder="Buscar en el archivo…"
        />
      )}
      <div className={styles.barra}>
        {/* El botón NO EXISTE si el archivo está truncado o no es texto: no
            basta con deshabilitarlo. Guardar un fragmento de 2 MB borraría el
            resto del archivo en silencio (`FUN-M-26`). */}
        {!editando && sePuedeEditar(datos) && (
          <button
            type="button"
            className={styles.accion}
            onClick={() => {
              setBorrador(datos.contenido);
              setSucio(false);
              setEditando(true);
            }}
          >
            Editar
          </button>
        )}
        {editando && (
          <>
            <button
              type="button"
              className={styles.accion}
              onClick={() => void guardar(false)}
              disabled={!sucio}
            >
              {sucio ? "Guardar (Ctrl+S)" : "Guardado"}
            </button>
            <button type="button" className={styles.accion} onClick={salirDeEdicion}>
              Salir de edición
            </button>
            {sucio && <span className={styles.sucio}>· sin guardar</span>}
          </>
        )}
        <button type="button" className={styles.accion} onClick={onAbrirFuera}>
          Abrir con el sistema
        </button>
      </div>
      {conflicto !== null && (
        <p className={styles.fragmento}>
          El archivo cambió fuera de Mycelium desde que lo abriste. No se guardó nada.{" "}
          <button type="button" className={styles.enlace} onClick={() => void guardar(true)}>
            sobrescribir igual
          </button>{" "}
          o{" "}
          <button
            type="button"
            className={styles.enlace}
            onClick={() => {
              setConflicto(null);
              setEditando(false);
              setSucio(false);
              setDatos(null);
              void leerArchivoVisor(vault!, ruta).then(setDatos).catch((e) => setError(String(e)));
            }}
          >
            descartar lo mío y recargar
          </button>
          .
        </p>
      )}
      {aviso !== null && <p className={styles.fragmento}>{aviso}</p>}
      {datos.truncado && (
        <p className={styles.fragmento}>
          Se muestra el principio del archivo ({formatearBytes(datos.bytes)} en total). Para verlo
          entero,{" "}
          <button type="button" className={styles.enlace} onClick={onAbrirFuera}>
            abrilo con la aplicación del sistema
          </button>
          .
        </p>
      )}
      {editando ? (
        <EditorTexto
          inicial={datos.contenido}
          onCambio={(t) => {
            setBorrador(t);
            setSucio(t !== datos.contenido);
          }}
          onGuardar={() => void guardar(false)}
        />
      ) : (
      <div className={styles.panelTexto}>
        {/* La columna de números NO scrollea sola: se la lleva de la mano el
            texto. Si estuviera dentro del mismo contenedor desplazable,
            `buscarEnDom` la recorrería como contenido y buscar "12" resaltaría
            números de línea. */}
        <pre className={styles.numeros} ref={numerosRef} aria-hidden>
          {numeros}
        </pre>
        {/* Este `<pre>` es a la vez la raíz de la búsqueda y el panel que
            desplaza: `centrarRango` mueve el `scrollTop` del elemento que se le
            pasa, así que tienen que ser el mismo. */}
        <pre
          className={styles.texto}
          ref={textoRef}
          onScroll={(e) => {
            if (numerosRef.current) numerosRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          {lineas}
        </pre>
      </div>
      )}
    </>
  );
}

/**
 * El archivo abierto para editarlo (`FUN-M-26`).
 *
 * CodeMirror en configuración **mínima** —números de línea, deshacer y las
 * teclas por defecto— y nada más: ni vista en vivo, ni markdown, ni widgets.
 * Es el mismo motor que el editor de notas, así que no suma nada al bundle,
 * pero **no comparte sus extensiones**: acá un `[[` es texto y un `#` es una
 * almohadilla.
 */
function EditorTexto({
  inicial,
  onCambio,
  onGuardar,
}: {
  inicial: string;
  onCambio: (texto: string) => void;
  onGuardar: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // El guardado se dispara desde un keymap que se registra UNA vez, así que
  // tiene que leer siempre la última función y no la que había al montar.
  const guardarRef = useRef(onGuardar);
  guardarRef.current = onGuardar;
  const cambioRef = useRef(onCambio);
  cambioRef.current = onCambio;

  useEffect(() => {
    if (!host.current) return;
    const vista = new EditorView({
      state: EditorState.create({
        doc: inicial,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                guardarRef.current();
                return true; // consumido: si no, el webview abre su "guardar como"
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cambioRef.current(u.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    vista.focus();
    return () => vista.destroy();
    // `inicial` a propósito fuera: recrear la vista al teclear perdería el
    // cursor y el historial de deshacer en cada pulsación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className={`mic-editor-host ${styles.editor}`} ref={host} />;
}

/**
 * PDF: se lo entrega al visor del propio webview con un `<iframe>` sobre la URL
 * `asset:`. Es lo que da la paginación, la búsqueda y el zoom sin sumar un
 * motor de PDF al bundle — y como el protocolo responde a `Range`, el documento
 * se lee por partes en vez de cargarse entero.
 */
function VisorPdf({ ruta, vault }: { ruta: string; vault: string | null }) {
  const url = useMemo(() => (vault ? urlDeArchivo(vault, ruta) : ""), [vault, ruta]);
  if (url === "") return <p className={styles.cargando}>Abriendo el documento…</p>;
  return <iframe className={styles.pdf} src={url} title={nombreDeRuta(ruta)} />;
}

/** Pasos de zoom de la imagen, en fracción del tamaño original. */
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/**
 * Imagen: se pinta a tamaño real dentro de un panel desplazable. El zoom se
 * mueve por la escalera de `ZOOMS`; con la imagen ampliada, arrastrar desplaza
 * el panel (es más natural que buscar las barras de scroll).
 */
function VisorImagen({ ruta, vault }: { ruta: string; vault: string | null }) {
  const url = useMemo(() => (vault ? urlDeArchivo(vault, ruta) : ""), [vault, ruta]);
  const [zoom, setZoom] = useState<number | null>(null); // null = ajustar al panel
  const [roto, setRoto] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const escalon = (delta: 1 | -1) => {
    const actual = zoom ?? 1;
    const i = ZOOMS.findIndex((z) => z >= actual - 0.001);
    const siguiente = ZOOMS[Math.min(Math.max((i < 0 ? 3 : i) + delta, 0), ZOOMS.length - 1)];
    setZoom(siguiente);
  };

  // Arrastrar para desplazar: solo tiene sentido con la imagen ampliada, así
  // que se apoya en el scroll del panel en vez de mover la imagen por CSS.
  function onPointerDown(e: React.PointerEvent) {
    const panel = panelRef.current;
    if (!panel || e.button !== 0) return;
    const inicio = { x: e.clientX, y: e.clientY, sl: panel.scrollLeft, st: panel.scrollTop };
    panel.setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      if (!panel) return;
      panel.scrollLeft = inicio.sl - (ev.clientX - inicio.x);
      panel.scrollTop = inicio.st - (ev.clientY - inicio.y);
    }
    function onUp(ev: PointerEvent) {
      panel?.releasePointerCapture(ev.pointerId);
      panel?.removeEventListener("pointermove", onMove);
      panel?.removeEventListener("pointerup", onUp);
    }
    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
  }

  if (url === "") return <p className={styles.cargando}>Abriendo la imagen…</p>;
  if (roto) {
    return (
      <p className={styles.cargando}>
        No se pudo cargar la imagen. Puede haberse borrado o movido desde fuera de Mycelium.
      </p>
    );
  }

  return (
    <>
      <div className={styles.barraZoom}>
        <button type="button" className={styles.iconoZoom} title="Alejar" onClick={() => escalon(-1)}>
          <Minus size={14} aria-hidden />
        </button>
        <span className={styles.nivelZoom}>{zoom === null ? "Ajustada" : `${Math.round(zoom * 100)} %`}</span>
        <button type="button" className={styles.iconoZoom} title="Acercar" onClick={() => escalon(1)}>
          <Plus size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.iconoZoom}
          title="Ajustar al panel"
          onClick={() => setZoom(null)}
        >
          <Maximize2 size={14} aria-hidden />
        </button>
      </div>
      <div
        className={styles.panelImagen}
        ref={panelRef}
        onPointerDown={onPointerDown}
        data-arrastrable={zoom !== null || undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- el optimizador de
            Next no puede tocar una URL del protocolo `asset:` del webview. */}
        <img
          src={url}
          alt={nombreDeRuta(ruta)}
          className={zoom === null ? styles.imagenAjustada : styles.imagen}
          style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
          draggable={false}
          onError={() => setRoto(true)}
        />
      </div>
    </>
  );
}
