"use client";

import { useMemo } from "react";
import {
  fechaLarga,
  nombreDelMes,
  ocurrenciasEnRango,
  rangoDePeriodo,
  varColor,
  type Ocurrencia,
  type Periodo,
} from "@/lib/recordatorios";
import { Check } from "lucide-react";
import { useModalRecordatorioStore, useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { fechaCorta, horaDe } from "./comun";
import styles from "./Recordatorios.module.css";

const PERIODOS: { valor: Periodo; nombre: string }[] = [
  { valor: "dia", nombre: "Día" },
  { valor: "semana", nombre: "Semana" },
  { valor: "mes", nombre: "Mes" },
];

/** El selector Día · Semana · Mes, compartido por la pestaña y el panel. */
export function SelectorPeriodo({
  periodo,
  onCambio,
}: {
  periodo: Periodo;
  onCambio: (p: Periodo) => void;
}) {
  return (
    <div className={styles.segmentos} role="group" aria-label="Período de la lista">
      {PERIODOS.map((p) => (
        <button
          key={p.valor}
          type="button"
          className={styles.segmento}
          aria-pressed={periodo === p.valor}
          onClick={() => onCambio(p.valor)}
        >
          {p.nombre}
        </button>
      ))}
    </div>
  );
}

/** Cómo se titula la lista según el período: «25 de septiembre», «Semana del 21», «septiembre 2026». */
function tituloDelPeriodo(fecha: string, periodo: Periodo): string {
  const { desde } = rangoDePeriodo(fecha, periodo);
  if (periodo === "dia") return fechaLarga(fecha);
  if (periodo === "semana") return `Semana del ${fechaLarga(desde)}`;
  const [a, m] = fecha.split("-").map(Number);
  return `${nombreDelMes(m)} ${a}`;
}

/**
 * La lista de recordatorios de un período (§ 4.1 y 4.2): en orden, con color,
 * fecha, hora y título. En Semana y Mes va agrupada por día; en Día, la fecha ya
 * está en el título.
 */
export function ListaRecordatorios({
  fecha,
  periodo,
  onPeriodo,
  seleccionado,
}: {
  fecha: string;
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  /** Clave `id@fecha` de la ocurrencia a resaltar («Abrir» desde un aviso). */
  seleccionado: string | null;
}) {
  const recordatorios = useRecordatoriosStore((s) => s.archivo.recordatorios);
  const estados = useRecordatoriosStore((s) => s.archivo.ocurrencias);
  const alternar = useRecordatoriosStore((s) => s.alternarCompletada);
  const abrirModal = useModalRecordatorioStore((s) => s.abrir);

  const ocurrencias = useMemo(() => {
    const { desde, hasta } = rangoDePeriodo(fecha, periodo);
    return ocurrenciasEnRango(recordatorios, desde, hasta);
  }, [recordatorios, fecha, periodo]);

  // Agrupadas por día, conservando el orden.
  const grupos = useMemo(() => {
    const salida: { fecha: string; items: Ocurrencia[] }[] = [];
    for (const o of ocurrencias) {
      const ultimo = salida[salida.length - 1];
      if (ultimo && ultimo.fecha === o.fecha) ultimo.items.push(o);
      else salida.push({ fecha: o.fecha, items: [o] });
    }
    return salida;
  }, [ocurrencias]);

  return (
    <section className={styles.panel} aria-label="Lista de recordatorios">
      <div className={styles.listaCabecera}>
        <h3 className={styles.listaTitulo}>{tituloDelPeriodo(fecha, periodo)}</h3>
        <SelectorPeriodo periodo={periodo} onCambio={onPeriodo} />
      </div>
      {ocurrencias.length === 0 ? (
        <p className={styles.vacio}>
          {periodo === "dia"
            ? "No hay recordatorios este día."
            : periodo === "semana"
              ? "No hay recordatorios esta semana."
              : "No hay recordatorios este mes."}
        </p>
      ) : (
        <div>
          {grupos.map((g) => (
            <div key={g.fecha}>
              {periodo !== "dia" && <p className={styles.grupoFecha}>{fechaCorta(g.fecha)}</p>}
              <ul className={styles.lista}>
                {g.items.map((o) => {
                  const clave = `${o.recordatorio.id}@${o.fecha}`;
                  const completada = estados[clave]?.completada === true;
                  const color = { "--rec": varColor(o.recordatorio.color, completada) } as React.CSSProperties;
                  return (
                    <li key={clave} className={styles.fila} data-completada={completada || undefined}>
                      {/* Hermana del ítem, no adentro: un botón no puede contener
                          otro. Marca solo ESTA ocurrencia. */}
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={completada}
                        aria-label={`${completada ? "Desmarcar" : "Marcar"} «${o.recordatorio.titulo}» como completado`}
                        title={completada ? "Desmarcar como completado" : "Marcar como completado"}
                        className={styles.casillaCompletar}
                        style={color}
                        onClick={() => alternar(clave)}
                      >
                        {completada && <Check size={12} strokeWidth={3} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className={`${styles.item} ${seleccionado === clave ? styles.seleccionado : ""}`}
                        style={color}
                        onClick={() =>
                          abrirModal({ tipo: "ver", id: o.recordatorio.id, fecha: o.fecha })
                        }
                      >
                        <span className={styles.punto} aria-hidden />
                        <span className={styles.itemHora}>{horaDe(o)}</span>
                        <span className={styles.itemTitulo}>{o.recordatorio.titulo}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
