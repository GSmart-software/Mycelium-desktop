/**
 * El informe de salud del vault como nota Markdown (`FUN-L-32`, parte E).
 *
 * Arma el texto de `Informes/Salud del vault AAAA-MM-DD.md` a partir de UNA
 * revisión (`revisarVault`, `lib/estadisticasVault.ts`): propiedades, callouts
 * con los problemas y `[[enlaces]]` a las notas afectadas, y las gráficas como
 * bloques ` ```mermaid ` que Mycelium dibuja con los colores del tema activo
 * (`lib/mermaidTema.ts`). Es Markdown que también lee Obsidian.
 *
 * Módulo **puro** y sin imports de valor —solo tipos y las constantes de dos
 * módulos que tampoco importan nada—: `scripts/test-informe-salud.mjs` lo
 * transpila sin build. Quien lo escribe en el vault y lo abre es
 * `lib/informeSaludVault.ts`.
 *
 * > [!important] La torta declara SIEMPRE las cinco porciones, en `ORDEN_TORTA`
 * > Mermaid 11 no ordena las porciones y colorea `pie1`…`pie5` por orden de
 * > declaración. Si falta una (porque vale 0), las que siguen toman el color de
 * > otro grupo. Por eso van las cinco, en el orden de la paleta, también las
 * > que valen 0 (ver `ColoresGraficas.torta` en `lib/mermaidTema.ts`).
 */
import { MESES_CRECIMIENTO, NOMBRE_GRUPO, type GrupoArchivo } from "@/lib/estadisticas";
import { ORDEN_TORTA } from "@/lib/paletaGraficas";
import type { RevisionVault } from "@/lib/estadisticasVault";
import type { InformeSalud, Problema } from "@/lib/salud";

// ── Formato de números (es-AR, como el resto de la app) ─────────────────────

// `useGrouping: "always"`: sin él, CLDR no agrupa los números de cuatro cifras
// en español («1642» en vez de «1.642»).
const ENTERO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0, useGrouping: "always" } as Intl.NumberFormatOptions);
const UN_DECIMAL = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: "always",
} as Intl.NumberFormatOptions);

export const entero = (n: number): string => ENTERO.format(n);

/** Un porcentaje: sin decimales desde 10, con uno por debajo («54 %», «0,4 %»). */
export function porcentaje(parte: number, total: number): string {
  if (total <= 0 || parte <= 0) return "0 %";
  const p = (parte / total) * 100;
  // Algo que hay no se muestra como «0,0 %»: parecería que no hay nada.
  if (p < 0.05) return "<0,1 %";
  return `${p >= 10 ? ENTERO.format(p) : UN_DECIMAL.format(p)} %`;
}

/** «el 54 %», o «menos del 0,1 %» para lo que casi no pesa: para las frases. */
export function elPorcentaje(parte: number, total: number): string {
  const p = porcentaje(parte, total);
  return p === "<0,1 %" ? "menos del 0,1 %" : `el ${p}`;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** Un peso legible: «512 B», «922 KB», «6,2 MB», «312 MB», «1,4 GB». */
export function pesoLegible(bytes: number): string {
  if (bytes < KB) return `${ENTERO.format(bytes)} B`;
  const [valor, unidad] = bytes >= GB ? [bytes / GB, "GB"] : bytes >= MB ? [bytes / MB, "MB"] : [bytes / KB, "KB"];
  return `${valor >= 10 ? ENTERO.format(valor) : UN_DECIMAL.format(valor)} ${unidad}`;
}

const plural = (n: number, singular: string, pluralTexto: string) => `${entero(n)} ${n === 1 ? singular : pluralTexto}`;

// ── Fechas ──────────────────────────────────────────────────────────────────

const dos = (n: number) => String(n).padStart(2, "0");
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** `AAAA-MM-DD`, hora local: la fecha del nombre del archivo. */
export const fechaArchivo = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
/** `HHmm`, hora local: lo que se agrega al nombre si el del día ya existe. */
export const horaArchivo = (d: Date) => `${dos(d.getHours())}${dos(d.getMinutes())}`;
/** `AAAA-MM-DDTHH:mm`, hora local: el formato «fecha y hora» de las propiedades. */
const fechaHoraPropiedad = (d: Date) => `${fechaArchivo(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
const fechaLarga = (d: Date) =>
  `${d.getDate()} de ${MESES_LARGOS[d.getMonth()]} de ${d.getFullYear()} a las ${dos(d.getHours())}:${dos(d.getMinutes())}`;

/** El nombre de la nota del informe (sin extensión). */
export function tituloInforme(fecha: Date, conHora = false): string {
  return `Salud del vault ${fechaArchivo(fecha)}${conHora ? ` ${horaArchivo(fecha)}` : ""}`;
}

// ── Escapes ─────────────────────────────────────────────────────────────────

/** Texto dentro de una celda de tabla: el `|` cortaría la celda. */
export const celda = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Un fragmento como código en línea, aunque traiga comillas invertidas. */
export function codigo(s: string): string {
  const texto = s.replace(/\r?\n/g, " ");
  let valla = "`";
  while (texto.includes(valla)) valla += "`";
  const relleno = texto.startsWith("`") || texto.endsWith("`") ? " " : "";
  return `${valla}${relleno}${texto}${relleno}${valla}`;
}

/**
 * Código en línea dentro de una celda: el `|` se escapa también ahí en GFM, y la
 * barra invertida con él, para que un `\` del texto no anule el escape del `|`.
 */
const codigoEnCelda = (s: string) => codigo(s).replace(/[\\|]/g, "\\$&");

/**
 * Una etiqueta de Mermaid entre comillas (categorías de un eje). Mermaid no
 * admite comillas escapadas dentro de un texto entre comillas, `%%` empieza un
 * comentario y `#algo;` lo toma como una entidad: se reemplazan por parecidos
 * que no rompen nada. Se acorta para que el eje no se coma la gráfica.
 */
export function etiquetaMermaid(s: string, maximo = 24): string {
  let t = s
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "”")
    .replace(/%%/g, "% %")
    .replace(/#(?=[\w-]*;)/g, "＃")
    .trim();
  if ([...t].length > maximo) t = [...t].slice(0, maximo - 1).join("") + "…";
  return `"${t === "" ? " " : t}"`;
}

// ── Enlaces a las notas ─────────────────────────────────────────────────────

const extensionDeRuta = (ruta: string) => {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const p = nombre.lastIndexOf(".");
  return p <= 0 ? "" : nombre.slice(p + 1).toLowerCase();
};
const sinExtension = (ruta: string) => {
  const barra = ruta.lastIndexOf("/");
  const p = ruta.lastIndexOf(".");
  return p > barra + 1 ? ruta.slice(0, p) : ruta;
};
const tituloDeRuta = (ruta: string) => {
  const s = sinExtension(ruta);
  return s.slice(s.lastIndexOf("/") + 1);
};

/**
 * Arma `[[enlaces]]` que llegan a la nota correcta con las reglas de Mycelium
 * (`resolveWikilinkEnIndice`, `lib/wikilinks.ts`):
 * - una nota con título único: `[[Título]]`;
 * - una de un grupo de homónimas (`informe.duplicados`): con la ruta como pista
 *   de carpeta y el título como texto, `[[Carpeta/Título|Título]]` —la pista
 *   descarta a las otras; sin ella iría a la más cercana a la raíz—;
 * - lo que no es markdown (un lienzo con un enlace roto) lleva su extensión,
 *   que filtra por tipo: `[[Mapa.canvas]]`.
 *
 * Un título con `[[`, `]]` o `|` no se puede escribir como enlace: va como
 * código con su ruta.
 */
export function enlazador(informe: Pick<InformeSalud, "duplicados">): (ruta: string, titulo?: string) => string {
  const homonimas = new Set<string>();
  for (const d of informe.duplicados) for (const r of d.rutas) homonimas.add(r);
  return (ruta, tituloDado) => {
    const titulo = tituloDado ?? tituloDeRuta(ruta);
    if (/\[\[|\]\]|\||[\r\n]/.test(ruta) || /\[\[|\]\]|\|/.test(titulo)) return codigo(ruta);
    const ext = extensionDeRuta(ruta);
    const conExt = ext !== "" && ext !== "md";
    if (!homonimas.has(ruta)) return `[[${conExt ? `${titulo}.${ext}` : titulo}]]`;
    const destino = conExt ? ruta : sinExtension(ruta);
    return `[[${destino}|${titulo}]]`;
  };
}

/** «a», «a y b», «a, b y c» (con «e» antes de un sonido «i»). */
export function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  const ultima = partes[partes.length - 1];
  const textoUltimo = ultima.replace(/^[[`*]+/, "");
  const conjuncion = /^(i|hi)(?!e)/i.test(textoUltimo) || /^[íÍ]/.test(textoUltimo) ? "e" : "y";
  return `${partes.slice(0, -1).join(", ")} ${conjuncion} ${ultima}`;
}

// ── Opciones ────────────────────────────────────────────────────────────────

export type OpcionesInforme = {
  /** Cuántas notas afectadas se enlazan por clase de problema (el resto, «y N más»). */
  tope?: number;
  /** El nombre del vault, para la línea de presentación. */
  vault?: string;
};

export const TOPE_INFORME = 5;

/**
 * La carpeta de los informes si el usuario no eligió otra (Configuración →
 * Vault). Vive acá, en el módulo puro, para que `preferencesStore` la importe
 * sin arrastrar los stores.
 */
export const CARPETA_INFORMES_DEFECTO = "Informes";

/** Cuántas carpetas van en la gráfica de peso; el resto se suma en una barra. */
export const TOPE_CARPETAS = 8;

// ── Unidades de las gráficas ────────────────────────────────────────────────

/**
 * La unidad de las gráficas de peso: MB, salvo en un vault de menos de 1 MB,
 * donde todo daría 0,0 y la torta no tendría nada que mostrar.
 */
function unidadDePeso(totalBytes: number): { nombre: "MB" | "KB"; divisor: number } {
  return totalBytes >= MB ? { nombre: "MB", divisor: MB } : { nombre: "KB", divisor: KB };
}

/** Un tope «redondo» para el eje: 1, 2 o 5 por una potencia de 10, ≥ `max`. */
export function topeDeEje(max: number): number {
  if (!(max > 0)) return 1;
  const potencia = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const t = m * potencia;
    if (t >= max) return Number(t.toPrecision(12));
  }
  return 10 * potencia;
}

const VALLA = "```";
const bloqueMermaid = (lineas: string[]) => [VALLA + "mermaid", ...lineas, VALLA].join("\n");

// ── Las gráficas ────────────────────────────────────────────────────────────

/**
 * La torta del peso por grupo, con las cinco porciones en `ORDEN_TORTA`.
 * `null` si no hay nada que dibujar (vault vacío o todo en 0,0).
 */
export function tortaMermaid(porGrupo: Record<GrupoArchivo, { bytes: number }>): string | null {
  const total = ORDEN_TORTA.reduce((s, g) => s + porGrupo[g].bytes, 0);
  const unidad = unidadDePeso(total);
  const valores = ORDEN_TORTA.map((g) => Number((porGrupo[g].bytes / unidad.divisor).toFixed(1)));
  if (valores.every((v) => v === 0)) return null;
  return bloqueMermaid([
    `pie showData title Peso por tipo de archivo (${unidad.nombre})`,
    ...ORDEN_TORTA.map((g, i) => `    ${etiquetaMermaid(NOMBRE_GRUPO[g])} : ${valores[i].toFixed(1)}`),
  ]);
}

/** Barras horizontales del peso por carpeta de primer nivel. */
export function carpetasMermaid(carpetas: readonly { carpeta: string; bytes: number }[]): string | null {
  if (carpetas.length === 0) return null;
  const total = carpetas.reduce((s, c) => s + c.bytes, 0);
  const unidad = unidadDePeso(total);
  let filas = carpetas.map((c) => ({ nombre: c.carpeta, bytes: c.bytes }));
  if (filas.length > TOPE_CARPETAS) {
    const resto = filas.slice(TOPE_CARPETAS - 1);
    filas = [
      ...filas.slice(0, TOPE_CARPETAS - 1),
      { nombre: `Otras ${resto.length} carpetas`, bytes: resto.reduce((s, c) => s + c.bytes, 0) },
    ];
  }
  const valores = filas.map((f) => Number((f.bytes / unidad.divisor).toFixed(1)));
  const max = Math.max(...valores);
  if (!(max > 0)) return null;
  return bloqueMermaid([
    "xychart-beta horizontal",
    `    title "Peso por carpeta (${unidad.nombre})"`,
    `    x-axis [${filas.map((f) => etiquetaMermaid(f.nombre)).join(", ")}]`,
    `    y-axis "${unidad.nombre}" 0 --> ${topeDeEje(max)}`,
    `    bar [${valores.map((v) => v.toFixed(1)).join(", ")}]`,
  ]);
}

/** Barras verticales de una serie con categorías (histograma, meses). */
export function barrasMermaid(titulo: string, eje: string, etiquetas: readonly string[], valores: readonly number[]): string | null {
  const max = Math.max(0, ...valores);
  if (etiquetas.length === 0 || !(max > 0)) return null;
  return bloqueMermaid([
    "xychart-beta",
    `    title ${etiquetaMermaid(titulo, 60)}`,
    `    x-axis [${etiquetas.map((e) => etiquetaMermaid(e)).join(", ")}]`,
    `    y-axis ${etiquetaMermaid(eje)} 0 --> ${topeDeEje(max)}`,
    `    bar [${valores.map((v) => String(Math.round(v))).join(", ")}]`,
  ]);
}

// ── Las secciones ───────────────────────────────────────────────────────────

/** Los nombres de los tipos para la tabla; cada extensión va por separado. */
const NOMBRE_EXTENSION: Readonly<Record<string, string>> = {
  md: "Notas",
  png: "Imágenes",
  jpg: "Imágenes",
  jpeg: "Imágenes",
  webp: "Imágenes",
  gif: "Imágenes",
  svg: "Imágenes",
  pdf: "PDF",
  excalidraw: "Dibujos",
  drawio: "Diagramas",
  canvas: "Lienzos",
  base: "Tablas",
};

export function nombreDeTipo(extension: string): string {
  if (extension === "") return "Sin extensión";
  return `${NOMBRE_EXTENSION[extension] ?? "Otros"} (.${extension})`;
}

/** «las imágenes», «los PDF»… para las frases. */
const EN_FRASE: Readonly<Record<GrupoArchivo, string>> = {
  notas: "las notas",
  imagenes: "las imágenes",
  pdf: "los PDF",
  visuales: "los dibujos, diagramas y lienzos",
  otros: "los demás archivos",
};
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** La frase que resume qué hay en el vault (el hallazgo, como en la pestaña). */
export function hallazgoComposicion(a: RevisionVault["estadisticas"]["archivos"]): string {
  const { total, porGrupo } = a;
  if (total.cantidad === 0) return "El vault todavía no tiene archivos.";
  const notas = porGrupo.notas;
  const frases: string[] = [];
  if (notas.cantidad === total.cantidad) {
    frases.push(`Todos los archivos son notas: ${plural(total.cantidad, "nota", "notas")}, ${pesoLegible(total.bytes)}.`);
    return frases.join(" ");
  }
  frases.push(
    `Las notas son ${elPorcentaje(notas.cantidad, total.cantidad)} de los archivos y ocupan ${elPorcentaje(notas.bytes, total.bytes)} del disco.`,
  );
  if (total.bytes > 0) {
    // Lo que más pesa fuera de las notas: uno o dos grupos, los que hagan falta
    // para pasar la mitad del disco (si no la pasan, el que más pesa).
    const otros = (["imagenes", "pdf", "visuales", "otros"] as GrupoArchivo[])
      .filter((g) => porGrupo[g].bytes > 0)
      .sort((x, y) => porGrupo[y].bytes - porGrupo[x].bytes);
    if (otros.length > 0 && porGrupo[otros[0]].bytes > notas.bytes) {
      const elegidos = [otros[0]];
      let suma = porGrupo[otros[0]].bytes;
      if (suma < total.bytes / 2 && otros[1] && suma + porGrupo[otros[1]].bytes >= total.bytes / 2) {
        elegidos.push(otros[1]);
        suma += porGrupo[otros[1]].bytes;
      }
      frases.push(`${mayuscula(enumerar(elegidos.map((g) => EN_FRASE[g])))} pesan ${elPorcentaje(suma, total.bytes)}.`);
    } else if (notas.bytes > 0) {
      frases.push("Las notas son lo que más pesa.");
    }
  }
  return frases.join(" ");
}

function seccionComposicion(r: RevisionVault): string[] {
  const a = r.estadisticas.archivos;
  const out = ["## Qué hay en el vault", "", hallazgoComposicion(a), ""];
  const torta = tortaMermaid(a.porGrupo);
  if (torta) out.push(torta, "");
  out.push("| Tipo | Archivos | Peso | Proporción del peso |", "|---|--:|--:|--:|");
  for (const t of a.porTipo) {
    out.push(
      `| ${celda(nombreDeTipo(t.extension))} | ${entero(t.cantidad)} | ${pesoLegible(t.bytes)} | ${porcentaje(t.bytes, a.total.bytes)} |`,
    );
  }
  out.push(`| **Total** | **${entero(a.total.cantidad)}** | **${pesoLegible(a.total.bytes)}** | ${a.total.bytes > 0 ? "100 %" : "0 %"} |`, "");
  return out;
}

function seccionEspacio(r: RevisionVault): string[] {
  const a = r.estadisticas.archivos;
  if (a.total.cantidad === 0) return [];
  const out = ["## Qué ocupa espacio", ""];
  const mayor = a.carpetas[0];
  if (mayor && a.total.bytes > 0) {
    out.push(
      `La carpeta que más ocupa es ${codigo(mayor.carpeta)}: ${pesoLegible(mayor.bytes)}, ${elPorcentaje(mayor.bytes, a.total.bytes)} del vault.`,
      "",
    );
  }
  const barras = carpetasMermaid(a.carpetas);
  if (barras) out.push(barras, "");
  if (a.masPesados.length > 0 && a.total.bytes > 0) {
    out.push("Los archivos más pesados:", "", "| Archivo | Peso |", "|---|--:|");
    for (const p of a.masPesados) out.push(`| ${codigoEnCelda(p.ruta)} | ${pesoLegible(p.bytes)} |`);
    out.push("");
  }
  return out;
}

function seccionRed(r: RevisionVault, enlace: (ruta: string, titulo?: string) => string): string[] {
  const red = r.estadisticas.red;
  const out = ["## La red", ""];
  if (red.notas === 0) {
    out.push("Todavía no hay notas que conectar.", "");
    return out;
  }
  const frases = [
    `${mayuscula(elPorcentaje(red.conectadas, red.notas))} de las notas tiene al menos una conexión (${entero(red.conectadas)} de ${entero(red.notas)}).`,
  ];
  if (red.componentes === 1) frases.push(`Todas las conectadas forman una sola red.`);
  else if (red.componentes > 1) {
    frases.push(
      `La red principal tiene ${plural(red.redPrincipal, "nota", "notas")}, y hay ${plural(red.islas, "isla suelta", "islas sueltas")}.`,
    );
  }
  if (red.huerfanas > 0) frases.push(`${mayuscula(plural(red.huerfanas, "nota es huérfana", "notas son huérfanas"))}: ninguna otra las enlaza.`);
  if (red.masConectadas.length > 0) {
    const lista = red.masConectadas.map((n) => `${enlace(n.ruta, n.titulo)} (${entero(n.conexiones)})`);
    frases.push(
      red.masConectadas.length === 1
        ? `La que más conecta es ${lista[0]}.`
        : `Las que más conectan son ${enumerar(lista)}.`,
    );
  }
  out.push(frases.join(" "), "");
  const hist = barrasMermaid(
    "Notas según sus conexiones",
    "Notas",
    red.histograma.map((c) => c.etiqueta),
    red.histograma.map((c) => c.notas),
  );
  if (hist) out.push(hist, "");
  return out;
}

function seccionCrecimiento(r: RevisionVault): string[] {
  const c = r.estadisticas.crecimiento;
  const out = ["## Crecimiento", ""];
  if (!c.confiable) {
    const lote = c.lote;
    const cuando = lote ? new Date(lote.fecha) : null;
    const fecha = cuando && !Number.isNaN(cuando.getTime())
      ? ` (el ${cuando.getDate()} de ${MESES_LARGOS[cuando.getMonth()]} de ${cuando.getFullYear()})`
      : "";
    out.push(
      `No hay fechas confiables para mostrar cuántas notas se crearon cada mes. ` +
        (lote ? `${mayuscula(plural(lote.notas, "nota tiene", "notas tienen"))} la misma fecha de creación${fecha}: ` : "") +
        `es el momento en que el índice de Mycelium las vio por primera vez, no cuándo se escribieron. ` +
        `Una gráfica mostraría un pico falso ese mes.`,
      "",
    );
    return out;
  }
  if (c.total === 0) {
    out.push(`No hubo notas nuevas en los últimos ${MESES_CRECIMIENTO} meses.`, "");
    return out;
  }
  out.push(`${mayuscula(plural(c.total, "nota nueva", "notas nuevas"))} en los últimos ${MESES_CRECIMIENTO} meses.`, "");
  const etiquetas = c.meses.map((m, i) => {
    const [anio, mes] = m.mes.split("-").map(Number);
    const corto = MESES_CORTOS[mes - 1] ?? m.mes;
    // El año, en el primer mes y en cada enero: doce meses cruzan siempre un cambio de año.
    return i === 0 || mes === 1 ? `${corto} ${String(anio).slice(-2)}` : corto;
  });
  const barras = barrasMermaid("Notas nuevas por mes", "Notas", etiquetas, c.meses.map((m) => m.notas));
  if (barras) out.push(barras, "");
  return out;
}

function seccionEtiquetas(r: RevisionVault): string[] {
  const e = r.estadisticas.etiquetas;
  const out = ["## Etiquetas", ""];
  if (e.distintas === 0) {
    out.push("Ninguna nota usa etiquetas.", "");
    return out;
  }
  out.push(
    `${mayuscula(plural(e.distintas, "etiqueta distinta", "etiquetas distintas"))}, en ${plural(e.notasConEtiqueta, "nota", "notas")}.` +
      (e.masUsadas.length > 0 ? " Las más usadas:" : ""),
    "",
  );
  if (e.masUsadas.length > 0) {
    out.push("| Etiqueta | Notas |", "|---|--:|");
    // En código: un `#tag` suelto en el cuerpo sumaría la etiqueta a ESTA nota.
    for (const t of e.masUsadas) out.push(`| ${codigoEnCelda(`#${t.etiqueta}`)} | ${entero(t.notas)} |`);
    out.push("");
  }
  return out;
}

// ── Los problemas ───────────────────────────────────────────────────────────

/** Cuántos problemas hay de cada gravedad. La suma es `conteos(informe).total`. */
export function gravedades(informe: InformeSalud): { graves: number; avisos: number; revisar: number; total: number } {
  const graves = informe.rotos.length + informe.embedsRotos.length;
  const avisos = informe.duplicados.length + (informe.propiedades?.length ?? 0);
  const revisar = informe.huerfanas.length + informe.sinSalientes.length;
  return { graves, avisos, revisar, total: graves + avisos + revisar };
}

const lineasDe = (p: Problema) =>
  p.lineas.length === 0 ? "" : p.lineas.length === 1 ? ` (línea ${p.lineas[0]})` : ` (líneas ${p.lineas.slice(0, 5).join(", ")}${p.lineas.length > 5 ? "…" : ""})`;

const referenciaDe = (p: Problema) =>
  p.tipo === "embed" ? codigo(`![[${p.texto}]]`) : p.tipo === "enlace" ? codigo(`[[${p.texto}]]`) : codigo(p.texto);

/** Una línea del callout con un ítem anidado por cada ejemplo y «y N más». */
function conEjemplos(encabezado: string, ejemplos: string[], total: number): string[] {
  const out = [`> - ${encabezado}`];
  for (const e of ejemplos) out.push(`>   - ${e}`);
  if (total > ejemplos.length) out.push(`>   - y ${entero(total - ejemplos.length)} más.`);
  return out;
}

function callouts(informe: InformeSalud, enlace: (ruta: string, titulo?: string) => string, tope: number): string[] {
  const g = gravedades(informe);
  const out: string[] = [];
  const problemas = (lista: Problema[], verbo: string) =>
    lista.slice(0, tope).map((p) => `${enlace(p.desde)} ${verbo} ${referenciaDe(p)}${lineasDe(p)}`);

  if (g.total === 0 && (informe.avisosEsquemas?.length ?? 0) === 0) {
    out.push("> [!success] Sin problemas", "> No hay enlaces rotos, títulos duplicados ni notas sueltas.", "");
    return out;
  }

  if (g.graves > 0) {
    out.push(`> [!caution] ${plural(g.graves, "problema grave", "problemas graves")}`);
    if (informe.rotos.length > 0) {
      out.push(
        ...conEjemplos(
          `${plural(informe.rotos.length, "enlace roto", "enlaces rotos")}: ${informe.rotos.length === 1 ? "apunta" : "apuntan"} a algo que no existe.`,
          problemas(informe.rotos, "enlaza a"),
          informe.rotos.length,
        ),
      );
    }
    if (informe.embedsRotos.length > 0) {
      out.push(
        ...conEjemplos(
          `${plural(informe.embedsRotos.length, "embed roto", "embeds rotos")}: ${informe.embedsRotos.length === 1 ? "muestra" : "muestran"} algo que no está en el vault.`,
          problemas(informe.embedsRotos, "embebe"),
          informe.embedsRotos.length,
        ),
      );
    }
    out.push("");
  }

  const propiedades = informe.propiedades ?? [];
  const esquemas = informe.avisosEsquemas ?? [];
  if (g.avisos > 0 || esquemas.length > 0) {
    out.push(`> [!warning] ${plural(g.avisos, "aviso", "avisos")}`);
    if (informe.duplicados.length > 0) {
      out.push(
        ...conEjemplos(
          `${plural(informe.duplicados.length, "título duplicado", "títulos duplicados")}: notas del mismo tipo con el mismo nombre en carpetas distintas.`,
          informe.duplicados
            .slice(0, tope)
            .map((d) => `**${d.titulo}**: ${enumerar(d.rutas.map((r) => `${enlace(r)} (${codigo(r)})`))}`),
          informe.duplicados.length,
        ),
      );
      const ambiguos = informe.duplicados.flatMap((d) => d.ambiguos);
      if (ambiguos.length > 0) {
        out.push(
          ...conEjemplos(
            ambiguos.length === 1
              ? "1 enlace ambiguo hacia esos títulos: no dice la carpeta y va a la nota más cercana a la raíz."
              : `${entero(ambiguos.length)} enlaces ambiguos hacia esos títulos: no dicen la carpeta y van a la nota más cercana a la raíz.`,
            problemas(ambiguos, "enlaza a"),
            ambiguos.length,
          ),
        );
      }
    }
    if (propiedades.length > 0) {
      out.push(
        ...conEjemplos(
          `${plural(propiedades.length, "nota tiene", "notas tienen")} propiedades que no cumplen ${codigo("esquemas.yml")}.`,
          propiedades.slice(0, tope).map((n) => {
            const primero = n.avisos[0];
            const resto = n.avisos.length - 1;
            return (
              `${enlace(n.ruta, n.titulo)}` +
              (primero ? `: ${primero.mensaje}${primero.linea > 0 ? ` (línea ${primero.linea})` : ""}` : "") +
              (resto > 0 ? ` y ${plural(resto, "aviso más", "avisos más")}` : "")
            );
          }),
          propiedades.length,
        ),
      );
    }
    if (esquemas.length > 0) {
      out.push(
        ...conEjemplos(
          `${codigo("esquemas.yml")} tiene ${plural(esquemas.length, "parte que no se entiende", "partes que no se entienden")} (se ignoran).`,
          esquemas.slice(0, tope).map((a) => `${a.mensaje}${a.linea ? ` (línea ${a.linea})` : ""}`),
          esquemas.length,
        ),
      );
    }
    out.push("");
  }

  if (g.revisar > 0) {
    out.push("> [!info] Para revisar cuando haya tiempo");
    const notas = (l: { ruta: string; titulo: string }[]) => {
      const ej = l.slice(0, tope).map((n) => enlace(n.ruta, n.titulo));
      return ej.length === 0 ? "" : ` ${enumerar(l.length > ej.length ? [...ej, `${entero(l.length - ej.length)} más`] : ej)}.`;
    };
    if (informe.huerfanas.length > 0) {
      out.push(`> - ${plural(informe.huerfanas.length, "nota huérfana", "notas huérfanas")}, que ninguna otra enlaza:${notas(informe.huerfanas)}`);
    }
    if (informe.sinSalientes.length > 0) {
      out.push(
        `> - ${plural(informe.sinSalientes.length, "nota sin enlaces salientes", "notas sin enlaces salientes")} (suele ser normal en notas cortas):${notas(informe.sinSalientes)}`,
      );
    }
    out.push("");
  }
  return out;
}

// ── Todo junto ──────────────────────────────────────────────────────────────

/** Los megabytes para la propiedad `peso_mb`, con un decimal. */
export const megabytes = (bytes: number) => Number((bytes / MB).toFixed(1));

/**
 * El Markdown completo del informe. Puro: con la misma revisión da siempre el
 * mismo texto (las fechas salen de `revision.revisadoEn`, no del reloj).
 */
export function markdownInformeSalud(revision: RevisionVault, opciones: OpcionesInforme = {}): string {
  const tope = Math.max(1, opciones.tope ?? TOPE_INFORME);
  const { informe, estadisticas } = revision;
  const revisado = new Date(revision.revisadoEn);
  const a = estadisticas.archivos;
  const g = gravedades(informe);
  const enlace = enlazador(informe);

  const out: string[] = [
    "---",
    `revisado: ${fechaHoraPropiedad(revisado)}`,
    `archivos: ${a.total.cantidad}`,
    `notas: ${a.porGrupo.notas.cantidad}`,
    `peso_mb: ${megabytes(a.total.bytes)}`,
    `problemas: ${g.total}`,
    "tags: [salud-del-vault]",
    "---",
    "",
    `Revisión ${opciones.vault ? `del vault ${codigo(opciones.vault)} ` : "del vault "}del ${fechaLarga(revisado)}: ` +
      `${plural(a.total.cantidad, "archivo", "archivos")}, ${pesoLegible(a.total.bytes)}` +
      (g.total > 0 ? `, ${plural(g.total, "problema", "problemas")}.` : ", sin problemas.") +
      (revision.sinOcultas ? " No cuenta lo que está en carpetas que empiezan con punto." : "") +
      " Es una foto de ese momento: la salud al día está en el panel **Salud del vault**.",
    "",
    ...callouts(informe, enlace, tope),
    ...seccionComposicion(revision),
    ...seccionEspacio(revision),
    ...seccionRed(revision, enlace),
    ...seccionCrecimiento(revision),
    ...seccionEtiquetas(revision),
  ];
  // Una sola línea en blanco al final.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

