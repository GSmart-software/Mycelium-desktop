/**
 * La lógica **pura** de las herramientas de archivos del MCP de control
 * (`FUN-L-09`, Parte 3; spec en `docs/features/mcp-control.md` § 1 y § 3.2):
 * validar lo que pide el agente, resolver qué nota o carpeta es, decidir si
 * hay que preguntarle al usuario (**el alcance**), redactar el efecto y lo que
 * se guarda para **deshacer**, y si todavía se puede. Sin stores ni Tauri, para
 * probarla con `scripts/test-mcp-archivos.mjs`; el cableado está en
 * `lib/mcpArchivos.ts`.
 *
 * > [!important] No duplica reglas de la app
 * > Qué nombre es válido lo dice `motivoNombreInvalido` (`lib/tituloEditable.ts`,
 * > el mismo que el título editable); qué es el objetivo, `resolverObjetivo`
 * > (`lib/mcpControlLogica.ts`, el de `mycelium_abrir`). El renombrado, el
 * > movimiento, la reparación de enlaces y la papelera son los de la app
 * > (`stores/vaultStore.ts`, `lib/repararEnlaces.ts`).
 */
import { candidatasParecidas, distancia, normalizarObjetivo, plano, resolverObjetivo, type Referencia } from "@/lib/mcpControlLogica";
import { motivoNombreInvalido } from "@/lib/tituloEditable";
import type { CarpetaEnlazable, NotaEnlazable } from "@/lib/wikilinks";

// ── Errores ─────────────────────────────────────────────────────────────────

export type CodigoArchivos = "INVALIDO" | "NO_ENCONTRADO" | "AMBIGUO" | "CAMBIOS_SIN_GUARDAR";
export type ErrorArchivos = { codigo: CodigoArchivos; mensaje: string; datos: unknown };
export type Validado<T> = { ok: true; valor: T } | { ok: false; error: ErrorArchivos };

const error = <T>(codigo: CodigoArchivos, mensaje: string, datos: unknown = null): Validado<T> => ({
  ok: false,
  error: { codigo, mensaje, datos },
});
const invalido = <T>(campo: string, porque: string): Validado<T> =>
  error("INVALIDO", `\`${campo}\`: ${porque}`, { campo });

/** Un campo desconocido es `INVALIDO`: un typo no pasa en silencio. */
function clavesConocidas(args: Record<string, unknown>, conocidas: string[]): Validado<null> {
  const extra = Object.keys(args).find((k) => !conocidas.includes(k));
  return extra === undefined
    ? { ok: true, valor: null }
    : invalido(extra, `no es un campo de esta herramienta (son: ${conocidas.join(", ")}).`);
}

function texto(args: Record<string, unknown>, campo: string): Validado<string> {
  const v = args[campo];
  if (typeof v !== "string" || v.trim() === "") return invalido(campo, "falta, o está vacío.");
  return { ok: true, valor: v.trim() };
}

// ── Argumentos ──────────────────────────────────────────────────────────────

export function validarRenombrar(args: Record<string, unknown>): Validado<{ objetivo: string; nombre: string }> {
  const k = clavesConocidas(args, ["objetivo", "nombre"]);
  if (!k.ok) return k;
  const objetivo = texto(args, "objetivo");
  if (!objetivo.ok) return objetivo;
  const nombre = texto(args, "nombre");
  if (!nombre.ok) return nombre;
  const motivo = motivoNombreInvalido(nombre.valor);
  if (motivo !== null) return invalido("nombre", `${motivo}.`.replace(/\.\.$/, "."));
  return { ok: true, valor: { objetivo: objetivo.valor, nombre: nombre.valor } };
}

export function validarMover(args: Record<string, unknown>): Validado<{ objetivo: string; carpeta: string }> {
  const k = clavesConocidas(args, ["objetivo", "carpeta"]);
  if (!k.ok) return k;
  const objetivo = texto(args, "objetivo");
  if (!objetivo.ok) return objetivo;
  // La carpeta puede ser "" o "/": la raíz del vault.
  if (typeof args.carpeta !== "string") return invalido("carpeta", "falta (una ruta de carpeta, o \"\" para la raíz).");
  return { ok: true, valor: { objetivo: objetivo.valor, carpeta: normalizarObjetivo(args.carpeta).replace(/\/+$/, "") } };
}

export function validarBorrar(args: Record<string, unknown>): Validado<{ objetivo: string }> {
  const k = clavesConocidas(args, ["objetivo"]);
  if (!k.ok) return k;
  const objetivo = texto(args, "objetivo");
  return objetivo.ok ? { ok: true, valor: { objetivo: objetivo.valor } } : objetivo;
}

export function validarPapelera(
  args: Record<string, unknown>,
): Validado<{ accion: "listar" } | { accion: "restaurar"; id: string }> {
  const k = clavesConocidas(args, ["accion", "id"]);
  if (!k.ok) return k;
  const accion = args.accion ?? "listar";
  if (accion === "listar") return { ok: true, valor: { accion } };
  if (accion !== "restaurar") return invalido("accion", "es «listar» o «restaurar».");
  const id = texto(args, "id");
  if (!id.ok) return invalido("id", "para restaurar hace falta el id de la entrada (lo da «listar» o mycelium_borrar).");
  return { ok: true, valor: { accion, id: normalizarObjetivo(id.valor) } };
}

/**
 * El nombre nuevo de un archivo: si el agente escribió la extensión
 * (`Plan 2026.md`), se le quita —el título es el nombre sin ella—; cambiar de
 * extensión no es renombrar.
 */
export function nombreSinExtension(nombre: string, extension: string): string {
  return extension !== "" && nombre.toLowerCase().endsWith(extension.toLowerCase()) && nombre.length > extension.length
    ? nombre.slice(0, nombre.length - extension.length).trim()
    : nombre;
}

// ── El objetivo: una nota o una carpeta ─────────────────────────────────────

export type Afectado<N> = { clase: "nota"; nota: N } | { clase: "carpeta"; carpeta: CarpetaEnlazable };

/**
 * Qué nota o carpeta es el `objetivo`. Una nota, con las reglas de
 * `mycelium_abrir` (ruta o título, `AMBIGUO` con las rutas). Una carpeta, por
 * su ruta (`Área/Proyectos`, también con `/` al final para forzarla) o por su
 * nombre si es la única que se llama así. Si una nota y una carpeta responden
 * a lo mismo, `AMBIGUO`: la carpeta se pide con `/` al final.
 *
 * El grafo, el calendario y los archivos que no se indexan (PDF, imágenes) no
 * se renombran, mueven ni borran por acá: `INVALIDO`.
 */
export function resolverAfectado<N extends NotaEnlazable>(
  objetivo: string,
  notas: readonly N[],
  carpetas: readonly CarpetaEnlazable[],
  otros: readonly { ruta: string }[],
): Validado<Afectado<N>> {
  const crudo = normalizarObjetivo(objetivo);
  const soloCarpeta = /\/$/.test(crudo);
  const o = crudo.replace(/\/+$/, "");
  const bajo = o.toLowerCase();
  if (o === "") return invalido("objetivo", "está vacío.");

  const porRuta = carpetas.find((c) => c.id === o) ?? carpetas.find((c) => c.id.toLowerCase() === bajo);
  const porNombre = carpetas.filter((c) => c.nombre.toLowerCase() === bajo);
  const carpeta = porRuta ?? (porNombre.length === 1 ? porNombre[0] : undefined);
  if (soloCarpeta) {
    if (carpeta) return { ok: true, valor: { clase: "carpeta", carpeta } };
    if (porNombre.length > 1) {
      return error("AMBIGUO", `Hay ${porNombre.length} carpetas «${o}».`, { rutas: porNombre.map((c) => `${c.id}/`).sort() });
    }
    return error("NO_ENCONTRADO", `No hay ninguna carpeta «${o}» en el vault.`, {
      candidatas: carpetasParecidas(o, carpetas),
    });
  }

  const r = resolverObjetivo(o, notas, carpetas, otros);
  switch (r.tipo) {
    case "grafo":
    case "calendario":
      return invalido("objetivo", `«${o}» es una vista de Mycelium, no un archivo: no se renombra, mueve ni borra.`);
    case "archivo":
      return invalido(
        "objetivo",
        `«${r.ruta}» no es una nota (Mycelium no lo indexa): estas herramientas operan notas y carpetas. ` +
          "Ese archivo lo podés mover con la terminal; ningún [[enlace]] se repara.",
      );
    case "nota":
      if (carpeta && porRuta) {
        return error("AMBIGUO", `«${o}» es una nota y también una carpeta.`, { rutas: [r.nota.id, `${carpeta.id}/`] });
      }
      return { ok: true, valor: { clase: "nota", nota: r.nota } };
    case "ambiguo":
      return error("AMBIGUO", `Hay ${r.rutas.length} notas que responden a «${o}».`, { rutas: r.rutas });
    case "no-encontrado":
      if (carpeta) return { ok: true, valor: { clase: "carpeta", carpeta } };
      if (porNombre.length > 1) {
        return error("AMBIGUO", `Hay ${porNombre.length} carpetas «${o}».`, { rutas: porNombre.map((c) => `${c.id}/`).sort() });
      }
      return error("NO_ENCONTRADO", `No hay ninguna nota ni carpeta «${o}» en el vault.`, {
        candidatas: [...r.candidatas, ...carpetasParecidas(o, carpetas, 3)].slice(0, 6),
      });
  }
}

/** Las carpetas cuyo nombre más se parece, como `candidatasParecidas` con las notas. */
export function carpetasParecidas(objetivo: string, carpetas: readonly CarpetaEnlazable[], max = 5): Referencia[] {
  const buscado = plano(normalizarObjetivo(objetivo).replace(/\/+$/, "").split("/").pop() ?? "");
  if (buscado === "") return [];
  return carpetas
    .map((c) => {
      const t = plano(c.nombre);
      let p = 1 - distancia(buscado, t) / Math.max(buscado.length, t.length, 1);
      if (t.includes(buscado) || buscado.includes(t)) p = Math.max(p, 0.6) + 0.2;
      return { c, p };
    })
    .filter((x) => x.p >= 0.5)
    .sort((a, b) => b.p - a.p || a.c.id.localeCompare(b.c.id))
    .slice(0, max)
    .map(({ c }) => ({ titulo: `${c.nombre}/`, ruta: `${c.id}/` }));
}

/**
 * La carpeta de destino de `mycelium_mover`: `""` es la raíz. **Tiene que
 * existir**: crearla sobre la marcha convertiría un typo en una carpeta nueva y
 * una nota perdida en ella. Si no existe, `NO_ENCONTRADO` con las parecidas.
 */
export function resolverDestino(carpeta: string, carpetas: readonly CarpetaEnlazable[]): Validado<CarpetaEnlazable | null> {
  if (carpeta === "") return { ok: true, valor: null };
  const bajo = carpeta.toLowerCase();
  const c = carpetas.find((x) => x.id === carpeta) ?? carpetas.find((x) => x.id.toLowerCase() === bajo);
  if (c) return { ok: true, valor: c };
  return error(
    "NO_ENCONTRADO",
    `No existe la carpeta «${carpeta}». Mover no crea carpetas: creala primero (con la terminal) o elegí una que exista.`,
    { campo: "carpeta", candidatas: carpetasParecidas(carpeta, carpetas) },
  );
}

/** `true` si algo ya ocupa `ruta` (sin distinguir mayúsculas: el disco de Windows no las distingue). */
export function rutaOcupada(ruta: string, ocupadas: Iterable<string>, salvo?: string): boolean {
  const bajo = ruta.toLowerCase();
  for (const o of ocupadas) if (o !== salvo && o.toLowerCase() === bajo) return true;
  return false;
}

// ── El alcance: cuándo pregunta ─────────────────────────────────────────────

/**
 * Renombrar y mover preguntan **solo** si reescriben enlaces en más de estas
 * notas (spec § 1). Renombrar una nota con un par de retroenlaces no pregunta en
 * la app y tampoco por acá; lo que se vigila es el agente que en un bucle
 * reescribiría medio vault (`docs/arquitectura/MCP de Mycelium - control.md`
 * § 3.3).
 */
export const UMBRAL_CONFIRMAR = 5;

/** ¿Hay que preguntarle al usuario? Borrar una carpeta, siempre; una nota, nunca (hay Deshacer). */
export function pidePermiso(op: "renombrar" | "mover" | "borrar", clase: "nota" | "carpeta", notasReescritas: number): boolean {
  if (op === "borrar") return clase === "carpeta";
  return notasReescritas > UMBRAL_CONFIRMAR;
}

/** Cuántos nombres se listan en una respuesta o en una pregunta. */
export const TOPE_LISTA = 10;

/** `A, B, C y 7 más`. */
export function enumerar(nombres: readonly string[], tope = TOPE_LISTA): string {
  if (nombres.length === 0) return "";
  const vistos = nombres.slice(0, tope);
  const resto = nombres.length - vistos.length;
  if (resto > 0) return `${vistos.join(", ")} y ${resto} más`;
  if (vistos.length === 1) return vistos[0];
  return `${vistos.slice(0, -1).join(", ")} y ${vistos[vistos.length - 1]}`;
}

/** El título que se muestra de una ruta: el nombre sin la extensión `.md`. */
export function tituloVisible(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  return nombre.replace(/\.md$/i, "");
}

/** `en la raíz` / `en «Área/Proyectos»`. */
export function dondeQueda(carpeta: string | null): string {
  return carpeta === null || carpeta === "" ? "en la raíz del vault" : `en «${carpeta}»`;
}

/** La pregunta que ve el usuario cuando la IA pide algo de alcance grande. */
export function preguntaConfirmacion(
  op: "renombrar" | "mover" | "borrar",
  clase: "nota" | "carpeta",
  datos: { ruta: string; nombreNuevo?: string; carpetaNueva?: string | null; reescribe: readonly string[]; notasCarpeta?: number },
): { mensaje: string; boton: string } {
  const que = clase === "nota" ? `la nota «${tituloVisible(datos.ruta)}»` : `la carpeta «${datos.ruta}»`;
  const enlaces =
    datos.reescribe.length > 0
      ? `\nEso reescribe enlaces en ${datos.reescribe.length} ${datos.reescribe.length === 1 ? "nota" : "notas"}: ${enumerar(
          datos.reescribe.map(tituloVisible),
          5,
        )}.`
      : "";
  switch (op) {
    case "renombrar":
      return { mensaje: `Claude Code pide renombrar ${que} a «${datos.nombreNuevo}».${enlaces}`, boton: "Renombrar" };
    case "mover":
      return { mensaje: `Claude Code pide mover ${que} ${dondeQueda(datos.carpetaNueva ?? null)}.${enlaces}`, boton: "Mover" };
    case "borrar": {
      const n = datos.notasCarpeta ?? 0;
      const notas = n === 0 ? "Está vacía." : `Manda ${n} ${n === 1 ? "nota" : "notas"} a la papelera de Mycelium.`;
      return { mensaje: `Claude Code pide eliminar ${que}. ${notas}`, boton: "Eliminar" };
    }
  }
}

/** Lo que dice un `RECHAZADO`: es una respuesta, no un error para reintentar. */
export function mensajeRechazo(pedido: string, sinRespuesta: boolean): string {
  const porque = sinRespuesta
    ? `El usuario no contestó a tiempo la pregunta para ${pedido}: se retiró y no se hizo nada.`
    : `El usuario dijo que no a ${pedido}: no se hizo nada.`;
  return (
    `${porque} Es una respuesta, no un error para reintentar: no lo vuelvas a pedir con otras palabras ni en partes, ` +
    "y no lo hagas por otro camino (mv, rm). Contáselo y seguí."
  );
}

// ── El efecto ───────────────────────────────────────────────────────────────

/** Lo que pasó con los enlaces, para el efecto: «reescribió 3 enlaces: A, B y C». */
export function efectoEnlaces(reescritas: readonly string[], fallidas: readonly string[]): string {
  const partes: string[] = [];
  if (reescritas.length === 0) partes.push("No había enlaces que reparar");
  else partes.push(`Reparé los enlaces en ${reescritas.length} ${reescritas.length === 1 ? "nota" : "notas"}: ${enumerar(reescritas.map(tituloVisible))}`);
  if (fallidas.length > 0) {
    partes.push(
      `${fallidas.length === 1 ? "una nota quedó" : `${fallidas.length} notas quedaron`} con el enlace viejo porque no se pudo escribir (${enumerar(
        fallidas,
      )}): arreglalas a mano`,
    );
  }
  return partes.join("; ") + ".";
}

// ── Deshacer ────────────────────────────────────────────────────────────────

/**
 * Lo que hace falta para deshacer una operación de archivos, guardado en el
 * registro de actividad. Cada uno dice **cómo lo dejó** la operación (`ruta`):
 * deshacer solo se aplica si sigue así —si se volvió a renombrar o mover, o se
 * restauró a mano, «cambió después» y no se toca—.
 */
export type DeshacerArchivos =
  /** Deshacer un renombrar: volver a `nombre`, reparando otra vez. */
  | { tipo: "archivo_renombrar"; clase: "nota" | "carpeta"; ruta: string; rutaAntes: string; nombre: string }
  /** Deshacer un mover: volver a `carpeta` (`null` = la raíz), reparando otra vez. */
  | { tipo: "archivo_mover"; clase: "nota" | "carpeta"; ruta: string; rutaAntes: string; carpeta: string | null }
  /** Deshacer un borrar: restaurar de la papelera (y recrear las carpetas que falten). */
  | { tipo: "archivo_restaurar"; clase: "nota" | "carpeta"; ruta: string; notas: string[] }
  /** Deshacer un restaurar: mandarla otra vez a la papelera. */
  | { tipo: "archivo_borrar"; ruta: string };

export function describirDeshacerArchivos(d: DeshacerArchivos): string {
  switch (d.tipo) {
    case "archivo_renombrar":
      return `volver a llamarla «${d.nombre}»`;
    case "archivo_mover":
      return `volver a ${d.carpeta ? `«${d.carpeta}»` : "la raíz"}`;
    case "archivo_restaurar":
      return d.clase === "carpeta" ? `restaurar la carpeta «${d.ruta}» de la papelera` : `restaurar «${tituloVisible(d.ruta)}» de la papelera`;
    case "archivo_borrar":
      return `mandar «${tituloVisible(d.ruta)}» otra vez a la papelera`;
  }
}

/** Lo que hay hoy en el vault, para saber si se puede deshacer. */
export type EstadoVault = {
  notas: ReadonlySet<string>;
  carpetas: ReadonlySet<string>;
  /** Los ids en la papelera; `null` si todavía no se leyó. */
  papelera: ReadonlySet<string> | null;
};

/** El motivo cuando lo que dejó la operación ya no está como lo dejó. */
export const CAMBIO_DESPUES = "cambió después";

/**
 * Si se puede deshacer contra el vault de hoy. Lo renombrado o movido tiene
 * que seguir donde lo dejó la operación y su lugar de antes tiene que estar
 * libre; lo borrado tiene que seguir en la papelera.
 */
export function puedeDeshacerArchivos(e: EstadoVault, d: DeshacerArchivos): { ok: true } | { ok: false; porque: string } {
  const existe = (clase: "nota" | "carpeta", ruta: string) =>
    clase === "nota" ? e.notas.has(ruta) : e.carpetas.has(ruta);
  const ocupada = (ruta: string) => rutaOcupada(ruta, e.notas) || rutaOcupada(ruta, e.carpetas);
  switch (d.tipo) {
    case "archivo_renombrar":
    case "archivo_mover":
      if (!existe(d.clase, d.ruta)) return { ok: false, porque: `${CAMBIO_DESPUES}: ya no está en «${d.ruta}»` };
      if (d.rutaAntes.toLowerCase() !== d.ruta.toLowerCase() && ocupada(d.rutaAntes)) {
        return { ok: false, porque: `«${d.rutaAntes}» está ocupada por otro archivo` };
      }
      if (d.tipo === "archivo_mover" && d.carpeta !== null && !e.carpetas.has(d.carpeta)) {
        return { ok: false, porque: `la carpeta «${d.carpeta}» ya no existe` };
      }
      return { ok: true };
    case "archivo_restaurar":
      if (e.papelera !== null && !d.notas.every((n) => e.papelera!.has(n))) {
        return { ok: false, porque: `${CAMBIO_DESPUES}: ya no está en la papelera` };
      }
      if (d.clase === "nota" && ocupada(d.ruta)) return { ok: false, porque: `«${d.ruta}» está ocupada por otro archivo` };
      return { ok: true };
    case "archivo_borrar":
      return e.notas.has(d.ruta) ? { ok: true } : { ok: false, porque: `${CAMBIO_DESPUES}: ya no está en «${d.ruta}»` };
  }
}

// ── La papelera ─────────────────────────────────────────────────────────────

export type ItemPapelera = { notaId: string; titulo: string; rutaOriginal: string; eliminadoEn: string };

/**
 * Qué restaurar con el `id` de `mycelium_papelera`: la entrada con ese id (la
 * ruta original de la nota), o todas las de una carpeta borrada (`Viejo` o
 * `Viejo/`). Si no hay, `NO_ENCONTRADO` con las parecidas por título.
 */
export function aRestaurar(id: string, items: readonly ItemPapelera[]): Validado<{ clase: "nota" | "carpeta"; ids: string[] }> {
  const bajo = id.replace(/\/+$/, "").toLowerCase();
  const exacta = items.find((i) => i.notaId.toLowerCase() === bajo || i.notaId.toLowerCase() === `${bajo}.md`);
  if (exacta) return { ok: true, valor: { clase: "nota", ids: [exacta.notaId] } };
  const deCarpeta = items.filter((i) => i.notaId.toLowerCase().startsWith(`${bajo}/`));
  if (deCarpeta.length > 0) return { ok: true, valor: { clase: "carpeta", ids: deCarpeta.map((i) => i.notaId) } };
  const porTitulo = items.filter((i) => i.titulo.toLowerCase() === bajo);
  if (porTitulo.length === 1) return { ok: true, valor: { clase: "nota", ids: [porTitulo[0].notaId] } };
  if (porTitulo.length > 1) {
    return error("AMBIGUO", `Hay ${porTitulo.length} entradas «${id}» en la papelera.`, { rutas: porTitulo.map((i) => i.notaId) });
  }
  return error("NO_ENCONTRADO", `No hay nada «${id}» en la papelera.`, {
    candidatas: candidatasParecidas(
      id,
      items.map((i) => ({ id: i.notaId, titulo: i.titulo, carpetaId: null, tipo: "markdown" })),
    ),
  });
}

/** Las carpetas que hay que recrear (de la más alta a la más honda) para restaurar `ids` en su lugar. */
export function carpetasQueFaltan(ids: readonly string[], carpetas: ReadonlySet<string>): string[] {
  const faltan = new Set<string>();
  for (const id of ids) {
    const partes = id.split("/").slice(0, -1);
    for (let i = 1; i <= partes.length; i++) {
      const ruta = partes.slice(0, i).join("/");
      if (!carpetas.has(ruta)) faltan.add(ruta);
    }
  }
  return [...faltan].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}
