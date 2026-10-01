// Acceso a la red desde una corrida (diagnóstico de la fase 1, § 3.6).
//
// Los brazos con herramientas tienen `Bash` y la máquina tiene internet: una
// corrida puede contestar desde FUERA del corpus —D12 r3 (`2f42f55e`) hizo
// `curl` al bucket real de R2 y leyó el `versions.json` publicado—, y eso no
// mide la memoria del vault. El arnés lo detecta en la transcripción y descarta
// la corrida con un motivo propio, igual que las instrucciones ajenas.
//
// Lógica pura: recibe los bloques `tool_use` ({name, input}) y devuelve los
// accesos encontrados. Mira lo que el agente PIDIÓ, no lo que obtuvo: un `curl`
// que falló también es una corrida que intentó salir del corpus.

/** Herramientas que por sí mismas salen a la red. */
const HERRAMIENTAS_WEB = /^(WebFetch|WebSearch)$|^mcp__.*(fetch|web|browser|http)/i;

/** Herramientas que ejecutan un comando de shell, y dónde viene el comando. */
const SHELLS = new Set(["Bash", "PowerShell"]);

/**
 * Programas y cmdlets que abren una conexión. `iwr` e `irm` son los alias de
 * PowerShell de `Invoke-WebRequest` e `Invoke-RestMethod`; se piden como
 * palabra entera para no confundir `irm` con un pedazo de otra palabra.
 */
const COMANDOS_RED = [
  ["curl", /(^|[\s;|&(`$])curl(\.exe)?(?=\s|$)/i],
  ["wget", /(^|[\s;|&(`$])wget(\.exe)?(?=\s|$)/i],
  ["Invoke-WebRequest", /\bInvoke-WebRequest\b/i],
  ["Invoke-RestMethod", /\bInvoke-RestMethod\b/i],
  ["iwr", /(^|[\s;|&(`$])iwr(?=\s|$)/i],
  ["irm", /(^|[\s;|&(`$])irm(?=\s|$)/i],
  ["Start-BitsTransfer", /\bStart-BitsTransfer\b/i],
  ["WebClient", /\bNet\.WebClient\b|\bHttpClient\b/i],
];

const URL = /\bhttps?:\/\/[^\s"'`<>)]+/i;

/** El texto de comando de un `tool_use` de shell, o null. */
function comandoDe(uso) {
  if (!SHELLS.has(uso?.name)) return null;
  const c = uso.input?.command;
  return typeof c === "string" ? c : null;
}

/**
 * Los accesos a la red de una lista de `tool_use`. Cada uno:
 * `{ herramienta, motivo, fragmento }`, con `motivo` corto y estable
 * (`curl`, `url`, `WebFetch`…) para poder contarlos.
 */
export function accesosARed(usos) {
  const out = [];
  for (const u of usos ?? []) {
    if (!u?.name) continue;
    if (HERRAMIENTAS_WEB.test(u.name)) {
      const q = u.input?.url ?? u.input?.query ?? "";
      out.push({ herramienta: u.name, motivo: u.name, fragmento: String(q).slice(0, 160) });
      continue;
    }
    const cmd = comandoDe(u);
    if (cmd === null) continue;
    const motivos = COMANDOS_RED.filter(([, re]) => re.test(cmd)).map(([n]) => n);
    if (URL.test(cmd)) motivos.push("url");
    if (motivos.length) out.push({ herramienta: u.name, motivo: motivos.join("+"), fragmento: cmd.replace(/\s+/g, " ").slice(0, 160) });
  }
  return out;
}

/** El `motivo_descarte` de una corrida con accesos a la red. */
export function motivoRed(accesos) {
  const motivos = [...new Set(accesos.map((a) => a.motivo))];
  return `acceso a la red (${motivos.join(", ")})`;
}
