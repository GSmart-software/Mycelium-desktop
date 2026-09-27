// Regenera el motor del corrector ortográfico (`FUN-L-12`):
// `wasm/ortografia` → `public/ortografia/motor.wasm`.
//
// El `.wasm` se commitea, así que esto solo hace falta al tocar el crate o al
// subir la versión de `spellbook`. Ni `next build` ni `tauri build` lo llaman: la
// app se compila sin la cadena de Rust para WASM.
//
//   npm run wasm:ortografia
//
// Requiere el target: `rustup target add wasm32-unknown-unknown`. El `target/`
// del crate queda dentro de su carpeta (≈ 25 MB, ignorado por git), separado del
// de la app de escritorio.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRATE = join(FRONTEND, "wasm", "ortografia");
const SALIDA = join(CRATE, "target", "wasm32-unknown-unknown", "release", "ortografia_wasm.wasm");
const DESTINO = join(FRONTEND, "public", "ortografia", "motor.wasm");

const r = spawnSync(
  "cargo",
  ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", join(CRATE, "Cargo.toml")],
  // El target propio del crate, aunque el entorno tenga un CARGO_TARGET_DIR
  // compartido: si no, el .wasm saldría en otra carpeta y se copiaría uno viejo.
  { stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: join(CRATE, "target") } },
);
if (r.status !== 0) {
  console.error("\nNo se pudo compilar el motor. ¿Está instalado el target?");
  console.error("  rustup target add wasm32-unknown-unknown");
  process.exit(r.status ?? 1);
}

mkdirSync(dirname(DESTINO), { recursive: true });
copyFileSync(SALIDA, DESTINO);
console.log(`\nMotor listo: public/ortografia/motor.wasm (${(statSync(DESTINO).size / 1024).toFixed(0)} KB)`);
