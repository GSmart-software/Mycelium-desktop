"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ocurrenciasEnRango,
  semanasDelMes,
  varColor,
  type ColorRecordatorio,
  type Periodo,
} from "@/lib/recordatorios";
import { hoy, nuevoRecordatorio, useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { fechaCompleta, INICIALES_SEMANA, useAbrirCalendario } from "./comun";
import { ListaRecordatorios } from "./ListaRecordatorios";
import styles from "./Recordatorios.module.css";
import { SelectorMes } from "./SelectorMes";

/** Como mucho tantos puntos por día: más no entran en la celda y no dicen más. */
const PUNTOS_POR_DIA = 3;

/**
 * El calendario como panel lateral (§ 4.2). Con menos lugar que la pestaña:
 * arriba un mes compacto —los días con recordatorios llevan puntos de su
 * color— y abajo la lista. Tocar un día pone la lista en ese día.
 */
export function CalendarioPanel() {
  const recordatorios = useRecordatoriosStore((s) => s.archivo.recordatorios);
  const estados = useRecordatoriosStore((s) => s.archivo.ocurrencias);
  const abrirCalendario = useAbrirCalendario();

  const [fecha, setFecha] = useState(hoy);
  const [mesVisible, setMesVisible] = useState(() => {
    const [anio, mes] = hoy().split("-").map(Number);
    return { anio, mes };
  });
  const [periodo, setPeriodo] = useState<Periodo>("dia");
  // El panel no resalta nada: «Abrir» desde un aviso va a la pestaña (§ 5.2).
  const seleccionado = null;

  const { anio, mes } = mesVisible;
  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes]);

  // Los colores de cada día, sin repetir, en el orden de la lista. Un punto va
  // oscurecido si TODO lo de ese color ese día está completado.
  const colores = useMemo(() => {
    const mapa = new Map<string, { c: ColorRecordatorio; completo: boolean }[]>();
    const desde = semanas[0][0];
    const hasta = semanas[semanas.length - 1][6];
    for (const o of ocurrenciasEnRango(recordatorios, desde, hasta)) {
      const lista = mapa.get(o.fecha) ?? [];
      const completada = estados[`${o.recordatorio.id}@${o.fecha}`]?.completada === true;
      const previo = lista.find((p) => p.c === o.recordatorio.color);
      if (previo) previo.completo = previo.completo && completada;
      else lista.push({ c: o.recordatorio.color, completo: completada });
      mapa.set(o.fecha, lista);
    }
    return mapa;
  }, [recordatorios, estados, semanas]);

  const moverMes = (delta: number) => {
    const d = new Date(anio, mes - 1 + delta, 1);
    setMesVisible({ anio: d.getFullYear(), mes: d.getMonth() + 1 });
  };

  const hoyTexto = hoy();
  const mesTexto = String(mes).padStart(2, "0");

  return (
    <div className={styles.panel}>
      <div className={styles.panelAcciones}>
        <button type="button" className={styles.botonPrimario} onClick={() => nuevoRecordatorio(fecha)}>
          <Plus size={15} aria-hidden />
          Nuevo
        </button>
        <div className={styles.empuje} />
        <button
          type="button"
          className={styles.botonIcono}
          aria-label="Abrir el calendario como pestaña"
          title="Abrir como pestaña"
          onClick={abrirCalendario}
        >
          <ExternalLink size={16} aria-hidden />
        </button>
      </div>

      <div className={styles.compacto}>
        <div className={styles.compactoNav}>
          <button
            type="button"
            className={styles.botonIcono}
            aria-label="Mes anterior"
            onClick={() => moverMes(-1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <div className={styles.compactoMes}>
            <SelectorMes
              compacto
              anio={anio}
              mes={mes}
              onElegir={(a, m) => setMesVisible({ anio: a, mes: m })}
            />
          </div>
          <button
            type="button"
            className={styles.botonIcono}
            aria-label="Mes siguiente"
            onClick={() => moverMes(1)}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
        <div className={styles.compactoGrilla}>
          {INICIALES_SEMANA.map((l) => (
            <span key={l} className={styles.compactoInicial} aria-hidden>
              {l}
            </span>
          ))}
          {semanas.flat().map((dia) => {
            const deDia = colores.get(dia) ?? [];
            const clases = [
              styles.compactoDia,
              dia.slice(5, 7) !== mesTexto ? styles.diaFuera : "",
              dia === hoyTexto ? styles.hoy : "",
              dia === fecha ? styles.diaElegido : "",
            ].join(" ");
            return (
              <button
                key={dia}
                type="button"
                className={clases}
                aria-pressed={dia === fecha}
                aria-current={dia === hoyTexto ? "date" : undefined}
                aria-label={`${fechaCompleta(dia)}${deDia.length ? ", con recordatorios" : ""}`}
                onClick={() => {
                  setFecha(dia);
                  setPeriodo("dia");
                }}
                onDoubleClick={() => nuevoRecordatorio(dia)}
              >
                {Number(dia.slice(8))}
                <span className={styles.puntos} aria-hidden>
                  {deDia.slice(0, PUNTOS_POR_DIA).map(({ c, completo }) => (
                    <span
                      key={c}
                      className={styles.punto}
                      style={{ "--rec": varColor(c, completo) } as React.CSSProperties}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ListaRecordatorios
        fecha={fecha}
        periodo={periodo}
        onPeriodo={setPeriodo}
        seleccionado={seleccionado}
      />
    </div>
  );
}
