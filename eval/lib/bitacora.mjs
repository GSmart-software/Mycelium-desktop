// El registro de búsquedas del servidor MCP (`mcp-<hash>-busquedas.jsonl`, al
// lado de su índice) y su cruce con las transcripciones. Lo usan la prueba
// gratis de un cambio del servidor (`repetir-busquedas.mjs`) y el informe, para
// la latencia interna del MCP por llamada. Lógica pura salvo `leerBitacoras`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Los tool_use del MCP de una transcripción, sin repetir, con la hora de su entrada. */
export function llamadasMcp(texto) {
  const vistas = new Map();
  for (const linea of String(texto).split("\n")) {
    if (!linea.trim()) continue;
    let e;
    try {
      e = JSON.parse(linea);
    } catch {
      continue;
    }
    if (e.type !== "assistant") continue;
    for (const b of e.message?.content ?? [])
      if (b?.type === "tool_use" && /^mcp__mycelium__vault_(buscar|leer)$/.test(b.name) && !vistas.has(b.id))
        vistas.set(b.id, { herramienta: b.name.replace("mcp__mycelium__", ""), args: b.input ?? {}, ts: Date.parse(e.timestamp) });
  }
  return [...vistas.values()];
}

/**
 * Empareja cada `vault_buscar` de las transcripciones con su línea del registro
 * de búsquedas del servidor: misma consulta y la hora más cercana (a menos de
 * 2 minutos), una a una. Devuelve las llamadas con su línea (o sin ella).
 */
export function emparejar(llamadas, registro) {
  const libres = registro.map((l, i) => ({ l, i }));
  const usadas = new Set();
  for (const c of llamadas) {
    let mejor = null;
    for (const { l, i } of libres) {
      if (usadas.has(i) || l.consulta !== (c.args.consulta ?? "")) continue;
      const d = Math.abs(l.ts - c.ts);
      if (d < 120_000 && (!mejor || d < mejor.d)) mejor = { i, d, l };
    }
    if (mejor) {
      usadas.add(mejor.i);
      c.registro = mejor.l;
    }
  }
  return llamadas;
}

/** Todas las líneas de los registros de búsquedas de un directorio de datos del MCP (incluida la rotada `.1`). */
export function leerBitacoras(dirApp) {
  if (!dirApp || !existsSync(dirApp)) return [];
  const out = [];
  for (const f of readdirSync(dirApp)) {
    if (!/^mcp-.*-busquedas\.jsonl(\.1)?$/.test(f)) continue;
    for (const l of readFileSync(join(dirApp, f), "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        out.push(JSON.parse(l));
      } catch {
        /* línea a medio escribir */
      }
    }
  }
  return out;
}
