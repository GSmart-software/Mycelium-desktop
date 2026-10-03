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

// ── Archivos por MCP y el hook de mv/rm (`FUN-L-09`, Parte 3) ───────────────

const HERRAMIENTAS_ARCHIVOS = ["mycelium_renombrar", "mycelium_mover", "mycelium_borrar", "mycelium_papelera"];

test("«Operar Mycelium» enseña las cuatro de archivos y qué hacer con un RECHAZADO", () => {
  const operar = CLAUDE_NUEVO.slice(CLAUDE_NUEVO.indexOf("## Operar Mycelium"), CLAUDE_NUEVO.indexOf("## Qué es Mycelium por fuera"));
  for (const h of HERRAMIENTAS_ARCHIVOS) assert.ok(operar.includes(`\`${h}\``), `falta ${h} en «Operar Mycelium»`);
  assert.match(operar, /más de 5 notas/);
  assert.match(operar, /`RECHAZADO`: \*\*es una respuesta, no un error\*\*/);
  assert.match(operar, /MYCELIUM_SIN_MCP=1/);
});

test("la regla dura 2 manda a la herramienta, y mv solo sin MCP (con los enlaces a cargo de la IA)", () => {
  const regla = CLAUDE_NUEVO.slice(CLAUDE_NUEVO.indexOf("2. **Para renombrar"), CLAUDE_NUEVO.indexOf("3. **Nada huérfano"));
  assert.match(regla, /^2\. \*\*Para renombrar o mover, usá la herramienta\*\*/);
  assert.ok(regla.indexOf("`mycelium_renombrar`") < regla.indexOf("`mv`"), "primero la herramienta");
  assert.match(regla, /`mycelium_borrar`: va a la \*\*papelera de Mycelium\*\*/);
  assert.match(regla, /\*\*los enlaces los\s+arreglás vos\*\*/);
  assert.ok(!/Un \\`mv\\` desde la terminal —que es\s+como renombrás—/.test(CLAUDE_NUEVO), "ya no dice que la IA renombra con mv");
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

test("«Operar Mycelium» enseña mycelium_diccionario y para qué sirve", () => {
  const operar = CLAUDE_NUEVO.slice(CLAUDE_NUEVO.indexOf("## Operar Mycelium"), CLAUDE_NUEVO.indexOf("## Qué es Mycelium por fuera"));
  assert.ok(operar.includes("`mycelium_diccionario`"), "falta mycelium_diccionario en «Operar Mycelium»");
  assert.match(operar, /términos propios de este vault/);
  assert.match(operar, /no escribas `\.mycelium\/recordatorios\.json` ni `\.mycelium\/diccionario\.txt`/);
  assert.match(operar, /diccionario \*\*de Mycelium\*\*/);
});

test("la regla 8 dice que el diccionario del vault no se escribe a mano", () => {
  const regla = CLAUDE_NUEVO.slice(CLAUDE_NUEVO.indexOf("8. **No toques**"), CLAUDE_NUEVO.indexOf("9. **Visibilidad**"));
  assert.match(regla, /`\.mycelium\/diccionario\.txt`\): solo con\s+`mycelium_diccionario`, nunca a mano/);
});
