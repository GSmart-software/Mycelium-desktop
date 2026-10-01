"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmar } from "@/lib/confirmar";
import { markMissingWikilinks } from "@/lib/editor/wikilink";
import { renderMarkdown } from "@/lib/markdown";
import {
  COLORES,
  esFechaValida,
  esHoraValida,
  normalizarTitulo,
  REPETICIONES,
  varColor,
  type Recordatorio,
  type Repeticion,
} from "@/lib/recordatorios";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { useConfirmarStore } from "@/stores/confirmarStore";
import {
  useModalRecordatorioStore,
  useRecordatoriosStore,
  type ModalRecordatorio as Modal,
} from "@/stores/recordatoriosStore";
import { useVaultStore } from "@/stores/vaultStore";
import { describirRepeticion, fechaCompleta, useEnlacesDelVault } from "./comun";
import { EditorDetalle } from "./EditorDetalle";
import styles from "./Recordatorios.module.css";

/**
 * El modal del calendario (§ 4.3): **ver** un recordatorio —detalle
 * renderizado, con Editar y Eliminar— o **editarlo** en el formulario. Uno solo,
 * montado en el workspace.
 */
export function ModalRecordatorio() {
  const modal = useModalRecordatorioStore((s) => s.modal);
  if (!modal) return null;
  // La `key` reinicia el estado del formulario al pasar de un recordatorio a otro.
  return modal.tipo === "ver" ? (
    <Ver key={`ver:${modal.id}@${modal.fecha}`} modal={modal} />
  ) : (
    <Editar key={`editar:${modal.borrador.id}`} modal={modal} />
  );
}

/**
 * El marco común: velo, foco atrapado, Escape. Mientras `DialogoConfirmar` está
 * preguntando, este modal suelta el teclado: si no, su trampa de foco le robaría
 * el foco a la pregunta y un Escape cerraría los dos.
 */
function Marco({
  color,
  completada = false,
  titulo,
  children,
  pie,
  etiqueta,
}: {
  color: Recordatorio["color"] | null;
  /** El borde del diálogo lleva el color oscurecido, como el chip. */
  completada?: boolean;
  titulo: string;
  children: React.ReactNode;
  pie: React.ReactNode;
  etiqueta: string;
}) {
  const cerrar = useModalRecordatorioStore((s) => s.cerrar);
  const preguntando = useConfirmarStore((s) => s.pendiente !== null);
  const dialogoRef = useRef<HTMLDivElement>(null);
  useDialogoModal({ abierto: !preguntando, cerrar, dialogoRef });

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        style={color ? ({ "--rec": varColor(color, completada) } as React.CSSProperties) : undefined}
      >
        <div className={styles.modalCabecera}>
          <h2 className={styles.modalTitulo}>{titulo}</h2>
          <button
            type="button"
            className={styles.botonIcono}
            aria-label="Cerrar"
            onClick={cerrar}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.modalCuerpo}>{children}</div>
        <div className={styles.modalPie}>{pie}</div>
      </div>
    </div>
  );
}

// ── Ver ─────────────────────────────────────────────────────────────────────

function Ver({ modal }: { modal: Extract<Modal, { tipo: "ver" }> }) {
  const recordatorio = useRecordatoriosStore((s) =>
    s.archivo.recordatorios.find((r) => r.id === modal.id),
  );
  const eliminar = useRecordatoriosStore((s) => s.eliminar);
  const alternar = useRecordatoriosStore((s) => s.alternarCompletada);
  const clave = `${modal.id}@${modal.fecha}`;
  const completada = useRecordatoriosStore((s) => s.archivo.ocurrencias[clave]?.completada === true);
  const { abrir, cerrar } = useModalRecordatorioStore();
  const { onClicDetalle } = useEnlacesDelVault(cerrar);
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const detalleRef = useRef<HTMLDivElement>(null);

  const detalle = recordatorio?.detalle ?? "";
  const html = useMemo(() => (detalle.trim() ? renderMarkdown(detalle) : ""), [detalle]);

  // Enlaces rotos: el mismo tratamiento que en la lectura de una nota.
  useEffect(() => {
    if (detalleRef.current) markMissingWikilinks(detalleRef.current, notas, carpetas);
  }, [html, notas, carpetas]);

  // Si lo borraron (desde otra vista) mientras estaba abierto, no queda nada que ver.
  useEffect(() => {
    if (!recordatorio) cerrar();
  }, [recordatorio, cerrar]);
  if (!recordatorio) return null;

  const repeticion = describirRepeticion(recordatorio.repeticion, recordatorio.fecha);

  const alEliminar = async () => {
    const serie = recordatorio.repeticion !== "ninguna";
    const ok = await confirmar(
      serie
        ? `¿Eliminar «${recordatorio.titulo}»? Se repite: se elimina la serie entera. No hay papelera para recordatorios.`
        : `¿Eliminar «${recordatorio.titulo}»? No hay papelera para recordatorios.`,
      "Eliminar",
    );
    if (!ok) return;
    eliminar(recordatorio.id);
    cerrar();
  };

  return (
    <Marco
      color={recordatorio.color}
      completada={completada}
      etiqueta={`Recordatorio: ${recordatorio.titulo}`}
      titulo={recordatorio.titulo}
      pie={
        <>
          <button type="button" className={`${styles.boton} ${styles.peligro}`} onClick={alEliminar}>
            <Trash2 size={14} aria-hidden />
            Eliminar
          </button>
          <div className={styles.empuje} />
          {/* Marca ESTA ocurrencia (la del día desde el que se abrió), no la serie. */}
          <button
            type="button"
            className={styles.boton}
            aria-pressed={completada}
            onClick={() => alternar(clave)}
          >
            <Check size={14} aria-hidden />
            {completada ? "Completado" : "Marcar como completado"}
          </button>
          <button
            type="button"
            className={styles.botonPrimario}
            onClick={() => abrir({ tipo: "editar", borrador: recordatorio, nuevo: false })}
          >
            <Pencil size={14} aria-hidden />
            Editar
          </button>
        </>
      }
    >
      <div className={styles.meta}>
        <span>
          <strong>{fechaCompleta(modal.fecha)}</strong>
          {" · "}
          {recordatorio.hora ?? "Todo el día"}
        </span>
        {repeticion && <span>{repeticion}</span>}
      </div>
      {html ? (
        // El pipeline de markdown escapa el HTML del usuario: no puede inyectar.
        <div
          ref={detalleRef}
          className={`mic-preview ${styles.detalle}`}
          onClick={onClicDetalle}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className={styles.sinDetalle}>Sin detalle.</p>
      )}
    </Marco>
  );
}

// ── Editar ──────────────────────────────────────────────────────────────────

function Editar({ modal }: { modal: Extract<Modal, { tipo: "editar" }> }) {
  const guardar = useRecordatoriosStore((s) => s.guardar);
  const { cerrar, abrir: abrirModal } = useModalRecordatorioStore();
  // Seguir un enlace desde el formulario abre la nota detrás y deja el
  // formulario abierto: cerrarlo perdería lo que se está escribiendo.
  const { abrir, existe } = useEnlacesDelVault();

  const [titulo, setTitulo] = useState(modal.borrador.titulo);
  const [fecha, setFecha] = useState(modal.borrador.fecha);
  const [todoElDia, setTodoElDia] = useState(modal.borrador.hora === null);
  const [hora, setHora] = useState(modal.borrador.hora ?? "09:00");
  const [repeticion, setRepeticion] = useState<Repeticion>(modal.borrador.repeticion);
  const [color, setColor] = useState(modal.borrador.color);
  const detalleRef = useRef(modal.borrador.detalle);
  const [intentado, setIntentado] = useState(false);

  const errores = {
    titulo: titulo.trim() === "" ? "Poné un título." : null,
    fecha: !esFechaValida(fecha) ? "Elegí una fecha." : null,
    hora: !todoElDia && !esHoraValida(hora) ? "Elegí una hora, o marcá «Todo el día»." : null,
  };
  const valido = !errores.titulo && !errores.fecha && !errores.hora;

  const onCambioDetalle = useCallback((texto: string) => {
    detalleRef.current = texto;
  }, []);

  const alGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    setIntentado(true);
    if (!valido) return;
    const r: Recordatorio = {
      ...modal.borrador,
      titulo: normalizarTitulo(titulo),
      fecha,
      hora: todoElDia ? null : hora,
      repeticion,
      color,
      detalle: detalleRef.current,
    };
    guardar(r);
    // Al guardar se muestra lo guardado: así se ve cómo quedó el detalle.
    abrirModal({ tipo: "ver", id: r.id, fecha: r.fecha });
  };

  const cancelar = () => {
    if (modal.nuevo) cerrar();
    else abrirModal({ tipo: "ver", id: modal.borrador.id, fecha: modal.borrador.fecha });
  };

  // Flechas dentro del grupo de colores, como en cualquier grupo de radios.
  const onTeclaColor = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const i = COLORES.findIndex((c) => c.valor === color);
    const siguiente = COLORES[(i + delta + COLORES.length) % COLORES.length];
    setColor(siguiente.valor);
    const grupo = (e.currentTarget as HTMLElement).parentElement;
    grupo?.querySelector<HTMLElement>(`[data-color="${siguiente.valor}"]`)?.focus();
  };

  return (
    <Marco
      color={color}
      etiqueta={modal.nuevo ? "Nuevo recordatorio" : "Editar recordatorio"}
      titulo={modal.nuevo ? "Nuevo recordatorio" : "Editar recordatorio"}
      pie={
        <>
          <div className={styles.empuje} />
          <button type="button" className={styles.boton} onClick={cancelar}>
            Cancelar
          </button>
          <button type="submit" form="form-recordatorio" className={styles.botonPrimario}>
            Guardar
          </button>
        </>
      }
    >
      <form id="form-recordatorio" className={styles.panel} onSubmit={alGuardar} noValidate>
        <label className={styles.campo}>
          Título
          <input
            className={`${styles.entrada} ${styles.entradaTitulo}`}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            aria-invalid={intentado && !!errores.titulo}
            required
          />
          {intentado && errores.titulo && <p className={styles.error}>{errores.titulo}</p>}
        </label>

        <div className={styles.fila}>
          <label className={styles.campo}>
            Fecha
            <input
              type="date"
              className={styles.entrada}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-invalid={intentado && !!errores.fecha}
              required
            />
          </label>
          <label className={styles.campo}>
            Hora
            <input
              type="time"
              className={styles.entrada}
              value={todoElDia ? "" : hora}
              disabled={todoElDia}
              onChange={(e) => setHora(e.target.value)}
              aria-invalid={intentado && !!errores.hora}
            />
          </label>
          <label className={styles.casilla}>
            <input type="checkbox" checked={todoElDia} onChange={(e) => setTodoElDia(e.target.checked)} />
            Todo el día
          </label>
        </div>
        {intentado && (errores.fecha || errores.hora) && (
          <p className={styles.error}>{errores.fecha ?? errores.hora}</p>
        )}

        <div className={styles.fila}>
          <label className={styles.campo}>
            Repetición
            <select
              className={styles.entrada}
              value={repeticion}
              onChange={(e) => setRepeticion(e.target.value as Repeticion)}
            >
              {REPETICIONES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.campo}>
            <span id="color-recordatorio">Color</span>
            <div className={styles.colores} role="radiogroup" aria-labelledby="color-recordatorio">
              {COLORES.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  role="radio"
                  data-color={c.valor}
                  aria-checked={color === c.valor}
                  aria-label={c.nombre}
                  title={c.nombre}
                  tabIndex={color === c.valor ? 0 : -1}
                  className={styles.color}
                  style={{ "--rec": varColor(c.valor) } as React.CSSProperties}
                  onClick={() => setColor(c.valor)}
                  onKeyDown={onTeclaColor}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={styles.campo}>
          <span>Detalle</span>
          <EditorDetalle
            valorInicial={modal.borrador.detalle}
            onCambio={onCambioDetalle}
            abrirEnlace={abrir}
            existeNota={existe}
            etiqueta="Detalle del recordatorio"
          />
        </div>
      </form>
    </Marco>
  );
}
