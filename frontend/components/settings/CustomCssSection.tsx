"use client";

import { Download, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useCssStore } from "@/stores/cssStore";
import styles from "./Settings.module.css";

const WARN_BYTES = 50 * 1024; // HU-15 CA5

/**
 * Gestor de snippets de CSS personalizado (estilo Obsidian, HU-13/15): lista de
 * archivos asociados a la cuenta, cada uno con switch para activar/desactivar,
 * exportar y eliminar; botón general para importar un .css. Los cambios se
 * aplican en vivo, sin recargar.
 */
export function CustomCssSection() {
  const snippets = useCssStore((s) => s.snippets);
  const importSnippet = useCssStore((s) => s.importSnippet);
  const toggle = useCssStore((s) => s.toggle);
  const remove = useCssStore((s) => s.remove);

  const fileRef = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const onPickFile = async (file: File) => {
    setAviso(null);
    if (file.size > WARN_BYTES) {
      setAviso(`"${file.name}" supera 50 KB, pero se importó igual.`);
    }
    const contenido = await file.text();
    await importSnippet(file.name, contenido);
  };

  const exportar = (nombre: string, contenido: string) => {
    const blob = new Blob([contenido], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre.endsWith(".css") ? nombre : `${nombre}.css`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className={styles.toggleRow}>
        <span className={styles.label}>Snippets de CSS</span>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => fileRef.current?.click()}
        >
          Importar .css
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".css,text/css"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
        Tus snippets quedan asociados a la cuenta y se aplican en cualquier
        dispositivo. Activá los que quieras; el estilo se actualiza al instante.
      </p>

      <ul className={styles.snippetList}>
        {snippets.length === 0 && (
          <li className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
            Todavía no importaste ningún CSS. Usá «Importar .css» (podés empezar
            por la plantilla descargable en /plantilla-estilos.css).
          </li>
        )}
        {snippets.map((s) => (
          <li key={s.id} className={styles.snippetRow}>
            <label className={styles.switch} title={s.activo ? "Activado" : "Desactivado"}>
              <input
                type="checkbox"
                checked={s.activo}
                onChange={(e) => void toggle(s.id, e.target.checked)}
              />
              <span className={styles.switchTrack} aria-hidden />
            </label>
            <span className={styles.snippetName} title={s.nombre}>{s.nombre}</span>
            <button
              type="button"
              className={styles.snippetIcon}
              title="Exportar"
              aria-label={`Exportar ${s.nombre}`}
              onClick={() => exportar(s.nombre, s.contenido)}
            >
              <Download size={15} aria-hidden />
            </button>
            <button
              type="button"
              className={`${styles.snippetIcon} ${styles.snippetDanger}`}
              title="Eliminar"
              aria-label={`Eliminar ${s.nombre}`}
              onClick={() => void remove(s.id)}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {aviso && <p className={styles.cssPreviewNote}>{aviso}</p>}
    </div>
  );
}
