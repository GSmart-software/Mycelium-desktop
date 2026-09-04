"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ICONO_TIPO } from "@/lib/markdown";
import { aplicarTextoMinimo } from "@/lib/editor/commands";
import { subscribeDoc } from "@/lib/editor/docBroker";
import { getView } from "@/lib/editor/viewRegistry";
import {
  NOMBRE_TIPO,
  TIPOS_PROPIEDAD,
  convertirValor,
  ponerPropiedad,
  quitarPropiedad,
  renombrarPropiedad,
  separarFrontmatter,
  valorComoTexto,
  valorInicialDe,
  type Propiedad,
  type TipoPropiedad,
  type ValorPropiedad,
} from "@/lib/frontmatter";
import { useAuthStore } from "@/stores/authStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./NotePanel.module.css";

/**
 * Glifo de cada tipo. Es el MISMO que usa la tarjeta de propiedades (vista de
 * lectura y widget del editor), así que sale de `lib/markdown.ts`.
 */
const ICONO = ICONO_TIPO;

/**
 * Pestaña PROPIEDADES del panel de la nota (`FUN-M-04`): lista las propiedades
 * del frontmatter con su tipo y permite añadirlas, editarlas, renombrarlas y
 * quitarlas.
 *
 * > El panel NO escribe el archivo: despacha una transacción sobre el CodeMirror
 * > de ESTA nota (ver `aplicarTextoMinimo`). Si llamara a `putContenido`, el
 * > autoguardado del editor pisaría el cambio y `Ctrl+Z` no podría deshacerlo.
 *
 * Tampoco lleva estado propio del frontmatter: las propiedades se derivan del
 * texto actual del editor, así que editar el YAML a mano actualiza el panel.
 */
/** Tope de sugerencias visibles: la lista es una ayuda, no un catálogo. */
const MAX_SUGERENCIAS = 8;

/** Para comparar claves sin que estorben las mayúsculas ni los acentos. */
function normalizarClave(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Lista de claves sugeridas al escribir una propiedad nueva (`DEF-067`).
 *
 * Antes esto era un `<datalist>`, y su desplegable **lo dibuja el navegador
 * fuera del documento**: ningún CSS lo alcanza, así que aparecía con la pinta
 * del sistema en medio de un panel con los estilos de Mycelium. Es la misma
 * familia de problema que la lista de un `<select>` —ver
 * `docs/DESIGN_SYSTEM.md` § Controles nativos— pero un escalón peor: al
 * `<select>` se le puede estilar el `option`, y al `<datalist>` no se le puede
 * estilar nada. La única salida es dibujar la lista uno mismo.
 *
 * Va en `position: fixed` calculado desde el input, como el menú de la tabla y
 * el de exportación: el panel lateral tiene scroll y overflow, y una lista
 * absoluta quedaría recortada por su contenedor.
 */
function SugerenciasClave({
  ancla,
  claves,
  activa,
  onElegir,
}: {
  ancla: React.RefObject<HTMLInputElement | null>;
  claves: string[];
  activa: number;
  onElegir: (clave: string) => void;
}) {
  const r = ancla.current?.getBoundingClientRect();
  if (!r) return null;
  return (
    <ul
      id="mic-claves-sugerencias"
      role="listbox"
      className={styles.sugerencias}
      style={{ position: "fixed", top: r.bottom + 2, left: r.left, width: r.width }}
    >
      {claves.map((c, i) => (
        <li key={c} role="option" aria-selected={i === activa}>
          <button
            type="button"
            className={`${styles.sugerencia} ${i === activa ? styles.sugerenciaActiva : ""}`}
            // En `mousedown` y no en `click`: el `blur` del input cierra la
            // lista, y para cuando llegaría el clic el botón ya no existe.
            onMouseDown={(e) => {
              e.preventDefault();
              onElegir(c);
            }}
          >
            {c}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PropiedadesTab({ notaId, paneId }: { notaId: string; paneId: string }) {
  const vaultId = useVaultStore((s) => s.vaultId);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claves, setClaves] = useState<string[]>([]);
  const [nuevaClave, setNuevaClave] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState<TipoPropiedad>("texto");
  // Sugerencias de clave (`DEF-067`). Ver `SugerenciasClave` más abajo.
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [sugerenciaActiva, setSugerenciaActiva] = useState(-1);
  const nuevaClaveRef = useRef<HTMLInputElement>(null);

  // Texto del editor: lectura inicial (la vista puede tardar en existir, el
  // contenido se carga en asíncrono) + espejo de los cambios vía docBroker.
  useEffect(() => {
    let vivo = true;
    let raf = 0;
    let intentos = 0;
    const leer = () => {
      if (!vivo) return;
      const view = getView(paneId);
      if (view) {
        setTexto(view.state.doc.toString());
        return;
      }
      if (intentos++ < 90) raf = requestAnimationFrame(leer);
    };
    leer();
    const soltar = subscribeDoc(notaId, `propiedades:${paneId}`, setTexto);
    return () => {
      vivo = false;
      if (raf) cancelAnimationFrame(raf);
      soltar();
    };
  }, [notaId, paneId]);

  // Claves ya usadas en el vault: es lo que evita que el mismo atributo termine
  // como `estado`, `Estado` y `status`.
  useEffect(() => {
    if (!vaultId) return;
    let cancelado = false;
    void api<{ claves: string[] }>(`/vaults/${vaultId}/propiedades/claves`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((r) => {
        if (!cancelado) setClaves(r.claves);
      })
      .catch(() => {
        if (!cancelado) setClaves([]);
      });
    return () => {
      cancelado = true;
    };
    // Solo al montar/cambiar de nota: el índice se actualiza al guardar, y
    // consultarlo en cada tecleo sería una query por pulsación.
  }, [vaultId, notaId]);

  const fm = useMemo(() => separarFrontmatter(texto), [texto]);

  /** Aplica una transformación del texto como UNA transacción del editor. */
  const aplicar = useCallback(
    (transformar: (t: string) => string) => {
      const view = getView(paneId);
      if (!view) return;
      try {
        const nuevo = transformar(view.state.doc.toString());
        aplicarTextoMinimo(view, nuevo);
        setTexto(view.state.doc.toString());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo editar la propiedad.");
      }
    },
    [paneId],
  );

  const cambiar = useCallback(
    (clave: string, valor: ValorPropiedad, tipo: TipoPropiedad) =>
      aplicar((t) => ponerPropiedad(t, clave, valor, tipo)),
    [aplicar],
  );

  const cerrarSugerencias = () => {
    setSugerenciasAbiertas(false);
    setSugerenciaActiva(-1);
  };

  const añadir = () => {
    const clave = nuevaClave.trim();
    if (clave === "") return;
    cambiar(clave, valorInicialDe(nuevoTipo), nuevoTipo);
    setNuevaClave("");
    cerrarSugerencias();
  };

  // Las claves del vault que casan con lo tecleado. Coincidencia por
  // CONTENIDO y no por prefijo, que es lo que hacía el `<datalist>`: se
  // conserva el comportamiento aunque cambie quién dibuja la lista.
  const sugerencias = useMemo(() => {
    const q = normalizarClave(nuevaClave.trim());
    const lista = q === "" ? claves : claves.filter((c) => normalizarClave(c).includes(q));
    return lista.slice(0, MAX_SUGERENCIAS);
  }, [claves, nuevaClave]);

  const elegirSugerencia = (clave: string) => {
    setNuevaClave(clave);
    cerrarSugerencias();
    nuevaClaveRef.current?.focus();
  };

  const teclaEnClave = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && sugerencias.length > 0) {
      e.preventDefault();
      setSugerenciasAbiertas(true);
      setSugerenciaActiva((i) => (i + 1) % sugerencias.length);
      return;
    }
    if (e.key === "ArrowUp" && sugerencias.length > 0) {
      e.preventDefault();
      setSugerenciasAbiertas(true);
      setSugerenciaActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape" && sugerenciasAbiertas) {
      e.preventDefault();
      cerrarSugerencias();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Con una sugerencia marcada, Enter la ELIGE; sin ninguna, añade. Es lo
      // que hacía el `<datalist>`, y evita añadir de más al aceptar una.
      const elegida = sugerenciasAbiertas ? sugerencias[sugerenciaActiva] : undefined;
      if (elegida !== undefined) elegirSugerencia(elegida);
      else añadir();
    }
  };

  const props = fm.hay && fm.soportado ? fm.props : [];
  const soloLectura = fm.hay && !fm.soportado;

  return (
    <div className={styles.props}>
      {soloLectura && (
        <div className={styles.propsAviso}>
          <p>
            Mycelium no interpreta este frontmatter: {fm.motivo}. Se muestra tal cual y no se
            edita desde acá, para no reformatear tus metadatos.
          </p>
          <pre className={styles.propsCrudo}>{fm.crudo}</pre>
        </div>
      )}

      {error && <p className={styles.propsError}>{error}</p>}

      {!soloLectura && props.length === 0 && (
        <p className={styles.empty}>Esta nota todavía no tiene propiedades.</p>
      )}

      {!soloLectura &&
        props.map((p) => (
          <FilaPropiedad
            key={p.clave}
            p={p}
            onCambiar={cambiar}
            onRenombrar={(clave, nueva) => aplicar((t) => renombrarPropiedad(t, clave, nueva))}
            onQuitar={(clave) => aplicar((t) => quitarPropiedad(t, clave))}
          />
        ))}

      {!soloLectura && (
        <div className={styles.propAdd}>
          <input
            ref={nuevaClaveRef}
            className={styles.propInput}
            value={nuevaClave}
            placeholder="Nueva propiedad"
            aria-label="Nombre de la propiedad nueva"
            role="combobox"
            aria-expanded={sugerenciasAbiertas && sugerencias.length > 0}
            aria-autocomplete="list"
            aria-controls="mic-claves-sugerencias"
            autoComplete="off"
            onChange={(e) => {
              setNuevaClave(e.target.value);
              setSugerenciasAbiertas(true);
              setSugerenciaActiva(-1);
            }}
            onFocus={() => setSugerenciasAbiertas(true)}
            onBlur={cerrarSugerencias}
            onKeyDown={teclaEnClave}
          />
          {sugerenciasAbiertas && sugerencias.length > 0 && (
            <SugerenciasClave
              ancla={nuevaClaveRef}
              claves={sugerencias}
              activa={sugerenciaActiva}
              onElegir={elegirSugerencia}
            />
          )}
          <select
            className={styles.propTipo}
            value={nuevoTipo}
            aria-label="Tipo de la propiedad nueva"
            onChange={(e) => setNuevoTipo(e.target.value as TipoPropiedad)}
          >
            {TIPOS_PROPIEDAD.map((t) => (
              <option key={t} value={t}>
                {ICONO[t]} {NOMBRE_TIPO[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.propBtn}
            title="Añadir propiedad"
            aria-label="Añadir propiedad"
            onClick={añadir}
          >
            <Plus size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Una fila del panel. El borrador se mantiene en local y se confirma al salir
 * del campo (o con Enter): así cada tecleo no genera una transacción —y por
 * tanto un paso de deshacer— en el editor.
 */
function FilaPropiedad({
  p,
  onCambiar,
  onRenombrar,
  onQuitar,
}: {
  p: Propiedad;
  onCambiar: (clave: string, valor: ValorPropiedad, tipo: TipoPropiedad) => void;
  onRenombrar: (clave: string, nueva: string) => void;
  onQuitar: (clave: string) => void;
}) {
  const serializado = `${p.clave}\u0000${p.tipo}\u0000${JSON.stringify(p.valor)}`;
  const [clave, setClave] = useState(p.clave);
  const [borrador, setBorrador] = useState(() => valorComoTexto(p));
  const [nuevoItem, setNuevoItem] = useState("");
  const itemRef = useRef<HTMLInputElement>(null);

  // Cuando la propiedad cambia en el documento, el borrador se resetea DURANTE el
  // render y no en un efecto: así no hay un pintado intermedio con el valor viejo,
  // y —a diferencia de una `key`— el campo no se remonta ni pierde el foco.
  const [vistoDe, setVistoDe] = useState(serializado);
  if (vistoDe !== serializado) {
    setVistoDe(serializado);
    setClave(p.clave);
    setBorrador(valorComoTexto(p));
  }

  const lista = Array.isArray(p.valor) ? p.valor : [];

  const confirmarValor = () => {
    if (borrador === valorComoTexto(p)) return;
    if (borrador === "") {
      onCambiar(p.clave, "", "texto");
      return;
    }
    if (p.tipo === "numero") {
      const n = Number(borrador);
      onCambiar(p.clave, Number.isFinite(n) ? n : borrador, Number.isFinite(n) ? "numero" : "texto");
      return;
    }
    onCambiar(p.clave, borrador, p.tipo);
  };

  const añadirItem = () => {
    const item = nuevoItem.trim();
    if (item === "") return;
    onCambiar(p.clave, [...lista, item], "lista");
    setNuevoItem("");
    itemRef.current?.focus();
  };

  return (
    <div className={styles.prop}>
      <div className={styles.propCabecera}>
        {/* El tipo se CAMBIA acá (`DEF-070`). Era un ícono decorativo, y para
            pasar de texto a fecha había que borrar la propiedad y rehacerla,
            perdiendo el valor. El `<select>` va con la pinta del ícono —sin
            flecha ni caja— para que la fila se lea igual que antes. */}
        <select
          className={styles.propIcono}
          value={p.tipo}
          title={`Tipo de «${p.clave}»: ${NOMBRE_TIPO[p.tipo]}`}
          aria-label={`Tipo de la propiedad ${p.clave}`}
          onChange={(e) => {
            const tipo = e.target.value as TipoPropiedad;
            // El valor se convierte, no se descarta: es el defecto entero.
            if (tipo !== p.tipo) onCambiar(p.clave, convertirValor(p.valor, tipo), tipo);
          }}
        >
          {TIPOS_PROPIEDAD.map((t) => (
            <option key={t} value={t}>
              {ICONO[t]} {NOMBRE_TIPO[t]}
            </option>
          ))}
        </select>
        <input
          className={styles.propClave}
          value={clave}
          aria-label={`Nombre de la propiedad ${p.clave}`}
          onChange={(e) => setClave(e.target.value)}
          onBlur={() => (clave.trim() === p.clave ? setClave(p.clave) : onRenombrar(p.clave, clave))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setClave(p.clave);
          }}
        />
        <button
          type="button"
          className={styles.propBtn}
          title={`Quitar «${p.clave}»`}
          aria-label={`Quitar la propiedad ${p.clave}`}
          onClick={() => onQuitar(p.clave)}
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className={styles.propValor}>
        {p.tipo === "casilla" && (
          <input
            type="checkbox"
            checked={p.valor === true}
            aria-label={String(p.clave)}
            onChange={(e) => onCambiar(p.clave, e.target.checked, "casilla")}
          />
        )}

        {p.tipo === "lista" && (
          <div className={styles.propPills}>
            {lista.map((v, i) => (
              <span key={`${v}-${i}`} className={styles.propPill}>
                {v}
                <button
                  type="button"
                  title={`Quitar «${v}»`}
                  aria-label={`Quitar ${v}`}
                  onClick={() =>
                    onCambiar(p.clave, lista.filter((_, j) => j !== i), "lista")
                  }
                >
                  <X size={11} aria-hidden />
                </button>
              </span>
            ))}
            <input
              ref={itemRef}
              className={styles.propItem}
              value={nuevoItem}
              placeholder="+"
              aria-label={`Añadir un elemento a ${p.clave}`}
              onChange={(e) => setNuevoItem(e.target.value)}
              onBlur={añadirItem}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  añadirItem();
                }
              }}
            />
          </div>
        )}

        {p.tipo !== "casilla" && p.tipo !== "lista" && (
          <input
            className={styles.propInput}
            type={p.tipo === "numero" ? "number" : p.tipo === "fecha" ? "date" : p.tipo === "fechaHora" ? "datetime-local" : "text"}
            value={borrador}
            aria-label={String(p.clave)}
            onChange={(e) => setBorrador(e.target.value)}
            onBlur={confirmarValor}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setBorrador(valorComoTexto(p));
            }}
          />
        )}
      </div>
    </div>
  );
}
