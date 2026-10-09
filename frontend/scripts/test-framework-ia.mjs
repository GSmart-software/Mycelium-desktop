// Test headless de `generarFramework` (`lib/ia/framework.ts`): el bloque
// gestionado de `CLAUDE.md` y su migración desde la 1.x (`FUN-L-29`), los
// archivos con prefijo `mycelium` en `.claude/` y el tamaño del núcleo. El
// módulo importa `invoke` de Tauri; acá se reemplaza por un disco en memoria
// antes de transpilarlo, así que no hace falta ni Tauri ni build.
//
//   node --test scripts/test-framework-ia.mjs
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

/** Transpila un módulo TS y lo importa desde memoria. */
async function importarTs(texto) {
  const { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

// Un módulo importado desde `data:` no resuelve imports relativos: las skills
// generadas se cargan aparte y se le pasan por `globalThis`.
const rutaSkills = fileURLToPath(new URL("../lib/ia/skillsGeneradas.ts", import.meta.url));
globalThis.__skillsGeneradas = await importarTs(await readFile(rutaSkills, "utf8"));

const rutaTs = fileURLToPath(new URL("../lib/ia/framework.ts", import.meta.url));
const fuente = (await readFile(rutaTs, "utf8"))
  .replace('import { invoke } from "@tauri-apps/api/core";', "const invoke = (cmd, args) => globalThis.__invoke(cmd, args);")
  .replace(
    'import { MARCADOR_VERSION_IA, SKILLS_GENERADAS } from "./skillsGeneradas";',
    "const { MARCADOR_VERSION_IA, SKILLS_GENERADAS } = globalThis.__skillsGeneradas;",
  );
const mod = await importarTs(fuente);
const { generarFramework, archivosFramework, bloqueGestionado, planificarClaudeMd, FRAMEWORK_IA_VERSION } = mod;

/** Un vault en memoria: ruta relativa → texto. */
function montarVault(inicial = {}) {
  const disco = new Map(Object.entries(inicial));
  globalThis.__invoke = async (cmd, args) => {
    if (cmd === "leer_archivo_texto") return disco.get(args.rutaRel) ?? null;
    if (cmd === "escribir_nota") return void disco.set(args.rutaRel, args.contenido);
    if (cmd === "ia_borrar_anterior") return void disco.delete(args.rutaRel);
    throw new Error(`comando inesperado: ${cmd}`);
  };
  return disco;
}

const BLOQUE = bloqueGestionado();
const BLOQUE_CRLF = bloqueGestionado("\r\n");
const RUTA_JSON = ".claude/mycelium-ia.json";
/** El contenido de un archivo generado, por ruta. */
const generado = (ruta) => archivosFramework().find((a) => a.ruta === ruta)?.contenido;
/** Todo lo que Mycelium le da a la IA, junto: para buscar dónde quedó cada regla. */
const TODO = [BLOQUE, ...archivosFramework().map((a) => a.contenido)].join("\n");
const SKILL = (s) => generado(`.claude/skills/${s}/SKILL.md`);

/** Una fuente de `framework.ts` de un commit viejo, y su versión. */
function fuenteDe(commit) {
  const src = execSync(`git show ${commit}:frontend/lib/ia/framework.ts`).toString();
  return { src, version: src.match(/FRAMEWORK_IA_VERSION = "([^"]+)"/)?.[1] };
}
/** Un template literal (`const NOMBRE = \`…\`;`) de una fuente vieja, evaluado. */
function literalDe({ src, version }, nombre) {
  const m = src.match(new RegExp(`const ${nombre} = (\`[\\s\\S]*?\\n\`);`));
  return m ? new Function("FRAMEWORK_IA_VERSION", `return ${m[1]}`)(version) : null;
}
/** El `CLAUDE.md` que generaba una versión vieja, sacado del historial de git. */
const claudeMdDe = (commit) => literalDe(fuenteDe(commit), "CLAUDE_MD");
const sha = (t) => createHash("sha256").update(t.replace(/\r\n/g, "\n")).digest("hex");

/** Lo que no deja de existir nunca más: el mecanismo de conflictos de la 1.x. */
function sinConflictos(disco) {
  for (const ruta of disco.keys()) {
    assert.ok(!/mycelium-ia v/.test(ruta), `quedó una copia al lado: ${ruta}`);
    assert.notEqual(ruta, "Conflictos instrucciones IA.md");
  }
}

const COMANDOS = ["vault-buscar", "vault-recordar", "vault-mapa", "vault-vincular", "vault-huerfanas", "vault-nota"];
const CONSTANTE = {
  "vault-buscar": "CMD_BUSCAR",
  "vault-recordar": "CMD_RECORDAR",
  "vault-mapa": "CMD_MAPA",
  "vault-vincular": "CMD_VINCULAR",
  "vault-huerfanas": "CMD_HUERFANAS",
  "vault-nota": "CMD_NOTA",
};
/** Los comandos sueltos que escribía una versión vieja. */
function comandosDe(commit) {
  const f = fuenteDe(commit);
  const salida = {};
  for (const c of COMANDOS) {
    const t = literalDe(f, CONSTANTE[c]);
    if (t) salida[`.claude/commands/${c}.md`] = t;
  }
  return salida;
}

// ── El bloque gestionado de CLAUDE.md ───────────────────────────────────────

test("el bloque: marcadores en su línea, versión en el de inicio, núcleo adentro", () => {
  const lineas = BLOQUE.split("\n");
  assert.match(lineas[0], new RegExp(`^<!-- mycelium:inicio v${FRAMEWORK_IA_VERSION.replace(/\./g, "\\.")} .*-->$`));
  assert.equal(lineas.at(-1), "<!-- mycelium:fin -->");
  assert.equal(lineas[1], "# Este vault es tu memoria");
  assert.equal(BLOQUE_CRLF, BLOQUE.replace(/\n/g, "\r\n"));
  assert.ok(!BLOQUE.includes("<!-- mycelium-ia v"), "el bloque no lleva la marca vieja");
});

test("el núcleo no pasa de 2,5 KB (se carga en cada sesión: lo que no entra va a una skill)", () => {
  const bytes = Buffer.byteLength(BLOQUE, "utf8");
  assert.ok(bytes <= 2560, `el bloque pesa ${bytes} bytes`);
});

test("vault vacío: CLAUDE.md es el bloque solo, y se registra la versión", async () => {
  const disco = montarVault();
  const r = await generarFramework("V");
  assert.equal(r.claudeMd, "creado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n`);
  assert.equal(JSON.parse(disco.get(RUTA_JSON)).version, FRAMEWORK_IA_VERSION);
  sinConflictos(disco);
});

test("un CLAUDE.md vacío cuenta como que no hay", async () => {
  const disco = montarVault({ "CLAUDE.md": "\n\n" });
  assert.equal((await generarFramework("V")).claudeMd, "creado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n`);
});

test("CLAUDE.md propio sin bloque: el bloque va arriba y lo del usuario queda debajo, intacto", async () => {
  const mio = "# Mi proyecto\n\nReglas mías.\n";
  const disco = montarVault({ "CLAUDE.md": mio });
  const r = await generarFramework("V");
  assert.equal(r.claudeMd, "insertado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n\n${mio}`);
  assert.ok(disco.get("CLAUDE.md").endsWith(mio));
  sinConflictos(disco);
});

test("CLAUDE.md con bloque: se reemplaza solo el bloque; lo de antes y lo de después, byte a byte", async () => {
  const antes = "Algo mío arriba.\n\n";
  const despues = "\n\n# Mi proyecto\n\nNo tocar.\n";
  const viejo = "<!-- mycelium:inicio v1.9.9 — otro aviso -->\ncualquier cosa\nde otra versión\n<!-- mycelium:fin -->";
  const disco = montarVault({ "CLAUDE.md": antes + viejo + despues });
  const r = await generarFramework("V");
  assert.equal(r.claudeMd, "actualizado");
  assert.equal(disco.get("CLAUDE.md"), antes + BLOQUE + despues);
});

test("regenerar dos veces da lo mismo (idempotente), en todos los casos", async () => {
  for (const inicial of [null, "# Mío\n", "# Mío\r\nCRLF\r\n", claudeMdDe("a347fd1"), `${claudeMdDe("a347fd1")}\n# Agregado\n`]) {
    const disco = montarVault(inicial === null ? {} : { "CLAUDE.md": inicial });
    await generarFramework("V");
    const primera = new Map(disco);
    await generarFramework("V");
    for (const [ruta, texto] of disco) {
      if (ruta === RUTA_JSON) continue; // lleva la fecha de generación
      assert.equal(texto, primera.get(ruta), `${ruta} cambió al regenerar`);
    }
    assert.deepEqual([...disco.keys()].sort(), [...primera.keys()].sort());
  }
});

test("CRLF: el bloque se escribe con los saltos del archivo y lo del usuario queda igual", async () => {
  const mio = "# Mío\r\n\r\nCon CRLF.\r\n";
  const disco = montarVault({ "CLAUDE.md": mio });
  await generarFramework("V");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE_CRLF}\r\n\r\n${mio}`);
  // Con el bloque ya puesto, regenerar no toca un byte de afuera.
  const conBloque = `Arriba\r\n${BLOQUE_CRLF.replace("# Este vault", "# Viejo")}\r\nAbajo\r\n`;
  disco.set("CLAUDE.md", conBloque);
  await generarFramework("V");
  assert.equal(disco.get("CLAUDE.md"), `Arriba\r\n${BLOQUE_CRLF}\r\nAbajo\r\n`);
});

test("un BOM sigue primero; el bloque va después", async () => {
  const disco = montarVault({ "CLAUDE.md": "﻿# Mío\n" });
  await generarFramework("V");
  assert.equal(disco.get("CLAUDE.md"), `﻿${BLOQUE}\n\n# Mío\n`);
  await generarFramework("V");
  assert.equal(disco.get("CLAUDE.md"), `﻿${BLOQUE}\n\n# Mío\n`);
});

test("un marcador citado en medio de una línea no es el bloque", async () => {
  const mio = "Mycelium escribe entre `<!-- mycelium:inicio v…-->` y `<!-- mycelium:fin -->`.\n";
  const disco = montarVault({ "CLAUDE.md": mio });
  assert.equal((await generarFramework("V")).claudeMd, "insertado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n\n${mio}`);
});

test("bloque roto (inicio sin fin): error y no se escribe nada", async () => {
  const roto = "# Mío\n<!-- mycelium:inicio v2.0.0 -->\nsin fin\n";
  const disco = montarVault({ "CLAUDE.md": roto });
  await assert.rejects(generarFramework("V"), /mycelium:fin/);
  assert.equal(disco.get("CLAUDE.md"), roto);
  assert.equal(disco.size, 1, "no se escribió ningún otro archivo");
});

test("CLAUDE.md que generó entero una 1.x, sin tocar: queda el bloque solo", async () => {
  for (const commit of ["371959c", "a347fd1", "0ef85c4"]) {
    const disco = montarVault({ "CLAUDE.md": claudeMdDe(commit) });
    assert.equal((await generarFramework("V")).claudeMd, "reemplazado", commit);
    assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n`, commit);
    sinConflictos(disco);
  }
  // Con los saltos pasados a CRLF por git, también.
  const disco = montarVault({ "CLAUDE.md": claudeMdDe("0ef85c4").replace(/\n/g, "\r\n") });
  assert.equal((await generarFramework("V")).claudeMd, "reemplazado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE_CRLF}\r\n`);
});

test("CLAUDE.md viejo reconocido por la huella que registró la 1.6–1.8 en mycelium-ia.json", async () => {
  const viejo = "<!-- mycelium-ia v1.7.0 -->\n# Uno que no está en la lista\n";
  const disco = montarVault({
    "CLAUDE.md": viejo,
    [RUTA_JSON]: JSON.stringify({ version: "1.7.0", huellas: { "CLAUDE.md": sha(viejo) } }),
  });
  assert.equal((await generarFramework("V")).claudeMd, "reemplazado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n`);
  assert.equal(JSON.parse(disco.get(RUTA_JSON)).huellas, undefined, "la 2.0.0 ya no registra huellas");
});

test("CLAUDE.md de una 1.x editado por el usuario: el bloque arriba y nada se descarta", async () => {
  const editado = `${claudeMdDe("0ef85c4")}\n# Mycelium — guía del proyecto\n\nLo mío.\n`;
  const disco = montarVault({ "CLAUDE.md": editado });
  const r = await generarFramework("V");
  assert.equal(r.claudeMd, "insertado-sobre-anterior");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n\n${editado}`);
  sinConflictos(disco);
  // La próxima vez ya tiene bloque: solo se actualiza el bloque.
  assert.equal((await generarFramework("V")).claudeMd, "actualizado");
  assert.equal(disco.get("CLAUDE.md"), `${BLOQUE}\n\n${editado}`);
});

test("planificarClaudeMd es pura: no lee ni escribe", async () => {
  globalThis.__invoke = () => {
    throw new Error("no debería tocar el disco");
  };
  assert.equal((await planificarClaudeMd(null)).contenido, `${BLOQUE}\n`);
});

// ── Lo de Mycelium lleva prefijo `mycelium` ──────────────────────────────────

test("todo lo que se genera en .claude/ lleva prefijo mycelium", () => {
  for (const { ruta } of archivosFramework()) {
    assert.match(ruta, /^\.claude\/(skills\/mycelium-[a-z]+\/|commands\/mycelium\/)/, ruta);
  }
  assert.ok(!archivosFramework().some((a) => a.ruta === "CLAUDE.md"), "CLAUDE.md no es un archivo de Mycelium");
});

test("los comandos están en commands/mycelium/ con el nombre de siempre", () => {
  for (const c of COMANDOS) assert.ok(generado(`.claude/commands/mycelium/${c}.md`), `falta ${c}`);
});

test("lo de .claude/ con prefijo se sobrescribe aunque se haya editado, y lo demás no se toca", async () => {
  const disco = montarVault({ ".claude/commands/mio.md": "mío", ".claude/agents/x.md": "agente" });
  await generarFramework("V");
  const ruta = ".claude/commands/mycelium/vault-buscar.md";
  disco.set(ruta, `${disco.get(ruta)}\nextra\n`);
  await generarFramework("V");
  assert.equal(disco.get(ruta), generado(ruta));
  assert.equal(disco.get(".claude/commands/mio.md"), "mío");
  assert.equal(disco.get(".claude/agents/x.md"), "agente");
});

// ── Migración de los comandos de la 1.x ─────────────────────────────────────

test("comandos de la 1.x sin tocar: se borran (ya están en commands/mycelium/)", async () => {
  for (const commit of ["371959c", "6b4be4c", "0ef85c4"]) {
    const viejos = comandosDe(commit);
    const disco = montarVault(viejos);
    const r = await generarFramework("V");
    assert.deepEqual(r.borrados.sort(), Object.keys(viejos).sort(), commit);
    assert.deepEqual(r.conservados, []);
    for (const ruta of Object.keys(viejos)) assert.equal(disco.has(ruta), false, `${commit}: quedó ${ruta}`);
  }
  // Con CRLF, también.
  const crlf = Object.fromEntries(Object.entries(comandosDe("0ef85c4")).map(([r, t]) => [r, t.replace(/\n/g, "\r\n")]));
  montarVault(crlf);
  assert.equal((await generarFramework("V")).borrados.length, 6);
});

test("comandos de la 1.x editados por el usuario: se quedan, y se informan", async () => {
  const viejos = comandosDe("0ef85c4");
  const ruta = ".claude/commands/vault-buscar.md";
  const editado = `${viejos[ruta]}\nY además, buscá en mi carpeta Diario.\n`;
  const disco = montarVault({ ...viejos, [ruta]: editado, ".claude/commands/mio.md": "mío" });
  const r = await generarFramework("V");
  assert.deepEqual(r.conservados, [ruta]);
  assert.equal(r.borrados.length, 5);
  assert.equal(disco.get(ruta), editado);
  assert.equal(disco.get(".claude/commands/mio.md"), "mío");
});

test("las huellas cubren cada CLAUDE.md y cada comando que publicó una 1.x", () => {
  const commits = execSync("git log --follow --format=%h -- lib/ia/framework.ts").toString().trim().split("\n");
  const enFuente = new Set(fuente.match(/"[0-9a-f]{64}"/g).map((h) => h.slice(1, -1)));
  let vistos = 0;
  for (const c of commits) {
    const f = fuenteDe(c);
    if (!/^1\./.test(f.version ?? "")) continue;
    vistos++;
    const claude = literalDe(f, "CLAUDE_MD");
    if (claude && /mycelium-ia v1\./.test(claude.split("\n")[0])) {
      assert.ok(enFuente.has(sha(claude)), `falta la huella del CLAUDE.md de ${c}`);
    }
    for (const c2 of COMANDOS) {
      const t = literalDe(f, CONSTANTE[c2]);
      if (!t) continue;
      const h = sha(t.replace(/^<!-- mycelium-ia v[^\n]*-->\n/m, ""));
      assert.ok(enFuente.has(h), `falta la huella de ${c2} de ${c}`);
    }
  }
  assert.ok(vistos > 10, "el historial de git no está disponible");
});

// ── Qué dice el núcleo, y que no se perdió ninguna regla ────────────────────

const SKILLS_TODAS = ["memoria", "vault", "operar", "base", "canvas", "drawio", "excalidraw", "esporas", "calendario"].map(
  (s) => `mycelium-${s}`,
);

test("el núcleo: las dos obligaciones, doce reglas duras y un puntero por skill y comando", () => {
  assert.match(BLOQUE, /\*\*Recuperá antes de responder\.\*\*/);
  assert.match(BLOQUE, /\*\*Consolidá lo que valga recordar\.\*\*/);
  const reglas = BLOQUE.slice(BLOQUE.indexOf("## Reglas duras"), BLOQUE.indexOf("## Skills"));
  assert.equal(reglas.match(/^\d+\. \*\*/gm).length, 12);
  for (const s of SKILLS_TODAS) {
    assert.ok(BLOQUE.includes(`- \`${s}\`:`), `el núcleo no apunta a ${s}`);
    assert.ok(SKILL(s), `el núcleo apunta a ${s}, que no se genera`);
  }
  for (const c of COMANDOS) assert.ok(BLOQUE.includes(`\`/${c}\``), `el núcleo no nombra /${c}`);
  // La regla nueva: lo de Mycelium es lo que lleva prefijo, no todo `.claude/`.
  assert.match(BLOQUE, /prefijo `mycelium`/);
  assert.ok(!/No edites\s+`\.claude\/`/.test(TODO), "quedó «no edites .claude/»");
});

// Cada regla o afirmación del `CLAUDE.md` 1.8.1 y dónde quedó (la tabla está en
// `docs/features/ia-framework-vault.md`). Si una frase se reescribe, se cambia
// acá la frase, no se borra la fila.
const DONDE_QUEDO = [
  // Las dos obligaciones y la anatomía de la memoria.
  ["núcleo", /Recuperá antes de responder/],
  ["núcleo", /Consolidá lo que valga recordar/],
  ["mycelium-memoria", /\*\*El enlace es la unidad de valor\.\*\*/],
  ["mycelium-memoria", /Nota "mapa" \(MOC\)/],
  // Tipos de archivo.
  ["mycelium-vault", /\| `\.drawio` \| \*\*Diagrama formal\*\*/],
  ["mycelium-vault", /validar-<formato>\.mjs/],
  ["mycelium-vault", /Solo las notas están en la memoria/],
  ["mycelium-vault", /«según el archivo `x\.py`»/],
  ["mycelium-vault", /un `\.base` y un `\.canvas` \*\*sí\*\* son destinos válidos/],
  ["mycelium-vault", /\*\*aporta aristas\*\*/],
  ["mycelium-vault", /un `\[\[…\]\]` ahí no crea una asociación/],
  // Protocolos.
  ["mycelium-memoria", /\*\*Entradas\*\*/],
  ["mycelium-memoria", /\*\*Facetas\*\*/],
  ["mycelium-memoria", /ofrecé crear la nota que falta/],
  ["mycelium-memoria", /\*\*Una idea por nota\*\*/],
  ["mycelium-memoria", /\*\*Enlazá hacia adentro\*\*/],
  ["mycelium-memoria", /Fecha y motivo de una decisión|fecha y motivo de una decisión/],
  ["mycelium-memoria", /callouts/],
  // Reglas duras.
  ["núcleo", /\*\*Títulos únicos\*\*/],
  ["mycelium-operar", /buscá `\[\[nombre viejo`/],
  ["mycelium-operar", /Un `rm` no pasa por la\s+papelera/],
  ["mycelium-operar", /`\? : \* \| " < > \\ \/`/],
  ["mycelium-vault", /`\? : \* \| " < > \\ \/`/],
  ["mycelium-vault", /mapas anidados, escalares multilínea/],
  ["mycelium-vault", /con moderación/],
  ["mycelium-vault", /leer, solo `recordatorios\.json`/],
  ["mycelium-vault", /`preferencias\.json`/],
  ["mycelium-vault", /No escondas ahí documentación que el usuario deba ver/],
  ["mycelium-vault", /\*\*partí de ella\*\*/],
  ["mycelium-vault", /copiarla deja `\{\{fecha\}\}` escrito/],
  // Operar Mycelium.
  ["mycelium-operar", /El contenido va por los archivos; operar la app va por Mycelium/],
  ["mycelium-operar", /`mycelium_estado`: si su pestaña figura \*\*sin guardar\*\*/],
  ["mycelium-operar", /\*\*no le roba el foco\*\*/],
  ["mycelium-operar", /`NO_ENCONTRADO` trae las notas más parecidas/],
  ["mycelium-operar", /\*\*Lo reversible no pregunta\*\*/],
  ["mycelium-operar", /más de 5 notas/],
  ["mycelium-operar", /`RECHAZADO`: \*\*es una respuesta, no un error\*\*/],
  ["mycelium-operar", /una errata no se agrega, se corrige/],
  ["mycelium-operar", /diccionario \*\*de Mycelium\*\*/],
  ["mycelium-operar", /`CAMBIOS_SIN_GUARDAR`/],
  ["mycelium-operar", /MYCELIUM_SIN_MCP=1/],
  ["mycelium-operar", /el usuario agrega la palabra con el clic derecho/],
  // Qué es Mycelium por fuera.
  ["mycelium-vault", /\*\*renombrar una nota escribiendo en su título\*\*/],
  ["mycelium-vault", /\*\*editor modal\*\* de un dibujo/],
  ["mycelium-vault", /\*\*terminal integrada\*\*/],
  ["mycelium-vault", /exportación a Markdown\/PDF\/carpeta/],
];

test("ninguna regla del CLAUDE.md 1.8.1 se perdió: cada una está donde dice la spec", () => {
  for (const [donde, frase] of DONDE_QUEDO) {
    const texto = donde === "núcleo" ? BLOQUE : SKILL(donde);
    assert.match(texto, frase, `${donde} no dice ${frase}`);
  }
});

test("mycelium-vault: .mycignore con negaciones, y DEF-131 no vuelve", () => {
  const vault = SKILL("mycelium-vault");
  assert.match(vault, /`!patrón` → \*\*negación\*\*/);
  assert.ok(!/sin negaciones|no hay\s+negaciones/.test(vault));
  assert.match(vault, /\| Embed de nota \| `!\[\[Título\]\]` \| \*\*No se dibuja\*\*/);
  assert.match(vault, /Hacer clic en ella no hace nada/);
  assert.ok(!/píldora/i.test(vault), "una #etiqueta no es una píldora clicable (DEF-131)");
});

// ── Las skills por herramienta (`FUN-L-26`) ─────────────────────────────────

const SKILLS = ["drawio", "canvas", "excalidraw", "base", "esporas", "calendario", "operar"].map((s) => `mycelium-${s}`);
const VALIDADORES = ["drawio", "canvas", "excalidraw"].map(
  (f) => `.claude/skills/mycelium-${f}/validar-${f}.mjs`,
);

test("genera las skills y los tres validadores, con la versión puesta", async () => {
  const disco = montarVault();
  await generarFramework("V");
  for (const s of SKILLS) {
    const skill = disco.get(`.claude/skills/${s}/SKILL.md`);
    assert.ok(skill, `falta la skill ${s}`);
    assert.match(skill, new RegExp(`^---\\nname: ${s}\\n`));
    assert.ok(skill.includes(`<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->`), `${s} sin marca de versión`);
  }
  for (const v of VALIDADORES) {
    const js = disco.get(v);
    assert.ok(js, `falta ${v}`);
    assert.ok(js.split("\n")[0].startsWith(`// <!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->`), `${v}: la marca no está en la primera línea`);
    assert.ok(!js.includes("#!/usr/bin/env node"), `${v}: quedó el shebang`);
  }
  for (const [ruta, texto] of disco) assert.ok(!texto.includes("{{VERSION_IA}}"), `${ruta}: quedó el marcador sin reemplazar`);
});

test("regenerar restaura un validador tocado", async () => {
  const disco = montarVault();
  await generarFramework("V");
  const ruta = VALIDADORES[0];
  const original = disco.get(ruta);
  disco.set(ruta, `${original}\n// retocado\n`);
  await generarFramework("V");
  assert.equal(disco.get(ruta), original);
});

test("ninguna instrucción manda a no editar .drawio ni .excalidraw", () => {
  assert.ok(!/no editar a mano/i.test(TODO));
});

// ── El calendario por MCP (`FUN-L-09`, Parte 2) ─────────────────────────────

const HERRAMIENTAS_CALENDARIO = [
  "mycelium_recordatorios",
  "mycelium_recordatorio_crear",
  "mycelium_recordatorio_editar",
  "mycelium_recordatorio_completar",
  "mycelium_recordatorio_borrar",
];

test("el calendario se modifica solo por MCP: núcleo, vault y operar lo dicen", () => {
  assert.match(BLOQUE, /calendario y diccionario, solo por MCP/);
  assert.match(SKILL("mycelium-vault"), /El calendario se\s+modifica solo con las herramientas `mycelium_recordatorio_\*`/);
  assert.match(SKILL("mycelium-operar"), /registro de\s+actividad/);
  assert.match(SKILL("mycelium-operar"), /no escribas `\.mycelium\/recordatorios\.json` ni `\.mycelium\/diccionario\.txt`/);
});

test("la skill del calendario lee por MCP primero y modifica solo por MCP", () => {
  const skill = SKILL("mycelium-calendario");
  assert.match(skill, /^description: .*SOLO con las herramientas mycelium_recordatorio_\*/m);
  assert.ok(skill.indexOf("mycelium_recordatorios") < skill.indexOf("consultar.mjs"), "primero la herramienta, después el script");
  for (const h of HERRAMIENTAS_CALENDARIO) assert.ok(skill.includes(h), `la skill no menciona ${h}`);
  assert.match(skill, /Nunca escribas en `\.mycelium\/`/);
  assert.match(skill, /\*\*Si no tenés esas herramientas\*\*/);
  // Y el script sigue viajando con la skill.
  assert.ok(archivosFramework().some((a) => a.ruta === ".claude/skills/mycelium-calendario/consultar.mjs"));
});

// ── Archivos por MCP y el hook de mv/rm (`FUN-L-09`, Parte 3) ───────────────

test("la regla dura 2 manda a la herramienta, y mv solo sin MCP (con los enlaces a cargo de la IA)", () => {
  const regla = BLOQUE.slice(BLOQUE.indexOf("2. **Renombrar"), BLOQUE.indexOf("3. **Nada huérfano"));
  assert.ok(regla.indexOf("`mycelium_renombrar`") < regla.indexOf("`mv`"), "primero la herramienta");
  assert.match(regla, /`_borrar`/);
  assert.match(regla, /los enlaces los arreglás vos/);
  const operar = SKILL("mycelium-operar");
  assert.match(operar, /papelera de Mycelium/);
  assert.match(operar, /Renombrar o mover con `mv` \*\*no repara nada\*\*/);
});

// El script del hook es la fuente de verdad (`scripts/hook-mv-rm.mjs`): se
// importa tal cual y se prueba su decisión con un disco de mentira.
const hook = await import(new URL("./hook-mv-rm.mjs", import.meta.url).href);
const VAULT = "C:\\V";
const DISCO = {
  "C:\\V\\Plan.md": "archivo",
  "C:\\V\\docs": "carpeta",
  "C:\\V\\docs\\Idea.md": "archivo",
  "C:\\V\\img.png": "archivo",
  "C:\\V\\.claude": "carpeta",
};
const decidir = (comando, extra = {}) =>
  hook.decidir({ comando, cwd: VAULT, vault: VAULT, control: true, tipo: (r) => DISCO[r] ?? null, ...extra });

test("el hook frena mv y rm sobre notas y carpetas del vault", { skip: process.platform !== "win32" && "rutas de Windows" }, () => {
  assert.deepEqual(decidir("mv Plan.md 'Plan 2026.md'"), { verbo: "mv", rutas: ["Plan.md"] });
  assert.deepEqual(decidir("rm -rf docs"), { verbo: "rm", rutas: ["docs"] });
  assert.deepEqual(decidir("cd docs && git mv Idea.md ../Idea.md", { cwd: "C:\\V\\docs" }), { verbo: "mv", rutas: ["docs/Idea.md"] });
  assert.deepEqual(decidir("Move-Item -Path docs\\Idea.md -Destination .; Remove-Item Plan.md"), { verbo: "mv+rm", rutas: ["docs/Idea.md", "Plan.md"] });
  assert.deepEqual(decidir("rm docs/*.md"), { verbo: "rm", rutas: ["docs/*.md"] });
});

test("el hook deja pasar lo que no es una nota, el escape, y todo con el control apagado", { skip: process.platform !== "win32" && "rutas de Windows" }, () => {
  assert.equal(decidir("mv img.png fotos/"), null, "un archivo que no se indexa");
  assert.equal(decidir("rm -rf .claude/hooks"), null, "lo que empieza con punto");
  assert.equal(decidir("rm C:\\Otro\\Plan.md"), null, "fuera del vault");
  assert.equal(decidir("MYCELIUM_SIN_MCP=1 mv Plan.md Otra.md"), null, "el escape explícito");
  assert.equal(decidir("mv Plan.md Otra.md", { control: false }), null);
  assert.equal(decidir("git status && ls docs"), null);
  assert.equal(decidir("cat Plan.md | grep rm"), null, "rm como argumento no es el verbo");
});

test("el motivo nombra la herramienta que corresponde y el escape", () => {
  const m = hook.motivo({ verbo: "mv", rutas: ["Plan.md"] });
  assert.match(m, /mycelium_renombrar \/ mycelium_mover/);
  assert.doesNotMatch(m, /mycelium_borrar/);
  assert.match(hook.motivo({ verbo: "rm", rutas: ["docs"] }), /mycelium_borrar: va a la papelera/);
  assert.match(m, /MYCELIUM_SIN_MCP=1 delante/);
});

test("el hook generado viaja con la marca y sin dependencias", () => {
  const { HOOK_MV_RM, MARCADOR_VERSION_IA } = globalThis.__skillsGeneradas;
  assert.ok(HOOK_MV_RM.startsWith(`// <!-- mycelium-ia v${MARCADOR_VERSION_IA} -->`));
  assert.ok(HOOK_MV_RM.includes("export function decidir"));
  assert.ok(!/from\s+["'](?!node:)/.test(HOOK_MV_RM), "solo módulos node:");
});

// La fusión con el `.claude/settings.json` del usuario.
const settings = await import(
  `data:text/javascript,${encodeURIComponent(
    ts.transpileModule(await readFile(fileURLToPath(new URL("../lib/ia/hookMvRm.ts", import.meta.url)), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )}`
);

test("settings.json: sin archivo se crea con nuestro hook; con hooks del usuario, se agrega sin pisar nada", () => {
  const nuevo = settings.fusionarSettings(null);
  assert.equal(nuevo.creado, true);
  assert.deepEqual(JSON.parse(nuevo.texto), { hooks: { PreToolUse: [settings.entradaHook()] } });
  const delUsuario = {
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "echo mio" }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo despues" }] }],
    },
  };
  const f = settings.fusionarSettings(JSON.stringify(delUsuario));
  const o = JSON.parse(f.texto);
  assert.deepEqual(o.permissions, delUsuario.permissions);
  assert.deepEqual(o.hooks.PostToolUse, delUsuario.hooks.PostToolUse);
  assert.deepEqual(o.hooks.PreToolUse, [delUsuario.hooks.PreToolUse[0], settings.entradaHook()]);
  // Otra vez: ya estaba, no cambia nada.
  assert.equal(settings.fusionarSettings(f.texto).cambia, false);
  // Un archivo roto no se toca.
  assert.throws(() => settings.fusionarSettings("{ esto no"), /no es JSON válido/);
  assert.throws(() => settings.fusionarSettings('{"hooks": {"PreToolUse": {}}}'), /no es una lista/);
});

test("settings.json: quitar deja lo del usuario; si no queda nada, se puede borrar", () => {
  const conUsuario = settings.fusionarSettings('{"permissions": {"allow": []}}').texto;
  const q = settings.quitarDeSettings(conUsuario);
  assert.equal(q.cambia, true);
  assert.deepEqual(JSON.parse(q.texto), { permissions: { allow: [] } });
  assert.deepEqual(settings.quitarDeSettings(settings.fusionarSettings(null).texto), { texto: null, cambia: true });
  assert.equal(settings.scriptLibre(null), true);
  assert.equal(settings.scriptLibre("// mi script"), false, "un archivo del usuario no se pisa");
  assert.equal(settings.scriptLibre(globalThis.__skillsGeneradas.HOOK_MV_RM), true);
});

// ── El diccionario del vault por MCP (`FUN-L-09`, Parte 4) ──────────────────

test("mycelium-operar enseña mycelium_diccionario y para qué sirve", () => {
  const operar = SKILL("mycelium-operar");
  assert.ok(operar.includes("`mycelium_diccionario`"), "falta mycelium_diccionario");
  assert.match(operar, /términos propios de este vault/);
  assert.match(operar, /diccionario \*\*de Mycelium\*\*/);
});

test("el diccionario del vault no se escribe a mano", () => {
  assert.match(SKILL("mycelium-vault"), /el diccionario solo con\s+`mycelium_diccionario`/);
});
