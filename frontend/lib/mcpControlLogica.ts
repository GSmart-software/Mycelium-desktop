/**
 * La lógica **pura** de las herramientas del MCP de control (`FUN-L-09`,
 * Parte 1): qué es el `objetivo` de `mycelium_abrir`, a qué línea lleva un
 * `ir_a`, qué candidatas se ofrecen cuando no existe, y cómo se describe una
 * pestaña. Sin stores ni Tauri, para poder probarla con
 * `scripts/test-mcp-control.mjs`; el cableado está en `lib/mcpControl.ts`.
 *
 * > [!important] Se resuelve como resuelve la app
 * > Un título pasa por las mismas reglas que un `[[wikilink]]`
 * > (`candidatosWikilinkEnIndice`, `lib/wikilinks.ts`): extensión, pista de
 * > carpeta, la nota markdown antes que un dibujo homónimo. La única
 * > diferencia es deliberada: con dos candidatas el enlace elige la más
 * > cercana a la raíz, y acá se contesta `AMBIGUO` con las rutas — el agente
 * > no debería abrir una nota elegida a ciegas.
 */
import {
  candidatosWikilinkEnIndice,
  indexarPorTitulo,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";

/** Lo que `mycelium_abrir` acepta en `ir_a` (ya validado por el servidor). */
export type IrA = { encabezado: string } | { linea: number } | { texto: string };

/** Una nota o archivo como lo nombra una candidata o una lista de rutas. */
export type Referencia = { titulo: string; ruta: string | null };

/** Qué es el objetivo de `mycelium_abrir`. */
export type Resolucion<N extends NotaEnlazable> =
  | { tipo: "grafo" }
  | { tipo: "calendario" }
  | { tipo: "nota"; nota: N; ancla: string | null }
  | { tipo: "archivo"; ruta: string }
  | { tipo: "ambiguo"; rutas: string[] }
  | { tipo: "no-encontrado"; candidatas: Referencia[] };

/** Barras de Windows a `/`, sin `./` ni `/` delante. */
export function normalizarObjetivo(objetivo: string): string {
  return objetivo.trim().replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

/**
 * Resuelve el `objetivo`: `grafo` / `calendario`, una ruta exacta del vault
 * (con o sin `.md`, sin distinguir mayúsculas), un archivo no indexado por su
 * ruta, o un título —`Nota`, `Carpeta/Nota`, `Nota#Sección`—.
 *
 * Las dos palabras reservadas ganan: una nota que se llame «grafo» se abre por
 * su ruta (`grafo.md`).
 */
export function resolverObjetivo<N extends NotaEnlazable>(
  objetivo: string,
  notas: readonly N[],
  carpetas: readonly CarpetaEnlazable[],
  otros: readonly { ruta: string }[],
): Resolucion<N> {
  const o = normalizarObjetivo(objetivo);
  const bajo = o.toLowerCase();
  if (bajo === "grafo") return { tipo: "grafo" };
  if (bajo === "calendario") return { tipo: "calendario" };

  // 1) Ruta exacta: en desktop el id de una nota ES su ruta relativa.
  const porRuta =
    notas.find((n) => n.id === o) ??
    notas.find((n) => n.id.toLowerCase() === bajo) ??
    notas.find((n) => n.id.toLowerCase() === `${bajo}.md`);
  if (porRuta) return { tipo: "nota", nota: porRuta, ancla: null };
  const archivo = otros.find((a) => a.ruta.toLowerCase() === bajo);
  if (archivo) return { tipo: "archivo", ruta: archivo.ruta };

  // 2) Título, con las reglas de los wikilinks.
  const porTitulo = indexarPorTitulo(notas);
  const intentar = (ref: string, ancla: string | null): Resolucion<N> | null => {
    const cands = candidatosWikilinkEnIndice(ref, porTitulo, carpetas);
    if (cands.length === 1) return { tipo: "nota", nota: cands[0], ancla };
    if (cands.length > 1) return { tipo: "ambiguo", rutas: cands.map((n) => n.id).sort() };
    return null;
  };
  const directo = intentar(o, null);
  if (directo) return directo;
  // `Nota#Sección`, como en un `[[enlace]]`: el ancla va en el último tramo.
  const barra = o.lastIndexOf("/");
  const almohadilla = o.indexOf("#", barra + 1);
  if (almohadilla > barra + 1) {
    const conAncla = intentar(o.slice(0, almohadilla), o.slice(almohadilla + 1).trim() || null);
    if (conAncla) return conAncla;
  }
  return { tipo: "no-encontrado", candidatas: candidatasParecidas(o, notas) };
}

/** Minúsculas y sin tildes: «Árbol» y «arbol» se parecen del todo. */
export function plano(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Distancia de edición (Levenshtein), con una sola fila de memoria. */
export function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = arriba;
    }
  }
  return fila[b.length];
}

/**
 * Las notas cuyo título más se parece al buscado, para que el agente corrija
 * en la misma vuelta (spec § 3.1: `NO_ENCONTRADO` trae las candidatas). Cuenta
 * contener o estar contenido, y la distancia de edición relativa. Hasta `max`.
 */
export function candidatasParecidas<N extends NotaEnlazable>(
  objetivo: string,
  notas: readonly N[],
  max = 5,
): Referencia[] {
  const buscado = plano(
    normalizarObjetivo(objetivo)
      .split("/")
      .pop()!
      .replace(/#.*$/, "")
      .replace(/\.(md|excalidraw|canvas|base|drawio)$/i, ""),
  );
  if (buscado === "") return [];
  const puntuadas: { n: N; p: number }[] = [];
  for (const n of notas) {
    const t = plano(n.titulo);
    let p = 1 - distancia(buscado, t) / Math.max(buscado.length, t.length, 1);
    if (t.includes(buscado) || buscado.includes(t)) p = Math.max(p, 0.6) + 0.2;
    if (p >= 0.5) puntuadas.push({ n, p });
  }
  return puntuadas
    .sort((a, b) => b.p - a.p || a.n.id.localeCompare(b.n.id))
    .slice(0, max)
    .map(({ n }) => ({ titulo: n.titulo, ruta: n.id }));
}

/** Un encabezado ATX (`## Texto`) fuera de los bloques de código. */
export type Encabezado = { linea: number; nivel: number; texto: string };

/** Los encabezados de una nota, con su línea (desde 1). */
export function encabezadosDe(contenido: string): Encabezado[] {
  const lineas = contenido.split(/\r?\n/);
  const salida: Encabezado[] = [];
  let valla: string | null = null;
  lineas.forEach((l, i) => {
    const v = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (v) {
      if (valla === null) valla = v[1][0];
      else if (v[1][0] === valla) valla = null;
      return;
    }
    if (valla !== null) return;
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) salida.push({ linea: i + 1, nivel: m[1].length, texto: m[2] });
  });
  return salida;
}

/** Resultado de resolver un `ir_a` contra el contenido. */
export type SaltoResuelto =
  | { ok: true; linea: number; descripcion: string }
  | { ok: false; codigo: "NO_ENCONTRADO" | "INVALIDO"; mensaje: string; datos: unknown };

/**
 * A qué línea lleva `ir_a` en una nota: el encabezado con ese texto (exacto
 * sin distinguir mayúsculas; si no, el primero que lo contenga), la línea pedida,
 * o la primera línea donde aparece el texto.
 */
export function resolverSalto(contenido: string, irA: IrA): SaltoResuelto {
  const total = contenido.split(/\r?\n/).length;
  if ("linea" in irA) {
    if (irA.linea > total) {
      return { ok: false, codigo: "INVALIDO", mensaje: `La nota tiene ${total} líneas; se pidió la ${irA.linea}.`, datos: { lineas: total } };
    }
    return { ok: true, linea: irA.linea, descripcion: `la línea ${irA.linea}` };
  }
  if ("encabezado" in irA) {
    const buscado = plano(irA.encabezado.replace(/^#+\s*/, "").trim());
    const todos = encabezadosDe(contenido);
    const e = todos.find((h) => plano(h.texto) === buscado) ?? todos.find((h) => plano(h.texto).includes(buscado));
    if (!e) {
      return {
        ok: false,
        codigo: "NO_ENCONTRADO",
        mensaje: `La nota no tiene ningún encabezado «${irA.encabezado}».`,
        datos: { candidatas: todos.slice(0, 15).map((h) => ({ titulo: `${"#".repeat(h.nivel)} ${h.texto}`, ruta: null })) },
      };
    }
    return { ok: true, linea: e.linea, descripcion: `el encabezado «${e.texto}» (línea ${e.linea})` };
  }
  // Se busca sobre la forma plana, que cambia el largo (las tildes se separan y
  // se quitan): la línea se cuenta sobre esa misma forma, que conserva los saltos.
  const enPlano = plano(contenido);
  const i = enPlano.indexOf(plano(irA.texto));
  if (i < 0) {
    return { ok: false, codigo: "NO_ENCONTRADO", mensaje: `El texto «${irA.texto}» no aparece en la nota.`, datos: null };
  }
  const linea = enPlano.slice(0, i).split(/\r?\n/).length;
  return { ok: true, linea, descripcion: `el texto «${irA.texto}» (línea ${linea})` };
}

/** Cómo se llama cada tipo de nota hacia el agente. */
export function tipoParaIa(tipoNota: string): string {
  switch (tipoNota) {
    case "excalidraw":
      return "dibujo";
    case "canvas":
      return "lienzo";
    case "base":
      return "tabla";
    case "drawio":
      return "diagrama";
    default:
      return "nota";
  }
}

/**
 * ¿Las dos rutas son el mismo vault? La misma normalización que
 * `misma_ruta` de Rust (`crates/mycelium-vault/src/rutas.rs`): barras,
 * barra final y mayúsculas.
 */
export function mismaRuta(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}
