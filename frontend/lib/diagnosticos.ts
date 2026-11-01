/**
 * Diagnósticos del editor (`FUN-M-44`, propuesta 3 de `ia-vaults-intensivos`):
 * los chequeos que ya existen —la salud de la nota (`FUN-L-30`) y sus
 * propiedades (`FUN-M-46`)— convertidos en marcas con **línea y columna**, como
 * las de un linter. Módulo **puro**: lo usan el editor (subrayado + mensaje al
 * pasar el mouse), la barra de estado («2 avisos») y `mycelium_diagnosticos`.
 * `scripts/test-diagnosticos.mjs` lo transpila e importa sin build.
 *
 * > [!important] Solo los chequeos incluidos
 * > La propuesta original pedía también **comandos** registrados en el vault que
 * > corrieran al guardar. Se descartó por seguridad: el vault viaja, y un
 * > comando guardado en él le daría a quien te pase un vault ejecución de código
 * > en tu PC. Ver `docs/features/ia-vaults-intensivos.md` § 3.
 *
 * Qué se marca:
 * - **Enlace roto** y **embed roto**: cada aparición del `[[…]]` / `![[…]]`, con
 *   la misma regla del índice (fuera del código, el destino sin alias).
 * - **Enlace ambiguo**: un enlace que duda entre notas homónimas.
 * - **Título duplicado**: la primera línea del cuerpo (la tarjeta de propiedades
 *   tapa el frontmatter en la vista en vivo).
 * - **Propiedades**: cada aviso de `lib/esquemas.ts`, en su línea.
 *
 * Las posiciones se calculan sobre el texto que se pasa (el del editor): las
 * líneas que trae el informe de salud son las del índice, y si el usuario
 * escribió algo después de guardar ya no coincidirían. Por eso los enlaces se
 * buscan en el texto, por su destino, y no por la línea del informe.
 */
import { textoDeAviso, type AvisoPropiedad } from "@/lib/esquemas";
import { separarFrontmatter } from "@/lib/frontmatter";
import { sinCodigo } from "@/lib/sinCodigo";
import { partirWikilink } from "@/lib/wikilinks";

/** De dónde sale una marca: sirve para el ícono, los tests y la IA. */
export type OrigenDiagnostico =
  | "enlace_roto"
  | "embed_roto"
  | "enlace_ambiguo"
  | "titulo_duplicado"
  | "propiedad";

export type Diagnostico = {
  origen: OrigenDiagnostico;
  /** Línea (desde 1) y columna (desde 1) donde empieza. */
  linea: number;
  columna: number;
  /** Offsets en el texto: `[desde, hasta)`. */
  desde: number;
  hasta: number;
  mensaje: string;
};

/** Un enlace con problema, como lo trae el informe de salud. */
type ProblemaEnlace = { desde: string; texto: string; tipo: string };

export type EntradaDiagnosticos = {
  notaId: string;
  texto: string;
  rotos: readonly ProblemaEnlace[];
  embedsRotos: readonly ProblemaEnlace[];
  duplicados: readonly { titulo: string; rutas: readonly string[]; ambiguos: readonly ProblemaEnlace[] }[];
  propiedades: readonly AvisoPropiedad[];
};

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/** Inicio (offset) de cada línea del texto. */
function iniciosDeLinea(texto: string): number[] {
  const inicios = [0];
  for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) === 10) inicios.push(i + 1);
  return inicios;
}

/** La línea (desde 1) de un offset, por búsqueda binaria. */
function lineaDe(inicios: readonly number[], offset: number): number {
  let lo = 0;
  let hi = inicios.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inicios[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** El rango de una línea sin la sangría ni el `\r` final (vacía: un carácter de ancho cero). */
function rangoDeLinea(texto: string, inicios: readonly number[], linea: number): { desde: number; hasta: number } {
  const n = Math.min(Math.max(linea, 1), inicios.length);
  const ini = inicios[n - 1];
  let fin = n < inicios.length ? inicios[n] - 1 : texto.length;
  if (fin > ini && texto[fin - 1] === "\r") fin--;
  let desde = ini;
  while (desde < fin && (texto[desde] === " " || texto[desde] === "\t")) desde++;
  return desde < fin ? { desde, hasta: fin } : { desde: ini, hasta: fin };
}

/**
 * Cada `[[…]]` / `![[…]]` del texto, fuera del código, con su destino y su
 * rango (el embed incluye el `!`). La misma regla que `ocurrenciasEnProsa`.
 */
export function enlacesConRango(texto: string): { tipo: "enlace" | "embed"; destino: string; desde: number; hasta: number }[] {
  const limpio = sinCodigo(texto);
  const fuera: { tipo: "enlace" | "embed"; destino: string; desde: number; hasta: number }[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  for (let m = re.exec(limpio); m !== null; m = re.exec(limpio)) {
    const esEmbed = m.index > 0 && limpio[m.index - 1] === "!";
    const destino = partirWikilink(m[1]).destino;
    if (destino === "") continue;
    fuera.push({
      tipo: esEmbed ? "embed" : "enlace",
      destino,
      desde: esEmbed ? m.index - 1 : m.index,
      hasta: m.index + m[0].length,
    });
  }
  return fuera;
}

/** Los diagnósticos de una nota, ordenados por posición y sin repetidos. */
export function diagnosticosDeNota(e: EntradaDiagnosticos): Diagnostico[] {
  const { texto, notaId } = e;
  const inicios = iniciosDeLinea(texto);
  const fuera: Diagnostico[] = [];
  const poner = (origen: OrigenDiagnostico, desde: number, hasta: number, mensaje: string) => {
    const linea = lineaDe(inicios, desde);
    fuera.push({ origen, linea, columna: desde - inicios[linea - 1] + 1, desde, hasta, mensaje });
  };

  // Enlaces: por clave `tipo + destino`, cada aparición en el texto.
  const mensajes = new Map<string, { origen: OrigenDiagnostico; mensaje: string }>();
  for (const p of e.rotos) {
    if (p.desde !== notaId) continue;
    mensajes.set(`enlace\u0000${p.texto}`, {
      origen: "enlace_roto",
      mensaje: `Enlace roto: no hay ninguna nota «${p.texto}». Corrige el nombre o crea la nota.`,
    });
  }
  for (const p of e.embedsRotos) {
    if (p.desde !== notaId) continue;
    mensajes.set(`embed\u0000${p.texto}`, {
      origen: "embed_roto",
      mensaje: `Embed roto: «${p.texto}» no está en el vault.`,
    });
  }
  for (const d of e.duplicados) {
    for (const a of d.ambiguos) {
      if (a.desde !== notaId) continue;
      const k = `${a.tipo === "embed" ? "embed" : "enlace"}\u0000${a.texto}`;
      if (mensajes.has(k)) continue;
      mensajes.set(k, {
        origen: "enlace_ambiguo",
        mensaje:
          `Enlace ambiguo: hay ${d.rutas.length} notas «${d.titulo}» (${d.rutas.join(", ")}) y va a la más cercana ` +
          `a la raíz. Escribe la carpeta para elegir una: [[Carpeta/${d.titulo}]].`,
      });
    }
  }
  if (mensajes.size > 0) {
    for (const o of enlacesConRango(texto)) {
      const m = mensajes.get(`${o.tipo}\u0000${o.destino}`);
      if (m) poner(m.origen, o.desde, o.hasta, m.mensaje);
    }
  }

  // Título duplicado: en la primera línea del cuerpo.
  const dup = e.duplicados.find((d) => d.rutas.includes(notaId));
  if (dup) {
    const fm = separarFrontmatter(texto);
    const linea = Math.min(fm.cuerpoDesde + 1, inicios.length);
    const r = rangoDeLinea(texto, inicios, linea);
    const otras = dup.rutas.filter((x) => x !== notaId);
    poner(
      "titulo_duplicado",
      r.desde,
      r.hasta,
      `Título duplicado: ${otras.length === 1 ? "otra nota se llama" : `otras ${otras.length} notas se llaman`} ` +
        `«${dup.titulo}» (${otras.join(", ")}). Los enlaces sin carpeta no saben a cuál ir.`,
    );
  }

  // Propiedades, en su línea.
  for (const a of e.propiedades) {
    const r = rangoDeLinea(texto, inicios, a.linea);
    poner("propiedad", r.desde, r.hasta, textoDeAviso(a));
  }

  const vistos = new Set<string>();
  return fuera
    .filter((d) => {
      const k = `${d.desde}\u0000${d.hasta}\u0000${d.mensaje}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => a.desde - b.desde || a.hasta - b.hasta);
}

/** «Sin avisos», «1 aviso», «3 avisos». */
export function resumenDiagnosticos(n: number): string {
  return n === 0 ? "Sin avisos" : n === 1 ? "1 aviso" : `${n} avisos`;
}

/** Lo que ve la IA de un diagnóstico: sin offsets, con línea y columna. */
export function diagnosticoParaIa(d: Diagnostico): { linea: number; columna: number; origen: OrigenDiagnostico; mensaje: string } {
  return { linea: d.linea, columna: d.columna, origen: d.origen, mensaje: d.mensaje };
}
