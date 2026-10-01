// Test headless de `generarFramework` (`lib/ia/framework.ts`): cuándo se
// sobrescribe un archivo del framework y cuándo la versión nueva va al lado
// (`DEF-118`). El módulo importa `invoke` de Tauri; acá se reemplaza por un
// disco en memoria antes de transpilarlo, así que no hace falta ni Tauri ni build.
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
const { generarFramework, archivosFramework, FRAMEWORK_IA_VERSION } = mod;

/** Un vault en memoria: ruta relativa → texto. */
function montarVault(inicial = {}) {
  const disco = new Map(Object.entries(inicial));
  globalThis.__invoke = async (cmd, args) => {
    if (cmd === "leer_archivo_texto") return disco.get(args.rutaRel) ?? null;
    if (cmd === "escribir_nota") return void disco.set(args.rutaRel, args.contenido);
    throw new Error(`comando inesperado: ${cmd}`);
  };
  return disco;
}

const CLAUDE_NUEVO = archivosFramework().find((a) => a.ruta === "CLAUDE.md").contenido;
const COPIA = `CLAUDE (mycelium-ia v${FRAMEWORK_IA_VERSION}).md`;

/** El `CLAUDE.md` que generaba una versión vieja, sacado del historial de git. */
function claudeMdDe(commit) {
  const src = execSync(`git show ${commit}:frontend/lib/ia/framework.ts`).toString();
  const version = src.match(/FRAMEWORK_IA_VERSION = "([^"]+)"/)[1];
  const literal = src.match(/const CLAUDE_MD = (`[\s\S]*?\n`);/)[1];
  return new Function("FRAMEWORK_IA_VERSION", `return ${literal}`)(version);
}

test("vault vacío: escribe todo y registra la huella del CLAUDE.md", async () => {
  const disco = montarVault();
  assert.deepEqual(await generarFramework("V"), []);
  assert.equal(disco.get("CLAUDE.md"), CLAUDE_NUEVO);
  const json = JSON.parse(disco.get(".claude/mycelium-ia.json"));
  assert.equal(json.version, FRAMEWORK_IA_VERSION);
  assert.match(json.huellas["CLAUDE.md"], /^[0-9a-f]{64}$/);
});

test("regenerar sobre lo recién generado lo sobrescribe sin conflicto", async () => {
  const disco = montarVault();
  await generarFramework("V");
  assert.deepEqual(await generarFramework("V"), []);
  assert.equal(disco.has(COPIA), false);
});

test("un CLAUDE.md generado y ampliado a mano NO se pisa (DEF-118)", async () => {
  const disco = montarVault();
  await generarFramework("V");
  const ampliado = `${CLAUDE_NUEVO}\n\n# Mi proyecto\n\nNotas propias.\n`;
  disco.set("CLAUDE.md", ampliado);
  const conflictos = await generarFramework("V");
  assert.deepEqual(conflictos, [{ original: "CLAUDE.md", generado: COPIA }]);
  assert.equal(disco.get("CLAUDE.md"), ampliado);
  assert.equal(disco.get(COPIA), CLAUDE_NUEVO);
  assert.ok(disco.has("Conflictos instrucciones IA.md"));
});

test("un CLAUDE.md viejo (1.2.0) sin tocar se actualiza aunque no haya huellas", async () => {
  const disco = montarVault({ "CLAUDE.md": claudeMdDe("a347fd1") });
  assert.deepEqual(await generarFramework("V"), []);
  assert.equal(disco.get("CLAUDE.md"), CLAUDE_NUEVO);
});

test("un CLAUDE.md viejo con marca pero ampliado va al lado aunque no haya huellas", async () => {
  const ampliado = `${claudeMdDe("a347fd1")}\n# Mycelium — guía del proyecto\n`;
  const disco = montarVault({ "CLAUDE.md": ampliado });
  assert.equal((await generarFramework("V")).length, 1);
  assert.equal(disco.get("CLAUDE.md"), ampliado);
});

test("los saltos CRLF no cuentan como edición", async () => {
  const disco = montarVault();
  await generarFramework("V");
  disco.set("CLAUDE.md", CLAUDE_NUEVO.replace(/\n/g, "\r\n"));
  assert.deepEqual(await generarFramework("V"), []);
});

test("si el usuario adopta la copia generada, la próxima vez se reconoce", async () => {
  const disco = montarVault({ "CLAUDE.md": "# Mío, sin marca\n" });
  await generarFramework("V");
  disco.set("CLAUDE.md", disco.get(COPIA));
  disco.delete(COPIA);
  assert.deepEqual(await generarFramework("V"), []);
});

test("lo de .claude/ se sobrescribe aunque se haya editado", async () => {
  const disco = montarVault();
  await generarFramework("V");
  const ruta = ".claude/commands/vault-buscar.md";
  disco.set(ruta, `${disco.get(ruta)}\nextra\n`);
  assert.deepEqual(await generarFramework("V"), []);
  assert.equal(disco.get(ruta), archivosFramework().find((a) => a.ruta === ruta).contenido);
});

test("un archivo sin marca sigue yendo al lado (comportamiento previo)", async () => {
  const disco = montarVault({ "CLAUDE.md": "# Mis instrucciones\n" });
  assert.equal((await generarFramework("V")).length, 1);
  assert.equal(disco.get("CLAUDE.md"), "# Mis instrucciones\n");
});

// ── Las skills por herramienta (`FUN-L-26`) ─────────────────────────────────

const SKILLS = ["drawio", "canvas", "excalidraw", "base", "esporas", "calendario"].map((s) => `mycelium-${s}`);
const VALIDADORES = ["drawio", "canvas", "excalidraw"].map(
  (f) => `.claude/skills/mycelium-${f}/validar-${f}.mjs`,
);

test("genera las seis skills y los tres validadores, con la versión puesta", async () => {
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

test("regenerar no da conflictos y restaura un validador tocado", async () => {
  const disco = montarVault();
  await generarFramework("V");
  const ruta = VALIDADORES[0];
  const original = disco.get(ruta);
  disco.set(ruta, `${original}\n// retocado\n`);
  assert.deepEqual(await generarFramework("V"), []);
  assert.equal(disco.get(ruta), original);
});

test("CLAUDE.md lista cada skill y ya no manda a no editar .drawio ni .excalidraw", () => {
  for (const s of SKILLS) assert.ok(CLAUDE_NUEVO.includes(`skill \`${s}\``), `CLAUDE.md no menciona ${s}`);
  assert.ok(!/no editar a mano/i.test(CLAUDE_NUEVO));
});

test("HUELLAS_CLAUDE_MD_PREVIAS cubre cada CLAUDE.md publicado hasta la 1.6.0", () => {
  const commits = execSync("git log --follow --format=%h -- lib/ia/framework.ts").toString().trim().split("\n");
  const enFuente = new Set(fuente.match(/"[0-9a-f]{64}"/g).map((h) => h.slice(1, -1)));
  for (const c of commits) {
    const texto = claudeMdDe(c);
    if (!/mycelium-ia v1\.[0-6]\.\d/.test(texto.split("\n")[0])) continue;
    const h = createHash("sha256").update(texto.replace(/\r\n/g, "\n")).digest("hex");
    assert.ok(enFuente.has(h), `falta la huella del CLAUDE.md de ${c}`);
  }
});

// ── El calendario por MCP (`FUN-L-09`, Parte 2) ─────────────────────────────

const HERRAMIENTAS_CALENDARIO = [
  "mycelium_recordatorios",
  "mycelium_recordatorio_crear",
  "mycelium_recordatorio_editar",
  "mycelium_recordatorio_completar",
  "mycelium_recordatorio_borrar",
];

test("«Operar Mycelium» enseña las cinco herramientas del calendario", () => {
  const operar = CLAUDE_NUEVO.slice(CLAUDE_NUEVO.indexOf("## Operar Mycelium"));
  for (const h of HERRAMIENTAS_CALENDARIO) assert.ok(operar.includes(`\`${h}\``), `falta ${h} en «Operar Mycelium»`);
  assert.match(CLAUDE_NUEVO, /registro de\s+actividad/);
  // La regla 8 sigue: leer sí, escribir en .mycelium/ nunca, y el calendario solo por MCP.
  assert.match(CLAUDE_NUEVO, /calendario se \*\*modifica solo\*\* con las herramientas/);
  assert.ok(!/Solo lectura\. \|/.test(CLAUDE_NUEVO), "la fila de la skill ya no dice solo lectura");
});

test("la skill del calendario lee por MCP primero y modifica solo por MCP", () => {
  const skill = archivosFramework().find((a) => a.ruta === ".claude/skills/mycelium-calendario/SKILL.md").contenido;
  assert.match(skill, /^description: .*SOLO con las herramientas mycelium_recordatorio_\*/m);
  assert.ok(skill.indexOf("mycelium_recordatorios") < skill.indexOf("consultar.mjs"), "primero la herramienta, después el script");
  for (const h of HERRAMIENTAS_CALENDARIO) assert.ok(skill.includes(h), `la skill no menciona ${h}`);
  assert.match(skill, /Nunca escribas en `\.mycelium\/`/);
  assert.match(skill, /\*\*Si no tenés esas herramientas\*\*/);
  // Y el script sigue viajando con la skill.
  assert.ok(archivosFramework().some((a) => a.ruta === ".claude/skills/mycelium-calendario/consultar.mjs"));
});
