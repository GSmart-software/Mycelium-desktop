/**
 * El `.mcp.json` de la raíz del vault (`FUN-L-09`): donde Claude Code busca los
 * servidores MCP del proyecto. Al encender el control, Mycelium registra ahí
 * el suyo, `mycelium`; al apagarlo, lo quita.
 *
 * > [!important] El archivo puede ser del usuario
 * > Si ya tenía un `.mcp.json` con sus propios servidores, se **fusiona**: se
 * > agrega o reemplaza solo `mcpServers.mycelium` y el resto queda intacto, en
 * > su orden. Si no es JSON o no tiene la forma esperada, **no se toca** y se
 * > dice por qué: pisar la configuración de otra herramienta sería peor que no
 * > registrar la nuestra.
 *
 * Módulo **puro** (lo prueba `scripts/test-mcp-control.mjs` sin Tauri); la
 * lectura y escritura del archivo están en `lib/mcpControl.ts`.
 */

/** Nombre del servidor dentro de `mcpServers`. */
export const NOMBRE_SERVIDOR = "mycelium";

/** Archivo, relativo a la raíz del vault. Empieza con punto: la app no lo muestra. */
export const ARCHIVO_MCP_JSON = ".mcp.json";

/** La entrada de nuestro servidor: el binario instalado y su vault. */
export function entradaServidor(binario: string, vault: string): Record<string, unknown> {
  return { command: binario, args: [], env: { MYCELIUM_VAULT: vault } };
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Lee el archivo como objeto, o lanza con un motivo que se puede mostrar. */
function leerObjeto(texto: string): Record<string, unknown> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error(`${ARCHIVO_MCP_JSON} no es JSON válido: no se toca. Corregilo o borralo y volvé a intentar.`);
  }
  if (!esObjeto(crudo)) throw new Error(`${ARCHIVO_MCP_JSON} no es un objeto JSON: no se toca.`);
  if ("mcpServers" in crudo && !esObjeto(crudo.mcpServers)) {
    throw new Error(`En ${ARCHIVO_MCP_JSON}, «mcpServers» no es un objeto: no se toca.`);
  }
  return crudo;
}

const formatear = (o: Record<string, unknown>) => JSON.stringify(o, null, 2) + "\n";

/**
 * El contenido con nuestro servidor registrado. `existente` es el archivo
 * actual (`null` si no hay). `cambia` es `false` si ya estaba exactamente así
 * (no hace falta escribir); `creado`, si no había archivo.
 */
export function fusionarMcpJson(
  existente: string | null,
  binario: string,
  vault: string,
): { texto: string; cambia: boolean; creado: boolean } {
  const entrada = entradaServidor(binario, vault);
  if (existente === null || existente.trim() === "") {
    return { texto: formatear({ mcpServers: { [NOMBRE_SERVIDOR]: entrada } }), cambia: true, creado: existente === null };
  }
  const o = leerObjeto(existente);
  const servidores = esObjeto(o.mcpServers) ? o.mcpServers : {};
  const cambia = JSON.stringify(servidores[NOMBRE_SERVIDOR]) !== JSON.stringify(entrada);
  // Reasignar una clave existente conserva su lugar en el objeto, así que
  // reemplazar nuestra entrada no reordena la del usuario.
  const nuevo = { ...o, mcpServers: { ...servidores, [NOMBRE_SERVIDOR]: entrada } };
  return { texto: formatear(nuevo), cambia, creado: false };
}

/**
 * El contenido sin nuestro servidor. `null` = no queda nada (ni otros
 * servidores ni otras claves): el archivo se puede borrar si era nuestro.
 * `cambia` es `false` si no estaba registrado.
 */
export function quitarDeMcpJson(existente: string): { texto: string | null; cambia: boolean } {
  if (existente.trim() === "") return { texto: null, cambia: false };
  const o = leerObjeto(existente);
  const servidores = esObjeto(o.mcpServers) ? { ...o.mcpServers } : {};
  const cambia = NOMBRE_SERVIDOR in servidores;
  delete servidores[NOMBRE_SERVIDOR];
  const otrasClaves = Object.keys(o).filter((k) => k !== "mcpServers");
  // Vacío = sin otros servidores y sin otras claves: el archivo solo existía
  // para nuestra entrada.
  if (Object.keys(servidores).length === 0 && otrasClaves.length === 0) return { texto: null, cambia };
  return { texto: formatear({ ...o, mcpServers: servidores }), cambia };
}
