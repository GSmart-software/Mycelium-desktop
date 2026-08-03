/**
 * Esporas: plantillas de notas (`FUN-M-03`). Una Espora es una nota normal que
 * vive en una carpeta designada del vault; al usarla, su texto se sustituye
 * antes de escribirse. Ver `docs/features/esporas-plantillas.md`.
 *
 * Acá vive SOLO la lógica pura: la sustitución de variables y el saneo de la
 * ruta de la carpeta configurada. Lo que toca el vault (listar, crear, insertar)
 * está en `lib/esporasVault.ts`.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-esporas.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/frontmatter.ts` y `lib/db/nombres.ts`.
 */

/** Carpeta de plantillas por defecto (configurable en Configuración → Vault). */
export const CARPETA_ESPORAS_DEFECTO = "Esporas";

/** Datos con los que se resuelven las variables de una Espora. */
export type ContextoEspora = {
  /** Título FINAL de la nota destino (ya saneado y desambiguado). */
  titulo: string;
  /** Momento de la sustitución; se inyecta en los tests. */
  ahora?: Date;
};

/**
 * Un token: `{{...}}` sin llaves anidadas dentro. Lo que no case con un token
 * conocido se deja tal cual — es preferible que el usuario vea `{{autor}}`
 * escrito en su nota y entienda que no existe, a que desaparezca en silencio.
 */
const TOKEN_RE = /\{\{([^{}]*)\}\}/g;

/**
 * Tokens de formato de `{{fecha:FORMATO}}`. Distinguen mayúsculas: `MM` es el
 * mes y `mm` el minuto. Lo que no case se copia literal, así que un formato
 * como `AAAA-MM-DD hh:mm` funciona sin más reglas.
 */
const FORMATO_RE = /AAAA|MM|DD|hh|mm|ss/g;

const dos = (n: number): string => String(n).padStart(2, "0");

/** Fecha de hoy en ISO (`AAAA-MM-DD`), en hora LOCAL (no UTC). */
export function fechaIso(ahora: Date): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/** Hora actual en 24 h (`hh:mm`). */
export function horaIso(ahora: Date): string {
  return `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`;
}

/** Aplica un formato propio (`DD/MM/AAAA`, `AAAA-MM-DD hh:mm`…) a una fecha. */
export function formatearFecha(formato: string, ahora: Date): string {
  return formato.replace(FORMATO_RE, (token) => {
    switch (token) {
      case "AAAA":
        return String(ahora.getFullYear());
      case "MM":
        return dos(ahora.getMonth() + 1);
      case "DD":
        return dos(ahora.getDate());
      case "hh":
        return dos(ahora.getHours());
      case "mm":
        return dos(ahora.getMinutes());
      default:
        return dos(ahora.getSeconds());
    }
  });
}

/**
 * Sustituye las variables de una Espora sobre el TEXTO CRUDO, así que también
 * aplica dentro del frontmatter: una plantilla con `fecha: {{fecha}}` produce
 * una propiedad de tipo fecha ya rellena.
 *
 * Tokens: `{{titulo}}`, `{{fecha}}`, `{{hora}}` y `{{fecha:FORMATO}}`. Van en
 * minúscula y en español, como el resto de la interfaz; cualquier otro se deja
 * intacto.
 */
export function sustituirVariables(texto: string, ctx: ContextoEspora): string {
  const ahora = ctx.ahora ?? new Date();
  return texto.replace(TOKEN_RE, (crudo, interior: string) => {
    const nombre = interior.trim();
    if (nombre === "titulo") return ctx.titulo;
    if (nombre === "fecha") return fechaIso(ahora);
    if (nombre === "hora") return horaIso(ahora);
    if (nombre.startsWith("fecha:")) return formatearFecha(nombre.slice(6).trim(), ahora);
    return crudo;
  });
}

/**
 * Normaliza la ruta configurada de la carpeta de Esporas a una ruta relativa
 * POSIX del vault, o `null` si no es válida. Se rechazan las rutas absolutas
 * (`/x`, `C:\x`) y los saltos hacia arriba (`..`): la carpeta tiene que estar
 * DENTRO del vault, que es lo único que Mycelium sabe listar.
 */
export function normalizarCarpetaEsporas(ruta: string): string | null {
  const bruto = (ruta ?? "").trim().replace(/\\/g, "/");
  if (bruto === "") return null;
  if (bruto.startsWith("/") || /^[a-zA-Z]:/.test(bruto)) return null;
  const segmentos = bruto
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (segmentos.length === 0) return null;
  if (segmentos.some((s) => s === "." || s === "..")) return null;
  return segmentos.join("/");
}
