// Lectura de la transcripción `.jsonl` de una sesión de Claude Code (§ 6, «Lo
// que sale de la transcripción, verificado»). Lógica pura sobre el texto.

import { accesosARed } from "./red.mjs";

/** La herramienta por la que vuelve la salida estructurada: no es recuperación. */
export const HERRAMIENTA_SALIDA = "StructuredOutput";

function contexto(u) {
  return (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
}

/**
 * Resume una transcripción. Los mensajes del asistente llegan partidos —una
 * entrada por bloque de contenido, todas con el mismo `message.id` y el mismo
 * `usage`—, así que se deduplican por id. Solo cuenta la cadena principal: las
 * entradas `isSidechain` son de subagentes.
 */
export function resumirTranscripcion(texto) {
  const mensajes = new Map(); // id → { usage, model, orden }
  const herramientas = new Map(); // tool_use id → nombre
  let compactado = false;
  let hooks = 0;
  let version = null;
  let cwd = null;
  let gitBranch;
  let orden = 0;
  const instrucciones = new Set();
  // Todos los tool_use, subagentes incluidos: para detectar la salida a la red.
  const usos = [];
  for (const linea of String(texto).split("\n")) {
    if (!linea.trim()) continue;
    let e;
    try {
      e = JSON.parse(linea);
    } catch {
      continue;
    }
    version ??= e.version ?? null;
    cwd ??= e.cwd ?? null;
    if (gitBranch === undefined && "gitBranch" in e) gitBranch = e.gitBranch;
    if (e.type === "system" && e.subtype === "compact_boundary") compactado = true;
    if (e.isCompactSummary) compactado = true;
    if (e.type === "system" && e.subtype === "stop_hook_summary") hooks++;
    // Qué archivos de instrucciones (CLAUDE.md) cargó la sesión: el control tiene
    // que ser el del corpus y nada más.
    if (e.attachment?.type === "instructions") for (const f of e.attachment.files ?? []) if (f?.path) instrucciones.add(f.path);
    if (e.type === "assistant") for (const b of e.message?.content ?? []) if (b?.type === "tool_use") usos.push(b);
    if (e.type !== "assistant" || e.isSidechain) continue;
    const m = e.message ?? {};
    const id = m.id ?? `sin-id-${orden}`;
    if (!mensajes.has(id)) mensajes.set(id, { usage: m.usage, model: m.model, orden: orden++ });
    else if ((m.usage?.output_tokens ?? 0) > (mensajes.get(id).usage?.output_tokens ?? 0)) mensajes.get(id).usage = m.usage;
    for (const b of m.content ?? []) if (b?.type === "tool_use") herramientas.set(b.id, b.name);
  }

  const lista = [...mensajes.values()].sort((a, b) => a.orden - b.orden);
  const llamadas = {};
  for (const n of herramientas.values()) if (n !== HERRAMIENTA_SALIDA) llamadas[n] = (llamadas[n] ?? 0) + 1;
  let cache5m = 0;
  let cache1h = 0;
  for (const m of lista) {
    cache5m += m.usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    cache1h += m.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  }
  return {
    mensajes: lista.length,
    modelos: [...new Set(lista.map((m) => m.model).filter((m) => m && !m.startsWith("<")))],
    llamadas,
    // § 6: contexto del último mensaje menos el del primero.
    tokens_recuperacion: lista.length ? contexto(lista.at(-1).usage) - contexto(lista[0].usage) : 0,
    compactado,
    hooks,
    version,
    cwd,
    gitBranch: gitBranch ?? null,
    cacheEscrituraPorTtl: { "5m": cache5m, "1h": cache1h },
    instrucciones: [...instrucciones],
    // Los bloques llegan repetidos (una entrada por bloque, a veces el mismo
    // tool_use dos veces): se deduplican por id.
    red: accesosARed([...new Map(usos.map((u, i) => [u.id ?? `sin-id-${i}`, u])).values()]),
  };
}

function lineas(texto) {
  const out = [];
  for (const linea of String(texto).split("\n")) {
    if (!linea.trim()) continue;
    try {
      out.push(JSON.parse(linea));
    } catch {
      /* línea cortada: se ignora, como en resumirTranscripcion */
    }
  }
  return out;
}

/**
 * Cuánto tiempo de reloj se fue en herramientas, separado del que piensa el
 * modelo. Cada `tool_use` de la cadena principal se empareja con su
 * `tool_result` por id: el intervalo va de la marca de tiempo de la entrada del
 * asistente que lo pide a la de la entrada del usuario que trae el resultado.
 *
 * `ms_herramientas` es la UNIÓN de esos intervalos —dos llamadas en paralelo no
 * cuentan doble—; `por_herramienta` suma por nombre (ahí sí se solapan). La
 * salida estructurada no es recuperación y queda afuera. Una llamada sin
 * resultado (la corrida se cortó) no suma y se cuenta en `sin_resultado`.
 */
export function tiemposDeHerramientas(texto) {
  const pedidas = new Map(); // id → { nombre, ini }
  const fines = new Map(); // id → ts
  for (const e of lineas(texto)) {
    if (e.isSidechain) continue;
    const ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (e.type === "assistant")
      for (const b of e.message?.content ?? [])
        if (b?.type === "tool_use" && b.name !== HERRAMIENTA_SALIDA && !pedidas.has(b.id)) pedidas.set(b.id, { nombre: b.name, ini: ts });
    if (e.type === "user" && Array.isArray(e.message?.content))
      for (const b of e.message.content) if (b?.type === "tool_result" && !fines.has(b.tool_use_id)) fines.set(b.tool_use_id, ts);
  }
  const intervalos = [];
  const porHerramienta = {};
  let sinResultado = 0;
  for (const [id, p] of pedidas) {
    const fin = fines.get(id);
    if (fin === undefined || fin < p.ini) {
      sinResultado++;
      continue;
    }
    intervalos.push([p.ini, fin]);
    porHerramienta[p.nombre] = (porHerramienta[p.nombre] ?? 0) + (fin - p.ini);
  }
  intervalos.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let abierto = null;
  for (const [i, f] of intervalos) {
    if (!abierto || i > abierto[1]) {
      if (abierto) total += abierto[1] - abierto[0];
      abierto = [i, f];
    } else abierto[1] = Math.max(abierto[1], f);
  }
  if (abierto) total += abierto[1] - abierto[0];
  return { ms_herramientas: total, por_herramienta: porHerramienta, llamadas: intervalos.length, sin_resultado: sinResultado };
}

/**
 * ¿La corrida leyó un PDF? Para el repliegue de la clase C9 (dato solo en un
 * PDF): `Read` sobre un `.pdf`, o un comando de shell que nombre un `.pdf`
 * (`pdftotext`, un script). Buscar con `Grep` no cuenta: no lee el texto de un
 * PDF, que viaja comprimido.
 */
export function leyoPdf(texto) {
  for (const e of lineas(texto)) {
    if (e.type !== "assistant" || e.isSidechain) continue;
    for (const b of e.message?.content ?? []) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "Read" && /\.pdf$/i.test(String(b.input?.file_path ?? ""))) return true;
      if ((b.name === "Bash" || b.name === "PowerShell") && /\.pdf\b/i.test(String(b.input?.command ?? ""))) return true;
    }
  }
  return false;
}
