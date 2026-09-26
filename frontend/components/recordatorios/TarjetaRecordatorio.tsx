"use client";

import { BellRing } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { markMissingWikilinks } from "@/lib/editor/wikilink";
import { renderMarkdown } from "@/lib/markdown";
import {
  describirVencimiento,
  opcionesPosponer,
  varColor,
  type Aviso,
} from "@/lib/recordatorios";
import { useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { useVaultStore } from "@/stores/vaultStore";
import { fechaCorta, useAbrirCalendario, useEnlacesDelVault } from "./comun";
import { ModalRecordatorio } from "./ModalRecordatorio";
import styles from "./Recordatorios.module.css";

/** Tarjetas a la vista a la vez (§ 5.2); el resto se cuenta en «y N más». */
const A_LA_VISTA = 3;

/**
 * Lo del calendario que vive montado en el workspace: las tarjetas de aviso y el
 * modal de ver/editar. Va una vez, en el shell, y lo usan la pestaña, el panel y
 * las propias tarjetas.
 */
export function Recordatorios() {
  return (
    <>
      <TarjetasRecordatorio />
      <ModalRecordatorio />
    </>
  );
}

/**
 * Las tarjetas de recordatorio (§ 5.2): abajo a la derecha, del color del
 * recordatorio y **sin irse solas** —a diferencia de los avisos efímeros, un
 * recordatorio que desaparece a los nueve segundos no sirve—. Se van con
 * Listo, Posponer o Abrir.
 */
function TarjetasRecordatorio() {
  const avisos = useRecordatoriosStore((s) => s.avisos);
  if (avisos.length === 0) return null;
  const visibles = avisos.slice(-A_LA_VISTA);
  const resto = avisos.length - visibles.length;
  return (
    <div className={styles.pilaTarjetas} role="region" aria-label="Recordatorios">
      {visibles.map((a) => (
        <Tarjeta key={`${a.clave}|${a.momento.getTime()}`} aviso={a} />
      ))}
      {resto > 0 && (
        <span className={styles.masTarjetas}>
          y {resto} más
        </span>
      )}
    </div>
  );
}

function Tarjeta({ aviso }: { aviso: Aviso }) {
  const { recordatorio: r } = aviso;
  const listo = useRecordatoriosStore((s) => s.listo);
  const posponer = useRecordatoriosStore((s) => s.posponer);
  const enfocar = useRecordatoriosStore((s) => s.enfocar);
  const abrirCalendario = useAbrirCalendario();
  const { onClicDetalle } = useEnlacesDelVault();
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);

  const [posponiendo, setPosponiendo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [recortado, setRecortado] = useState(false);
  const detalleRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => (r.detalle.trim() ? renderMarkdown(r.detalle) : ""), [r.detalle]);

  useEffect(() => {
    if (detalleRef.current) markMissingWikilinks(detalleRef.current, notas, carpetas);
  }, [html, notas, carpetas]);

  // «Ver todo» solo si el detalle no entra: medirlo después de pintarlo.
  useLayoutEffect(() => {
    const el = detalleRef.current;
    if (el && !abierto) setRecortado(el.scrollHeight > el.clientHeight + 1);
  }, [html, abierto]);

  const ahora = new Date();
  const vencido = describirVencimiento(aviso, ahora);
  const cuando = `${fechaCorta(aviso.fecha)} · ${r.hora ?? "Todo el día"}`;

  const abrir = () => {
    enfocar(aviso.fecha, r.id);
    // «Abrir» NO descarta la ocurrencia: es ir a mirarla, no darla por hecha.
    // La tarjeta sigue hasta Listo o Posponer.
    abrirCalendario();
  };

  return (
    <div
      className={styles.tarjeta}
      style={{ "--rec": varColor(r.color) } as React.CSSProperties}
      role="alert"
      aria-label={`Recordatorio: ${r.titulo}`}
    >
      <div className={styles.tarjetaCabecera}>
        <BellRing size={16} className={styles.tarjetaIcono} aria-hidden />
        <div>
          <p className={styles.tarjetaTitulo}>{r.titulo}</p>
          <span className={styles.tarjetaCuando}>
            {cuando}
            {vencido && (
              <>
                {" · "}
                <span className={styles.vencido}>{vencido}</span>
              </>
            )}
          </span>
        </div>
      </div>

      {html && (
        <>
          <div
            ref={detalleRef}
            className={`mic-preview ${styles.tarjetaDetalle} ${abierto ? styles.abierto : ""}`}
            onClick={onClicDetalle}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {(recortado || abierto) && (
            <button type="button" className={styles.verTodo} onClick={() => setAbierto((v) => !v)}>
              {abierto ? "Ver menos" : "Ver todo"}
            </button>
          )}
        </>
      )}

      <div className={styles.tarjetaAcciones}>
        {posponiendo ? (
          <>
            {opcionesPosponer(ahora).map((o) => (
              <button
                key={o.etiqueta}
                type="button"
                className={styles.accion}
                onClick={() => posponer(aviso.clave, o.hasta)}
              >
                {o.etiqueta}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.accion} ${styles.accionSecundaria}`}
              onClick={() => setPosponiendo(false)}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.accion} onClick={() => listo(aviso.clave)}>
              Listo
            </button>
            <button type="button" className={styles.accion} onClick={() => setPosponiendo(true)}>
              Posponer
            </button>
            <button type="button" className={`${styles.accion} ${styles.accionSecundaria}`} onClick={abrir}>
              Abrir
            </button>
          </>
        )}
      </div>
    </div>
  );
}
