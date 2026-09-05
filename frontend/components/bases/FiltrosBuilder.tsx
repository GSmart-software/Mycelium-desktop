"use client";

import { Plus, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  OPERADORES_UI,
  OPS_DE_ARCHIVO,
  condicionAplicable,
  type Condicion,
  type NodoFiltro,
} from "@/lib/bases";
import styles from "./BaseView.module.css";

/**
 * El constructor de filtros de un archivo tabla (`FUN-M-27` · `FUN-S-16`).
 *
 * Es recursivo porque el filtro lo es: un grupo tiene condiciones y otros
 * grupos. El motor ya sabía combinar —`Filtro` tiene `and`, `or` y `not` desde
 * siempre—; lo que faltaba era poder expresarlo, y para eso la interfaz tiene
 * que poder anidarse igual que el dato.
 *
 * > [!important] Lo incompleto se conserva en pantalla (`DEF-080`)
 * > Una condición sin valor no se escribe en el archivo —no filtra— pero **no se
 * > borra**: se la sigue viendo mientras se la termina de armar, marcada con un
 * > borde punteado. Los dos lados usan la misma regla, `condicionAplicable`.
 * >
 * > La marca **no** es una atenuación: apagar la fila apagaría también el campo
 * > que se está tecleando, que es lo último que conviene volver ilegible.
 */

/** Cuántos campos se listan a la vez en el buscador (`FUN-S-16`). */
const MAX_CAMPOS = 60;

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * Elige por qué campo filtra una condición, con buscador (`FUN-S-16`).
 *
 * Un `<select>` alcanzaba con cinco propiedades y deja de alcanzar con
 * cincuenta: hay que recorrer la lista con la vista. Acá se escribe y la lista
 * se acorta.
 *
 * Se dibuja a mano y no con un `<select>` por lo de siempre: su lista la pinta
 * el navegador fuera del documento y no admite un campo de texto adentro. Es el
 * mismo caso —y el mismo patrón— que `SugerenciasClave` de la pestaña
 * PROPIEDADES (`DEF-077`).
 */
function SelectorCampo({
  valor,
  campos,
  onElegir,
  deshabilitado,
}: {
  valor: string;
  campos: { ref: string; grupo: string }[];
  onElegir: (ref: string) => void;
  deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [activa, setActiva] = useState(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, ancho: 0 });

  const visibles = useMemo(() => {
    const q = norm(consulta.trim());
    const lista = q === "" ? campos : campos.filter((c) => norm(c.ref).includes(q));
    return lista.slice(0, MAX_CAMPOS);
  }, [campos, consulta]);

  const abrir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    // `position: fixed` calculado, como el resto de los menús: el panel de
    // filtros tiene scroll y una lista absoluta la recortaría su contenedor.
    if (r) setPos({ top: r.bottom + 2, left: r.left, ancho: Math.max(r.width, 220) });
    setConsulta("");
    setActiva(-1);
    setAbierto(true);
  };

  const elegir = (ref: string) => {
    onElegir(ref);
    setAbierto(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={styles.select}
        disabled={deshabilitado}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
      >
        {valor || "elegir campo"}
      </button>
      {/* En un PORTAL, no dentro de la fila. Un `position: fixed` sale del flujo
          pero NO de la composición: la opacidad, un `transform` o un `filter` en
          cualquier ancestro se le aplican igual, y el panel de filtros tiene
          scroll y overflow. Colgado del `body` no depende de nada de eso. Es el
          mismo motivo por el que `GraphOptionsMenu` usa portal (`DEF-053`). */}
      {abierto &&
        createPortal(
        <div
          className={styles.buscadorCampo}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.ancho }}
        >
          <div className={styles.buscadorFila}>
            <Search size={13} aria-hidden />
            <input
              autoFocus
              className={styles.buscadorInput}
              value={consulta}
              placeholder="Buscar campo…"
              aria-label="Buscar campo"
              onChange={(e) => {
                setConsulta(e.target.value);
                setActiva(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && visibles.length > 0) {
                  e.preventDefault();
                  setActiva((i) => (i + 1) % visibles.length);
                } else if (e.key === "ArrowUp" && visibles.length > 0) {
                  e.preventDefault();
                  setActiva((i) => (i <= 0 ? visibles.length - 1 : i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const c = visibles[activa] ?? visibles[0];
                  if (c) elegir(c.ref);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAbierto(false);
                }
              }}
              // Cerrar al salir del campo: el clic en una opción se atiende en
              // `mousedown`, así que llega antes que este `blur`.
              onBlur={() => setAbierto(false)}
            />
          </div>
          <ul role="listbox" className={styles.buscadorLista}>
            {visibles.length === 0 && (
              <li className={styles.buscadorVacio}>Ningún campo coincide</li>
            )}
            {visibles.map((c, i) => (
              <li key={c.ref} role="option" aria-selected={c.ref === valor}>
                <button
                  type="button"
                  className={`${styles.buscadorOpcion} ${
                    i === activa ? styles.buscadorOpcionActiva : ""
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(c.ref);
                  }}
                >
                  {c.ref}
                </button>
              </li>
            ))}
          </ul>
        </div>,
          document.body,
        )}
    </>
  );
}

/** Una condición: campo, operador, valor, y el interruptor de negación. */
function FilaCondicion({
  nodo,
  campos,
  onCambio,
  onQuitar,
}: {
  nodo: Extract<NodoFiltro, { tipo: "cond" }>;
  campos: { ref: string; grupo: string }[];
  onCambio: (siguiente: NodoFiltro) => void;
  onQuitar: () => void;
}) {
  const c = nodo.cond;
  const meta = OPERADORES_UI.find((o) => o.op === c.op);
  const deArchivo = OPS_DE_ARCHIVO.has(c.op);
  const conCond = (parcial: Partial<Condicion>): NodoFiltro => ({
    ...nodo,
    cond: { ...c, ...parcial },
  });

  return (
    <div className={`${styles.condicion} ${condicionAplicable(c) ? "" : styles.condicionAMedias}`}>
      <button
        type="button"
        className={nodo.negado ? `${styles.negar} ${styles.negarActivo}` : styles.negar}
        aria-pressed={nodo.negado}
        title={nodo.negado ? "Se cumple cuando NO pasa esto" : "Negar esta condición"}
        onClick={() => onCambio({ ...nodo, negado: !nodo.negado })}
      >
        no
      </button>
      <SelectorCampo
        valor={deArchivo ? "el archivo" : c.ref}
        campos={campos}
        deshabilitado={deArchivo}
        onElegir={(ref) => onCambio(conCond({ ref }))}
      />
      <select
        className={styles.select}
        value={c.op}
        aria-label="Operador de la condición"
        onChange={(e) => {
          const op = e.target.value;
          onCambio(conCond({ op, ref: OPS_DE_ARCHIVO.has(op) ? "file" : c.ref }));
        }}
      >
        {OPERADORES_UI.map((o) => (
          <option key={o.op} value={o.op}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {meta?.sinValor !== true && (
        <input
          className={styles.input}
          value={c.valor}
          placeholder="valor"
          aria-label="Valor de la condición"
          onChange={(e) => onCambio(conCond({ valor: e.target.value }))}
        />
      )}
      <button
        type="button"
        className={styles.quitar}
        aria-label="Quitar esta condición"
        title="Quitar"
        onClick={onQuitar}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Un grupo: su combinador, su negación y sus hijos —condiciones u otros grupos—.
 *
 * `raiz` distingue al de más afuera, que no se puede quitar ni negar como una
 * fila cualquiera: es el filtro entero.
 */
export function GrupoFiltro({
  nodo,
  campos,
  raiz = false,
  onCambio,
  onQuitar,
}: {
  nodo: Extract<NodoFiltro, { tipo: "grupo" }>;
  campos: { ref: string; grupo: string }[];
  raiz?: boolean;
  onCambio: (siguiente: NodoFiltro) => void;
  onQuitar?: () => void;
}) {
  const conHijos = (hijos: NodoFiltro[]) => onCambio({ ...nodo, hijos });
  const reemplazar = (i: number, h: NodoFiltro) =>
    conHijos(nodo.hijos.map((x, j) => (j === i ? h : x)));

  return (
    <div className={raiz ? styles.grupoRaiz : styles.grupo}>
      <div className={styles.grupoCabecera}>
        {!raiz && (
          <button
            type="button"
            className={nodo.negado ? `${styles.negar} ${styles.negarActivo}` : styles.negar}
            aria-pressed={nodo.negado}
            title={nodo.negado ? "Se cumple cuando NO pasa este grupo" : "Negar el grupo"}
            onClick={() => onCambio({ ...nodo, negado: !nodo.negado })}
          >
            no
          </button>
        )}
        <span className={styles.panelTitulo}>{raiz ? "Mostrar las que cumplen" : "Cumplen"}</span>
        <select
          className={styles.selectCorto}
          value={nodo.combinador}
          aria-label="Cómo se combinan las condiciones del grupo"
          onChange={(e) => onCambio({ ...nodo, combinador: e.target.value as "and" | "or" })}
        >
          <option value="and">todas</option>
          <option value="or">alguna</option>
        </select>
        {!raiz && onQuitar && (
          <button
            type="button"
            className={styles.quitar}
            aria-label="Quitar este grupo"
            title="Quitar el grupo"
            onClick={onQuitar}
          >
            <X size={13} aria-hidden />
          </button>
        )}
      </div>

      {nodo.hijos.length === 0 && (
        <p className={styles.panelNota}>
          {raiz ? "Sin filtros: entran todas las notas del vault." : "Grupo vacío: no filtra."}
        </p>
      )}

      {nodo.hijos.map((h, i) =>
        h.tipo === "cond" ? (
          <FilaCondicion
            key={i}
            nodo={h}
            campos={campos}
            onCambio={(sig) => reemplazar(i, sig)}
            onQuitar={() => conHijos(nodo.hijos.filter((_, j) => j !== i))}
          />
        ) : (
          <GrupoFiltro
            key={i}
            nodo={h}
            campos={campos}
            onCambio={(sig) => reemplazar(i, sig)}
            onQuitar={() => conHijos(nodo.hijos.filter((_, j) => j !== i))}
          />
        ),
      )}

      <div className={styles.grupoAcciones}>
        <button
          type="button"
          className={styles.botonSecundario}
          onClick={() =>
            conHijos([
              ...nodo.hijos,
              {
                tipo: "cond",
                negado: false,
                cond: { ref: campos[0]?.ref ?? "file.name", op: "==", valor: "" },
              },
            ])
          }
        >
          <Plus size={12} aria-hidden /> Condición
        </button>
        <button
          type="button"
          className={styles.botonSecundario}
          title="Un grupo se cumple o no como un todo, y se puede negar entero"
          onClick={() =>
            conHijos([...nodo.hijos, { tipo: "grupo", combinador: "or", negado: false, hijos: [] }])
          }
        >
          <Plus size={12} aria-hidden /> Grupo
        </button>
      </div>
    </div>
  );
}
