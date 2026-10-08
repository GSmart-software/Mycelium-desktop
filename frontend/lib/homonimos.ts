/**
 * Notas con el mismo título en carpetas distintas (`DEF-134`). Mycelium lo
 * permite, como Obsidian, pero una operación que **crea** la coincidencia —o que
 * cambia cuál de las homónimas gana un `[[Título]]` sin ruta— no puede cambiar
 * en silencio a dónde lleva un enlace que ya existía. Ver
 * `docs/features/titulos-homonimos.md`.
 *
 * La regla, para renombrar, crear, duplicar y mover (notas y carpetas):
 *
 * 1. **Antes** de la operación se anota a qué archivo apunta cada enlace de las
 *    notas que enlazan a algo **involucrado**: lo que se mueve o se renombra, y
 *    toda nota que comparta título con lo que queda después.
 * 2. **Después**, cada uno de esos enlaces se vuelve a resolver contra el vault
 *    nuevo. Si ya no lleva al mismo archivo, se reescribe con su forma con ruta
 *    (`formaUnivoca`): la ruta completa desde la raíz para una nota en carpeta,
 *    el título solo para una nota de la raíz.
 *
 * > [!important] Por qué la nota de la raíz no necesita sintaxis propia
 * > El resolvedor (`lib/wikilinks.ts`, regla 5) desempata por profundidad: una
 * > nota de la raíz le gana a cualquier homónima del mismo tipo. `[[Tomate]]`
 * > ya es la «ruta completa» de `Tomate.md`. Lo único que puede ganarle es una
 * > nota **markdown** cuando la de la raíz no lo es (regla 4): para eso se
 * > prueba también la forma con extensión (`[[Tomate.canvas]]`). `formaUnivoca`
 * > comprueba cada forma contra el resolvedor en vez de suponerla.
 *
 * Módulo **puro** (solo importa los también puros `lib/wikilinks.ts` y
 * `lib/enlaces.ts`): lo prueba `scripts/test-homonimos.mjs` sin build. La E/S
 * —leer los retroenlaces, leer y escribir las notas— vive en
 * `lib/repararEnlaces.ts`.
 *
 * Solo-desktop: trabaja con ids que **son** rutas (`Cultivos/Tomate.md`).
 */
import { cambiarDestinos, destinoTrasCambio, type CambioDeRuta } from "@/lib/enlaces";
import {
  folderSegments,
  resolveWikilink,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";

/** Una nota del vault vista por su ruta: lo mínimo para resolver enlaces. */
export type NotaRuta = { id: string; titulo: string; tipo: string };

/** Lo que pasa con un archivo en la operación: su id antes y después. */
export type Traslado = { id: string; idNuevo: string; titulo: string; cambio?: CambioDeRuta };

/** Carpeta de un id-ruta, o `null` en la raíz. */
function carpetaDe(id: string): string | null {
  const i = id.lastIndexOf("/");
  return i < 0 ? null : id.slice(0, i);
}

/** Extensión (con el punto) de un id-ruta, o `""`. */
function extensionDe(id: string): string {
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const p = nombre.lastIndexOf(".");
  return p <= 0 ? "" : nombre.slice(p);
}

/**
 * Las notas y carpetas en la forma que pide el resolvedor, sacando las carpetas
 * de las rutas. Una carpeta vacía no hace falta: nadie resuelve hacia ella.
 */
function vista(notas: readonly NotaRuta[]): { notas: NotaEnlazable[]; carpetas: CarpetaEnlazable[] } {
  const carpetas = new Map<string, CarpetaEnlazable>();
  const salida: NotaEnlazable[] = [];
  for (const n of notas) {
    const carpetaId = carpetaDe(n.id);
    salida.push({ id: n.id, titulo: n.titulo, carpetaId, tipo: n.tipo });
    let c = carpetaId;
    while (c !== null && !carpetas.has(c)) {
      const padreId = carpetaDe(c);
      carpetas.set(c, { id: c, nombre: c.slice(c.lastIndexOf("/") + 1), padreId });
      c = padreId;
    }
  }
  return { notas: salida, carpetas: [...carpetas.values()] };
}

/** Resolver de enlaces contra un estado del vault: destino escrito → id. */
export type Resolutor = (ref: string) => string | undefined;

export function resolutorDe(notas: readonly NotaRuta[]): Resolutor {
  const v = vista(notas);
  return (ref) => resolveWikilink(ref, v.notas, v.carpetas)?.id;
}

/** El vault después de que cada `Traslado` cambie de ruta (renombrar o mover). */
export function trasTraslados(notas: readonly NotaRuta[], traslados: readonly Traslado[]): NotaRuta[] {
  const porId = new Map(traslados.map((t) => [t.id, t]));
  return notas.map((n) => {
    const t = porId.get(n.id);
    return t ? { ...n, id: t.idNuevo, titulo: t.titulo } : n;
  });
}

/**
 * Las notas cuyos enlaces entrantes hay que mirar, con su id de antes: las que
 * cambian de ruta y las que, **antes** de la operación, ya se llamaban como
 * alguna de `titulosDespues` (los títulos con que quedan las tocadas). Ellas
 * son las que pueden ganar o perder un `[[Título]]` sin ruta.
 */
export function involucradas(
  antes: readonly NotaRuta[],
  trasladadas: readonly string[],
  titulosDespues: readonly string[],
): string[] {
  const titulos = new Set(titulosDespues.map((t) => t.trim().toLowerCase()));
  const ids = new Set(trasladadas);
  for (const n of antes) if (titulos.has(n.titulo.trim().toLowerCase())) ids.add(n.id);
  return [...ids];
}

/**
 * La forma más explícita de escribir un enlace a `id` que, en el vault
 * `despues`, resuelve a él: la ruta completa desde la raíz para una nota en
 * carpeta (`Cultivos/Tomate`), el título para una de la raíz, y en los dos
 * casos con la extensión si sin ella ganaría otra (una nota markdown homónima
 * le gana a un lienzo o a un dibujo). Si ninguna resuelve —no debería pasar—,
 * la última: ruta con extensión.
 */
export function formaUnivoca(id: string, despues: readonly NotaRuta[], resolver = resolutorDe(despues)): string {
  const nota = despues.find((n) => n.id === id);
  const carpeta = carpetaDe(id);
  const titulo = nota?.titulo ?? id.slice(id.lastIndexOf("/") + 1, id.length - extensionDe(id).length);
  const base = carpeta === null ? titulo : `${carpeta}/${titulo}`;
  const ext = extensionDe(id);
  const formas = ext === "" ? [base] : [base, base + ext];
  for (const f of formas) if (resolver(f) === id) return f;
  return formas[formas.length - 1];
}

/** Qué hacer con los enlaces de una nota (lo que `repararTexto` necesita). */
export type PlanHomonimos = {
  /** A qué archivo resolvía un destino ANTES de la operación. */
  antes: Resolutor;
  /** A qué archivo resuelve DESPUÉS. */
  despues: Resolutor;
  /** Id de antes → lo que es después, de cada nota involucrada. */
  destinos: ReadonlyMap<string, { idNuevo: string; cambio?: CambioDeRuta }>;
  /** La forma con ruta de un id de después (`formaUnivoca`, memorizada). */
  forma: (idNuevo: string) => string;
};

/**
 * Reescribe los enlaces de `texto` que apuntaban a una nota involucrada para que
 * sigan apuntando a ella después de la operación. Por cada enlace:
 *
 * - si antes no resolvía a una involucrada, no se toca;
 * - si la operación cambió el nombre o la carpeta de su destino, se prueba
 *   primero la reparación de siempre (`destinoTrasCambio`: el título nuevo, o la
 *   ruta nueva si tenía pista);
 * - si esa forma —o la que ya tenía— resuelve al mismo archivo, queda así;
 * - si no, va con su ruta (`forma`): es el caso de `DEF-134`.
 *
 * Conserva el `!` de un embed, el alias, el ancla y lo que hay alrededor
 * (`cambiarDestinos`). `conRuta` cuenta los que tomaron la forma con ruta.
 */
export function repararTexto(
  texto: string,
  plan: PlanHomonimos,
): { texto: string; cambios: number; conRuta: number } {
  let conRuta = 0;
  const r = cambiarDestinos(texto, (destino) => {
    const idAntes = plan.antes(destino);
    if (idAntes === undefined) return null;
    const d = plan.destinos.get(idAntes);
    if (!d) return null;
    const natural = d.cambio ? destinoTrasCambio(destino, d.cambio) : null;
    const candidato = typeof natural === "string" ? natural : destino;
    if (plan.despues(candidato) === d.idNuevo) return candidato === destino ? null : candidato;
    const forma = plan.forma(d.idNuevo);
    if (forma === destino) return null;
    conRuta++;
    return forma;
  });
  return { ...r, conRuta };
}

/**
 * Arma el plan de una operación a partir de los dos estados del vault y de lo
 * que se trasladó (vacío al crear: nada cambia de ruta).
 */
export function planHomonimos(
  antes: readonly NotaRuta[],
  despues: readonly NotaRuta[],
  involucradasAntes: readonly string[],
  traslados: readonly Traslado[],
): PlanHomonimos {
  const porId = new Map(traslados.map((t) => [t.id, t]));
  const destinos = new Map<string, { idNuevo: string; cambio?: CambioDeRuta }>();
  for (const id of involucradasAntes) {
    const t = porId.get(id);
    destinos.set(id, t ? { idNuevo: t.idNuevo, cambio: t.cambio } : { idNuevo: id });
  }
  const resolverDespues = resolutorDe(despues);
  const formas = new Map<string, string>();
  return {
    antes: resolutorDe(antes),
    despues: resolverDespues,
    destinos,
    forma: (id) => {
      let f = formas.get(id);
      if (f === undefined) {
        f = formaUnivoca(id, despues, resolverDespues);
        formas.set(id, f);
      }
      return f;
    },
  };
}

/** Otra nota del mismo tipo con el mismo título: una coincidencia de verdad. */
export type Coincidencia = { titulo: string; carpetas: string[] };

/**
 * Las coincidencias de título que deja la operación para las notas `tocadas`
 * (ids de después): por cada una, las carpetas de las **otras** notas del mismo
 * tipo que se llaman igual. Un dibujo y una nota con el mismo nombre no cuentan:
 * `[[x]]` va a la nota y `![[x.excalidraw]]` al dibujo, sin ambigüedad.
 */
export function coincidencias(despues: readonly NotaRuta[], tocadas: readonly string[]): Coincidencia[] {
  const salida: Coincidencia[] = [];
  const vistos = new Set<string>();
  const v = vista(despues);
  for (const id of tocadas) {
    const nota = despues.find((n) => n.id === id);
    if (!nota) continue;
    const clave = `${nota.tipo}|${nota.titulo.trim().toLowerCase()}`;
    if (vistos.has(clave)) continue;
    const otras = despues.filter(
      (n) => n.id !== id && n.tipo === nota.tipo && n.titulo.trim().toLowerCase() === nota.titulo.trim().toLowerCase(),
    );
    if (otras.length === 0) continue;
    vistos.add(clave);
    salida.push({
      titulo: nota.titulo,
      carpetas: otras.map((o) => folderSegments(carpetaDe(o.id), v.carpetas).join("/")),
    });
  }
  return salida;
}

/**
 * El aviso para el usuario, o `null` si no hay coincidencias. `notas` es
 * cuántas notas se reescribieron con la ruta.
 */
export function textoAviso(cs: readonly Coincidencia[], notas: number): string | null {
  if (cs.length === 0) return null;
  const donde = (c: string) => (c === "" ? "la raíz" : c);
  const cuantas = notas === 1 ? "1 nota" : `${notas} notas`;
  const cola =
    notas === 0
      ? "Ningún enlace cambió de destino."
      : `Para que ningún enlace cambie de destino, se escribieron con su ruta en ${cuantas}.`;
  if (cs.length === 1) {
    const c = cs[0];
    const lugares = c.carpetas.map(donde).join(", ");
    const otra = c.carpetas.length === 1 ? "otra nota llamada" : `otras ${c.carpetas.length} notas llamadas`;
    return `Hay ${otra} «${c.titulo}» (en ${lugares}). ${cola}`;
  }
  const titulos = cs.slice(0, 3).map((c) => `«${c.titulo}»`).join(", ") + (cs.length > 3 ? "…" : "");
  return `${cs.length} notas coinciden en título con otras del vault (${titulos}). ${cola}`;
}
