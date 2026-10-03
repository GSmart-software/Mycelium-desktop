import { test } from "node:test";
import assert from "node:assert/strict";
import { sondearMcp } from "../lib/sonda-mcp.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("la sonda del MCP marca un ejecutable roto y un servidor que no responde", () => {
  const d = mkdtempSync(join(tmpdir(), "sonda-"));
  const roto = join(d, "roto.json");
  writeFileSync(roto, JSON.stringify({ mcpServers: { m: { command: "C:mycelium-evalbinno.exe" } } }));
  assert.match(sondearMcp(roto)[0], /no existe el ejecutable/);
  assert.match(sondearMcp(join(d, "no.json"))[0], /no existe el config/);
  const mudo = join(d, "mudo.json");
  writeFileSync(mudo, JSON.stringify({ mcpServers: { m: { command: process.execPath } } }));
  const falso = () => ({ stdout: "", stderr: "" });
  assert.match(sondearMcp(mudo, { ejecutar: falso })[0], /no respondió tools\/list/);
  const bien = () => ({
    stdout: [
      { id: 2, result: { tools: [{ name: "vault_buscar" }] } },
      { id: 3, result: { content: [{ text: "INDEXANDO" }], isError: true } },
    ].map((m) => JSON.stringify(m)).join("\n"),
  });
  assert.deepEqual(sondearMcp(mudo, { ejecutar: bien }), [], "un arranque en frío es un servidor que anda");
});
