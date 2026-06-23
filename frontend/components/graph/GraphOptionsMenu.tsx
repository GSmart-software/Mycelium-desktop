"use client";

import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./GraphOptionsMenu.module.css";

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
type ColorGroup = { id: string; type: "path" | "tag" | "name"; value: string; color: string };

const PLACEHOLDER: Record<ColorGroup["type"], string> = {
  path: "carpeta o ruta",
  tag: "etiqueta (sin #)",
  name: "texto del nombre",
};

export function GraphOptionsMenu() {
  const edgeDirection = usePreferencesStore((s) => s.prefs.graphEdgeDirection);
  const hoverGlow = usePreferencesStore((s) => s.prefs.graphHoverGlow);
  const colorGroups = usePreferencesStore((s) => s.prefs.graphColorGroups);
  const setPref = usePreferencesStore((s) => s.setPref);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const setGroups = (next: ColorGroup[]) => setPref("graphColorGroups", next);
  const addGroup = () =>
    setGroups([...colorGroups, { id: crypto.randomUUID(), type: "tag", value: "", color: "#7c9cff" }]);
  const updateGroup = (id: string, patch: Partial<ColorGroup>) =>
    setGroups(colorGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGroup = (id: string) => setGroups(colorGroups.filter((g) => g.id !== id));

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
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

      {open && (
        <div className={styles.menu} role="menu">
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
            {colorGroups.map((g) => (
              <div key={g.id} className={styles.groupRow}>
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
        </div>
      )}
    </div>
  );
}
