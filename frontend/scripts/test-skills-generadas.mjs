// `lib/ia/skillsGeneradas.ts` y `lib/ia/hookMvRmGenerado.ts` tienen que ser exactamente lo que genera
// `scripts/generar-skills-ia.mjs` a partir de los borradores y los validadores
// (`FUN-L-26`). Si falla: `node scripts/generar-skills-ia.mjs`.
//
//   node --test scripts/test-skills-generadas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { archivosSkills, MARCADOR_VERSION, modulosGenerados } from "./generar-skills-ia.mjs";

test("los módulos generados están al día con los borradores, los validadores y el hook", async () => {
  const modulos = modulosGenerados();
  // El hook de mv/rm va en su propio módulo (`FUN-M-58`): `mcpControl` lo
  // instala sin cargar las skills.
  assert.deepEqual(
    modulos.map((m) => m.ruta),
    ["lib/ia/skillsGeneradas.ts", "lib/ia/hookMvRmGenerado.ts"],
  );
  for (const { ruta, texto } of modulos) {
    const enDisco = (await readFile(fileURLToPath(new URL(`../${ruta}`, import.meta.url)), "utf8")).replace(/\r\n/g, "\n");
    assert.ok(enDisco === texto, `${ruta} está desactualizado: corré \`node scripts/generar-skills-ia.mjs\``);
  }
});

test("cada archivo lleva el marcador de versión y los scripts no importan nada del repo", () => {
  const archivos = archivosSkills();
  assert.equal(archivos.filter((a) => a.ruta.endsWith("/SKILL.md")).length, 7);
  assert.equal(archivos.filter((a) => a.ruta.endsWith(".mjs")).length, 5); // tres validadores, dibujo.mjs y consultar.mjs
  for (const a of archivos) {
    assert.ok(a.contenido.includes(`<!-- mycelium-ia v${MARCADOR_VERSION} -->`), `${a.ruta} sin marca`);
    if (a.ruta.endsWith(".mjs")) {
      const imports = [...a.contenido.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
      assert.ok(imports.length > 0 && imports.every((i) => i.startsWith("node:")), `${a.ruta}: ${imports}`);
    }
  }
});
