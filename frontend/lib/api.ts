/**
 * Dispatcher local de la app de escritorio (Tauri).
 *
 * ANTES: cliente HTTP contra el backend .NET (`fetch` a localhost:5279).
 * AHORA: enruta `(method, path)` a las funciones de la capa de datos
 * (`lib/db/*`), que consultan el índice SQLite del vault vía `tauri-plugin-sql`
 * y escriben en su carpeta. Los call-sites que usan `api<T>(path, {method, body,
 * token})` son los mismos que en web: la firma y `ApiError` se conservan.
 *
 * No hay usuarios, sesión ni login en desktop, y por eso tampoco rutas de
 * autenticación: la identidad es una constante (`authStore`), y la apariencia y los
 * snippets CSS se guardan directo en `.mycelium/` del vault, sin pasar por acá
 * (`FUN-L-24`). Las rutas no implementadas devuelven 501.
 */
import { buscar } from "@/lib/db/buscar";
import { crearCarpeta, renombrarCarpeta, moverCarpeta, borrarCarpeta } from "@/lib/db/carpetas";
import { getContenido, putContenido } from "@/lib/db/contenido";
import { DbError } from "@/lib/db/errors";
import { conexiones, grafo, retroenlaces } from "@/lib/db/grafo";
import { crearNota, renombrarNota, moverNota, duplicarNota } from "@/lib/db/notas";
import { borrarNota, borrarPermanente, listarPapelera, recuperarNota } from "@/lib/db/papelera";
import { clavesDelVault, notasConPropiedad, propiedadesDeNota } from "@/lib/db/propiedades";
import { notasParaTabla } from "@/lib/db/tabla";
import { tree } from "@/lib/db/tree";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /**
   * Ignorado en desktop: no hay sesión. Se acepta para que los componentes
   * compartidos con web (que sí lo mandan) no tengan que distinguir.
   */
  token?: string | null;
};

type Method = NonNullable<ApiOptions["method"]>;

/** Cuerpo como objeto indexable (los call-sites envían objetos JSON planos). */
type Body = Record<string, unknown>;

/** Normaliza un valor de body a `string | null` (para carpeta/destino/título…). */
const s = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

/**
 * Enruta la petición a la capa de datos. Devuelve la forma exacta que cada
 * call-site ya espera de `api()`.
 */
async function dispatch(
  method: Method,
  seg: string[],
  q: URLSearchParams,
  body: Body,
): Promise<unknown> {
  const [a, b, c, d] = seg;

  // ── /vaults/:vaultId/... ──────────────────────────────────────────────────
  if (a === "vaults" && b) {
    if (c === "tree" && method === "GET") return tree(b);
    if (c === "papelera" && method === "GET") return listarPapelera(b);
    if (c === "grafo" && method === "GET") return grafo(b);
    if (c === "retroenlaces" && method === "POST") {
      return retroenlaces(Array.isArray(body.ids) ? body.ids.map(String) : []);
    }
    if (c === "buscar" && method === "GET") {
      // `campo` (`FUN-M-20`) es opcional: una petición vieja o sin él busca en
      // los dos, que es lo que hacía antes de existir.
      const campo = q.get("campo");
      return buscar(
        b,
        q.get("q") ?? "",
        q.get("exacto") === "true",
        campo === "nombre" || campo === "contenido" ? campo : "ambos",
      );
    }
    // Propiedades del frontmatter (FUN-M-04): claves del vault (autocompletado
    // del panel) y notas que tienen una propiedad (base de `FUN-L-03`).
    if (c === "propiedades" && d === "claves" && method === "GET") return clavesDelVault(b);
    // Datos de una base (FUN-L-03): una fila por nota, con propiedades y
    // etiquetas. El filtrado NO baja acá: lo hace `lib/bases.ts`, compartido.
    if (c === "tabla" && !d && method === "GET") return notasParaTabla(b);
    if (c === "propiedades" && !d && method === "GET") {
      return notasConPropiedad(b, q.get("clave") ?? "", q.get("valor"));
    }
    if (c === "carpetas" && !d && method === "POST") {
      return crearCarpeta(b, s(body.padreId), String(body.nombre ?? ""));
    }
    if (c === "notas" && !d && method === "POST") {
      return crearNota(b, s(body.carpetaId), s(body.titulo), s(body.tipo));
    }
  }

  // ── /carpetas/:id/... ─────────────────────────────────────────────────────
  if (a === "carpetas" && b) {
    // Renombrar/mover cambia el id (=ruta): se devuelve el id NUEVO que calcula
    // el repo, y quien llamó remapea sus pestañas con él.
    if (!c && method === "PATCH") {
      return renombrarCarpeta(b, String(body.nombre ?? ""));
    }
    if (!c && method === "DELETE") {
      await borrarCarpeta(b);
      return { id: b };
    }
    if (c === "mover" && method === "POST") {
      return moverCarpeta(b, s(body.destinoId));
    }
  }

  // ── /notas/:id/... ────────────────────────────────────────────────────────
  if (a === "notas" && b) {
    // Renombrar/mover cambia el id (=ruta): se devuelve el id NUEVO que calcula
    // el repo, y quien llamó remapea sus pestañas con él.
    if (!c && method === "PATCH") {
      return renombrarNota(b, String(body.titulo ?? ""));
    }
    if (!c && method === "DELETE") {
      await borrarNota(b);
      return { id: b };
    }
    if (c === "mover" && method === "POST") {
      return moverNota(b, s(body.destinoId));
    }
    if (c === "duplicar" && method === "POST") return duplicarNota(b);
    if (c === "recuperar" && method === "POST") {
      await recuperarNota(b);
      return { id: b };
    }
    if (c === "permanente" && method === "DELETE") {
      await borrarPermanente(b);
      return { id: b };
    }
    if (c === "conexiones" && method === "GET") return conexiones(b);
    if (c === "propiedades" && method === "GET") return propiedadesDeNota(b);
    if (c === "contenido" && method === "GET") return getContenido(b);
    if (c === "contenido" && method === "PUT") return putContenido(b, s(body.contenido));
  }

  throw new DbError(501, `Ruta no implementada: ${method} /${seg.join("/")}`);
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET") as Method;
  const [rawPath, rawQuery] = path.split("?");
  // Los ids de nota/carpeta son RUTAS (contienen `/`): los call-sites los mandan
  // con encodeURIComponent, así que cada segmento se decodifica aquí para
  // recuperar el id real (p. ej. "Anime%2FBoku.md" → "Anime/Boku.md").
  const seg = rawPath.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const q = new URLSearchParams(rawQuery ?? "");
  const body = (options.body ?? {}) as Body;

  try {
    return (await dispatch(method, seg, q, body)) as T;
  } catch (err) {
    if (err instanceof DbError) throw new ApiError(err.status, err.message);
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : "Error desconocido";
    throw new ApiError(500, message);
  }
}
