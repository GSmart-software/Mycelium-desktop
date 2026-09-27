"use client";

import { Check, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  nombreDelMes,
  ocurrenciasEnRango,
  semanasDelMes,
  varColor,
  type Ocurrencia,
  type Periodo,
} from "@/lib/recordatorios";
import {
  hoy,
  nuevoRecordatorio,
  useModalRecordatorioStore,
  useRecordatoriosStore,
} from "@/stores/recordatoriosStore";
import { DIAS_SEMANA, fechaCompleta } from "./comun";
import { ListaRecordatorios } from "./ListaRecordatorios";
import styles from "./Recordatorios.module.css";
import { SelectorMes } from "./SelectorMes";

/** Cuántos chips entran en un día antes del «+N más». */
const CHIPS_POR_DIA = 3;

/** Clave de `localStorage`: si la lista lateral está escondida. Comodidad, no estado. */
const CLAVE_LISTA = "mic-calendario-lista-oculta";

/** Mes visible como `{ anio, mes }` a partir de una fecha `AAAA-MM-DD`. */
const mesDe = (fecha: string) => {
  const [anio, mes] = fecha.split("-").map(Number);
  return { anio, mes };
};

/**
 * El calendario como pestaña (§ 4.1): la grilla del mes al centro, con los
 * recordatorios de cada día como chips de su color, y la lista del período en un
 * lateral que se puede esconder.
 */
export function CalendarioVista() {
  const recordatorios = useRecordatoriosStore((s) => s.archivo.recordatorios);
  const estados = useRecordatoriosStore((s) => s.archivo.ocurrencias);
  const foco = useRecordatoriosStore((s) => s.foco);
  const consumirFoco = useRecordatoriosStore((s) => s.consumirFoco);
  const abrirModal = useModalRecordatorioStore((s) => s.abrir);

  const [fecha, setFecha] = useState(hoy);
  const [{ anio, mes }, setMes] = useState(() => mesDe(hoy()));
  const [periodo, setPeriodo] = useState<Periodo>("dia");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [listaOculta, setListaOculta] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_LISTA) === "1";
    } catch {
      return false;
    }
  });

  const alternarLista = () => {
    setListaOculta((v) => {
      try {
        localStorage.setItem(CLAVE_LISTA, v ? "0" : "1");
      } catch {
        // sin almacenamiento, la preferencia dura lo que la pestaña
      }
      return !v;
    });
  };

  // «Abrir» desde una tarjeta de aviso: el mes de ese día, el día en la lista y
  // el recordatorio resaltado. Se ajusta el estado DURANTE el render (el patrón
  // de React para derivar de algo que cambió) y después se consume el pedido,
  // para que otra pestaña del calendario —o esta, al remontarse— no vuelva a
  // saltar a ese día.
  const [focoVisto, setFocoVisto] = useState(0);
  if (foco && foco.n !== focoVisto) {
    setFocoVisto(foco.n);
    setFecha(foco.fecha);
    setMes(mesDe(foco.fecha));
    setPeriodo("dia");
    setListaOculta(false);
    setSeleccionado(foco.id ? `${foco.id}@${foco.fecha}` : null);
  }
  useEffect(() => {
    if (foco && foco.n === focoVisto) consumirFoco();
  }, [foco, focoVisto, consumirFoco]);

  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes]);

  // Las ocurrencias de toda la grilla —incluidos los días de los meses vecinos
  // que asoman—, agrupadas por día.
  const porDia = useMemo(() => {
    const mapa = new Map<string, Ocurrencia[]>();
    const desde = semanas[0][0];
    const hasta = semanas[semanas.length - 1][6];
    for (const o of ocurrenciasEnRango(recordatorios, desde, hasta)) {
      const lista = mapa.get(o.fecha);
      if (lista) lista.push(o);
      else mapa.set(o.fecha, [o]);
    }
    return mapa;
  }, [recordatorios, semanas]);

  const moverMes = (delta: number) => {
    const d = new Date(anio, mes - 1 + delta, 1);
    setMes({ anio: d.getFullYear(), mes: d.getMonth() + 1 });
  };

  const irAHoy = () => {
    const h = hoy();
    setFecha(h);
    setMes(mesDe(h));
  };

  const elegirDia = (dia: string, verLista = false) => {
    setFecha(dia);
    setSeleccionado(null);
    if (verLista) {
      setPeriodo("dia");
      setListaOculta(false);
    }
  };

  const hoyTexto = hoy();
  const mesTexto = `${String(mes).padStart(2, "0")}`;

  return (
    <div className={styles.vista}>
      <div className={styles.cabecera}>
        <button
          type="button"
          className={styles.botonIcono}
          aria-label="Mes anterior"
          title="Mes anterior"
          onClick={() => moverMes(-1)}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.botonIcono}
          aria-label="Mes siguiente"
          title="Mes siguiente"
          onClick={() => moverMes(1)}
        >
          <ChevronRight size={18} aria-hidden />
        </button>
        <SelectorMes anio={anio} mes={mes} onElegir={(a, m) => setMes({ anio: a, mes: m })} />
        <button type="button" className={styles.boton} onClick={irAHoy}>
          Hoy
        </button>
        <div className={styles.empuje} />
        <button type="button" className={styles.botonPrimario} onClick={() => nuevoRecordatorio(fecha)}>
          <Plus size={15} aria-hidden />
          Nuevo recordatorio
        </button>
        <button
          type="button"
          className={styles.botonIcono}
          aria-pressed={!listaOculta}
          aria-label={listaOculta ? "Mostrar la lista" : "Esconder la lista"}
          title={listaOculta ? "Mostrar la lista" : "Esconder la lista"}
          onClick={alternarLista}
        >
          {listaOculta ? <PanelRightOpen size={18} aria-hidden /> : <PanelRightClose size={18} aria-hidden />}
        </button>
      </div>

      <div className={styles.cuerpo}>
        <div className={styles.grilla}>
          <div className={styles.encabezadoSemana} aria-hidden>
            {DIAS_SEMANA.map((d) => (
              <span key={d}>{d.slice(0, 3)}</span>
            ))}
          </div>
          <div className={styles.semanas} role="grid" aria-label={`${nombreDelMes(mes)} ${anio}`}>
            {semanas.map((semana) => (
              <div key={semana[0]} className={styles.semana} role="row">
                {semana.map((dia) => {
                  const ocurrencias = porDia.get(dia) ?? [];
                  const visibles =
                    ocurrencias.length > CHIPS_POR_DIA
                      ? ocurrencias.slice(0, CHIPS_POR_DIA - 1)
                      : ocurrencias;
                  const resto = ocurrencias.length - visibles.length;
                  const clases = [
                    styles.dia,
                    dia.slice(5, 7) !== mesTexto ? styles.diaFuera : "",
                    dia === hoyTexto ? styles.hoy : "",
                    dia === fecha ? styles.diaElegido : "",
                  ].join(" ");
                  return (
                    <div
                      key={dia}
                      role="gridcell"
                      aria-selected={dia === fecha}
                      className={clases}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) elegirDia(dia);
                      }}
                      // Doble clic en un día: un recordatorio con esa fecha (§ 4.3).
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        nuevoRecordatorio(dia);
                      }}
                    >
                      <button
                        type="button"
                        className={styles.numeroDia}
                        aria-label={`${fechaCompleta(dia)}${ocurrencias.length ? `, ${ocurrencias.length} recordatorio${ocurrencias.length === 1 ? "" : "s"}` : ""}`}
                        aria-current={dia === hoyTexto ? "date" : undefined}
                        onClick={() => elegirDia(dia, true)}
                      >
                        {Number(dia.slice(8))}
                      </button>
                      {visibles.map((o) => {
                        const clave = `${o.recordatorio.id}@${o.fecha}`;
                        const completada = estados[clave]?.completada === true;
                        return (
                          <button
                            key={clave}
                            type="button"
                            className={`${styles.chip} ${seleccionado === clave ? styles.seleccionado : ""}`}
                            data-completada={completada || undefined}
                            style={{ "--rec": varColor(o.recordatorio.color, completada) } as React.CSSProperties}
                            title={completada ? `${o.recordatorio.titulo} (completado)` : o.recordatorio.titulo}
                            onClick={() => abrirModal({ tipo: "ver", id: o.recordatorio.id, fecha: o.fecha })}
                          >
                            {completada && <Check size={11} strokeWidth={3} aria-hidden className={styles.chipCheck} />}
                            {o.recordatorio.hora && (
                              <span className={styles.chipHora}>{o.recordatorio.hora}</span>
                            )}
                            <span className={styles.chipTitulo}>{o.recordatorio.titulo}</span>
                          </button>
                        );
                      })}
                      {resto > 0 && (
                        <button type="button" className={styles.mas} onClick={() => elegirDia(dia, true)}>
                          +{resto} más
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {!listaOculta && (
          <aside className={styles.lateral}>
            <ListaRecordatorios
              fecha={fecha}
              periodo={periodo}
              onPeriodo={setPeriodo}
              seleccionado={seleccionado}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
