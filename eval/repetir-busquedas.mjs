// La prueba GRATIS de un cambio del servidor MCP (diagnóstico de la fase 1, § 6):
// repite las búsquedas y lecturas que el agente ya hizo en una tanda contra un
// índice NUEVO del mismo corpus, construido por el binario que se quiere probar,
// y mide si la sección con el dato (las «secciones oro» del apéndice del
// diagnóstico) entra entre las 10 primeras. No llama a la API.
//
//   node eval/repetir-busquedas.mjs --binario C:\mycelium-eval\bin\mycelium-mcp-c487c58.exe --etiqueta antes
//   node eval/repetir-busquedas.mjs --binario frontend\src-tauri\target\release\mycelium-mcp.exe --etiqueta despues
//
// > [!warning] Es un diagnóstico, no una decisión
// > Las consultas son las que el agente escribió con el servidor VIEJO: con otra
// > lista habría leído otra cosa y reformulado distinto. Y son de las preguntas
// > de DESARROLLO, que ya se miraron a fondo: afinar parámetros hasta que esto dé
// > perfecto es ajustar el servidor a 16 preguntas. Lo confirma una tanda, y las
// > preguntas selladas.
//
// El índice se construye en un directorio de datos PROPIO (`MYCELIUM_DIR_APP`
// apuntando a una carpeta de trabajo con su propio `vaults.json`), nunca en el
// app-data real ni en el de la tanda (`C:\mycelium-eval\app`).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RAIZ_EVAL, rutaTranscripcion } from "./lib/corpus.mjs";
import { leerJsonl, ultimaPorSesion } from "./lib/preguntas.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));

/**
 * Las secciones oro, TAL CUAL el apéndice del diagnóstico. `nota#sN` con la nota
 * por título (el nombre del archivo sin `.md`). D11 son «seis secciones de
 * `Bugs_errores_y_defectos`»: las de esos DEF, que en el índice son `#s54`,
 * `#s61`, `#s65`, `#s80`, `#s81` y `#s82` (comprobado en una copia del índice de la tanda
 * por su encabezado). D13/D14 (solo en el código) y D09/D10 (ausencia) no tienen.
 */
export const ORO = {
  D01: ["enlaces-externos#s9", "Version 2.1.0#s5", "bugs-progreso#s6", "BACKLOG#s7"],
  D02: ["Version 2.0.0#s4", "BACKLOG#s10", "atmosferas#s2", "atmosferas#s3", "atmosferas#s5", "DESIGN#s10"],
  D03: ["Version 2.1.0#s4", "drawio#s19", "BACKLOG#s14"],
  D04: ["autoactualizacion#s7"],
  D05: ["BACKLOG#s22", "Version 1.5.0#s1"],
  D06: ["Capa de datos del desktop#s2", "Generar instaladores desktop#s8", "Levantar Mycelium en desarrollo#s2", "vault-en-carpeta#s16"],
  D07: ["terminal-integrada#s2"],
  D08: ["titulo-renombra#s4"],
  D11: ["Bugs_errores_y_defectos#s54", "Bugs_errores_y_defectos#s61", "Bugs_errores_y_defectos#s65", "Bugs_errores_y_defectos#s80", "Bugs_errores_y_defectos#s81", "Bugs_errores_y_defectos#s82"],
  D12: ["Version 2.1.0#s1"],
  D15: ["video-embebido#s6", "Version 2.1.0#s5", "BACKLOG#s7"],
  D16: ["ventanas-multiples#s12", "ventanas-multiples#s9"],
};

/**
 * Las corridas perdidas por granularidad (diagnóstico § 2, causa 3) y la cadena
 * que prueba que la lectura trajo el dato: el costo real (40,3 MB), los defectos
 * de consolas que faltaban y la resolución de D16.
 */
export const GRANULARIDAD = {
  f24f679b: { pregunta: "D03", marcas: ["40,3"] },
  c6c91151: { pregunta: "D03", marcas: ["40,3"] },
  "9769996c": { pregunta: "D03", marcas: ["40,3"] },
  "8557b0a8": { pregunta: "D11", marcas: ["DEF-072", "DEF-079", "DEF-083", "DEF-098", "DEF-099", "DEF-100"] },
  c000b3fc: { pregunta: "D11", marcas: ["DEF-072", "DEF-079", "DEF-083", "DEF-098", "DEF-099", "DEF-100"] },
  c30d68a7: { pregunta: "D11", marcas: ["DEF-072", "DEF-079", "DEF-083", "DEF-098", "DEF-099", "DEF-100"] },
  fc726fbe: { pregunta: "D11", marcas: ["DEF-072", "DEF-079", "DEF-083", "DEF-098", "DEF-099", "DEF-100"] },
  "6f7dc0db": { pregunta: "D16", marcas: ["is_dev"] },
};

/** `docs/estado/Version 2.1.0.md#s5` → `Version 2.1.0#s5`. */
export function refPorTitulo(ref) {
  const i = ref.lastIndexOf("#s");
  const nota = i >= 0 ? ref.slice(0, i) : ref;
  return `${basename(nota).replace(/\.md$/i, "")}${i >= 0 ? ref.slice(i) : ""}`;
}

/** Las refs, en orden, de una respuesta de `vault_buscar` (`[3] ruta#sN · migas`). */
export function refsDeRespuesta(texto) {
  const out = [];
  for (const m of String(texto).matchAll(/^\[\d+\] (.+?#s\d+)(?= · |\s*$)/gm)) out.push(m[1]);
  return out;
}

/** Los tool_use de una transcripción, sin repetir, con la hora de su entrada. */
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

// ── El servidor, por stdio ───────────────────────────────────────────────────

class Servidor {
  constructor(binario, env) {
    this.p = spawn(binario, [], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.buf = "";
    this.pend = new Map();
    this.id = 0;
    this.stderr = "";
    this.p.stdout.setEncoding("utf8");
    this.p.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const linea = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!linea.trim()) continue;
        const m = JSON.parse(linea);
        this.pend.get(m.id)?.(m);
        this.pend.delete(m.id);
      }
    });
    this.p.stderr.on("data", (d) => (this.stderr += d));
  }
  pedir(method, params) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pend.set(id, res);
      this.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async herramienta(name, args) {
    const r = await this.pedir("tools/call", { name, arguments: args });
    return { texto: r.result?.content?.[0]?.text ?? JSON.stringify(r.error), error: !!r.result?.isError };
  }
  cerrar() {
    this.p.stdin.end();
    this.p.kill();
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** El app-data real de Mycelium en esta máquina (para no tocarlo nunca). */
function appDataReal() {
  const base = process.env.APPDATA || join(homedir(), ".config");
  return join(base, "com.mycelium.desktop");
}

function prohibido(dir) {
  const d = resolve(dir).toLowerCase();
  return [join(RAIZ_EVAL, "app"), appDataReal()].some((p) => d === resolve(p).toLowerCase() || d.startsWith(resolve(p).toLowerCase() + "\\"));
}

// ── Las métricas ──────────────────────────────────────────────────────────────

const mediana = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const tok = (bytes) => Math.ceil(bytes / 4);

export function medir(busquedas) {
  const conOro = busquedas.filter((b) => ORO[b.pregunta]);
  const porPregunta = {};
  let top10 = 0;
  let notaTop10 = 0;
  for (const b of conOro) {
    const oro = new Set(ORO[b.pregunta]);
    const notasOro = new Set(ORO[b.pregunta].map((r) => r.slice(0, r.lastIndexOf("#s"))));
    const primeras = b.refs.slice(0, 10).map(refPorTitulo);
    const pega = primeras.some((r) => oro.has(r));
    const pegaNota = primeras.some((r) => notasOro.has(r.slice(0, r.lastIndexOf("#s"))));
    top10 += pega ? 1 : 0;
    notaTop10 += pegaNota ? 1 : 0;
    const q = (porPregunta[b.pregunta] ??= { n: 0, top10: 0, vacias: 0 });
    q.n++;
    q.top10 += pega ? 1 : 0;
    q.vacias += b.refs.length ? 0 : 1;
  }
  const bytes = busquedas.map((b) => Buffer.byteLength(b.texto, "utf8"));
  return {
    busquedas: busquedas.length,
    conOro: conOro.length,
    top10,
    notaTop10,
    vacias: busquedas.filter((b) => !b.refs.length).length,
    vaciasConOro: conOro.filter((b) => !b.refs.length).length,
    tokensMediana: tok(mediana(bytes)),
    tokensTotal: tok(bytes.reduce((a, x) => a + x, 0)),
    porPregunta,
  };
}

async function principal() {
  const { values: v } = parseArgs({
    options: {
      binario: { type: "string" },
      etiqueta: { type: "string", default: "prueba" },
      tanda: { type: "string", default: "2026-09-24-mcp-fase1" },
      registro: { type: "string", default: join(RAIZ_EVAL, "app", "mcp-6376de955fcd347e-busquedas.jsonl") },
      corpus: { type: "string", default: join(RAIZ_EVAL, "corpus", "c0a33b8ec71a") },
      resultados: { type: "string", default: join(EVAL, "resultados.jsonl") },
      trabajo: { type: "string" },
      salida: { type: "string" },
    },
  });
  if (!v.binario || !existsSync(v.binario)) throw new Error(`Falta --binario (o no existe: ${v.binario}).`);
  const trabajo = resolve(v.trabajo ?? join(tmpdir(), "mycelium-repetir", v.etiqueta));
  if (prohibido(trabajo)) throw new Error(`${trabajo} es un directorio de datos real: la prueba usa uno propio.`);

  // 1. Las llamadas de la tanda, emparejadas con el registro del servidor.
  // Las corridas que analizó el diagnóstico: las válidas de la tanda. La de D12 r3,
  // descartada después por salir a la red, entra igual: sus búsquedas en el
  // índice son tan legítimas como las demás (lo que se descartó es su respuesta).
  const filas = ultimaPorSesion(leerJsonl(v.resultados)).filter(
    (f) => f.tanda === v.tanda && f.brazo === "mcp" && (!f.descartada || /^acceso a la red/.test(f.motivo_descarte)),
  );
  const registro = leerJsonl(v.registro);
  const llamadas = [];
  for (const f of filas) {
    const ruta = rutaTranscripcion(f.session_id);
    if (!ruta) continue;
    for (const c of llamadasMcp(readFileSync(ruta, "utf8"))) llamadas.push({ ...c, pregunta: f.pregunta, sesion: f.session_id });
  }
  const buscar = emparejar(llamadas.filter((c) => c.herramienta === "vault_buscar"), registro);
  const leer = llamadas.filter((c) => c.herramienta === "vault_leer");
  const sinPareja = buscar.filter((c) => !c.registro).length;

  // 2. Un índice nuevo, en un directorio de datos propio.
  rmSync(trabajo, { recursive: true, force: true });
  mkdirSync(trabajo, { recursive: true });
  writeFileSync(join(trabajo, "vaults.json"), JSON.stringify({ vaults: [{ ruta: resolve(v.corpus), nombre: "corpus-eval", ultimoAcceso: 0 }] }, null, 2));
  const s = new Servidor(resolve(v.binario), { MYCELIUM_DIR_APP: trabajo, MYCELIUM_VAULT: resolve(v.corpus) });
  try {
    await s.pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "repetir", version: "1" } });
    const lista = await s.pedir("tools/list", {});
    const bytesTools = Buffer.byteLength(JSON.stringify(lista.result.tools), "utf8");
    for (let i = 0; ; i++) {
      const r = await s.herramienta("vault_leer", { refs: ["CLAUDE.md"] });
      if (!r.texto.startsWith("INDEXANDO")) break;
      if (i > 600) throw new Error("el índice no terminó en 60 s");
      await esperar(100);
    }

    // 3. Las mismas búsquedas y lecturas, en el mismo orden.
    const busquedas = [];
    for (const c of buscar) {
      const r = await s.herramienta("vault_buscar", c.args);
      busquedas.push({ pregunta: c.pregunta, sesion: c.sesion, consulta: c.args.consulta, texto: r.texto, refs: r.error ? [] : refsDeRespuesta(r.texto) });
    }
    const lecturas = [];
    for (const c of leer) {
      const r = await s.herramienta("vault_leer", c.args);
      lecturas.push({ pregunta: c.pregunta, sesion: c.sesion, args: c.args, texto: r.texto });
    }

    // 4. Las métricas.
    const m = medir(busquedas);
    const bytesLeer = lecturas.map((l) => Buffer.byteLength(l.texto, "utf8"));
    const granularidad = Object.entries(GRANULARIDAD).map(([id, g]) => {
      const texto = lecturas.filter((l) => l.sesion.startsWith(id)).map((l) => l.texto).join("\n");
      const faltan = g.marcas.filter((x) => !texto.includes(x));
      return { sesion: id, pregunta: g.pregunta, trae: !faltan.length, faltan };
    });
    const informe = {
      etiqueta: v.etiqueta,
      binario: resolve(v.binario),
      busquedas_emparejadas: buscar.length - sinPareja,
      busquedas_sin_pareja: sinPareja,
      ...m,
      tools_list_tokens: tok(bytesTools),
      lecturas: lecturas.length,
      lectura_tokens_mediana: tok(mediana(bytesLeer)),
      lectura_tokens_total: tok(bytesLeer.reduce((a, x) => a + x, 0)),
      granularidad,
    };
    if (v.salida) writeFileSync(v.salida, JSON.stringify({ informe, busquedas: busquedas.map(({ texto, ...b }) => ({ ...b, bytes: Buffer.byteLength(texto, "utf8") })) }, null, 2));
    imprimir(informe);
  } finally {
    s.cerrar();
    rmSync(trabajo, { recursive: true, force: true });
  }
}

function imprimir(x) {
  console.log(`# ${x.etiqueta} · ${x.binario}`);
  console.log(`Búsquedas repetidas: ${x.busquedas} (emparejadas con el registro: ${x.busquedas_emparejadas}, sin pareja: ${x.busquedas_sin_pareja})`);
  console.log(`Con sección oro: ${x.conOro}`);
  console.log(`  la sección oro entra en el top 10: ${x.top10} / ${x.conOro}`);
  console.log(`  alguna sección de la nota oro en el top 10: ${x.notaTop10} / ${x.conOro}`);
  console.log(`Vacías: ${x.vacias} / ${x.busquedas} (de las que tienen oro: ${x.vaciasConOro})`);
  console.log(`Respuesta de vault_buscar: mediana ≈${x.tokensMediana} tokens · total ≈${x.tokensTotal}`);
  console.log(`tools/list: ≈${x.tools_list_tokens} tokens`);
  console.log(`vault_leer repetidas: ${x.lecturas} · mediana ≈${x.lectura_tokens_mediana} tokens · total ≈${x.lectura_tokens_total}`);
  console.log("Por pregunta (top 10 / búsquedas · vacías):");
  for (const [q, p] of Object.entries(x.porPregunta).sort()) console.log(`  ${q}: ${p.top10}/${p.n} · ${p.vacias} vacías`);
  console.log("Granularidad (¿la lectura repetida trae el dato?):");
  for (const g of x.granularidad) console.log(`  ${g.pregunta} ${g.sesion}: ${g.trae ? "sí" : `no (faltan ${g.faltan.join(", ")})`}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  });
}
