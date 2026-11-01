"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { setPendingMatch } from "@/lib/editor/pendingMatch";
import { EVENTO_NOTA_GUARDADA, EVENTO_RECARGA } from "@/lib/eventos";
import { conteos, type Duplicado, type NotaRef, type Problema } from "@/lib/salud";
import { avisar } from "@/stores/avisosStore";
import { useSaludStore } from "@/stores/saludStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./SaludPanel.module.css";

/** Cuántos ítems dibuja cada sección; el resto se cuenta. */
const TOPE_VISIBLE = 200;

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
  const router = useRouter();
  const informe = useSaludStore((s) => s.informe);
  const cargando = useSaludStore((s) => s.cargando);
  const error = useSaludStore((s) => s.error);
  const calculadoEn = useSaludStore((s) => s.calculadoEn);
  const vaultId = useVaultStore((s) => s.vaultId);
  const notas = useVaultStore((s) => s.notas);

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
    // El árbol: crear, renombrar, mover o borrar cambian destinos y backlinks.
    const desuscribir = useVaultStore.subscribe((s, previo) => {
      if (s.notas !== previo.notas || s.carpetas !== previo.carpetas) pedir();
    });
    return () => {
      window.removeEventListener(EVENTO_NOTA_GUARDADA, pedir);
      window.removeEventListener(EVENTO_RECARGA, pedir);
      desuscribir();
    };
  }, [vaultId]);

  const titulos = useMemo(() => new Map(notas.map((n) => [n.id, n.titulo])), [notas]);
  const c = informe ? conteos(informe) : null;

  const ir = (id: string, linea?: number) => {
    if (!useVaultStore.getState().notas.some((n) => n.id === id)) {
      avisar(`«${id}» ya no existe (puede haberse renombrado o borrado). Actualiza el panel.`);
      return;
    }
    if (linea !== undefined) setPendingMatch(id, { linea });
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
    if (linea !== undefined) {
      window.dispatchEvent(new CustomEvent("micelio:goto-match", { detail: { notaId: id, linea } }));
    }
  };

  const titulo = (id: string) => titulos.get(id) ?? id.slice(id.lastIndexOf("/") + 1);

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

type Ir = (id: string, linea?: number) => void;

const escrito = (p: Problema) => `${p.tipo === "embed" ? "!" : ""}[[${p.texto}]]`;

function ItemProblema({ p, tituloDesde, ir }: { p: Problema; tituloDesde: string; ir: Ir }) {
  const linea = p.lineas[0];
  return (
    <li>
      <button type="button" className={styles.item} onClick={() => ir(p.desde, linea)} title={`Abrir ${p.desde}`}>
        <span className={styles.itemTitulo}>{tituloDesde}</span>
        <span className={styles.itemDetalle}>
          <code className={styles.codigo}>{escrito(p)}</code>
          {p.lineas.length > 0 && ` · ${p.lineas.length === 1 ? "línea" : "líneas"} ${p.lineas.join(", ")}`}
          {p.tipo === "canvas" && " · en una tarjeta del lienzo"}
        </span>
      </button>
    </li>
  );
}

function ItemDuplicado({ d, titulo, ir }: { d: Duplicado; titulo: (id: string) => string; ir: Ir }) {
  return (
    <li className={styles.grupo}>
      <p className={styles.grupoTitulo}>
        «{d.titulo}» · {d.rutas.length} notas
        {d.ambiguos.length > 0 && ` · ${d.ambiguos.length} ${d.ambiguos.length === 1 ? "enlace ambiguo" : "enlaces ambiguos"}`}
      </p>
      <ul className={styles.lista}>
        {d.rutas.map((r) => (
          <li key={r}>
            <button type="button" className={styles.item} onClick={() => ir(r)} title={`Abrir ${r}`}>
              <span className={styles.itemDetalle}>{r}</span>
            </button>
          </li>
        ))}
        {d.ambiguos.map((p, i) => (
          <ItemProblema key={`${p.desde}-${p.texto}-${i}`} p={p} tituloDesde={`Ambiguo en ${titulo(p.desde)}`} ir={ir} />
        ))}
      </ul>
    </li>
  );
}

function ItemNota({ n, ir }: { n: NotaRef; ir: Ir }) {
  return (
    <li>
      <button type="button" className={styles.item} onClick={() => ir(n.ruta)} title={`Abrir ${n.ruta}`}>
        <span className={styles.itemTitulo}>{n.titulo}</span>
        {n.ruta.includes("/") && <span className={styles.itemDetalle}>{n.ruta}</span>}
      </button>
    </li>
  );
}
