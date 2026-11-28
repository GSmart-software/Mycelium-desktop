/**
 * Soltar archivos en la consola escribe su ruta (`FUN-S-43`): la parte pura,
 * sin DOM ni Tauri, para poder probarla sola (`scripts/test-rutas-soltadas.mjs`).
 *
 * Se imita a Windows Terminal: cada ruta absoluta, entre comillas dobles si la
 * shell la partiría o la interpretaría, separadas por un espacio y con un
 * espacio al final, listo para seguir escribiendo. Nunca un Enter: soltar no
 * ejecuta nada.
 */

/**
 * Lo que obliga a citar una ruta. El espacio (y cualquier blanco) parte el
 * argumento en todas las shells; el resto lo interpreta alguna de las que la
 * consola puede abrir: `& ( ) ; , ' { } @ $ #` y el acento grave en
 * PowerShell, `& | < > ^ ( ) %` en cmd, `* ? [ ] ! ~ =` y compañía en bash.
 * Las letras con tilde y la ñ no hacen falta: ninguna shell las trata aparte.
 */
const ESPECIALES = /[\s"'&()[\]{}^=;!+,`~$@#%|<>*?]/;

/** ¿La ruta es de Windows (`C:\…`, `C:/…` o `\\servidor\…`)? */
export function esRutaWindows(ruta: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(ruta) || ruta.startsWith("\\\\");
}

/**
 * Una ruta como se escribe en la consola: tal cual, o entre comillas dobles si
 * lleva algo de {@link ESPECIALES}.
 *
 * En Windows una ruta no puede tener `"`, así que las comillas no necesitan
 * escape. En macOS y Linux sí puede, y dentro de comillas dobles bash sigue
 * expandiendo `$`, el acento grave y `\`: esos se escapan con `\`.
 */
export function citarRuta(ruta: string): string {
  if (!ESPECIALES.test(ruta)) return ruta;
  if (esRutaWindows(ruta)) return `"${ruta}"`;
  return `"${ruta.replace(/["$`\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * El texto que se escribe al soltar: las rutas citadas, separadas por un
 * espacio y con uno al final. Sin rutas, nada (cadena vacía).
 */
export function textoDeRutas(rutas: readonly string[]): string {
  const validas = rutas.filter((r) => r !== "");
  if (validas.length === 0) return "";
  return `${validas.map(citarRuta).join(" ")} `;
}

/**
 * La ruta absoluta de algo del vault, a partir de la raíz del vault (como la
 * guarda la sesión, con el separador del sistema) y de su ruta relativa POSIX
 * (el id de una nota, de una carpeta o de un archivo que no es nota).
 *
 * El separador lo decide la raíz: en Windows la relativa pasa a `\`, que es lo
 * que esperan cmd y la mayoría de los programas. `null` si falta alguna de las
 * dos o si la relativa intenta salir del vault (`..`): soltar no tiene por qué
 * escribir otra cosa que lo que se arrastró.
 */
export function rutaAbsolutaEnVault(raiz: string | null | undefined, relativa: string | null | undefined): string | null {
  if (!raiz || relativa === null || relativa === undefined) return null;
  const partes = relativa.split(/[\\/]/).filter((p) => p !== "" && p !== ".");
  if (partes.some((p) => p === "..")) return null;
  const sep = esRutaWindows(raiz) || (raiz.includes("\\") && !raiz.includes("/")) ? "\\" : "/";
  // Se quitan los separadores finales de la raíz, salvo que sea la raíz del
  // disco entera (`C:\`, `/`), que los necesita.
  let base = raiz;
  while (base.length > 1 && /[\\/]$/.test(base) && !/^[A-Za-z]:[\\/]$/.test(base)) {
    base = base.slice(0, -1);
  }
  if (partes.length === 0) return base;
  const unidas = partes.join(sep);
  return /[\\/]$/.test(base) ? `${base}${unidas}` : `${base}${sep}${unidas}`;
}
