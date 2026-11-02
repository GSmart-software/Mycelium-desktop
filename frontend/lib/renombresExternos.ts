/**
 * Ofrecer reparar los enlaces de un renombre hecho **por fuera** de Mycelium
 * (`FUN-M-47`, solo-desktop). La decisión de si un par borrado/creación es un
 * renombre es pura y vive en `lib/renombreExterno.ts`; acá está la E/S.
 *
 * Va en dos tiempos, alrededor del indexado del watcher (`lib/vaultWatch.ts`):
 *
 * 1. **Antes de indexar** (`prepararRenombres`): el índice todavía tiene la
 *    nota que se fue —su texto y quién la enlaza—, y después ya no. Se mira solo
 *    si en la ráfaga hay a la vez una nota indexada que desapareció y una nota
 *    nueva que el índice no conoce: es el caso de un `mv`. Los renombres de la
 *    app no entran: cuando llega el aviso, el índice ya los tiene con el nombre
 *    nuevo (y por si acaso, `esMovimientoPropio`). Lo que va a la papelera
 *    tampoco: su fila sigue, pero está en `papelera`.
 * 2. **Después de indexar** (`ofrecerRenombres`): un aviso por renombre, con la
 *    cantidad real de enlaces que apuntaban a la nota de antes. «Reparar»
 *    reescribe esos enlaces con el MISMO código que renombrar
 *    (`repararTrasOperacion`, homónimos incluidos); «Reparar y guardar alias»
 *    además deja el nombre anterior en `aliases`. Queda en el registro de
 *    actividad con Deshacer. Ignorar no hace nada.
 */
import { select } from "@/lib/db/client";
import { enTandas, marcadores } from "@/lib/db/ftsIndice";
import { esMovimientoPropio } from "@/lib/db/vaultFs";
import type { CambioVault } from "@/lib/arbolVivo";
import { EVENTO_RECARGA } from "@/lib/eventos";
import type { NotaRuta } from "@/lib/homonimos";
import { detectarRenombres, textoOferta, type NotaConTexto } from "@/lib/renombreExterno";
import {
  alternarAliasDeNota,
  carpetaDeRuta,
  extensionDeRuta,
  leerPrevia,
  repararTrasOperacion,
  tituloDeRuta,
  type Previa,
} from "@/lib/repararEnlaces";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { useAuthStore } from "@/stores/authStore";
import { avisar, avisarFallo } from "@/stores/avisosStore";
import { useGraphStore } from "@/stores/graphStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Un renombre detectado, listo para ofrecer: lo leído del índice ANTES de indexar. */
export type OfertaRenombre = {
  de: { id: string; titulo: string };
  a: { id: string; titulo: string };
  /** Quién enlazaba a la nota de antes, y el vault de antes (`leerPrevia`). */
  previa: Previa;
  /** Cuántos enlaces (sumando repeticiones) y desde cuántas notas. */
  enlaces: number;
  notas: number;
};

/** Cuánto queda a la vista el aviso: pregunta algo, no solo cuenta. */
const DURACION_AVISO_MS = 30_000;

const token = () => useAuthStore.getState().accessToken;

/**
 * El paso 1: con la ráfaga que el watcher está por indexar, los renombres que
 * parece haber. Vacío casi siempre, y barato en ese caso: si la ráfaga no
 * tiene a la vez algo que se fue y una nota que llegó, no consulta nada.
 */
export async function prepararRenombres(vaultRuta: string, cambios: readonly CambioVault[]): Promise<OfertaRenombre[]> {
  const idas = cambios.filter((c) => c.estado === "ausente" && !esMovimientoPropio(c.ruta)).map((c) => c.ruta);
  const llegadas = cambios.filter((c) => c.estado === "nota" && !esMovimientoPropio(c.ruta)).map((c) => c.ruta);
  if (idas.length === 0 || llegadas.length === 0) return [];

  // Las que se fueron y el índice tiene como notas vivas, con su texto.
  const viejas: (NotaConTexto & { tipo: string })[] = [];
  for (const tanda of enTandas(idas)) {
    viejas.push(
      ...(await select<NotaConTexto & { tipo: string }>(
        `SELECT n.id AS id, n.titulo AS titulo, n.tipo AS tipo, c.contenido AS contenido
           FROM notas n JOIN contenidos c ON c.nota_id = n.id
          WHERE n.id IN (${marcadores(tanda.length)})
            AND n.id NOT IN (SELECT nota_id FROM papelera)`,
        tanda,
      )),
    );
  }
  if (viejas.length === 0) return [];

  // Las que llegaron y el índice todavía no conoce.
  const conocidas = new Set<string>();
  for (const tanda of enTandas(llegadas)) {
    const filas = await select<{ id: string }>(`SELECT id FROM notas WHERE id IN (${marcadores(tanda.length)})`, tanda);
    for (const f of filas) conocidas.add(f.id);
  }
  const nuevas = llegadas.filter((r) => !conocidas.has(r));
  if (nuevas.length === 0) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const leidas = await invoke<{ ruta_relativa: string; contenido: string }[]>("leer_archivos", {
    origen: vaultRuta,
    rutas: nuevas,
  });
  const pares = detectarRenombres(
    viejas,
    leidas.map((l) => ({ id: l.ruta_relativa, titulo: tituloDeRuta(l.ruta_relativa), contenido: l.contenido })),
  );
  if (pares.length === 0) return [];

  const { vaultId, notas } = useVaultStore.getState();
  if (vaultId === null) return [];
  const ofertas: OfertaRenombre[] = [];
  for (const par of pares) {
    const vieja = viejas.find((v) => v.id === par.de.id)!;
    // El vault de ANTES: el árbol ya muestra la nota nueva y no la vieja
    // (el watcher lo actualiza al llegar el aviso, `FUN-M-42`).
    const antes: NotaRuta[] = [
      ...notas.filter((n) => n.id !== par.a.id && n.id !== par.de.id).map((n) => ({ id: n.id, titulo: n.titulo, tipo: n.tipo, aliases: n.aliases })),
      { id: vieja.id, titulo: vieja.titulo, tipo: vieja.tipo },
    ];
    const previa = await leerPrevia(antes, [par.de.id], [par.a.titulo], vaultId, token());
    const [cuenta] = await select<{ enlaces: number | null; notas: number }>(
      `SELECT SUM(n) AS enlaces, COUNT(DISTINCT desde_id) AS notas FROM enlaces
        WHERE destino_id = ? AND desde_id <> ?`,
      [par.de.id, par.de.id],
    );
    const enlaces = Number(cuenta?.enlaces ?? 0);
    if (enlaces === 0) continue; // nada que reparar: no se pregunta
    ofertas.push({
      de: { id: par.de.id, titulo: par.de.titulo },
      a: { id: par.a.id, titulo: par.a.titulo },
      previa,
      enlaces,
      notas: Number(cuenta?.notas ?? 0),
    });
  }
  return ofertas;
}

/** El paso 2: un aviso por renombre, con las dos formas de aceptar. */
export function ofrecerRenombres(ofertas: readonly OfertaRenombre[]): void {
  for (const o of ofertas) {
    const md = extensionDeRuta(o.a.id).toLowerCase() === ".md";
    avisar(
      textoOferta(o.de.titulo, o.a.titulo, o.enlaces, o.notas),
      { etiqueta: "Reparar", hacer: () => repararRenombre(o, false).catch(avisarFallo("reparar los enlaces")) },
      {
        duracionMs: DURACION_AVISO_MS,
        ...(md
          ? {
              secundaria: {
                etiqueta: "Reparar y guardar alias",
                hacer: () => repararRenombre(o, true).catch(avisarFallo("reparar los enlaces")),
              },
            }
          : {}),
      },
    );
  }
}

/**
 * Acepta una oferta: reescribe los enlaces que apuntaban a la nota de antes
 * con el código de renombrar, y opcionalmente guarda el nombre anterior como
 * alias. Lo anota en el registro de actividad, con Deshacer.
 */
export async function repararRenombre(o: OfertaRenombre, conAlias: boolean): Promise<void> {
  const cambio = {
    tituloViejo: o.de.titulo,
    tituloNuevo: o.a.titulo,
    carpetaVieja: carpetaDeRuta(o.de.id),
    carpetaNueva: carpetaDeRuta(o.a.id),
    extension: extensionDeRuta(o.de.id),
  };
  const r = await repararTrasOperacion(o.previa, [{ id: o.de.id, idNuevo: o.a.id, cambio }], [], token());
  let alias = false;
  if (conAlias) {
    alias = await alternarAliasDeNota(o.a.id, o.de.titulo, token()).catch(() => false);
  }
  if (r.reescritas.length > 0) window.dispatchEvent(new Event(EVENTO_RECARGA));
  useGraphStore.getState().markStale();
  const { vaultId } = useVaultStore.getState();
  // Con las vistas en vivo aunque el árbol no cambie (`FUN-M-58`): se
  // reescribió el contenido de otras notas, que pueden estar embebidas.
  if (vaultId) await useVaultStore.getState().loadTree(vaultId, { refrescarVistas: true });

  const cuantas = r.reescritas.length === 1 ? "1 nota" : `${r.reescritas.length} notas`;
  const fallo = r.fallidas.length > 0 ? ` No se pudieron reescribir ${r.fallidas.length}: ${r.fallidas.join(", ")}.` : "";
  const conAliasTexto = conAlias
    ? alias
      ? ` «${o.de.titulo}» quedó como alias.`
      : ` «${o.de.titulo}» no se pudo guardar como alias.`
    : "";
  const efecto = `Se repararon los enlaces a «${o.de.titulo}», renombrada a «${o.a.titulo}» fuera de Mycelium: se reescribieron en ${cuantas}.${fallo}${conAliasTexto}`;
  useActividadIaStore.getState().registrar({
    op: "reparar_renombre",
    resultado: "hecho",
    efecto,
    objetivo: { tipo: "nota", ruta: o.a.id },
    deshacer: {
      tipo: "archivo_reparar_renombre",
      ruta: o.a.id,
      rutaAntes: o.de.id,
      notas: r.reescritas,
      ...(alias ? { alias: o.de.titulo } : {}),
    },
  });
  avisar(efecto);
}
