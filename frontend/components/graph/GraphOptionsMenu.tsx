"use client";

import { GripVertical, Plus, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePreferencesStore } from "@/stores/preferencesStore";
import {
  usePrefVault,
  usePrefsVaultStore,
  type ModoNombresGrafo,
} from "@/stores/prefsVaultStore";
import styles from "./GraphOptionsMenu.module.css";

/**
 * Cuánto nombre se dibuja en el grafo (`FUN-M-21`). Con muchos nodos, todos los
 * nombres a la vez tapan las conexiones, que es lo que el grafo viene a mostrar.
 */
const NOMBRES: { value: ModoNombresGrafo; label: string; ayuda: string }[] = [
  { value: "todos", label: "Todos", ayuda: "El nombre de cada nodo visible" },
  {
    value: "vecinos",
    label: "Vecinos",
    ayuda: "Solo el nodo apuntado y aquellos con los que conecta",
  },
  { value: "apuntado", label: "Apuntado", ayuda: "Solo el nodo bajo el cursor" },
];

const DIRECTIONS: { value: "none" | "animated" | "arrow" | "both"; label: string }[] = [
  { value: "none", label: "Ninguno" },
  { value: "animated", label: "Animado" },
  { value: "arrow", label: "Flecha" },
  { value: "both", label: "Ambos" },
];

/**
 * Menú desplegable de opciones del grafo del vault (overlay arriba a la derecha).
 * Pensado para crecer con más opciones; por ahora: indicador de dirección de los
 * enlaces e intensidad del brillo de las conexiones al apuntar un nodo.
 */
type RuleType = "path" | "tag" | "name";
type ColorGroup = { id: string; type: RuleType; value: string; color: string; enabled?: boolean };
type ExcludeRule = { id: string; type: RuleType; value: string; enabled?: boolean };

const PLACEHOLDER: Record<RuleType, string> = {
  path: "carpeta o ruta",
  tag: "etiqueta (sin #)",
  name: "texto del nombre",
};
const EXCLUDE_PLACEHOLDER: Record<RuleType, string> = {
  path: "ruta exacta (archivo/carpeta)",
  tag: "etiqueta (sin #)",
  name: "nombre a ocultar",
};

/** Mueve el elemento `from` a la posición `to` (devuelve una lista nueva). */
function mover<T>(lista: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= lista.length) return lista;
  const copia = [...lista];
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
}

/** Qué lista se está reordenando y desde qué posición (drag nativo). */
type Arrastre = { lista: "color" | "exclude"; index: number };

export function GraphOptionsMenu() {
  const edgeDirection = usePreferencesStore((s) => s.prefs.graphEdgeDirection);
  const hoverGlow = usePreferencesStore((s) => s.prefs.graphHoverGlow);
  const colorGroups = usePreferencesStore((s) => s.prefs.graphColorGroups);
  const excludeRules = usePreferencesStore((s) => s.prefs.graphExcludeRules);
  const setPref = usePreferencesStore((s) => s.setPref);
  // Los nombres son preferencia DEL VAULT (`FUN-M-21`): un vault de cien notas y
  // uno de cinco mil no quieren lo mismo, y quien los abre es la misma persona.
  const nombresGrafo = usePrefVault("nombresGrafo");
  const setPrefVault = usePrefsVaultStore((s) => s.set);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Posición fija del panel, ya ajustada para que quepa (`DEF-053`). */
  const [pos, setPos] = useState({ x: 0, y: 0, alto: 0 });
  // Reordenamiento de reglas: el ORDEN define la prioridad (gana la primera que
  // coincide), así que se puede reacomodar arrastrando el asa de cada fila.
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);

  const setGroups = (next: ColorGroup[]) => setPref("graphColorGroups", next);
  const addGroup = () =>
    setGroups([...colorGroups, { id: crypto.randomUUID(), type: "tag", value: "", color: "#7c9cff", enabled: true }]);
  const updateGroup = (id: string, patch: Partial<ColorGroup>) =>
    setGroups(colorGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGroup = (id: string) => setGroups(colorGroups.filter((g) => g.id !== id));

  const setRules = (next: ExcludeRule[]) => setPref("graphExcludeRules", next);
  const addRule = () =>
    setRules([...excludeRules, { id: crypto.randomUUID(), type: "name", value: "", enabled: true }]);
  const updateRule = (id: string, patch: Partial<ExcludeRule>) =>
    setRules(excludeRules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRule = (id: string) => setRules(excludeRules.filter((r) => r.id !== id));

  /** Reubica una regla dentro de su lista (drag del asa o teclado). */
  const reordenar = (lista: Arrastre["lista"], from: number, to: number) => {
    if (lista === "color") setGroups(mover(colorGroups, from, to));
    else setRules(mover(excludeRules, from, to));
  };

  /**
   * Props del asa de arrastre + el contenedor de la fila. El asa es el único
   * elemento `draggable` (si lo fuera la fila entera, no se podría seleccionar
   * texto en sus inputs). Con el foco en el asa, ↑/↓ también reordena (teclado).
   */
  const propsAsa = (lista: Arrastre["lista"], index: number, total: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      setArrastre({ lista, index });
    },
    onDragEnd: () => {
      setArrastre(null);
      setSobre(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      reordenar(lista, index, index + (e.key === "ArrowUp" ? -1 : 1));
    },
    title: `Arrastrá para cambiar la prioridad (${index + 1} de ${total}); con el foco acá, ↑/↓ también la mueve`,
    "aria-label": `Reordenar: posición ${index + 1} de ${total}`,
  });

  /** Props de la fila como zona de destino del reordenamiento. */
  const propsFila = (lista: Arrastre["lista"], index: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (arrastre?.lista !== lista) return; // no mezclar listas distintas
      e.preventDefault();
      setSobre(index);
    },
    onDrop: (e: React.DragEvent) => {
      if (arrastre?.lista !== lista) return;
      e.preventDefault();
      reordenar(lista, arrastre.index, index);
      setArrastre(null);
      setSobre(null);
    },
    className: [
      styles.groupRow,
      arrastre?.lista === lista && arrastre.index === index ? styles.rowDragging : "",
      arrastre?.lista === lista && sobre === index && arrastre.index !== index
        ? styles.rowOver
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  });

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      // El panel vive en un portal, así que NO cuelga de `wrapRef`: hay que
      // preguntarle también a él o pulsar dentro lo cerraría.
      const dentro =
        wrapRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node);
      if (!dentro) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  /**
   * Coloca el panel respecto de la VENTANA, no del pane (`DEF-053`).
   *
   * Antes era `position: absolute` dentro del grafo: con la pestaña pequeña el
   * panel —300 px de ancho y hasta 70vh de alto— se salía por los lados y por
   * abajo, y encima el área de contenido tiene `overflow: hidden`, así que lo
   * que sobresalía quedaba recortado y sin forma de alcanzarlo.
   *
   * Se mide igual que en el menú contextual (`DEF-047`) y se acota a la ventana;
   * el alto disponible también, para que un panel alto en una ventana baja
   * termine desplazándose por dentro en vez de desbordar.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const calcular = () => {
      const boton = wrapRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!boton) return;
      const margen = 8;
      const ancho = menu?.width ?? 300;
      const arriba = boton.top - margen;
      const abajo = window.innerHeight - boton.bottom - margen * 2;
      // Se abre hacia el lado donde haya más sitio.
      const haciaArriba = abajo < 220 && arriba > abajo;
      const alto = Math.max(160, Math.min(haciaArriba ? arriba : abajo, window.innerHeight * 0.7));
      const y = haciaArriba ? Math.max(margen, boton.top - margen - alto) : boton.bottom + margen;
      const x = Math.min(
        Math.max(margen, boton.right - ancho),
        window.innerWidth - ancho - margen,
      );
      setPos({ x, y, alto });
    };
    calcular();
    window.addEventListener("resize", calcular);
    return () => window.removeEventListener("resize", calcular);
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.button}
        title="Opciones del grafo"
        aria-label="Opciones del grafo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} aria-hidden />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            role="menu"
            style={{ left: pos.x, top: pos.y, maxHeight: pos.alto || undefined }}
          >
          <div className={styles.group}>
            <span className={styles.label}>Nombres</span>
            <div className={styles.segmented} role="radiogroup">
              {NOMBRES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={nombresGrafo === m.value}
                  title={m.ayuda}
                  className={
                    nombresGrafo === m.value
                      ? `${styles.segment} ${styles.segmentActive}`
                      : styles.segment
                  }
                  onClick={() => setPrefVault("nombresGrafo", m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.label}>Indicador de dirección</span>
            <div className={styles.segmented} role="radiogroup">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  role="radio"
                  aria-checked={edgeDirection === d.value}
                  className={
                    edgeDirection === d.value
                      ? `${styles.segment} ${styles.segmentActive}`
                      : styles.segment
                  }
                  onClick={() => setPref("graphEdgeDirection", d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.label}>
              Brillo de conexiones al apuntar
              <span className={styles.value}>{Math.round(hoverGlow * 100)}%</span>
            </span>
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={hoverGlow}
              onChange={(e) => setPref("graphHoverGlow", Number(e.target.value))}
              aria-label="Intensidad del brillo de las conexiones al apuntar un nodo"
            />
          </div>

          <div className={styles.group}>
            <span className={styles.label}>
              Colores de nodos
              <button
                type="button"
                className={styles.addBtn}
                onClick={addGroup}
                title="Agregar grupo de color"
                aria-label="Agregar grupo de color"
              >
                <Plus size={14} aria-hidden />
              </button>
            </span>
            {colorGroups.length === 0 && (
              <span className={styles.hint}>
                Colorea nodos por ruta, etiqueta o nombre. Los que cumplen la regla
                comparten color.
              </span>
            )}
            {colorGroups.length > 1 && (
              <span className={styles.hint}>
                Gana la primera regla que coincide: arrastrá <GripVertical size={11} aria-hidden />
                {" "}para cambiar la prioridad.
              </span>
            )}
            {colorGroups.map((g, i) => (
              <div key={g.id} {...propsFila("color", i)}>
                <span className={styles.handle} {...propsAsa("color", i, colorGroups.length)} tabIndex={0} role="button">
                  <GripVertical size={13} aria-hidden />
                </span>
                <label className={styles.switch} title={g.enabled === false ? "Regla desactivada" : "Regla activada"}>
                  <input
                    type="checkbox"
                    checked={g.enabled !== false}
                    onChange={(e) => updateGroup(g.id, { enabled: e.target.checked })}
                    aria-label="Activar o desactivar la regla"
                  />
                  <span className={styles.switchTrack} aria-hidden />
                </label>
                <select
                  className={styles.select}
                  value={g.type}
                  onChange={(e) => updateGroup(g.id, { type: e.target.value as ColorGroup["type"] })}
                  aria-label="Tipo de regla"
                >
                  <option value="path">Ruta</option>
                  <option value="tag">Etiqueta</option>
                  <option value="name">Nombre</option>
                </select>
                <input
                  className={styles.groupValue}
                  value={g.value}
                  placeholder={PLACEHOLDER[g.type]}
                  onChange={(e) => updateGroup(g.id, { value: e.target.value })}
                  aria-label="Valor de la regla"
                />
                <input
                  className={styles.colorInput}
                  type="color"
                  value={g.color}
                  onChange={(e) => updateGroup(g.id, { color: e.target.value })}
                  aria-label="Color del grupo"
                />
                <button
                  type="button"
                  className={styles.delBtn}
                  onClick={() => removeGroup(g.id)}
                  title="Quitar grupo"
                  aria-label="Quitar grupo"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.group}>
            <span className={styles.label}>
              Ocultar del grafo
              <button
                type="button"
                className={styles.addBtn}
                onClick={addRule}
                title="Agregar regla de exclusión"
                aria-label="Agregar regla de exclusión"
              >
                <Plus size={14} aria-hidden />
              </button>
            </span>
            {excludeRules.length === 0 && (
              <span className={styles.hint}>
                Oculta nodos por nombre (todas las coincidencias), ruta exacta de
                archivo/carpeta, o etiqueta.
              </span>
            )}
            {excludeRules.length > 1 && (
              <span className={styles.hint}>
                Se evalúan en orden: arrastrá <GripVertical size={11} aria-hidden /> para
                cambiar la prioridad.
              </span>
            )}
            {excludeRules.map((r, i) => (
              <div key={r.id} {...propsFila("exclude", i)}>
                <span className={styles.handle} {...propsAsa("exclude", i, excludeRules.length)} tabIndex={0} role="button">
                  <GripVertical size={13} aria-hidden />
                </span>
                <label className={styles.switch} title={r.enabled === false ? "Regla desactivada" : "Regla activada"}>
                  <input
                    type="checkbox"
                    checked={r.enabled !== false}
                    onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
                    aria-label="Activar o desactivar la regla"
                  />
                  <span className={styles.switchTrack} aria-hidden />
                </label>
                <select
                  className={styles.select}
                  value={r.type}
                  onChange={(e) => updateRule(r.id, { type: e.target.value as RuleType })}
                  aria-label="Tipo de exclusión"
                >
                  <option value="name">Nombre</option>
                  <option value="path">Ruta</option>
                  <option value="tag">Etiqueta</option>
                </select>
                <input
                  className={styles.groupValue}
                  value={r.value}
                  placeholder={EXCLUDE_PLACEHOLDER[r.type]}
                  onChange={(e) => updateRule(r.id, { value: e.target.value })}
                  aria-label="Valor de la exclusión"
                />
                <button
                  type="button"
                  className={styles.delBtn}
                  onClick={() => removeRule(r.id)}
                  title="Quitar regla"
                  aria-label="Quitar regla"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
