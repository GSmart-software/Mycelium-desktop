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
import {
  agruparEnArbol,
  firstSearchTerm,
  fragmentToHtml,
  folderPath,
  type NodoResultados,
} from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore, type NotaTipo } from "@/stores/vaultStore";
import styles from "./SearchPanel.module.css";

type Resultado = {
  nota_id: string;
  titulo: string;
  carpeta_id: string | null;
  fragmento: string;
};

const DEBOUNCE_MS = 200;

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
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
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

  // Foco automático al activar la búsqueda (CA2)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Búsqueda con debounce (CA3, CA6, CA7)
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResultados([]);
      setBuscado(false);
      return;
    }
    const handle = setTimeout(async () => {
      if (!vaultId) return;
      setLoading(true);
      try {
        const data = await api<{ resultados: Resultado[] }>(
          `/vaults/${vaultId}/buscar?q=${encodeURIComponent(term)}&exacto=${exacto}&campo=${campo}`,
          { token: useAuthStore.getState().accessToken },
        );
        setResultados(data.resultados);
      } catch {
        setResultados([]);
      } finally {
        setLoading(false);
        setBuscado(true);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, vaultId, exacto, campo]);

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
        <code>tag:nombre</code> · <code>clave:valor</code>
      </p>

      {loading && resultados.length === 0 && (
        <p className={styles.status}>Buscando…</p>
      )}

      {buscado && !loading && resultados.length === 0 && (
        <p className={styles.status}>
          Sin resultados para «{query.trim()}».
          <br />
          Probá con otros términos o una frase entre comillas.
        </p>
      )}

      {arbol ? (
        <div className={styles.results}>
          <Rama
            nodo={agruparEnArbol(resultados, carpetas)}
            raiz
            tipos={tipos}
            onAbrir={openResult}
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
              />
            </li>
          ))}
        </ul>
      )}
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
}: {
  resultado: Resultado;
  ruta: string;
  tipo: NotaTipo | undefined;
  onAbrir: (notaId: string) => void;
}) {
  // Una nota que la búsqueda encuentra pero el índice en memoria todavía no
  // tiene: markdown, que es lo que casi siempre resulta ser.
  const Icono = ICONO_POR_TIPO[tipo ?? "markdown"];
  return (
    <button
      type="button"
      className={styles.result}
      onClick={() => onAbrir(resultado.nota_id)}
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
}: {
  nodo: NodoResultados<Resultado>;
  raiz?: boolean;
  tipos: Map<string, NotaTipo>;
  onAbrir: (notaId: string) => void;
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
        />
      ))}
      {nodo.hijos.map((h) => (
        <Rama key={h.id} nodo={h} tipos={tipos} onAbrir={onAbrir} />
      ))}
    </>
  );

  if (raiz) return contenido;

  return (
    <div>
      <button
        type="button"
        className={styles.carpeta}
        aria-expanded={abierta}
        onClick={() => setAbierta((v) => !v)}
      >
        {abierta ? (
          <ChevronDown size={13} className={styles.carpetaFlecha} aria-hidden />
        ) : (
          <ChevronRight size={13} className={styles.carpetaFlecha} aria-hidden />
        )}
        <Folder size={13} className={styles.carpetaIcono} aria-hidden />
        <span className={styles.carpetaNombre}>{nodo.nombre}</span>
        <span className={styles.carpetaCuenta}>{nodo.total}</span>
      </button>
      {abierta && <div className={styles.rama}>{contenido}</div>}
    </div>
  );
}
