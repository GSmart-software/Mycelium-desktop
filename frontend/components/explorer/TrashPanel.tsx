"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./TrashPanel.module.css";
import { confirmar } from "@/lib/confirmar";

const RETENTION_DAYS = 30;

/**
 * Vista de papelera (HU-23 CA9/CA10): recuperar o eliminar definitivamente.
 *
 * Con selección múltiple (`FUN-S-04`): una casilla por elemento, Ctrl/Cmd‑clic en
 * la fila para sumar o quitar uno, Shift‑clic para un rango desde el último
 * marcado, y «Seleccionar todo». La barra de arriba recupera o elimina lo
 * seleccionado de una vez; eliminar siempre pide confirmación. Los botones de
 * cada fila siguen andando de a uno.
 */
export function TrashPanel() {
  const papelera = useVaultStore((s) => s.papelera);
  const loadPapelera = useVaultStore((s) => s.loadPapelera);
  const restoreNota = useVaultStore((s) => s.restoreNota);
  const deleteNotaForever = useVaultStore((s) => s.deleteNotaForever);
  const restoreNotas = useVaultStore((s) => s.restoreNotas);
  const deleteNotasForever = useVaultStore((s) => s.deleteNotasForever);
  const vaultId = useVaultStore((s) => s.vaultId);

  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Desde dónde se extiende un Shift‑clic: el último elemento marcado o desmarcado.
  const ancla = useRef<string | null>(null);
  const casillaTodo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (vaultId) void loadPapelera();
  }, [vaultId, loadPapelera]);

  // Lo que ya no está en la papelera (recuperado, eliminado, vencido) sale de la
  // selección: si no, la barra contaría elementos que ya no se ven.
  const ids = useMemo(() => papelera.map((i) => i.notaId), [papelera]);
  useEffect(() => {
    setSeleccion((prev) => {
      const vigentes = new Set(ids);
      const filtrada = [...prev].filter((id) => vigentes.has(id));
      return filtrada.length === prev.size ? prev : new Set(filtrada);
    });
  }, [ids]);

  const todas = ids.length > 0 && seleccion.size === ids.length;
  useEffect(() => {
    if (casillaTodo.current) {
      casillaTodo.current.indeterminate = seleccion.size > 0 && !todas;
    }
  }, [seleccion, todas]);

  if (papelera.length === 0) {
    return <p className={styles.empty}>La papelera está vacía.</p>;
  }

  const alternar = (id: string) => {
    setSeleccion((prev) => {
      const nueva = new Set(prev);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
    ancla.current = id;
  };

  /** Shift‑clic: marca el rango entre el ancla y `id` (sin desmarcar lo demás). */
  const extender = (id: string) => {
    const desde = ancla.current === null ? -1 : ids.indexOf(ancla.current);
    const hasta = ids.indexOf(id);
    if (desde < 0) return alternar(id);
    const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
    setSeleccion((prev) => new Set([...prev, ...ids.slice(a, b + 1)]));
    ancla.current = id;
  };

  const clicEnFila = (e: MouseEvent, id: string) => {
    // Los botones de la fila hacen lo suyo; la fila solo selecciona con modificador.
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.shiftKey) {
      e.preventDefault();
      extender(id);
    } else if (e.ctrlKey || e.metaKey) {
      alternar(id);
    }
  };

  const seleccionarTodo = () => {
    setSeleccion(todas ? new Set() : new Set(ids));
    ancla.current = null;
  };

  const informarFallidas = (fallidas: string[], verbo: string) => {
    setAviso(
      fallidas.length === 0
        ? null
        : `No se ${fallidas.length === 1 ? "pudo" : "pudieron"} ${verbo} ${fallidas.length} elemento${
            fallidas.length === 1 ? "" : "s"
          }: quedan seleccionados para reintentar.`,
    );
    setSeleccion(new Set(fallidas));
  };

  const recuperarSeleccion = async () => {
    setOcupado(true);
    try {
      informarFallidas(await restoreNotas([...seleccion]), "recuperar");
    } finally {
      setOcupado(false);
    }
  };

  const eliminarSeleccion = async () => {
    const n = seleccion.size;
    const ok = await confirmar(
      n === 1
        ? "El elemento seleccionado se eliminará permanentemente. ¿Continuar?"
        : `Los ${n} elementos seleccionados se eliminarán permanentemente. ¿Continuar?`,
      "Eliminar definitivamente",
    );
    if (!ok) return;
    setOcupado(true);
    try {
      informarFallidas(await deleteNotasForever([...seleccion]), "eliminar");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.barra}>
        <label className={styles.todo}>
          <input
            ref={casillaTodo}
            type="checkbox"
            checked={todas}
            onChange={seleccionarTodo}
            disabled={ocupado}
          />
          {seleccion.size === 0 ? "Seleccionar todo" : `${seleccion.size} seleccionado${seleccion.size === 1 ? "" : "s"}`}
        </label>
        {seleccion.size > 0 && (
          <div className={styles.accionesLote}>
            <button
              type="button"
              className={styles.restore}
              disabled={ocupado}
              onClick={() => void recuperarSeleccion()}
            >
              Recuperar
            </button>
            <button
              type="button"
              className={styles.deleteForever}
              disabled={ocupado}
              onClick={() => void eliminarSeleccion()}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
      {aviso && <p className={styles.aviso}>{aviso}</p>}

      <ul className={styles.list}>
        {papelera.map((item) => {
          const eliminado = new Date(item.eliminadoEn);
          const diasPasados = Math.floor(
            (Date.now() - eliminado.getTime()) / (24 * 60 * 60 * 1000),
          );
          const diasRestantes = Math.max(0, RETENTION_DAYS - diasPasados);
          const marcado = seleccion.has(item.notaId);

          return (
            <li
              key={item.notaId}
              className={`${styles.item} ${marcado ? styles.marcado : ""}`}
              onClick={(e) => clicEnFila(e, item.notaId)}
              // Shift+clic selecciona un rango de elementos, no el texto de las
              // filas: la selección de texto arranca en el mousedown.
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
            >
              <div className={styles.cabecera}>
                <input
                  type="checkbox"
                  className={styles.casilla}
                  checked={marcado}
                  disabled={ocupado}
                  aria-label={`Seleccionar «${item.titulo}»`}
                  onChange={() => undefined}
                  onClick={(e) => {
                    if (e.shiftKey) extender(item.notaId);
                    else alternar(item.notaId);
                  }}
                />
                <p className={styles.titulo}>{item.titulo}</p>
              </div>
              <p className={styles.meta}>
                {item.rutaOriginal} · eliminada el {eliminado.toLocaleDateString()} ·{" "}
                {diasRestantes} día{diasRestantes === 1 ? "" : "s"} restantes
              </p>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={styles.restore}
                  disabled={ocupado}
                  onClick={() => void restoreNota(item.notaId)}
                >
                  Recuperar
                </button>
                <button
                  type="button"
                  className={styles.deleteForever}
                  disabled={ocupado}
                  onClick={() => {
                    void confirmar(
                      `"${item.titulo}" se eliminará permanentemente. ¿Continuar?`,
                      "Eliminar definitivamente",
                    ).then((ok) => {
                      if (ok) void deleteNotaForever(item.notaId);
                    });
                  }}
                >
                  Eliminar ahora
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
