// Generador de `lib/ia/skillsGeneradas.ts` (`FUN-L-26`, parte D) y de
// `lib/ia/hookMvRmGenerado.ts` (`FUN-M-58`).
//
// Las skills de las herramientas del vault se escriben como Markdown en
// `lib/ia/borradores/` (ahí las leen sus tests) y tres de ellas viajan con su
// validador (`scripts/validar-{drawio,canvas,excalidraw}.mjs`); la de Excalidraw,
// además, con su generador (`scripts/dibujo-excalidraw.mjs` → `dibujo.mjs`), y la de
// calendario con su consulta (`scripts/consultar-recordatorios-vault.mjs` → `consultar.mjs`). Pegarlos a mano
// dentro de template literals obligaría a escapar backticks y `${…}` —los
// borradores de calendario y Excalidraw traen JavaScript—, y una copia a mano se
// desincroniza. Este script los lee y escribe un módulo con cada contenido como
// `JSON.stringify`: los borradores y los validadores son la FUENTE DE VERDAD.
//
//   node scripts/generar-skills-ia.mjs              (regenera el módulo)
//   node scripts/generar-skills-ia.mjs --comprobar  (exit 1 si está desactualizado)
//
// Correlo cada vez que cambie un borrador o un validador que viaja.
// `scripts/test-skills-generadas.mjs` falla si alguien se olvidó.
//
// Marca de versión: cada borrador lleva `<!-- mycelium-ia v{{VERSION_IA}} -->` y
// cada script que viaja recibe en su primera línea (en lugar del shebang) un
// comentario con esa misma marca. `framework.ts` reemplaza `{{VERSION_IA}}` por
// `FRAMEWORK_IA_VERSION` al generar, así la marca `<!-- mycelium-ia v` que usa
// `generarFramework` para saber que un archivo es suyo está también en los `.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const SALIDA = "lib/ia/skillsGeneradas.ts";
/**
 * El hook de `mv`/`rm` va en su propio módulo (`FUN-M-58`, C-H4 de la
 * auditoría de eficiencia del 2026-11-01): lo instala `lib/mcpControl.ts` cada
 * vez que se abre un vault con el control encendido, y `mcpControl` carga con
 * el workspace. Sacado de `skillsGeneradas.ts` (353 KB de texto), ese módulo
 * entero deja de entrar en el arranque: el hook solo pesa ~6 KB.
 */
const SALIDA_HOOK = "lib/ia/hookMvRmGenerado.ts";
export const MARCADOR_VERSION = "{{VERSION_IA}}";

/**
 * Las skills generadas. `validador` es el script que viaja con la skill y se
 * escribe en `.claude/skills/<nombre>/<basename del validador>`, que es la ruta
 * que el borrador le indica a la IA. `adjuntos` son otros scripts que viajan con
 * ella, con el nombre que tienen en el vault (`{ fuente: nombre en el vault }`).
 * Solo viajan scripts sin dependencias: los validadores de bases y Esporas
 * transpilan módulos del repo y no funcionarían en un vault.
 */
export const SKILLS = [
  { nombre: "mycelium-drawio", validador: "scripts/validar-drawio.mjs" },
  { nombre: "mycelium-canvas", validador: "scripts/validar-canvas.mjs" },
  {
    nombre: "mycelium-excalidraw",
    validador: "scripts/validar-excalidraw.mjs",
    adjuntos: { "scripts/dibujo-excalidraw.mjs": "dibujo.mjs" },
  },
  { nombre: "mycelium-base" },
  { nombre: "mycelium-esporas" },
  {
    nombre: "mycelium-calendario",
    adjuntos: { "scripts/consultar-recordatorios-vault.mjs": "consultar.mjs" },
  },
  // El MCP de control (`FUN-L-09`): lo que era «Operar Mycelium» del `CLAUDE.md`
  // hasta el framework 2.0.0 (`FUN-L-29`), sin la tabla de herramientas (la
  // dice la `description` de cada una).
  { nombre: "mycelium-operar" },
];

const leer = (rel) => readFileSync(resolve(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const nombreDe = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

/** Falla si el script importa algo que no sea un módulo propio de Node. */
function comprobarSinDependencias(rel, texto) {
  const especificadores = [
    ...texto.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm),
    ...texto.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ...texto.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ...texto.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  const ajenos = especificadores.filter((e) => !e.startsWith("node:"));
  if (ajenos.length > 0) {
    throw new Error(`${rel} no puede viajar al vault: importa ${ajenos.join(", ")} (solo se admite node:*)`);
  }
}

/** Contenido de la SKILL.md, con la marca de versión normalizada. */
function skillMd(nombre) {
  const rel = `lib/ia/borradores/${nombre}.md`;
  const texto = leer(rel);
  const marca = `<!-- mycelium-ia v${MARCADOR_VERSION} -->`;
  if (!texto.includes(marca)) throw new Error(`${rel} no tiene la marca ${marca}`);
  if (!new RegExp(`^---\\nname: ${nombre}\\n`).test(texto)) {
    throw new Error(`${rel} no empieza con el frontmatter de la skill (name: ${nombre})`);
  }
  return texto;
}

/** Contenido de un script que viaja: la marca reemplaza al shebang. */
function scriptMjs(nombre, rel, de = `skill ${nombre}`) {
  const texto = leer(rel);
  comprobarSinDependencias(rel, texto);
  const cabecera =
    `// <!-- mycelium-ia v${MARCADOR_VERSION} --> generado por Mycelium (${de}); ` +
    "no editar: se regenera desde Configuración → Vault.";
  return `${cabecera}\n${texto.replace(/^#![^\n]*\n/, "")}`;
}

/**
 * El hook `PreToolUse` que frena `mv`/`rm` sobre notas (`FUN-L-09`, Parte 3).
 * No es parte de una skill ni del framework que se genera siempre: lo instala
 * `lib/mcpControl.ts` solo con el control encendido. Viaja por acá por lo
 * mismo que los validadores: escrito a mano dentro de un template literal
 * habría que escapar cada barra de sus expresiones regulares.
 */
export const HOOK_MV_RM = "scripts/hook-mv-rm.mjs";

export function hookMvRm() {
  return scriptMjs("hook", HOOK_MV_RM, "hook del control de la IA");
}

/**
 * El hook `PostToolUse` que avisa de las referencias sin enlazar (`FUN-S-10`).
 * Este sí es del framework: lo instala `generarFramework` siempre.
 */
export const HOOK_REFERENCIAS = "scripts/hook-referencias.mjs";

export function hookReferencias() {
  return scriptMjs("hook", HOOK_REFERENCIAS, "hook de las referencias sin enlazar");
}

/** Los archivos que viajan al vault (ruta relativa → contenido con marcador). */
export function archivosSkills() {
  const archivos = [];
  for (const { nombre, validador, adjuntos = {} } of SKILLS) {
    archivos.push({ ruta: `.claude/skills/${nombre}/SKILL.md`, contenido: skillMd(nombre) });
    if (validador) {
      archivos.push({
        ruta: `.claude/skills/${nombre}/${nombreDe(validador)}`,
        contenido: scriptMjs(nombre, validador),
      });
    }
    for (const [fuente, destino] of Object.entries(adjuntos)) {
      archivos.push({ ruta: `.claude/skills/${nombre}/${destino}`, contenido: scriptMjs(nombre, fuente) });
    }
  }
  // La ruta que cada borrador le dice a la IA tiene que ser la que se genera.
  for (const { nombre, validador } of SKILLS) {
    const skill = archivos.find((a) => a.ruta === `.claude/skills/${nombre}/SKILL.md`).contenido;
    for (const m of skill.matchAll(/\.claude\/skills\/[\w.-]+\/[\w.-]+\.mjs/g)) {
      if (!archivos.some((a) => a.ruta === m[0])) {
        throw new Error(`el borrador de ${nombre} manda a correr ${m[0]}, que no se genera`);
      }
    }
    if (validador && !skill.includes(`.claude/skills/${nombre}/${nombreDe(validador)}`)) {
      throw new Error(`el borrador de ${nombre} no dice cómo correr su validador`);
    }
  }
  return archivos;
}

/** El texto de `lib/ia/skillsGeneradas.ts`. */
export function generarModulo() {
  const entradas = archivosSkills()
    .map((a) => `  {\n    ruta: ${JSON.stringify(a.ruta)},\n    contenido: ${JSON.stringify(a.contenido)},\n  },`)
    .join("\n");
  return `// GENERADO por scripts/generar-skills-ia.mjs — NO EDITAR A MANO.
// Fuente: lib/ia/borradores/*.md y los scripts que viajan con su skill
// (scripts/validar-{drawio,canvas,excalidraw}.mjs, scripts/dibujo-excalidraw.mjs,
// scripts/consultar-recordatorios-vault.mjs) y el hook de las referencias
// (scripts/hook-referencias.mjs). El de mv/rm va aparte, en hookMvRmGenerado.ts.
// Para regenerar:
//
//   node scripts/generar-skills-ia.mjs
//
// \`${MARCADOR_VERSION}\` lo reemplaza \`framework.ts\` por FRAMEWORK_IA_VERSION.

/** Marcador de versión dentro de los contenidos. */
export const MARCADOR_VERSION_IA = ${JSON.stringify(MARCADOR_VERSION)};

/** Skills de las herramientas del vault y sus scripts (ruta → contenido). */
export const SKILLS_GENERADAS: readonly { ruta: string; contenido: string }[] = [
${entradas}
];

/** El hook \`PostToolUse\` de las referencias sin enlazar (lo instala \`generarFramework\`). */
export const HOOK_REFERENCIAS: string = ${JSON.stringify(hookReferencias())};
`;
}

/** El texto de `lib/ia/hookMvRmGenerado.ts`. */
export function generarModuloHook() {
  return `// GENERADO por scripts/generar-skills-ia.mjs — NO EDITAR A MANO.
// Fuente: scripts/hook-mv-rm.mjs. Para regenerar:
//
//   node scripts/generar-skills-ia.mjs
//
// Va aparte de skillsGeneradas.ts para que lib/mcpControl.ts lo instale sin
// cargar todas las skills (FUN-M-58). \`${MARCADOR_VERSION}\` lo reemplaza
// lib/mcpControl.ts por FRAMEWORK_IA_VERSION.

/** Marcador de versión dentro del script (el mismo que en skillsGeneradas.ts). */
export const MARCADOR_VERSION_IA = ${JSON.stringify(MARCADOR_VERSION)};

/** El hook \`PreToolUse\` que frena \`mv\`/\`rm\` sobre notas (lo instala \`lib/mcpControl.ts\`). */
export const HOOK_MV_RM: string = ${JSON.stringify(hookMvRm())};
`;
}

/** Los módulos generados: ruta relativa → texto esperado. */
export function modulosGenerados() {
  return [
    { ruta: SALIDA, texto: generarModulo() },
    { ruta: SALIDA_HOOK, texto: generarModuloHook() },
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const comprobar = process.argv.includes("--comprobar");
  let desactualizado = false;
  for (const { ruta, texto } of modulosGenerados()) {
    const rutaSalida = resolve(RAIZ, ruta);
    if (comprobar) {
      let actual = "";
      try {
        actual = readFileSync(rutaSalida, "utf8").replace(/\r\n/g, "\n");
      } catch {}
      if (actual !== texto) {
        console.error(`${ruta} está desactualizado: corré node scripts/generar-skills-ia.mjs`);
        desactualizado = true;
      } else {
        console.log(`${ruta} al día.`);
      }
    } else {
      writeFileSync(rutaSalida, texto);
      const n = ruta === SALIDA ? `${archivosSkills().length} archivos, ` : "";
      console.log(`${ruta}: ${n}${Math.round(Buffer.byteLength(texto) / 1024)} KB.`);
    }
  }
  if (desactualizado) process.exit(1);
}
