"use client";

import {
  AlignLeft,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  Heading,
  List,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setPendingMatch } from "@/lib/editor/pendingMatch";
import { ICONO_POR_TIPO } from "@/lib/iconosDeTipo";
import { navegarFilas, primerControl } from "@/lib/teclado/listaDom";
import {
  agruparEnArbol,
  firstSearchTerm,
  fragmentToHtml,
  folderPath,
  type NodoResultados,
} from "@/lib/search";
import { EVENTO_BUSCAR, tomarBusquedaPendiente, verBusquedaPendiente } from "@/lib/busquedaPendiente";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore, type NotaTipo } from "@/stores/vaultStore";
import { RenameInput, useAccionesArchivo, type RenameState } from "./useAccionesArchivo";
import styles from "./SearchPanel.module.css";

/** Lo que una fila de resultados necesita para su menú y su renombrado (`DEF-185`). */
type AccionesFila = Pick<
  ReturnType<typeof useAccionesArchivo>,
  "renaming" | "cambiarRenombre" | "commitRename" | "setRenaming"
> & {
  /** Clic derecho (o tecla Menú) sobre una nota. */
  menuNota: (e: React.MouseEvent, notaId: string) => void;
  /** Clic derecho (o tecla Menú) sobre una carpeta. */
  menuCarpeta: (e: React.MouseEvent, carpetaId: string) => void;
};

/** ¿Se está renombrando ESTE elemento? */
const renombrando = (r: RenameState, type: "nota" | "carpeta", id: string | null) =>
  r !== null && r.type === type && r.id === id;

type Resultado = {
  nota_id: string;
  titulo: string;
  carpeta_id: string | null;
  fragmento: string;
};

const DEBOUNCE_MS = 200;

/**
 * Con menos caracteres no se consulta (`FUN-M-38`, hallazgo H2). Una letra
 * sola coincide con casi todas las notas, y FTS5 calcula el `snippet()` de
 * TODAS antes de quedarse con las 50 mejores: medido, `"e"*` tardaba 2,3 s en
 * un vault de 1.300 notas contra 80 ms de `"pr"*`. Y como la primera letra
 * siempre llega antes que la segunda, esa consulta era la lenta de todas.
 */
const MINIMO_CARACTERES = 2;

/**
 * Los tres modos de búsqueda, en el orden en que los recorre el botón
 * (`FUN-M-20`).
 *
 * Es un botón que cicla y no un desplegable porque son **tres** opciones y una
 * de ellas es la de siempre: recorrerlas cuesta un clic, y así el control ocupa
 * lo mismo que el de la vista y cabe dentro del propio campo de búsqueda. Con
 * más opciones esto no escalaría —ciclar entre seis es peor que elegir— pero con
 * tres, elegir de una lista es más trabajo que probar.
 *
 * El estado se lee del ícono y del `title`; el `aria-label` lo dice completo,
 * porque un ícono que cambia no se anuncia solo.
 */
const CAMPOS = {
  ambos: { etiqueta: "nombre y contenido", icono: Search },
  nombre: { etiqueta: "solo el nombre", icono: Heading },
  contenido: { etiqueta: "solo el contenido", icono: AlignLeft },
} as const;

const ORDEN_CAMPOS = ["ambos", "nombre", "contenido"] as const;

type CampoBusqueda = (typeof ORDEN_CAMPOS)[number];

const siguienteCampo = (actual: CampoBusqueda): CampoBusqueda =>
  ORDEN_CAMPOS[(ORDEN_CAMPOS.indexOf(actual) + 1) % ORDEN_CAMPOS.length];

/**
 * Panel de búsqueda full-text del vault (HU-21). Reemplaza el explorer en el
 * panel izquierdo, recibe el foco al abrir, busca con debounce vía FTS5 y al
 * hacer clic abre la nota posicionando el cursor en la primera coincidencia.
 */
export function SearchPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultadosRef = useRef<HTMLDivElement>(null);
  const alTeclaEnResultados = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // El campo de renombrar atiende sus propias teclas (Enter, Esc, flechas).
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    // Tecla Menú o Shift+F10: el menú del resultado, como el clic derecho; F2,
    // renombrar. Lo mismo que en el árbol del explorador (`DEF-185`).
    const fila = e.target as HTMLElement;
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const r = fila.getBoundingClientRect();
      fila.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }),
      );
      return;
    }
    if (e.key === "F2") {
      const { notaId, carpetaId } = fila.dataset;
      const vs = useVaultStore.getState();
      const nota = notaId ? vs.notas.find((n) => n.id === notaId) : undefined;
      const carpeta = carpetaId ? vs.carpetas.find((c) => c.id === carpetaId) : undefined;
      if (nota) archivo.setRenaming({ type: "nota", id: nota.id, valor: nota.titulo });
      else if (carpeta) archivo.setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre });
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    navegarFilas(e, e.currentTarget, "button", () => inputRef.current?.focus());
  };
  // Un texto pedido desde otra vista (una etiqueta de la salud del vault).
  const [query, setQuery] = useState(() => verBusquedaPendiente() ?? "");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  // Número de la última consulta lanzada (`DEF-111`). Limpiar el debounce no
  // cancela la petición en vuelo, y una respuesta lenta —`"e"` en 2,3 s— podía
  // llegar después que la de `"es"` y pisarla con resultados viejos. Cada
  // consulta anota su número y, si al volver ya hay otra más nueva, se descarta.
  const consultaRef = useRef(0);
  // Cómo se busca y cómo se ven los resultados: los tres son preferencias DEL
  // USUARIO y no del vault —describen cómo se busca, no qué contiene—, y ninguno
  // puede ser estado local: este panel se desmonta al cambiar de sección del
  // rail, y una elección que se pierde sola es peor que no poder hacerla.
  //
  // Por defecto `exacto` está apagado: busca por COINCIDENCIA (prefijo).
  // Activado, solo la palabra completa (`DEF-035`).
  const exacto = usePreferencesStore((s) => s.prefs.busquedaExacta);
  const campo = usePreferencesStore((s) => s.prefs.busquedaCampo);
  const arbol = usePreferencesStore((s) => s.prefs.busquedaArbol);
  const setPref = usePreferencesStore((s) => s.setPref);

  const carpetas = useVaultStore((s) => s.carpetas);
  // El tipo de cada nota, para el ícono del árbol (`FUN-M-20`). Sale del índice
  // que ya está en memoria y NO del resultado de la búsqueda: agregarlo a la
  // respuesta obligaría a tocar también el endpoint de web para un dato que
  // acá ya se tiene.
  const notas = useVaultStore((s) => s.notas);
  const tipos = useMemo(() => new Map(notas.map((n) => [n.id, n.tipo])), [notas]);
  const vaultId = useVaultStore((s) => s.vaultId);

  // El menú contextual del explorador, el mismo (`DEF-185`): renombrar, mover,
  // duplicar o borrar desde un resultado sin ir a buscarlo al árbol.
  const archivo = useAccionesArchivo();
  const accionesFila: AccionesFila = {
    renaming: archivo.renaming,
    cambiarRenombre: archivo.cambiarRenombre,
    commitRename: archivo.commitRename,
    setRenaming: archivo.setRenaming,
    menuNota: (e, notaId) => {
      e.preventDefault();
      // Una nota que la búsqueda encuentra pero el índice en memoria todavía
      // no tiene: sin menú, que sus acciones no tendrían sobre qué operar.
      const nota = useVaultStore.getState().notas.find((n) => n.id === notaId);
      if (nota) archivo.abrirMenu(e, archivo.notaMenu(nota));
    },
    menuCarpeta: (e, carpetaId) => {
      e.preventDefault();
      const vs = useVaultStore.getState();
      const carpeta = vs.carpetas.find((c) => c.id === carpetaId);
      if (!carpeta) return;
      // Como en el explorador: la carpeta del clic derecho pasa a ser el
      // destino de «nota nueva» e importar.
      vs.setActiveFolder(carpeta.id);
      archivo.abrirMenu(e, archivo.carpetaMenu(carpeta));
    },
  };

  /**
   * Lo que cambia la lista de resultados sin cambiar la consulta: renombrar,
   * mover, duplicar, crear o borrar desde el menú (`DEF-185`). Sin esto, la
   * fila seguía mostrando el nombre viejo y apuntando a una ruta que ya no
   * existe. Son los ids (la ruta) y los títulos: guardar una nota no la cambia,
   * así que escribir no relanza la búsqueda.
   */
  const firmaVault = useMemo(
    () => notas.map((n) => `${n.id}\u0000${n.titulo}`).join("\n") + "\n\n" + carpetas.map((c) => c.id).join("\n"),
    [notas, carpetas],
  );

  // Al terminar un renombrado, el foco vuelve a los resultados: el campo
  // desaparece y, sin esto, caía al <body>. Se busca la fila por su id de
  // antes (sirve si se canceló); si ya no está, la primera, y si tampoco, el
  // campo de búsqueda.
  const renombradoAnteriorRef = useRef<RenameState>(null);
  useEffect(() => {
    const antes = renombradoAnteriorRef.current;
    renombradoAnteriorRef.current = archivo.renaming;
    if (!antes || archivo.renaming) return;
    const cuadro = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const atributo = antes.type === "carpeta" ? "data-carpeta-id" : "data-nota-id";
      const fila =
        resultadosRef.current?.querySelector<HTMLElement>(`[${atributo}="${CSS.escape(antes.id)}"]`) ??
        primerControl(resultadosRef.current);
      (fila ?? inputRef.current)?.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [archivo.renaming]);

  // Foco automático al activar la búsqueda (CA2)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Con el panel ya abierto, el pedido llega por evento. Al montarse, el que
  // ya tomó el estado inicial se consume.
  useEffect(() => {
    tomarBusquedaPendiente();
    const alPedir = () => {
      const t = tomarBusquedaPendiente();
      if (t !== null) setQuery(t);
      inputRef.current?.focus();
    };
    window.addEventListener(EVENTO_BUSCAR, alPedir);
    return () => window.removeEventListener(EVENTO_BUSCAR, alPedir);
  }, []);

  // Búsqueda con debounce (CA3, CA6, CA7)
  useEffect(() => {
    const term = query.trim();
    if (term.length < MINIMO_CARACTERES) {
      // Invalida lo que esté en vuelo: si el usuario borró hasta una letra, la
      // respuesta de la consulta anterior ya no tiene dónde caer.
      consultaRef.current++;
      setResultados([]);
      setBuscado(false);
      setLoading(false);
      return;
    }
    const handle = setTimeout(async () => {
      if (!vaultId) return;
      const consulta = ++consultaRef.current;
      setLoading(true);
      try {
        const data = await api<{ resultados: Resultado[] }>(
          `/vaults/${vaultId}/buscar?q=${encodeURIComponent(term)}&exacto=${exacto}&campo=${campo}`,
          { token: useAuthStore.getState().accessToken },
        );
        if (consulta !== consultaRef.current) return; // ya hay una más nueva
        setResultados(data.resultados);
      } catch {
        if (consulta === consultaRef.current) setResultados([]);
      } finally {
        if (consulta === consultaRef.current) {
          setLoading(false);
          setBuscado(true);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, vaultId, exacto, campo, firmaVault]);

  const restoreExplorer = () => {
    usePanelLayoutStore.getState().toggleSection("explorer");
  };

  const openResult = (notaId: string) => {
    const term = firstSearchTerm(query);
    setPendingMatch(notaId, term);
    useTabsStore.getState().openNote(notaId);
    router.replace(`/workspace?note=${notaId}`);
    // Si la nota ya estaba abierta, el editor montado salta a la coincidencia.
    window.dispatchEvent(
      new CustomEvent("micelio:goto-match", { detail: { notaId, term } }),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // ↓ baja a los resultados (`FUN-XL-04`, Parte 7); ahí, ↑ ↓ los recorren,
    // Enter abre y Esc o ↑ en el primero vuelven al campo.
    if (event.key === "ArrowDown" && !event.altKey && !event.ctrlKey) {
      const primero = primerControl(resultadosRef.current);
      if (primero) {
        event.preventDefault();
        primero.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query.length > 0) {
        setQuery("");
      } else {
        restoreExplorer(); // CA9
      }
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.field}>
        <Search size={15} aria-hidden className={styles.fieldIcon} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar en el vault…"
          className={styles.input}
          aria-label="Buscar en el vault"
        />
        {query.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={14} aria-hidden />
          </button>
        )}
        {/* Dónde busca y cómo se presenta (`FUN-M-20`), dentro del propio campo:
            se cambian mientras se busca, mirando lo que devolvió la búsqueda
            anterior, así que van donde está la vista y no en Configuración. */}
        <button
          type="button"
          className={styles.opcion}
          title={`${CAMPOS[campo].etiqueta} · clic para cambiar`}
          aria-label={`Buscar en: ${CAMPOS[campo].etiqueta}. Cambiar.`}
          onClick={() => setPref("busquedaCampo", siguienteCampo(campo))}
        >
          {(() => {
            const Icono = CAMPOS[campo].icono;
            return <Icono size={14} aria-hidden />;
          })()}
        </button>
        <button
          type="button"
          className={styles.opcion}
          aria-pressed={arbol}
          title={arbol ? "Ver como lista, por relevancia" : "Agrupar por carpeta"}
          aria-label={arbol ? "Ver como lista" : "Agrupar por carpeta"}
          onClick={() => setPref("busquedaArbol", !arbol)}
        >
          {arbol ? <List size={14} aria-hidden /> : <FolderTree size={14} aria-hidden />}
        </button>
      </div>

      <label className={styles.exactToggle} title="Si está activo, solo busca la palabra completa; si no, busca por coincidencia (p. ej. «perr» encuentra «perro»).">
        <input
          type="checkbox"
          checked={exacto}
          onChange={(e) => setPref("busquedaExacta", e.target.checked)}
        />
        Búsqueda exacta
      </label>

      <p className={styles.hint}>
        AND implícito · <code>&quot;frase exacta&quot;</code> ·{" "}
        <code>#etiqueta</code> · <code>clave:valor</code>
      </p>

      {query.trim().length > 0 && query.trim().length < MINIMO_CARACTERES && (
        <p className={styles.status}>
          Escribe al menos {MINIMO_CARACTERES} caracteres para buscar.
        </p>
      )}

      {loading && resultados.length === 0 && (
        <p className={styles.status}>Buscando…</p>
      )}

      {buscado && !loading && resultados.length === 0 && (
        <p className={styles.status}>
          Sin resultados para «{query.trim()}».
          <br />
          Prueba con otros términos o una frase entre comillas.
        </p>
      )}

      {/* `display: contents`: solo escucha las teclas, no cambia el layout. */}
      {/* `data-lista`: teclear el comienzo de un resultado salta a él (`tecleoDom.ts`). */}
      <div ref={resultadosRef} style={{ display: "contents" }} onKeyDown={alTeclaEnResultados} data-lista="button">
      {arbol ? (
        <div className={styles.results}>
          <Rama
            nodo={agruparEnArbol(resultados, carpetas)}
            raiz
            tipos={tipos}
            onAbrir={openResult}
            acciones={accionesFila}
          />
        </div>
      ) : (
        <ul className={styles.results}>
          {resultados.map((r) => (
            <li key={r.nota_id}>
              <Fila
                resultado={r}
                tipo={tipos.get(r.nota_id)}
                // En lista, cada fila dice dónde está: es lo único que ubica el
                // resultado. En árbol lo dice la carpeta que lo contiene, y
                // repetirlo en cada hoja sería la misma ruta cien veces.
                ruta={folderPath(r.carpeta_id, carpetas)}
                onAbrir={openResult}
                acciones={accionesFila}
              />
            </li>
          ))}
        </ul>
      )}
      </div>
      {/* El menú contextual, «Mover a…» y el selector de «Importar archivos…». */}
      {archivo.capas}
    </div>
  );
}

/**
 * Un resultado: ícono del tipo, título, dónde está (en lista) y el fragmento con
 * la marca.
 *
 * El ícono sale del mismo mapa que el explorador y las pestañas
 * (`lib/iconosDeTipo`, `FUN-S-11`): una tabla tiene que verse como una tabla
 * también cuando aparece en una búsqueda.
 */
function Fila({
  resultado,
  ruta,
  tipo,
  onAbrir,
  acciones,
}: {
  resultado: Resultado;
  ruta: string;
  tipo: NotaTipo | undefined;
  onAbrir: (notaId: string) => void;
  acciones: AccionesFila;
}) {
  // Una nota que la búsqueda encuentra pero el índice en memoria todavía no
  // tiene: markdown, que es lo que casi siempre resulta ser.
  const Icono = ICONO_POR_TIPO[tipo ?? "markdown"];
  // Renombrar desde el menú (`DEF-185`): el campo ocupa el lugar del título,
  // como en el árbol del explorador. No va dentro del botón: un campo de texto
  // dentro de un <button> no se puede editar.
  if (renombrando(acciones.renaming, "nota", resultado.nota_id)) {
    return (
      <div className={styles.result}>
        <span className={styles.resultHead}>
          <Icono size={13} className={styles.resultIcon} aria-hidden />
          <RenameInput
            renameValue={acciones.renaming?.valor ?? ""}
            onRenameChange={acciones.cambiarRenombre}
            onRenameCommit={acciones.commitRename}
            onRenameCancel={() => acciones.setRenaming(null)}
            pistaAlias={(tipo ?? "markdown") === "markdown" ? resultado.titulo : undefined}
          />
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.result}
      onClick={() => onAbrir(resultado.nota_id)}
      onContextMenu={(e) => acciones.menuNota(e, resultado.nota_id)}
      data-nota-id={resultado.nota_id}
    >
      <span className={styles.resultHead}>
        <Icono size={13} className={styles.resultIcon} aria-hidden />
        <span className={styles.resultTitle}>{resultado.titulo}</span>
      </span>
      {ruta !== "" && <span className={styles.resultPath}>{ruta}</span>}
      {/* Buscando solo por nombre no viene fragmento: la coincidencia es el
          título, que ya está arriba. */}
      {resultado.fragmento !== "" && (
        <span
          className={styles.resultFragment}
          dangerouslySetInnerHTML={{ __html: fragmentToHtml(resultado.fragmento) }}
        />
      )}
    </button>
  );
}

/**
 * Una carpeta del árbol de resultados y lo que cuelga de ella (`FUN-M-20`).
 *
 * Se dibuja **plegable y abierta**: quien busca quiere ver las coincidencias, no
 * la estructura. El árbol agrupa; plegar es para apartar una carpeta que estorba,
 * no para tener que abrirlas una por una.
 *
 * > [!important] La sangría la da el ANIDAMIENTO, no un `padding` calculado
 * > Los hijos van dentro de un contenedor con `border-left`, así que la línea
 * > vertical de cada nivel sale sola y llega **exactamente** hasta donde llega
 * > el contenido de esa carpeta — que es lo que la hace útil. Con un
 * > `paddingLeft: nivel * 12` en cada fila la sangría se ve igual, pero no hay
 * > ningún elemento que abarque la rama y no habría dónde colgar la línea.
 *
 * La raíz no se dibuja a sí misma —no es una carpeta, es el vault— pero sí sus
 * resultados sueltos y sus hijas, y sin línea: no hay nada de lo que separarlos.
 */
function Rama({
  nodo,
  raiz = false,
  tipos,
  onAbrir,
  acciones,
}: {
  nodo: NodoResultados<Resultado>;
  raiz?: boolean;
  tipos: Map<string, NotaTipo>;
  onAbrir: (notaId: string) => void;
  acciones: AccionesFila;
}) {
  const [abierta, setAbierta] = useState(true);

  const contenido = (
    <>
      {nodo.resultados.map((r) => (
        <Fila
          key={r.nota_id}
          resultado={r}
          ruta=""
          tipo={tipos.get(r.nota_id)}
          onAbrir={onAbrir}
          acciones={acciones}
        />
      ))}
      {nodo.hijos.map((h) => (
        <Rama key={h.id} nodo={h} tipos={tipos} onAbrir={onAbrir} acciones={acciones} />
      ))}
    </>
  );

  if (raiz) return contenido;

  const flecha = abierta ? (
    <ChevronDown size={13} className={styles.carpetaFlecha} aria-hidden />
  ) : (
    <ChevronRight size={13} className={styles.carpetaFlecha} aria-hidden />
  );

  return (
    <div>
      {renombrando(acciones.renaming, "carpeta", nodo.id) ? (
        // Renombrar la carpeta (`DEF-185`), en el lugar de su nombre.
        <div className={styles.carpeta}>
          {flecha}
          <Folder size={13} className={styles.carpetaIcono} aria-hidden />
          <RenameInput
            renameValue={acciones.renaming?.valor ?? ""}
            onRenameChange={acciones.cambiarRenombre}
            onRenameCommit={acciones.commitRename}
            onRenameCancel={() => acciones.setRenaming(null)}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.carpeta}
          aria-expanded={abierta}
          onClick={() => setAbierta((v) => !v)}
          onContextMenu={(e) => nodo.id !== null && acciones.menuCarpeta(e, nodo.id)}
          data-carpeta-id={nodo.id ?? undefined}
        >
          {flecha}
          <Folder size={13} className={styles.carpetaIcono} aria-hidden />
          <span className={styles.carpetaNombre}>{nodo.nombre}</span>
          <span className={styles.carpetaCuenta}>{nodo.total}</span>
        </button>
      )}
      {abierta && <div className={styles.rama}>{contenido}</div>}
    </div>
  );
}
