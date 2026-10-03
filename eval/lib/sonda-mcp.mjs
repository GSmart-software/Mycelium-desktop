// Antes de una tanda con brazo `mcp`: el servidor del `--mcp-config` arranca, da
// sus herramientas y contesta una búsqueda sobre el vault.
//
// Por qué (tesina, 2026-09-25): un `mcp.json` con las rutas rotas (las barras
// invertidas comidas por la shell al generarlo) hizo que Claude Code no cargara
// el servidor, y el brazo MCP corrió 45 corridas con grep sin que nada lo
// marcara. Claude Code no falla si un servidor no arranca: sigue sin él.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Prueba cada servidor del config. Devuelve la lista de problemas (vacía si
 * todo anda). `ejecutar` se inyecta en los tests.
 */
export function sondearMcp(rutaConfig, { ejecutar = spawnSync } = {}) {
  if (!existsSync(rutaConfig)) return [`no existe el config ${rutaConfig}`];
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(rutaConfig, "utf8"));
  } catch (e) {
    return [`el config no es JSON: ${e.message}`];
  }
  const servidores = Object.entries(cfg.mcpServers ?? {});
  if (!servidores.length) return ["el config no declara ningún servidor"];
  const problemas = [];
  for (const [nombre, s] of servidores) {
    if (!s.command || !existsSync(s.command)) {
      problemas.push(`${nombre}: no existe el ejecutable «${s.command}»`);
      continue;
    }
    for (const [k, val] of Object.entries(s.env ?? {}))
      if (/^MYCELIUM_(VAULT|DIR_APP)$/.test(k) && !existsSync(val)) problemas.push(`${nombre}: ${k} apunta a una carpeta que no existe: «${val}»`);
    const msgs = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sonda", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vault_buscar", arguments: { consulta: "nota", limite: 1 } } },
    ];
    const p = ejecutar(s.command, s.args ?? [], {
      input: msgs.map((m) => JSON.stringify(m)).join("\n") + "\n",
      env: { ...process.env, ...(s.env ?? {}) },
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
    });
    const respuestas = new Map();
    for (const l of String(p.stdout ?? "").split("\n")) {
      try {
        const m = JSON.parse(l);
        if (m.id != null) respuestas.set(m.id, m);
      } catch {
        // líneas que no son JSON-RPC
      }
    }
    const herramientas = (respuestas.get(2)?.result?.tools ?? []).map((t) => t.name);
    if (!herramientas.includes("vault_buscar")) {
      problemas.push(`${nombre}: no respondió tools/list con vault_buscar${p.stderr ? ` (stderr: ${String(p.stderr).slice(0, 200)})` : ""}`);
      continue;
    }
    const r = respuestas.get(3)?.result;
    const texto = (r?.content ?? []).map((c) => c.text ?? "").join("");
    // INDEXANDO es un arranque en frío: el servidor anda.
    if (!r || (r.isError && !/INDEXANDO/.test(texto))) problemas.push(`${nombre}: la búsqueda de prueba falló: ${texto.slice(0, 300)}`);
  }
  return problemas;
}
