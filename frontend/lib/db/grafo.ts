/**
 * Grafo de wikilinks del vault (HU-30): grafo global y conexiones de una nota.
 * Portado de `SearchEndpoints.BuildVaultGraphAsync/ContarConexiones/FragmentAround`.
 *
 * Diferencia con el backend: en vez de leer N blobs en paralelo, se cargan todos
 * los contenidos del vault en UNA sola query (SQLite local, sin round-trips).
 */
import { referenciasDe } from "@/lib/canvas";
import { etiquetasDe } from "@/lib/frontmatter";
import { destinoDeWikilink } from "@/lib/wikilinks";
import { select } from "./client";
import { DbError } from "./errors";

// Los WIKILINKS se buscan sobre el texto COMPLETO a propósito: un `[[enlace]]`
// dentro de una propiedad del frontmatter cuenta como enlace saliente, que es el
// comportamiento actual y el correcto (FUN-M-04).
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

export type GraphNodeDto = {
  id: string;
  titulo: string;
  conexiones: number;
  tags?: string[];
  creadoEn?: string;
};
export type GraphEdgeDto = { source: string; target: string };
export type GraphDataDto = { nodos: GraphNodeDto[]; aristas: GraphEdgeDto[] };

type Arista = { from: string; to: string };
type VaultGraph = {
  aristas: Arista[];
  titulosPorId: Map<string, string>;
  contenidos: Map<string, string>;
  creadoPorId: Map<string, string>;
};

/** Escanea todas las notas (no en papelera) y arma el grafo de wikilinks. */
async function buildVaultGraph(vaultId: string): Promise<VaultGraph> {
  const filas = await select<{
    id: string;
    titulo: string;
    creado_en: string;
    tipo: string;
    contenido: string | null;
  }>(
    `SELECT n.id, n.titulo, n.creado_en, n.tipo, c.contenido
     FROM notas n LEFT JOIN contenidos c ON c.nota_id = n.id
     WHERE n.vault_id = ? AND n.id NOT IN (SELECT nota_id FROM papelera)`,
    [vaultId],
  );

  // Título → primera nota con ese título (case-insensitive), para resolver enlaces.
  const porTitulo = new Map<string, string>();
  const titulosPorId = new Map<string, string>();
  const contenidos = new Map<string, string>();
  /** Canvas por id: su contenido se interpreta aparte, no como prosa. */
  const canvasPorId = new Map<string, string>();
  const creadoPorId = new Map<string, string>();
  for (const f of filas) {
    const key = f.titulo.toLowerCase();
    if (!porTitulo.has(key)) porTitulo.set(key, f.id);
    titulosPorId.set(f.id, f.titulo);
    creadoPorId.set(f.id, f.creado_en);
    // Una base (`FUN-L-03`) SÍ es un destino válido —`[[Mi base]]` navega y
    // aparece como nodo— pero su contenido NO se escanea: es la definición de una
    // consulta, no prosa, y un `[[…]]` dentro de un valor del YAML crearía una
    // arista fantasma. Es el mismo efecto colateral que ya arrastra Excalidraw y
    // que nadie diseñó (ver docs/features/canvas.md).
    if (f.contenido && f.tipo !== "base" && f.tipo !== "canvas") {
      contenidos.set(f.id, f.contenido);
    }
    // Un canvas (`FUN-L-18`) tampoco se escanea como prosa: es JSON, y buscarle
    // wikilinks a la cadena cruda encontraría también los de las rutas y los
    // escapes. Sus referencias se leen entendiendo el formato (ver abajo).
    if (f.contenido && f.tipo === "canvas") canvasPorId.set(f.id, f.contenido);
  }

  const vistas = new Set<string>();
  const aristas: Arista[] = [];
  const agregar = (desde: string, hasta: string) => {
    if (hasta === desde) return;
    const clave = `${desde}${hasta}`;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    aristas.push({ from: desde, to: hasta });
  };

  // Qué aporta un canvas al grafo (spec § 5): los `[[enlaces]]` de sus tarjetas
  // de texto y las tarjetas de nota, que son una referencia explícita como un
  // embed. Las FLECHAS no: son disposición visual, y así una arista del grafo se
  // crea de una sola manera y no hay que resolver qué pasa si una flecha y un
  // enlace se contradicen.
  for (const [notaId, json] of canvasPorId) {
    const { titulos, rutas } = referenciasDe(json);
    for (const t of titulos) {
      const destinoId = porTitulo.get(t.toLowerCase());
      if (destinoId) agregar(notaId, destinoId);
    }
    // La tarjeta guarda una RUTA, y en desktop el id de una nota ES su ruta.
    for (const r of rutas) if (titulosPorId.has(r)) agregar(notaId, r);
  }
  for (const [notaId, contenido] of contenidos) {
    for (let m = WIKILINK_RE.exec(contenido); m !== null; m = WIKILINK_RE.exec(contenido)) {
      // [[destino|alias]] y [[Carpeta/destino]] → apunta al título (antes del `|`,
      // último segmento de la ruta). La barra puede venir escapada si el enlace
      // está dentro de una tabla (`DEF-045`), y ahí también es un alias.
      const destino = destinoDeWikilink(m[1]);
      const destinoId = porTitulo.get(destino.toLowerCase());
      if (destinoId && destinoId !== notaId) {
        const clave = `${notaId}\u0000${destinoId}`;
        if (!vistas.has(clave)) {
          vistas.add(clave);
          aristas.push({ from: notaId, to: destinoId });
        }
      }
    }
  }

  return { aristas, titulosPorId, contenidos, creadoPorId };
}

/** Grado total (entrante + saliente) por nodo (HU-30 CA3). */
function contarConexiones(aristas: Arista[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const { from, to } of aristas) {
    conteo.set(from, (conteo.get(from) ?? 0) + 1);
    conteo.set(to, (conteo.get(to) ?? 0) + 1);
  }
  return conteo;
}

/** Fragmento de contexto alrededor del [[enlace]] (HU-30 CA7). */
function fragmentAround(contenido: string, titulo: string): string {
  const index = contenido.toLowerCase().indexOf(`[[${titulo.toLowerCase()}`);
  if (index < 0) return "";
  const start = Math.max(0, index - 40);
  const end = Math.min(contenido.length, index + titulo.length + 44);
  const fragment = contenido.slice(start, end).replace(/\n/g, " ").trim();
  return (start > 0 ? "…" : "") + fragment + (end < contenido.length ? "…" : "");
}

/** `GET /vaults/{id}/grafo`. */
export async function grafo(vaultId: string): Promise<GraphDataDto> {
  const { aristas, titulosPorId, contenidos, creadoPorId } = await buildVaultGraph(vaultId);
  const conexionesTotales = contarConexiones(aristas);

  const nodos: GraphNodeDto[] = [];
  for (const [id, titulo] of titulosPorId) {
    const contenido = contenidos.get(id);
    nodos.push({
      id,
      titulo,
      conexiones: conexionesTotales.get(id) ?? 0,
      // Etiquetas = las de `tags:` del frontmatter MÁS los `#tag` del cuerpo
      // (FUN-M-04): los grupos de color por etiqueta ven las dos fuentes.
      tags: contenido ? etiquetasDe(contenido) : [],
      creadoEn: creadoPorId.get(id),
    });
  }
  return { nodos, aristas: aristas.map((a) => ({ source: a.from, target: a.to })) };
}

/** `GET /notas/{id}/conexiones` — salientes, retroenlaces y mini-grafo de 1 salto. */
export async function conexiones(notaId: string): Promise<unknown> {
  const nota = await select<{
    id: string;
    vault_id: string;
    titulo: string;
    carpeta_id: string | null;
    creado_en: string;
    actualizado_en: string;
    tamano_bytes: number;
  }>(
    "SELECT id, vault_id, titulo, carpeta_id, creado_en, actualizado_en, tamano_bytes FROM notas WHERE id = ?",
    [notaId],
  );
  if (nota.length === 0) throw new DbError(404, "La nota no existe.");
  const n = nota[0];

  const { aristas, titulosPorId, contenidos } = await buildVaultGraph(n.vault_id);
  const conexionesTotales = contarConexiones(aristas);

  const salientes = aristas
    .filter((a) => a.from === notaId)
    .map((a) => ({ id: a.to, titulo: titulosPorId.get(a.to) ?? "?" }));

  const retro = aristas
    .filter((a) => a.to === notaId)
    .map((a) => ({
      id: a.from,
      titulo: titulosPorId.get(a.from) ?? "?",
      fragmento: fragmentAround(contenidos.get(a.from) ?? "", n.titulo),
    }));

  const vecinos = [...new Set([...salientes.map((s) => s.id), ...retro.map((r) => r.id)])];
  const nodos = [notaId, ...vecinos].map((id) => ({
    id,
    titulo: titulosPorId.get(id) ?? "?",
    conexiones: conexionesTotales.get(id) ?? 0,
  }));
  const aristasVecinas = aristas
    .filter((a) => a.from === notaId || a.to === notaId)
    .map((a) => ({ source: a.from, target: a.to }));

  return {
    nota: {
      id: n.id,
      titulo: n.titulo,
      carpetaId: n.carpeta_id,
      creadoEn: n.creado_en,
      actualizadoEn: n.actualizado_en,
      tamanoBytes: n.tamano_bytes,
    },
    salientes,
    retro,
    grafo: { nodos, aristas: aristasVecinas },
  };
}
