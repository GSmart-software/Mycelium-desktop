"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { EVENTO_ARCHIVO_GUARDADO, EVENTO_NOTA_GUARDADA, EVENTO_RECARGA } from "@/lib/eventos";
import { RUTA_ESQUEMAS } from "@/lib/esquemas";
import { conteos } from "@/lib/salud";
import { useSaludStore } from "@/stores/saludStore";
import { useVaultStore } from "@/stores/vaultStore";
import {
  ItemDuplicado,
  ItemNota,
  ItemProblema,
  ItemPropiedades,
  TOPE_VISIBLE,
  useIrANota,
  useTituloDeNota,
} from "./problemas";
import styles from "./SaludPanel.module.css";

/**
 * Panel de salud del vault (`FUN-L-30`), en el rail. Muestra lo mismo que
 * `mycelium_salud` le da a la IA —enlaces y embeds rotos, títulos duplicados,
 * huérfanas y notas sin enlaces salientes—, agrupado y con conteos, y cada
 * ítem lleva a la nota y a la línea.
 *
 * Se recalcula al abrirse y cuando el índice cambia (guardado, cambio externo,
 * árbol), con espera: ver `stores/saludStore.ts`.
 */
export function SaludPanel() {
  const informe = useSaludStore((s) => s.informe);
  const cargando = useSaludStore((s) => s.cargando);
  const error = useSaludStore((s) => s.error);
  const calculadoEn = useSaludStore((s) => s.calculadoEn);
  const vaultId = useVaultStore((s) => s.vaultId);
  const ir = useIrANota();
  const titulo = useTituloDeNota();

  // Al abrir el panel (o cambiar de vault): calcular. Mientras está abierto,
  // escuchar los cambios del índice.
  useEffect(() => {
    if (vaultId === null) return;
    const store = useSaludStore.getState();
    // Se ve el informe anterior mientras se recalcula, salvo que sea de otro vault.
    if (store.vaultId !== vaultId) store.vaciar();
    void store.recalcular();
    const pedir = () => useSaludStore.getState().pedir();
    window.addEventListener(EVENTO_NOTA_GUARDADA, pedir);
    window.addEventListener(EVENTO_RECARGA, pedir);
    // Guardar `esquemas.yml` desde el visor cambia qué notas cumplen (`FUN-M-46`).
    window.addEventListener(EVENTO_ARCHIVO_GUARDADO, pedir);
    // El árbol: crear, renombrar, mover o borrar cambian destinos y backlinks.
    const desuscribir = useVaultStore.subscribe((s, previo) => {
      if (s.notas !== previo.notas || s.carpetas !== previo.carpetas) pedir();
    });
    return () => {
      window.removeEventListener(EVENTO_NOTA_GUARDADA, pedir);
      window.removeEventListener(EVENTO_RECARGA, pedir);
      window.removeEventListener(EVENTO_ARCHIVO_GUARDADO, pedir);
      desuscribir();
    };
  }, [vaultId]);

  const c = informe ? conteos(informe) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.resumen} data-estado={c === null ? "cargando" : c.total === 0 ? "sano" : "problemas"}>
        <p className={styles.resumenTitulo}>
          {c === null
            ? cargando
              ? "Revisando el vault…"
              : "Sin revisar"
            : c.total === 0
              ? "Ningún problema"
              : `${c.total} ${c.total === 1 ? "problema" : "problemas"}`}
        </p>
        <p className={styles.resumenDetalle}>
          {informe !== null &&
            `${informe.notas} ${informe.notas === 1 ? "nota revisada" : "notas revisadas"}` +
              (calculadoEn !== null ? ` · ${new Date(calculadoEn).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : "")}
        </p>
        <button
          type="button"
          className={styles.actualizar}
          onClick={() => void useSaludStore.getState().recalcular()}
          disabled={cargando}
          title="Volver a revisar el vault"
          aria-label="Volver a revisar el vault"
        >
          <RefreshCw size={14} aria-hidden className={cargando ? styles.girando : undefined} />
        </button>
      </div>

      {error && <p className={styles.error}>No se pudo revisar el vault: {error}</p>}

      {informe && informe.avisosEsquemas.length > 0 && (
        <div className={styles.error} role="status">
          <p>
            {RUTA_ESQUEMAS} tiene {informe.avisosEsquemas.length === 1 ? "un problema" : `${informe.avisosEsquemas.length} problemas`}; lo que
            no se entiende se ignora:
          </p>
          <ul className={styles.lista}>
            {informe.avisosEsquemas.map((a, i) => (
              <li key={i}>
                {a.linea !== undefined && `Línea ${a.linea}: `}
                {a.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}

      {informe && c && (
        <>
          <Seccion
            titulo="Enlaces rotos"
            cuenta={c.rotos}
            ayuda="Enlaces a notas que no existen. Un enlace escrito dentro de un bloque de código no cuenta."
          >
            {informe.rotos.slice(0, TOPE_VISIBLE).map((p, i) => (
              <ItemProblema key={`${p.desde}-${p.tipo}-${p.texto}-${i}`} p={p} tituloDesde={titulo(p.desde)} ir={ir} />
            ))}
          </Seccion>
          <Seccion titulo="Embeds rotos" cuenta={c.embedsRotos} ayuda="Embebidos (![[…]]) de algo que no está en el vault.">
            {informe.embedsRotos.slice(0, TOPE_VISIBLE).map((p, i) => (
              <ItemProblema key={`${p.desde}-${p.texto}-${i}`} p={p} tituloDesde={titulo(p.desde)} ir={ir} />
            ))}
          </Seccion>
          <Seccion
            titulo="Títulos duplicados"
            cuenta={c.duplicados}
            ayuda="Notas del mismo tipo con el mismo título: un enlace sin carpeta no sabe a cuál ir."
          >
            {informe.duplicados.slice(0, TOPE_VISIBLE).map((d) => (
              <ItemDuplicado key={`${d.tipo}-${d.titulo}`} d={d} titulo={titulo} ir={ir} />
            ))}
          </Seccion>
          <Seccion titulo="Huérfanas" cuenta={c.huerfanas} ayuda="Notas que ninguna otra enlaza: nada lleva hasta ellas.">
            {informe.huerfanas.slice(0, TOPE_VISIBLE).map((n) => (
              <ItemNota key={n.ruta} n={n} ir={ir} />
            ))}
          </Seccion>
          <Seccion
            titulo="Propiedades"
            cuenta={c.propiedades}
            ayuda={`Notas cuyas propiedades no cumplen los esquemas de ${RUTA_ESQUEMAS} o tienen un valor que empieza con # sin comillas.`}
          >
            {informe.propiedades.slice(0, TOPE_VISIBLE).map((n) => (
              <ItemPropiedades key={n.ruta} n={n} ir={ir} />
            ))}
          </Seccion>
          <Seccion
            titulo="Sin enlaces salientes"
            cuenta={c.sinSalientes}
            ayuda="Notas que no enlazan a ninguna otra."
            cerrada
          >
            {informe.sinSalientes.slice(0, TOPE_VISIBLE).map((n) => (
              <ItemNota key={n.ruta} n={n} ir={ir} />
            ))}
          </Seccion>
          <p className={styles.nota}>
            No se revisan las Esporas (son plantillas) ni los archivos de instrucciones para agentes de la raíz
            (CLAUDE.md, AGENTS.md).
          </p>
        </>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  cuenta,
  ayuda,
  cerrada = false,
  children,
}: {
  titulo: string;
  cuenta: number;
  ayuda: string;
  cerrada?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.seccion} open={!cerrada && cuenta > 0} data-vacia={cuenta === 0 || undefined}>
      <summary className={styles.seccionTitulo}>
        <span>{titulo}</span>
        <span className={styles.cuenta} data-cero={cuenta === 0 || undefined}>
          {cuenta}
        </span>
      </summary>
      <p className={styles.ayuda}>{ayuda}</p>
      {cuenta > 0 && <ul className={styles.lista}>{children}</ul>}
      {cuenta > TOPE_VISIBLE && <p className={styles.ayuda}>Y {cuenta - TOPE_VISIBLE} más.</p>}
    </details>
  );
}
