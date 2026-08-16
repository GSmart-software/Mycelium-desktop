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
export function PropiedadesTab({ notaId, paneId }: { notaId: string; paneId: string }) {
  const vaultId = useVaultStore((s) => s.vaultId);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claves, setClaves] = useState<string[]>([]);
  const [nuevaClave, setNuevaClave] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState<TipoPropiedad>("texto");

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

  const añadir = () => {
    const clave = nuevaClave.trim();
    if (clave === "") return;
    cambiar(clave, valorInicialDe(nuevoTipo), nuevoTipo);
    setNuevaClave("");
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
            className={styles.propInput}
            list="mic-claves-vault"
            value={nuevaClave}
            placeholder="Nueva propiedad"
            aria-label="Nombre de la propiedad nueva"
            onChange={(e) => setNuevaClave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                añadir();
              }
            }}
          />
          <datalist id="mic-claves-vault">
            {claves.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
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
  const serializado = `${p.clave} ${p.tipo} ${JSON.stringify(p.valor)}`;
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
        <span className={styles.propIcono} title={p.tipo} aria-hidden>
          {ICONO[p.tipo]}
        </span>
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
