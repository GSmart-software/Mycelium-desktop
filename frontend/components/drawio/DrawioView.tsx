"use client";

import { useEffect, useRef } from "react";
import { adjuntar, aplicarTema, desadjuntar } from "@/lib/drawioInstancias";
import type { TemaDrawio } from "@/lib/drawio";
import { usePreferencesStore } from "@/stores/preferencesStore";
import styles from "./DrawioView.module.css";

/**
 * Vista de un diagrama de draw.io (`FUN-L-20`).
 *
 * > [!important] Esto no es un componente de draw.io, es su aplicación entera
 * > Excalidraw se integró como componente React y por eso fue barato. draw.io no
 * > publica nada equivalente: lo que ofrece es la webapp en **modo embebido**, un
 * > `iframe` que habla por `postMessage`. Mycelium sigue siendo quien guarda el
 * > archivo; el iframe solo edita y devuelve el XML.
 *
 * El editor de verdad —el `iframe`, el puente y el guardado— vive en
 * `lib/drawioInstancias.ts`, a nivel de módulo. Este componente solo **marca el
 * hueco**: dice dónde hay que mostrarlo y, al desmontarse, que se oculte. Así,
 * cambiar de pestaña y volver no recarga la webapp (`DEF-039` resolvió lo mismo
 * para el editor de notas, y `lib/terminal.ts` para las consolas).
 *
 * `instanceId` es la PESTAÑA, no el archivo: dos pestañas del mismo `.drawio`
 * son dos editores, como en `BaseView`.
 */
export function DrawioView({
  notaId,
  instanceId = notaId,
}: {
  notaId: string;
  instanceId?: string;
}) {
  const anclaRef = useRef<HTMLDivElement>(null);
  const oscuro = usePreferencesStore((s) => s.modoOscuro);
  const tema: TemaDrawio = oscuro ? "oscuro" : "claro";

  useEffect(() => {
    const ancla = anclaRef.current;
    if (!ancla) return;
    adjuntar(instanceId, notaId, ancla, tema);
    return () => desadjuntar(instanceId);
    // `tema` no va en las dependencias: cambiarlo no tiene que re-adjuntar, solo
    // avisarle al editor (abajo). Si estuviera acá, cada cambio de tema
    // desadjuntaría y volvería a adjuntar sin motivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, notaId]);

  useEffect(() => {
    aplicarTema(instanceId, tema);
  }, [instanceId, tema]);

  return <div ref={anclaRef} className={styles.host} />;
}
