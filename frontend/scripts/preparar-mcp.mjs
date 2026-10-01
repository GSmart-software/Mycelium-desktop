#!/usr/bin/env node
/**
 * Compila el servidor MCP de control (`FUN-L-09`) y lo deja donde Tauri busca
 * el *sidecar*: `src-tauri/binaries/mycelium-mcp-<target-triple>[.exe]`.
 *
 * El servidor es un binario aparte del workspace de Rust
 * (`src-tauri/crates/mycelium-mcp`) y viaja dentro del instalador como
 * `bundle.externalBin`: Tauri lo instala junto a `Mycelium.exe` como
 * `mycelium-mcp.exe`, así que nunca puede quedar de otra versión que la app.
 * Tauri exige el archivo **con el target triple en el nombre** al compilar, y
 * lo copia sin el triple al lado del ejecutable (en desarrollo, a
 * `target/debug/`).
 *
 * Corre solo: es el primer paso de `beforeBuildCommand` (release) y de
 * `beforeDevCommand` (`--dev`, compila en debug, que es más rápido). Hereda el
 * entorno, así que respeta el `CARGO_BUILD_JOBS=2` con el que se empaqueta.
 *
 * Uso:  npm run preparar-mcp            (release, para empaquetar)
 *       npm run preparar-mcp -- --dev   (debug, para `tauri dev`)
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const TAURI = resolve(AQUI, "..", "src-tauri");
const dev = process.argv.includes("--dev");
const perfil = dev ? "debug" : "release";

/** El target triple del host, como lo nombra `rustc` (y Tauri). */
function tripleDelHost() {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`rustc -vV falló: ${r.stderr}`);
  const linea = r.stdout.split("\n").find((l) => l.startsWith("host:"));
  if (!linea) throw new Error("rustc -vV no informó el host");
  return linea.slice("host:".length).trim();
}

const triple = tripleDelHost();
const ext = triple.includes("windows") ? ".exe" : "";

console.log(`[preparar-mcp] compilando mycelium-mcp (${perfil}, ${triple})…`);
const args = ["build", "-p", "mycelium-mcp", ...(dev ? [] : ["--release"])];
const cargo = spawnSync("cargo", args, { cwd: TAURI, stdio: "inherit", shell: process.platform === "win32" });
if (cargo.status !== 0) {
  console.error(`[preparar-mcp] cargo ${args.join(" ")} terminó con ${cargo.status}`);
  process.exit(cargo.status ?? 1);
}

const origen = join(TAURI, "target", perfil, `mycelium-mcp${ext}`);
const destino = join(TAURI, "binaries", `mycelium-mcp-${triple}${ext}`);
mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origen, destino);
console.log(`[preparar-mcp] ${destino} (${Math.round(statSync(destino).size / 1024)} KB)`);
