// Validador de archivos `.base` para la skill `mycelium-base` (`FUN-L-26`).
//
// Usa el MISMO parser y evaluador que la app (`lib/bases.ts`, transpilado en el
// momento), así que no hay dos implementaciones que puedan divergir. Encima de
// eso marca lo que la app acepta **sin quejarse pero hace mal**: el parser de
// Mycelium es tolerante y varias escrituras plausibles dan una tabla
// equivocada en silencio (un comentario al final de una línea, `&&`, `now()`,
// un número entre comillas, un `sort` en línea…). Con `--vault` además evalúa
// la base contra un vault real y muestra las filas que saldrían.
//
//   node scripts/validar-base.mjs <archivo.base> [--vault <carpeta>] [--json] [--filas N]
//
// Sale con código 1 si hay errores.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { carpetasDelVault, importarTs, notasDelVault } from "./lib-vault-fixture.mjs";

const B = await importarTs("lib/bases.ts", "export { parsearYaml, analizar, METODOS };");

/** Campos `file.*` que entiende `valoresDe` (lib/bases.ts). */
export const CAMPOS_FILE = new Set(["name", "basename", "path", "folder", "ext", "ctime", "mtime", "size", "tags"]);

/** Claves de nivel superior que Mycelium modela. */
const RAIZ_MODELADA = new Set(["filters", "views", "properties"]);
/** Claves de Obsidian que Mycelium conoce pero NO modela: la tabla se ve, no se edita desde la UI. */
const RAIZ_OBSIDIAN = new Set(["formulas", "summaries"]);
/** Claves de una vista que Mycelium modela. */
const VISTA_MODELADA = new Set(["type", "name", "limit", "order", "sort", "filters"]);
/** Claves de vista de Obsidian que Mycelium ignora (la vista se dibuja igual). */
const VISTA_OBSIDIAN = new Set(["groupBy", "summaries", "columnSize", "rowHeight", "cardSize", "image", "imageFit", "imageAspectRatio"]);

const esMapa = (n) => typeof n === "object" && n !== null && !Array.isArray(n);

/** Quita lo que está entre comillas, para buscar símbolos solo en el código. */
function sinLiterales(s) {
  return s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""');
}

/** Todas las expresiones (texto) de un árbol de filtros ya parseado. */
function expresiones(filtro) {
  if (filtro === null) return [];
  if (filtro.tipo === "expr" || filtro.tipo === "opaco") return [filtro.fuente];
  return filtro.hijos.flatMap(expresiones);
}

/** Todos los escalares de un nodo YAML crudo (para buscar comentarios en línea). */
function escalares(nodo) {
  if (typeof nodo === "string") return [nodo];
  if (Array.isArray(nodo)) return nodo.flatMap(escalares);
  if (esMapa(nodo)) return Object.values(nodo).flatMap(escalares);
  return [];
}

/** La propiedad a la que apunta una referencia (`note.x` → `x`), o null si es `file.*`. */
function claveDe(ref) {
  if (ref.startsWith("file.") || ref === "file") return null;
  return ref.startsWith("note.") ? ref.slice(5) : ref;
}

/**
 * Valida el texto de un `.base`. `contexto` (opcional) trae las notas y
 * carpetas de un vault para los avisos que dependen de él y para evaluar.
 * Devuelve `{ errores, avisos, base, vistas }`; `vistas` solo con contexto.
 */
export function validarBase(texto, contexto = null) {
  const errores = [];
  const avisos = [];
  const err = (codigo, msg) => errores.push({ codigo, msg });
  const av = (codigo, msg) => avisos.push({ codigo, msg });

  let crudo;
  let base;
  try {
    crudo = B.parsearYaml(texto);
    base = B.parsearBase(texto);
  } catch (e) {
    err("yaml", `El YAML no se entiende: ${e.message}. Mycelium muestra el error y el archivo como texto.`);
    return { errores, avisos, base: null, vistas: [] };
  }

  // ── Nivel superior ──
  for (const clave of Object.keys(crudo)) {
    if (RAIZ_MODELADA.has(clave)) continue;
    if (RAIZ_OBSIDIAN.has(clave)) {
      av("no-modelada", `\`${clave}\` es de Obsidian y Mycelium no lo modela: la tabla se ve, pero los botones Filtros/Columnas quedan deshabilitados y lo que dependa de él sale vacío.`);
    } else {
      err("clave-desconocida", `\`${clave}\` no es una clave de un .base (son \`filters\`, \`properties\`, \`views\`); se ignora en silencio.`);
    }
  }
  if (crudo.views === undefined) av("sin-vistas", "Sin `views`: Mycelium muestra una tabla «Tabla» con solo el nombre de cada nota.");
  else if (!Array.isArray(crudo.views)) err("vistas", "`views` tiene que ser una lista (`- type: table …`).");

  if (crudo.properties !== undefined) {
    if (!esMapa(crudo.properties)) err("properties", "`properties` tiene que ser un mapa `clave: { displayName: … }`.");
    else {
      for (const [clave, cfg] of Object.entries(crudo.properties)) {
        if (!esMapa(cfg) || typeof cfg.displayName !== "string") {
          av("properties", `\`properties.${clave}\` no tiene \`displayName\`: es lo único que Mycelium lee de ahí.`);
        }
      }
    }
  }

  // Comentarios al final de una línea: el parser NO los quita, pasan a ser parte del valor.
  for (const s of escalares(crudo)) {
    if (/\s#/.test(sinLiterales(s))) {
      err("comentario", `«${s}»: Mycelium no admite comentarios al final de una línea; el \`# …\` pasa a formar parte del valor. Poné el comentario en su propia línea.`);
    }
  }

  // ── Vistas ──
  const vistasCrudas = Array.isArray(crudo.views) ? crudo.views : [];
  vistasCrudas.forEach((v, i) => {
    const nombre = esMapa(v) && typeof v.name === "string" ? v.name : `Vista ${i + 1}`;
    if (!esMapa(v)) return;
    if (v.type === undefined) av("tipo", `La vista «${nombre}» no dice \`type\`; se asume \`table\`.`);
    for (const k of Object.keys(v)) {
      if (VISTA_MODELADA.has(k)) continue;
      if (VISTA_OBSIDIAN.has(k)) av("no-modelada", `La vista «${nombre}» usa \`${k}\`: Mycelium lo ignora (la tabla se ve sin eso) y deshabilita los botones de edición.`);
      else err("clave-vista", `La vista «${nombre}» usa \`${k}\`, que no existe${k === "columns" ? " (las columnas van en `order`)" : ""}; se ignora en silencio.`);
    }
    if (v.limit !== undefined) {
      const n = Number(v.limit);
      if (typeof v.limit !== "string" || !Number.isFinite(n) || n <= 0) err("limit", `La vista «${nombre}»: \`limit: ${JSON.stringify(v.limit)}\` no es un entero positivo; se ignora en silencio.`);
    }
    if (v.order !== undefined && !Array.isArray(v.order)) err("order", `La vista «${nombre}»: \`order\` tiene que ser una lista de columnas.`);
    if (v.sort !== undefined) {
      if (!Array.isArray(v.sort)) err("sort", `La vista «${nombre}»: \`sort\` tiene que ser una lista de \`- property: … / direction: …\`.`);
      else {
        for (const s of v.sort) {
          if (!esMapa(s) || typeof s.property !== "string") {
            err("sort", `La vista «${nombre}»: el criterio de orden ${JSON.stringify(s)} no es \`- property: x\` en bloque (el formato en línea \`[{…}]\` no se entiende); se ignora en silencio.`);
          } else if (s.direction !== undefined && !/^(asc|desc)$/i.test(String(s.direction))) {
            av("direction", `La vista «${nombre}»: \`direction: ${s.direction}\` no es ASC ni DESC; se ordena ascendente.`);
          }
        }
      }
    }
  });

  base.vistas.forEach((v) => {
    if (v.noSoportada) err("vista", `La vista «${v.nombre}»: ${v.noSoportada} No se dibuja.`);
  });

  // ── Expresiones ──
  const todos = [base.filtros, ...base.vistas.map((v) => v.filtros)];
  for (const o of todos.flatMap(B.opacosDe)) {
    if (o.motivo.startsWith("combinador desconocido") && /[=<>!(]/.test(o.fuente)) {
      // `- estado == "a: b"`: el YAML ve `clave: valor` y parte la expresión.
      err("dos-puntos", `Una expresión tiene «: » (dos puntos y espacio) y el YAML la partió en clave y valor (quedó \`${o.fuente}\`); ni las comillas lo evitan. Reescribila sin «: » (p. ej. \`.contains()\` con un tramo sin los dos puntos). Mycelium NO muestra la tabla.`);
      continue;
    }
    err("filtro", `El filtro \`${o.fuente}\` no se entiende (${o.motivo}). Mycelium NO muestra la tabla: muestra el error.`);
  }
  const refs = new Set();
  for (const fuente of todos.flatMap(expresiones)) {
    const codigo = sinLiterales(fuente);
    if (/&&|\|\|/.test(codigo)) {
      err("js", `\`${fuente}\`: \`&&\` y \`||\` no existen; se evalúa como una comparación rara y da un resultado equivocado sin error. Usá \`and:\` / \`or:\` con una expresión por línea.`);
      continue;
    }
    if (/^\s*!/.test(codigo) || /===|!==/.test(codigo)) {
      err("js", `\`${fuente}\`: no hay \`!\`, \`===\` ni \`!==\`. Para negar, envolvé la expresión en \`not:\`; para comparar, \`==\` / \`!=\`.`);
      continue;
    }
    const e = B.analizar(fuente);
    if (!e) continue; // ya reportado como opaco
    if (e.clase === "comparacion") {
      const derecha = fuente.slice(fuente.indexOf(e.op) + e.op.length).trim();
      if (/\(/.test(sinLiterales(derecha))) {
        err("llamada-derecha", `\`${fuente}\`: el lado derecho de una comparación tiene que ser un valor literal; \`${derecha}\` se compara como TEXTO y el resultado es falso o verdadero sin sentido. No hay \`now()\`/\`today()\`: escribí la fecha, \`"2026-10-01"\`.`);
      }
      if ([">", "<", ">=", "<="].includes(e.op) && /^["'][-+]?\d+(\.\d+)?["']$/.test(derecha)) {
        av("numero-comillas", `\`${fuente}\`: el número va entre comillas, así que se compara como texto ("10" < "9"). Sacale las comillas.`);
      }
    }
    if (e.clase === "llamada" && !B.METODOS.has(e.metodo)) continue; // ya reportado como opaco
    if (e.clase === "llamada" && e.ref === "file" && !["hasTag", "inFolder", "hasProperty"].includes(e.metodo)) {
      err("filtro", `\`${fuente}\`: \`file.${e.metodo}()\` no existe; las funciones de archivo son \`hasTag\`, \`inFolder\` y \`hasProperty\`. Para un campo, \`file.name.${e.metodo}(…)\`. Mycelium NO muestra la tabla.`);
    }
    if (e.clase === "llamada" && e.ref !== "file" && ["hasTag", "inFolder", "hasProperty"].includes(e.metodo)) {
      err("filtro", `\`${fuente}\`: \`${e.metodo}()\` es una función del archivo, se escribe \`file.${e.metodo}(…)\`. Así, Mycelium NO muestra la tabla.`);
    }
    if (e.clase === "llamada" && e.ref === "file" && e.args.length === 0) {
      err("filtro", `\`${fuente}\`: le falta el argumento.`);
    }
    refs.add(e.ref);
    if (e.clase === "llamada" && e.ref === "file" && e.metodo === "hasProperty" && e.args[0]) refs.add(e.args[0].texto);
  }

  // Referencias de columnas y de orden.
  const refsColumnas = new Set();
  for (const v of base.vistas) {
    for (const c of v.columnas) refsColumnas.add(c);
    for (const o of v.orden) refsColumnas.add(o.propiedad);
  }

  for (const ref of [...refs, ...refsColumnas]) {
    if (ref === "file") continue;
    if (ref.startsWith("file.") && !CAMPOS_FILE.has(ref.slice(5))) {
      err("campo-file", `\`${ref}\` no existe; los campos del archivo son ${[...CAMPOS_FILE].map((c) => `file.${c}`).join(", ")}. Un campo inexistente vale «vacío» en todas las notas, sin error.`);
    }
    if (ref.startsWith("formula.")) {
      (refs.has(ref) ? err : av)("formula", `\`${ref}\`: Mycelium no calcula fórmulas; ${refs.has(ref) ? "en un filtro vale «vacío» en todas las notas (compara falso, `!=` verdadero) sin error" : "la columna sale vacía"}.`);
    }
    if (ref === "file.ctime" || ref === "file.mtime") {
      if (refs.has(ref)) av("fecha-indice", `\`${ref}\` no es la fecha del archivo sino la del índice de Mycelium (cuándo lo indexó / registró su último cambio, ISO UTC). Para fechas confiables usá una propiedad (\`creada: 2026-09-30\`).`);
    }
  }

  // ── Lo que depende del vault ──
  const vistas = [];
  if (contexto) {
    const claves = new Set(contexto.notas.flatMap((n) => n.props.map((p) => p.clave.toLowerCase())));
    for (const ref of [...refs, ...refsColumnas]) {
      const clave = claveDe(ref);
      if (clave === null || ref.startsWith("formula.") || /[()\s"']/.test(clave)) continue;
      if (!claves.has(clave.toLowerCase())) {
        av("propiedad-desconocida", `\`${ref}\`: ninguna nota del vault tiene la propiedad \`${clave}\` (¿typo?). Propiedades existentes: ${[...claves].sort().join(", ") || "ninguna"}.`);
      }
    }
    const tags = new Set(contexto.notas.flatMap((n) => n.tags.map((t) => t.toLowerCase())));
    for (const fuente of todos.flatMap(expresiones)) {
      const e = B.analizar(fuente);
      if (!e || e.clase !== "llamada" || e.ref !== "file") continue;
      for (const a of e.args) {
        if (e.metodo === "hasTag") {
          const t = a.texto.replace(/^#/, "").toLowerCase();
          if (!tags.has(t)) {
            const anidadas = [...tags].filter((x) => x.startsWith(`${t}/`));
            av("etiqueta", anidadas.length > 0
              ? `\`${fuente}\`: ninguna nota tiene \`#${t}\` exacta; \`hasTag\` NO incluye las anidadas (${anidadas.join(", ")}). Listalas: \`file.hasTag("${anidadas.join('", "')}")\`.`
              : `\`${fuente}\`: ninguna nota del vault tiene la etiqueta \`#${t}\`.`);
          }
        }
        if (e.metodo === "inFolder") {
          const c = a.texto.replace(/\/+$/, "");
          if (!contexto.carpetas.has(c)) {
            const parecida = [...contexto.carpetas].find((x) => x.toLowerCase() === c.toLowerCase());
            av("carpeta", `\`${fuente}\`: la carpeta «${c}» no existe${parecida ? ` (existe «${parecida}»: \`inFolder\` distingue mayúsculas)` : ""}.`);
          }
        }
      }
    }

    for (const v of base.vistas) {
      const t = B.construirTabla(base, v, contexto.notas);
      vistas.push({ nombre: v.nombre, tabla: t, base });
      if (t.ok && contexto.carpetaEsporas) {
        const moldes = t.filas.filter((f) => f.nota.carpeta === contexto.carpetaEsporas);
        if (moldes.length > 0) {
          av("esporas", `La vista «${v.nombre}» incluye ${moldes.length} plantilla(s) de «${contexto.carpetaEsporas}/» (${moldes.map((f) => f.nota.nombre).join(", ")}). Las Esporas son notas y entran en las bases: excluilas con \`not:\` + \`file.inFolder("${contexto.carpetaEsporas}")\`.`);
        }
      }
    }
  }

  return { errores, avisos, base, vistas };
}

/** Contexto de evaluación a partir de una carpeta de vault. */
export async function contextoDeVault(vault) {
  let carpetaEsporas = "Esporas";
  try {
    const prefs = JSON.parse(await readFile(resolve(vault, ".mycelium/preferencias.json"), "utf8"));
    if (typeof prefs?.preferencias?.carpetaEsporas === "string") carpetaEsporas = prefs.preferencias.carpetaEsporas;
  } catch {
    /* sin preferencias: el default */
  }
  return { notas: await notasDelVault(vault), carpetas: await carpetasDelVault(vault), carpetaEsporas };
}

/** Texto legible de una celda. */
function celda(valores) {
  if (valores === undefined || valores.length === 0) return "—";
  return valores.join(", ");
}

export function informe(r, { filas = 20 } = {}) {
  const lineas = [];
  for (const e of r.errores) lineas.push(`ERROR [${e.codigo}] ${e.msg}`);
  for (const a of r.avisos) lineas.push(`aviso [${a.codigo}] ${a.msg}`);
  if (r.errores.length === 0 && r.avisos.length === 0) lineas.push("OK: sin errores ni avisos.");
  for (const v of r.vistas) {
    lineas.push("", `── Vista «${v.nombre}» ──`);
    if (!v.tabla.ok) {
      lineas.push(`  NO SE MUESTRA: ${v.tabla.motivo}${v.tabla.expresion ? ` (${v.tabla.expresion})` : ""}`);
      continue;
    }
    const t = v.tabla;
    lineas.push(`  ${t.total} nota(s)${t.recortadas ? `, ${t.recortadas} ocultas por el límite` : ""}`);
    lineas.push(`  | ${t.columnas.map((c) => B.tituloColumna(v.base, c)).join(" | ")} |`);
    for (const f of t.filas.slice(0, filas)) lineas.push(`  | ${f.celdas.map(celda).join(" | ")} |`);
    if (t.filas.length > filas) lineas.push(`  … y ${t.filas.length - filas} más`);
  }
  return lineas.join("\n");
}

// ── CLI ──
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
  };
  const archivo = args.find((a, i) => !a.startsWith("--") && !["--vault", "--filas"].includes(args[i - 1]));
  if (!archivo) {
    console.error("Uso: node scripts/validar-base.mjs <archivo.base> [--vault <carpeta>] [--json] [--filas N]");
    process.exit(2);
  }
  const vault = opt("--vault");
  const texto = await readFile(archivo, "utf8");
  const r = validarBase(texto, vault ? await contextoDeVault(vault) : null);
  if (args.includes("--json")) {
    console.log(JSON.stringify({
      errores: r.errores,
      avisos: r.avisos,
      vistas: r.vistas.map((v) => (v.tabla.ok
        ? { nombre: v.nombre, ok: true, columnas: v.tabla.columnas, total: v.tabla.total, filas: v.tabla.filas.map((f) => f.nota.id) }
        : { nombre: v.nombre, ok: false, motivo: v.tabla.motivo })),
    }, null, 2));
  } else {
    console.log(informe(r, { filas: Number(opt("--filas") ?? 20) }));
  }
  process.exit(r.errores.length > 0 ? 1 : 0);
}
