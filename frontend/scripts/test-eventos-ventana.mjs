// Los eventos de UNA ventana llegan solo a esa ventana (`DEF-158`).
//
// En Tauri 2 hacen falta las dos puntas, y faltaba cualquiera de las dos:
//  - Rust: `Emitter::emit` manda a TODAS las ventanas aunque se llame sobre una
//    (`ventana.emit(...)` no la acota). Hay que usar `emit_to(etiqueta, ...)`.
//  - Frontend: el `listen` de `@tauri-apps/api/event` escucha con destino «Any» y
//    recibe también lo dirigido a otra ventana. Hay que escuchar con
//    `getCurrentWebviewWindow().listen(...)`.
// Con varios vaults abiertos, los cambios de la carpeta de uno aparecían como
// copias fantasma en el explorador de los otros.
//
//   node --test scripts/test-eventos-ventana.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = async (ruta) => (await readFile(join(FRONTEND, ruta), "utf8")).replace(/\r\n/g, "\n");

// Evento → [archivo de Rust que lo emite, archivo del frontend que lo escucha].
const EVENTOS = {
  "vault-cambios": ["src-tauri/src/vault_watch.rs", "lib/vaultWatch.ts"],
  "open-files": ["src-tauri/src/lib.rs", "components/workspace/FileOpenBridge.tsx"],
  "terminal-datos": ["src-tauri/src/terminal.rs", "lib/terminal.ts"],
  "terminal-salida": ["src-tauri/src/terminal.rs", "lib/terminal.ts"],
  "marco://hover-maximizar": ["src-tauri/src/marco.rs", "components/ventana/ControlesVentana.tsx"],
  "mcp-pedido": ["src-tauri/src/control.rs", "lib/mcpControl.ts"],
};

test("Rust emite los eventos de una ventana con `emit_to`, nunca con `emit`", async () => {
  for (const [evento, [rust]] of Object.entries(EVENTOS)) {
    const fuente = await leer(rust);
    // El nombre puede ir literal o en una constante: se buscan las dos formas.
    const constante = [...fuente.matchAll(/const (\w+): &str = "([^"]+)"/g)].find((m) => m[2] === evento)?.[1];
    const nombres = [`"${evento}"`, constante].filter(Boolean);
    // Hasta el `;`: los argumentos pueden tener paréntesis (`ventana.label()`).
    const llamadas = [...fuente.matchAll(/\.(emit(?:_to)?)\(([^;]*);/gs)].filter(([, , args]) =>
      nombres.some((n) => args.includes(n)),
    );
    assert.ok(llamadas.length > 0, `${rust} no emite ${evento}`);
    for (const [texto, metodo] of llamadas) {
      assert.equal(metodo, "emit_to", `${rust}: ${evento} se emite con \`emit\` (llega a todas las ventanas): ${texto.slice(0, 80)}`);
    }
  }
});

test("el frontend escucha los eventos de una ventana en su ventana, no con el `listen` global", async () => {
  for (const [evento, [, front]] of Object.entries(EVENTOS)) {
    const fuente = await leer(front);
    assert.ok(fuente.includes(`"${evento}"`) || fuente.includes("EVENTO_TAURI"), `${front} no escucha ${evento}`);
    assert.match(fuente, /getCurrentWebviewWindow/, `${front} tiene que escuchar con getCurrentWebviewWindow()`);
    assert.doesNotMatch(
      fuente,
      /import\s*\{[^}]*\blisten\b[^}]*\}\s*from\s*["']@tauri-apps\/api\/event["']|\{\s*listen\s*\}\s*=\s*await import\(["']@tauri-apps\/api\/event["']\)/,
      `${front} importa el \`listen\` global de @tauri-apps/api/event`,
    );
  }
});
