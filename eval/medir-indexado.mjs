// Cuánto tarda el MCP en indexar un vault EN FRÍO: sin índice previo, desde que
// arranca el proceso hasta que `vault_buscar` deja de contestar INDEXANDO. No
// llama a la API.
//
//   node eval/medir-indexado.mjs                                # vault de Mycelium
//   node eval/medir-indexado.mjs --vault C:\mycelium-eval\tesina\vault.json --frio
//
// Toma el binario y el entorno (registro de vaults y vault) del `mcp.json` del
// vault. `--frio` borra antes el índice (`mcp-*.db*`) de ESE registro, que es el
// de la evaluación: se niega a hacerlo sobre el app-data real de Mycelium. Mide
// dos cosas: el reloj de afuera (arranque → primera respuesta útil) y lo que el
// propio servidor dice en stderr («índice listo · N archivos … ms»).

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { OPCION_VAULT, vaultDeArgs } from "./lib/vault.mjs";

const VAULT = vaultDeArgs();

/** El app-data real de Mycelium (nunca se toca). */
function appDataReal() {
  return join(process.env.APPDATA || join(homedir(), ".config"), "com.mycelium.desktop");
}

/** Lee el binario y el entorno del servidor `mycelium` de un mcp.json. */
export function servidorDe(rutaMcp) {
  const j = JSON.parse(readFileSync(rutaMcp, "utf8"));
  const s = j.mcpServers?.mycelium;
  if (!s?.command) throw new Error(`${rutaMcp} no declara el servidor «mycelium»`);
  return { binario: s.command, args: s.args ?? [], env: s.env ?? {} };
}

/** Tamaño en bytes de los índices del registro. */
function indices(dirApp) {
  if (!existsSync(dirApp)) return [];
  return readdirSync(dirApp)
    .filter((f) => /^mcp-[0-9a-f]+\.db(-wal|-shm)?$/.test(f))
    .map((f) => ({ f, bytes: statSync(join(dirApp, f)).size }));
}

function medir({ binario, args, env }, { consulta = "qubit", intervalo = 250, tope = 30 * 60_000 } = {}) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const p = spawn(binario, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buf = "";
    let stderr = "";
    let id = 0;
    let intentos = 0;
    let primeraRespuesta = null;
    const pend = new Map();
    const pedir = (method, params) =>
      new Promise((r) => {
        const i = ++id;
        pend.set(i, r);
        p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
      });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!l.trim()) continue;
        const m = JSON.parse(l);
        pend.get(m.id)?.(m);
        pend.delete(m.id);
      }
    });
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", rej);
    const fin = (r) => {
      p.stdin.end();
      p.kill();
      res(r);
    };
    (async () => {
      const ini = await pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "medir-indexado", version: "1" } });
      const msInitialize = Date.now() - t0;
      if (ini.error) return fin({ error: ini.error, stderr });
      for (;;) {
        if (Date.now() - t0 > tope) return fin({ error: "tope de tiempo", stderr });
        intentos++;
        const r = await pedir("tools/call", { name: "vault_buscar", arguments: { consulta } });
        const texto = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
        if (!/^INDEXANDO/.test(texto)) {
          primeraRespuesta = Date.now() - t0;
          const listo = /índice listo · (\d+) archivos, (\d+) reindexados, (\d+) borrados · (\d+) ms \(recorrido (\d+) ms\)/.exec(stderr);
          return fin({
            msInitialize,
            msPrimeraRespuesta: primeraRespuesta,
            intentos,
            servidor: listo ? { archivos: +listo[1], reindexados: +listo[2], borrados: +listo[3], ms: +listo[4], msRecorrido: +listo[5] } : null,
            error: r.result?.isError ? texto.slice(0, 300) : null,
            stderr,
          });
        }
        await new Promise((w) => setTimeout(w, intervalo));
      }
    })().catch(rej);
  });
}

async function principal() {
  const { values: v } = parseArgs({
    options: { ...OPCION_VAULT, "mcp-config": { type: "string", default: VAULT.mcp_config }, frio: { type: "boolean", default: false }, consulta: { type: "string", default: "qubit" } },
  });
  const srv = servidorDe(v["mcp-config"]);
  const dirApp = srv.env.MYCELIUM_DIR_APP;
  if (!dirApp) throw new Error("El mcp.json no fija MYCELIUM_DIR_APP: se usaría el app-data real.");
  const real = resolve(appDataReal()).toLowerCase();
  if (resolve(dirApp).toLowerCase() === real || resolve(dirApp).toLowerCase().startsWith(real + "\\"))
    throw new Error(`${dirApp} es el app-data real de Mycelium: no se mide ahí.`);
  if (v.frio) for (const { f } of indices(dirApp)) rmSync(join(dirApp, f), { force: true });
  const antes = indices(dirApp);
  const r = await medir(srv, { consulta: v.consulta });
  const despues = indices(dirApp);
  console.log(`Vault «${VAULT.nombre}» · binario ${srv.binario}`);
  console.log(`Índice previo: ${antes.length ? antes.map((x) => `${x.f} ${x.bytes} B`).join(", ") : "ninguno (frío)"}`);
  if (r.error && !r.msPrimeraRespuesta) throw new Error(`${JSON.stringify(r.error)}\n${r.stderr}`);
  console.log(`initialize contestó a los ${r.msInitialize} ms; la primera búsqueda útil, a los ${r.msPrimeraRespuesta} ms (${r.intentos} intentos).`);
  if (r.servidor)
    console.log(`El servidor: ${r.servidor.archivos} archivos, ${r.servidor.reindexados} reindexados, en ${r.servidor.ms} ms (recorrido ${r.servidor.msRecorrido} ms).`);
  console.log(`Índice después: ${despues.map((x) => `${x.f} ${(x.bytes / 1e6).toFixed(1)} MB`).join(", ")}`);
  if (r.error) console.log(`La búsqueda devolvió error: ${r.error}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  });
}
