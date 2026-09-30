// Validador y expansor de Esporas (plantillas) para la skill
// `mycelium-esporas` (`FUN-L-26`).
//
// Usa la MISMA sustitución que la app (`lib/esporas.ts`) y el MISMO parser de
// propiedades (`lib/frontmatter.ts`), transpilados en el momento. Marca lo que
// en la app sale mal sin avisar: tokens de Obsidian/Templater que quedan
// escritos tal cual, un token desconocido en el frontmatter que deja la nota
// sin propiedades, un `{{fecha}}` entre comillas que produce texto y no fecha…
//
//   node scripts/validar-espora.mjs <espora.md> [--vault <carpeta>]
//   node scripts/validar-espora.mjs <espora.md> --expandir --titulo "Mi nota" [--ahora 2026-09-30T14:05]
//
// Sale con código 1 si hay errores.
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { importarTs } from "./lib-vault-fixture.mjs";

const E = await importarTs("lib/esporas.ts");
const F = await importarTs("lib/frontmatter.ts");

/** Equivalencias de otras herramientas de plantillas → Mycelium. */
const AJENOS = {
  date: "{{fecha}}",
  time: "{{hora}}",
  title: "{{titulo}}",
  "título": "{{titulo}}",
  Titulo: "{{titulo}}",
  Fecha: "{{fecha}}",
  Hora: "{{hora}}",
};

const TOKEN_RE = /\{\{([^{}]*)\}\}/g;

/**
 * `{{date:FORMATO}}` / `{{time:FORMATO}}` de Obsidian (letras de Moment) →
 * `{{fecha:…}}` de Mycelium, como la tabla de equivalencias de la skill:
 * `YYYY`→`AAAA`, `HH`→`hh`; `MM`, `DD`, `mm`, `ss` no cambian. Lo que no tiene
 * equivalente (`dddd`, `MMMM`, `Do`, `A`, `[texto]`…) se señala. `null` si no
 * es un token de Moment.
 */
function deMoment(interior) {
  const m = /^(?:date|time):(.*)$/.exec(interior);
  if (!m) return null;
  const EQUIV = { YYYY: "AAAA", MM: "MM", DD: "DD", HH: "hh", mm: "mm", ss: "ss" };
  const sin = new Set();
  // Tokens de Moment, los largos primero (`MMMM` no es dos `MM`).
  const convertido = m[1].trim().replace(
    /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|A|a|ww|w/g,
    (t) => EQUIV[t] ?? (sin.add(t), t),
  );
  const sugerido = `{{fecha:${convertido}}}`;
  return sin.size ? `${sugerido} — sin equivalente para ${[...sin].join(", ")}` : sugerido;
}

/** Un momento fijo para validar sin depender del reloj. */
const AHORA_PRUEBA = new Date(2026, 8, 30, 14, 5, 9);

export function validarEspora(texto, { rutaEnVault = null, carpetaEsporas = "Esporas" } = {}) {
  const errores = [];
  const avisos = [];
  const err = (codigo, msg) => errores.push({ codigo, msg });
  const av = (codigo, msg) => avisos.push({ codigo, msg });

  if (rutaEnVault !== null) {
    const barra = rutaEnVault.lastIndexOf("/");
    const carpeta = barra === -1 ? "" : rutaEnVault.slice(0, barra);
    if (!rutaEnVault.toLowerCase().endsWith(".md")) err("extension", "Una Espora es una nota: tiene que ser `.md`.");
    if (carpeta !== carpetaEsporas) {
      err("ubicacion", `Está en «${carpeta || "(raíz)"}», no directamente en «${carpetaEsporas}/». Mycelium solo lista las notas de esa carpeta, sin recorrer subcarpetas: no va a aparecer como Espora.`);
    }
  }

  // Dónde termina el frontmatter (en el texto CRUDO de la plantilla).
  const lineas = texto.split("\n");
  let finFm = -1;
  if (lineas[0]?.replace(/\r$/, "") === "---") {
    for (let i = 1; i < lineas.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lineas[i])) {
        finFm = i;
        break;
      }
    }
  }
  const offsetFinFm = finFm === -1 ? -1 : lineas.slice(0, finFm + 1).join("\n").length;

  for (const m of texto.matchAll(TOKEN_RE)) {
    const interior = m[1].trim();
    const enFm = offsetFinFm !== -1 && m.index < offsetFinFm;
    if (interior === "titulo" || interior === "fecha" || interior === "hora" || interior === "cursor") continue;
    if (interior.startsWith("fecha:")) {
      const formato = interior.slice(6).trim();
      if (/YYYY|yyyy|YY\b|\bdd\b|HH/.test(formato)) {
        err("formato", `\`${m[0]}\`: el formato usa letras de otra herramienta. En Mycelium son \`AAAA\` año · \`MM\` mes · \`DD\` día · \`hh\` hora · \`mm\` minuto · \`ss\` segundo; lo demás se copia literal (quedaría «${E.formatearFecha(formato, AHORA_PRUEBA)}»).`);
      } else if (/hh:MM/.test(formato)) {
        av("formato", `\`${m[0]}\`: \`MM\` es el MES; el minuto es \`mm\`.`);
      } else if (!/AAAA|MM|DD|hh|mm|ss/.test(formato)) {
        err("formato", `\`${m[0]}\`: el formato no tiene ningún token (\`AAAA MM DD hh mm ss\`): saldría «${formato}» literal.`);
      }
      continue;
    }
    const ajeno = AJENOS[interior] ?? deMoment(interior);
    const sugerencia = ajeno ? ` Es sintaxis de otra herramienta; en Mycelium: \`${ajeno}\`.` : "";
    if (enFm && !/^\s*[^:]+:\s*["']/.test(lineas[texto.slice(0, m.index).split("\n").length - 1])) {
      err("token-desconocido", `\`${m[0]}\` no es una variable de Mycelium y queda escrito tal cual; en el frontmatter sin comillas se lee como mapa en línea y **la nota creada queda sin propiedades**.${sugerencia}`);
    } else {
      (ajeno ? err : av)("token-desconocido", `\`${m[0]}\` no es una variable de Mycelium: llega a la nota escrito tal cual.${sugerencia}`);
    }
  }
  if (/<%[\s\S]*?%>/.test(texto)) err("templater", "`<% … %>` es Templater (Obsidian): Mycelium no lo ejecuta, llega escrito tal cual.");
  if (/\{\{\s*cursor\s*\}\}/.test(texto)) err("token-desconocido", "No hay `{{cursor}}` en Mycelium: llega a la nota escrito tal cual.");

  // Comillas alrededor de tokens de fecha en el frontmatter: dan TEXTO, no fecha.
  if (finFm !== -1) {
    for (let i = 1; i < finFm; i++) {
      const m = /:\s*["'](\{\{\s*fecha[^}]*\}\})["']\s*$/.exec(lineas[i]);
      // Solo importa si lo sustituido sería una fecha: una hora suelta es texto igual.
      const sale = m ? E.sustituirVariables(m[1], { titulo: "", ahora: AHORA_PRUEBA }) : "";
      if (m && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(sale)) {
        av("fecha-texto", `Línea ${i + 1} «${lineas[i].trim()}»: entre comillas, la propiedad queda de tipo TEXTO. Sin comillas (\`fecha: {{fecha}}\`) queda de tipo fecha.`);
      }
    }
  }

  // El resultado: ¿las propiedades de la nota creada se entienden?
  const resultado = E.sustituirVariables(texto, { titulo: "Título de prueba", ahora: AHORA_PRUEBA });
  const fm = F.separarFrontmatter(resultado);
  if (fm.hay && !fm.soportado) {
    err("frontmatter", `Después de sustituir, el frontmatter no lo entiende Mycelium (${fm.motivo}): la nota creada se ve cruda y sin propiedades.`);
  }
  const propio = F.separarFrontmatter(texto);
  if (propio.hay && !propio.soportado && fm.soportado) {
    av("plantilla-cruda", "La plantilla en sí se ve cruda en Mycelium (un `{{…}}` sin comillas parece un mapa en línea), pero las notas que crea sí tienen propiedades. Es normal y esperable.");
  }
  if (fm.hay && fm.soportado) {
    const tags = fm.props.find((p) => p.clave.toLowerCase() === "tags");
    if (tags && !Array.isArray(tags.valor)) {
      av("tags", "`tags:` con un valor suelto: usá una lista (`tags: [reunion]`) para que cuenten como etiquetas.");
    }
  }

  return { errores, avisos, resultado, propiedades: fm.soportado ? fm.props : [] };
}

/** Lee la carpeta de Esporas configurada en el vault (`.mycelium/preferencias.json`). */
export async function carpetaEsporasDe(vault) {
  try {
    const prefs = JSON.parse(await readFile(resolve(vault, ".mycelium/preferencias.json"), "utf8"));
    const c = E.normalizarCarpetaEsporas(prefs?.preferencias?.carpetaEsporas ?? "");
    return c ?? E.CARPETA_ESPORAS_DEFECTO;
  } catch {
    return E.CARPETA_ESPORAS_DEFECTO;
  }
}

/** Expande una Espora como lo haría la app al crear una nota. */
export function expandir(texto, titulo, ahora = new Date()) {
  return E.sustituirVariables(texto, { titulo, ahora });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
  };
  const conValor = ["--vault", "--titulo", "--ahora"];
  const archivo = args.find((a, i) => !a.startsWith("--") && !conValor.includes(args[i - 1]));
  if (!archivo) {
    console.error("Uso: node scripts/validar-espora.mjs <espora.md> [--vault <carpeta>] [--expandir --titulo T [--ahora AAAA-MM-DDThh:mm]]");
    process.exit(2);
  }
  const texto = await readFile(archivo, "utf8");
  if (args.includes("--expandir")) {
    const a = opt("--ahora");
    const ahora = a ? new Date(`${a}:00`) : new Date();
    process.stdout.write(expandir(texto, opt("--titulo") ?? "Sin título", ahora));
    process.exit(0);
  }
  const vault = opt("--vault");
  const ctx = vault
    ? {
        rutaEnVault: relative(resolve(vault), resolve(archivo)).split(sep).join("/"),
        carpetaEsporas: await carpetaEsporasDe(vault),
      }
    : {};
  const r = validarEspora(texto, ctx);
  for (const e of r.errores) console.log(`ERROR [${e.codigo}] ${e.msg}`);
  for (const a of r.avisos) console.log(`aviso [${a.codigo}] ${a.msg}`);
  if (r.errores.length === 0 && r.avisos.length === 0) console.log("OK: sin errores ni avisos.");
  if (r.propiedades.length > 0) {
    console.log("\nPropiedades de la nota creada (con fecha de prueba 2026-09-30 14:05):");
    for (const p of r.propiedades) console.log(`  ${p.clave}: ${JSON.stringify(p.valor)} (${p.tipo})`);
  }
  process.exit(r.errores.length > 0 ? 1 : 0);
}
