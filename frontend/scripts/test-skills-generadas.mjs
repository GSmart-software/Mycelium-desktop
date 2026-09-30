// `lib/ia/skillsGeneradas.ts` tiene que ser exactamente lo que genera
// `scripts/generar-skills-ia.mjs` a partir de los borradores y los validadores
// (`FUN-L-26`). Si falla: `node scripts/generar-skills-ia.mjs`.
//
//   node --test scripts/test-skills-generadas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { archivosSkills, generarModulo, MARCADOR_VERSION } from "./generar-skills-ia.mjs";

const rutaGenerado = fileURLToPath(new URL("../lib/ia/skillsGeneradas.ts", import.meta.url));

test("skillsGeneradas.ts está al día con los borradores y los validadores", async () => {
  const enDisco = (await readFile(rutaGenerado, "utf8")).replace(/\r\n/g, "\n");
  assert.ok(
    enDisco === generarModulo(),
    "lib/ia/skillsGeneradas.ts está desactualizado: corré `node scripts/generar-skills-ia.mjs`",
  );
});

test("cada archivo lleva el marcador de versión y los scripts no importan nada del repo", () => {
  const archivos = archivosSkills();
  assert.equal(archivos.filter((a) => a.ruta.endsWith("/SKILL.md")).length, 6);
  assert.equal(archivos.filter((a) => a.ruta.endsWith(".mjs")).length, 4); // tres validadores y dibujo.mjs
  for (const a of archivos) {
    assert.ok(a.contenido.includes(`<!-- mycelium-ia v${MARCADOR_VERSION} -->`), `${a.ruta} sin marca`);
    if (a.ruta.endsWith(".mjs")) {
      const imports = [...a.contenido.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
      assert.ok(imports.length > 0 && imports.every((i) => i.startsWith("node:")), `${a.ruta}: ${imports}`);
    }
  }
});
