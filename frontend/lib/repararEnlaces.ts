/**
 * Reparar los `[[enlaces]]` entrantes cuando un archivo cambia de nombre o de
 * carpeta (`FUN-M-08`; desde `FUN-L-09` Parte 3, también al mover y con las
 * pistas de carpeta). Lo usan **las dos puertas**: el renombrado y el
 * movimiento de la app (`stores/vaultStore.ts`: explorador, título, arrastrar)
 * y las herramientas del MCP de control (`lib/mcpArchivos.ts`), así que una
 * nota renombrada por la IA queda igual que una renombrada a mano.
 *
 * El texto de cada nota lo reescribe `reescribirEnlacesMovidos`
 * (`lib/enlaces.ts`, puro y probado); acá solo se decide **a quién** se le
 * reescribe —las notas que ya enlazaban, según el índice— y se lee y escribe
 * por `api()`.
 */
import { api } from "@/lib/api";
import { reescribirEnlacesMovidos, type CambioDeRuta } from "@/lib/enlaces";

/** Qué pasó con los enlaces entrantes. Ids (rutas) después del cambio. */
export type Reparacion = {
  /** Las notas cuyo texto se reescribió. */
  reescritas: string[];
  /** Las que enlazaban pero no se pudieron leer o escribir: quedan con el enlace viejo. */
  fallidas: string[];
};

export const SIN_REPARACION: Reparacion = { reescritas: [], fallidas: [] };

/** Un archivo que se renombra o se mueve: su id antes y después, y el cambio. */
export type Movido = { id: string; idNuevo: string; cambio: CambioDeRuta };

/** Carpeta de un id-ruta (`""` en la raíz). */
export function carpetaDeRuta(id: string): string {
  const i = id.lastIndexOf("/");
  return i < 0 ? "" : id.slice(0, i);
}

/** Extensión de un id-ruta, con el punto (`".md"`), o `""`. */
export function extensionDeRuta(id: string): string {
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const p = nombre.lastIndexOf(".");
  return p <= 0 ? "" : nombre.slice(p);
}

/** Título de un id-ruta: el nombre sin la extensión. */
export function tituloDeRuta(id: string): string {
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const ext = extensionDeRuta(id);
  return ext ? nombre.slice(0, nombre.length - ext.length) : nombre;
}

/**
 * Quién enlaza a cada uno de `ids`, leído del índice **antes** del cambio:
 * después los enlaces ya no resuelven y el índice no los encuentra.
 * Devuelve nota que enlaza → archivos a los que enlaza. Si el índice no
 * contesta, vacío: el renombrado no depende de esto.
 */
export async function entrantesDe(
  ids: readonly string[],
  vaultId: string,
  token: string | null | undefined,
): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  if (ids.length === 0) return mapa;
  try {
    const { pares } = await api<{ pares: { desde: string; destino: string }[] }>(
      `/vaults/${encodeURIComponent(vaultId)}/retroenlaces`,
      { method: "POST", token, body: { ids: [...ids] } },
    );
    for (const { desde, destino } of pares) {
      if (!mapa.has(desde)) mapa.set(desde, new Set());
      mapa.get(desde)!.add(destino);
    }
  } catch {
    // Sin retroenlaces no se puede reparar, pero el cambio en sí no depende de esto.
  }
  return mapa;
}

/**
 * Reescribe los enlaces de las notas que enlazaban a algo de `movidos`.
 *
 * Con `simular` no escribe: lee con los ids de antes y cuenta a quién habría
 * que reescribir (es el **alcance** que decide si la IA pregunta). Sin
 * `simular`, el cambio ya ocurrió: una nota que enlazaba y también se movió
 * (dentro de una carpeta movida) se lee por su id nuevo.
 *
 * Si una nota falla se sigue con las demás —es preferible reparar nueve de
 * diez enlaces que abortar y dejar los diez rotos— y queda en `fallidas`.
 */
export async function repararEntrantes(
  entrantes: Map<string, Set<string>>,
  movidos: readonly Movido[],
  token: string | null | undefined,
  simular = false,
): Promise<Reparacion> {
  const porId = new Map(movidos.map((m) => [m.id, m]));
  const reescritas: string[] = [];
  const fallidas: string[] = [];
  for (const [desde, destinos] of entrantes) {
    const cambios = [...destinos].map((d) => porId.get(d)?.cambio).filter((c): c is CambioDeRuta => !!c);
    if (cambios.length === 0) continue;
    const id = simular ? desde : (porId.get(desde)?.idNuevo ?? desde);
    try {
      const actual = await api<{ contenido: string | null }>(`/notas/${encodeURIComponent(id)}/contenido`, { token });
      const { texto, cambios: n } = reescribirEnlacesMovidos(actual.contenido ?? "", cambios);
      if (n === 0) continue;
      if (!simular) {
        await api(`/notas/${encodeURIComponent(id)}/contenido`, { method: "PUT", token, body: { contenido: texto } });
      }
      reescritas.push(id);
    } catch {
      fallidas.push(id);
    }
  }
  return { reescritas, fallidas };
}

/** El cambio de un archivo que se renombra (misma carpeta). */
export function cambioRenombrar(id: string, tituloNuevo: string): CambioDeRuta {
  const carpeta = carpetaDeRuta(id);
  return {
    tituloViejo: tituloDeRuta(id),
    tituloNuevo,
    carpetaVieja: carpeta,
    carpetaNueva: carpeta,
    extension: extensionDeRuta(id),
  };
}

/**
 * Los archivos que cambian de ruta cuando la carpeta `prefijo` pasa a
 * `prefijoNuevo` (renombrar o mover una carpeta): cada nota del subárbol.
 */
export function movidosPorCarpeta(
  notas: readonly { id: string }[],
  prefijo: string,
  prefijoNuevo: string,
): Movido[] {
  const salida: Movido[] = [];
  for (const n of notas) {
    if (!n.id.startsWith(`${prefijo}/`)) continue;
    const idNuevo = prefijoNuevo + n.id.slice(prefijo.length);
    salida.push({
      id: n.id,
      idNuevo,
      cambio: {
        tituloViejo: tituloDeRuta(n.id),
        tituloNuevo: tituloDeRuta(n.id),
        carpetaVieja: carpetaDeRuta(n.id),
        carpetaNueva: carpetaDeRuta(idNuevo),
        extension: extensionDeRuta(n.id),
      },
    });
  }
  return salida;
}
