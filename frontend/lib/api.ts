/**
 * Dispatcher local de la app de escritorio (Tauri).
 *
 * ANTES: cliente HTTP contra el backend .NET (`fetch` a localhost:5279).
 * AHORA: enruta `(method, path)` a las funciones de la capa de datos
 * (`lib/db/*`), que consultan SQLite nativo vía `tauri-plugin-sql`. Los ~53
 * call-sites que usan `api<T>(path, {method, body, token})` NO cambian: la firma
 * y `ApiError` se conservan. El `token` se ignora (sesión local, sin JWT).
 *
 * No hay usuarios ni login en desktop: `/auth/refresh` y `/auth/me` devuelven
 * la sesión fija del vault local. Las rutas no implementadas devuelven 501.
 */
import { me, session } from "@/lib/db/auth";
import { buscar } from "@/lib/db/buscar";
import { crearCarpeta, renombrarCarpeta, moverCarpeta, borrarCarpeta } from "@/lib/db/carpetas";
import { getContenido, putContenido } from "@/lib/db/contenido";
import { getDiagrama, putDiagrama } from "@/lib/db/diagramas";
import { DbError } from "@/lib/db/errors";
import { conexiones, grafo } from "@/lib/db/grafo";
import { crearNota, renombrarNota, moverNota, duplicarNota } from "@/lib/db/notas";
import { borrarNota, borrarPermanente, listarPapelera, recuperarNota } from "@/lib/db/papelera";
import { putPreferencias } from "@/lib/db/preferencias";
import { compartido, miembros, noop } from "@/lib/db/sharing";
import { actualizarSnippet, borrarSnippet, crearSnippet, listarSnippets } from "@/lib/db/snippets";
import { carpetasCompartidas, tree } from "@/lib/db/tree";

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
  const [a, b, c, d, e] = seg;

  // ── /auth/... (sesión local, preferencias, css) ───────────────────────────
  if (a === "auth") {
    if (b === "refresh" && method === "POST") return session();
    if (b === "me" && method === "GET") return me();
    if (b === "preferencias" && method === "PUT") {
      return putPreferencias(s(body.tema), Boolean(body.modoOscuro), body.preferencias);
    }
    // /auth/css/snippets[/:id]
    if (b === "css" && c === "snippets") {
      if (!d && method === "GET") return listarSnippets();
      if (!d && method === "POST") {
        return crearSnippet(String(body.nombre ?? ""), String(body.contenido ?? ""));
      }
      if (d && method === "PATCH") {
        return actualizarSnippet(d, {
          nombre: body.nombre === undefined ? undefined : String(body.nombre),
          contenido: body.contenido === undefined ? undefined : String(body.contenido),
          activo: body.activo === undefined ? undefined : Boolean(body.activo),
        });
      }
      if (d && method === "DELETE") return borrarSnippet(d);
    }
  }

  // ── /compartido (sharing latente) ─────────────────────────────────────────
  if (a === "compartido" && method === "GET") return compartido();

  // ── /vaults/:vaultId/... ──────────────────────────────────────────────────
  if (a === "vaults" && b) {
    if (c === "tree" && method === "GET") return tree(b);
    if (c === "carpetas-compartidas" && method === "GET") return carpetasCompartidas(b);
    if (c === "papelera" && method === "GET") return listarPapelera(b);
    if (c === "grafo" && method === "GET") return grafo(b);
    if (c === "buscar" && method === "GET") {
      return buscar(b, q.get("q") ?? "", q.get("exacto") === "true");
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
    if (!c && method === "PATCH") {
      await renombrarCarpeta(b, String(body.nombre ?? ""));
      return { id: b };
    }
    if (!c && method === "DELETE") {
      await borrarCarpeta(b);
      return { id: b };
    }
    if (c === "mover" && method === "POST") {
      await moverCarpeta(b, s(body.destinoId));
      return { id: b };
    }
    // Sharing latente (no-op): miembros / compartir
    if (c === "miembros" && !d && method === "GET") return miembros();
    if (c === "compartir" && method === "POST") return noop();
    if (c === "miembros" && e && (method === "PATCH" || method === "DELETE")) return noop();
  }

  // ── /notas/:id/... ────────────────────────────────────────────────────────
  if (a === "notas" && b) {
    if (!c && method === "PATCH") {
      await renombrarNota(b, String(body.titulo ?? ""));
      return { id: b };
    }
    if (!c && method === "DELETE") {
      await borrarNota(b);
      return { id: b };
    }
    if (c === "mover" && method === "POST") {
      await moverNota(b, s(body.destinoId));
      return { id: b };
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
    // Colaboración deshabilitada en local: sin relay. Se devuelve un objeto con
    // `habilitada:false` (NO null) para que startCollab caiga con gracia.
    if (c === "colaboracion" && method === "GET") return { habilitada: false };
    if (c === "contenido" && method === "GET") return getContenido(b);
    if (c === "contenido" && method === "PUT") return putContenido(b, s(body.contenido));
    // /notas/:notaId/diagramas/:diagId
    if (c === "diagramas" && d) {
      if (method === "GET") return getDiagrama(b, d);
      if (method === "PUT") return putDiagrama(b, d, String(body.contenido ?? body.json ?? ""));
    }
  }

  throw new DbError(501, `Ruta no implementada: ${method} /${seg.join("/")}`);
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET") as Method;
  const [rawPath, rawQuery] = path.split("?");
  const seg = rawPath.split("/").filter(Boolean);
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
