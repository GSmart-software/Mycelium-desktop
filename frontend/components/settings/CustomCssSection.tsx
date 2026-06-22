"use client";

import { Download, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useCssStore, type CssSnippet } from "@/stores/cssStore";
import { CssEditorModal } from "./CssEditorModal";
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
  const rename = useCssStore((s) => s.rename);
  const remove = useCssStore((s) => s.remove);

  const fileRef = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<CssSnippet | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [nombreTmp, setNombreTmp] = useState("");

  const iniciarRenombre = (s: CssSnippet) => {
    setRenombrando(s.id);
    setNombreTmp(s.nombre);
  };
  const confirmarRenombre = (s: CssSnippet) => {
    const nombre = nombreTmp.trim();
    if (nombre && nombre !== s.nombre) void rename(s.id, nombre);
    setRenombrando(null);
  };

  const onPickFile = async (file: File) => {
    setAviso(null);
    if (file.size > WARN_BYTES) {
      setAviso(`"${file.name}" supera 50 KB, pero se importó igual.`);
    }
    const contenido = await file.text();
    await importSnippet(file.name, contenido);
  };

  const descargar = (nombre: string, contenido: string) => {
    const blob = new Blob([contenido], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre.endsWith(".css") ? nombre : `${nombre}.css`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Crea un snippet nuevo (a partir de la plantilla) y lo abre en el editor.
  const nuevoSnippet = async () => {
    setAviso(null);
    const existentes = new Set(snippets.map((s) => s.nombre));
    let nombre = "nuevo.css";
    let i = 2;
    while (existentes.has(nombre)) nombre = `nuevo-${i++}.css`;
    let contenido = "/* Nuevo snippet de Mycelium */\n";
    try {
      contenido = await fetch("/plantilla-estilos.css").then((r) => r.text());
    } catch {
      // sin plantilla disponible → snippet con comentario base
    }
    const snippet = await importSnippet(nombre, contenido);
    setEditando(snippet);
  };

  const descargarPlantilla = async () => {
    const css = await fetch("/plantilla-estilos.css").then((r) => r.text());
    descargar("plantilla-estilos.css", css);
  };

  return (
    <div>
      <span className={styles.label}>Snippets de CSS</span>
      <div className={styles.btnRow} style={{ marginTop: "0.4rem" }}>
        <button type="button" className={styles.primaryBtn} onClick={() => void nuevoSnippet()}>
          Nuevo snippet
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => fileRef.current?.click()}
        >
          Importar .css
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void descargarPlantilla()}
        >
          Descargar plantilla
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
            {renombrando === s.id ? (
              <input
                className={styles.snippetRename}
                value={nombreTmp}
                autoFocus
                onChange={(e) => setNombreTmp(e.target.value)}
                onBlur={() => confirmarRenombre(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarRenombre(s);
                  if (e.key === "Escape") setRenombrando(null);
                }}
                aria-label={`Renombrar ${s.nombre}`}
              />
            ) : (
              <button
                type="button"
                className={styles.snippetName}
                title="Renombrar"
                onClick={() => iniciarRenombre(s)}
              >
                {s.nombre}
              </button>
            )}
            <button
              type="button"
              className={styles.snippetIcon}
              title="Editar"
              aria-label={`Editar ${s.nombre}`}
              onClick={() => setEditando(s)}
            >
              <Pencil size={15} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.snippetIcon}
              title="Exportar"
              aria-label={`Exportar ${s.nombre}`}
              onClick={() => descargar(s.nombre, s.contenido)}
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

      {editando && (
        <CssEditorModal snippet={editando} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}
