/**
 * Borra el código de un markdown para buscar enlaces y etiquetas (`DEF-102`).
 *
 * Un `[[enlace]]` o un `#tag` escrito dentro de código se escribió para
 * **mostrar** la sintaxis, no para usarla. El grafo y la lista de etiquetas los
 * buscaban con una expresión regular sobre el texto crudo y los contaban igual:
 * en el vault del repo, 1.014 aristas y 174 etiquetas falsas; en uno personal,
 * 185 etiquetas que eran colores de CSS (`#0F6E56`).
 *
 * Devuelve el MISMO texto con el código reemplazado por espacios —los saltos de
 * línea se conservan—, así las posiciones no cambian y quien busque encima puede
 * seguir usando las suyas. Reconoce lo que CommonMark llama código:
 *
 * - **Bloques cercados**: un renglón con tres o más `` ` `` o `~` (hasta tres
 *   espacios delante) abre, y otro con el mismo carácter, al menos igual de
 *   largo y nada más, cierra. Sin cierre, el bloque llega al final del texto.
 * - **Código en línea**: una tanda de N `` ` `` cierra con otra de exactamente N,
 *   sin cruzar un renglón en blanco (fin de párrafo).
 *
 * El código indentado con cuatro espacios queda afuera a propósito: distinguirlo
 * de una lista anidada pide el parser entero, y un falso positivo ahí borraría
 * enlaces de verdad.
 */

const APERTURA = /^ {0,3}(`{3,}|~{3,})/;

/** Reemplaza por espacios todo lo que no sea salto de línea. */
const blanquear = (s: string): string => s.replace(/[^\n]/g, " ");

function sinBloques(texto: string): string {
  const lineas = texto.split("\n");
  let cerco: string | null = null;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (cerco === null) {
      const m = APERTURA.exec(l);
      // Un cerco de backticks no puede tener backticks en su info: si los tiene,
      // es código en línea, no un bloque.
      if (m && !(m[1][0] === "`" && l.slice(m[0].length).includes("`"))) {
        cerco = m[1];
        lineas[i] = blanquear(l);
      }
      continue;
    }
    const cierre = new RegExp(`^ {0,3}${cerco[0] === "`" ? "`" : "~"}{${cerco.length},}\\s*$`);
    if (cierre.test(l)) cerco = null;
    lineas[i] = blanquear(l);
  }
  return lineas.join("\n");
}

function sinCodigoEnLinea(texto: string): string {
  const out = texto.split("");
  let i = 0;
  while (i < texto.length) {
    if (texto[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (texto[i + n] === "`") n++;
    // Buscar una tanda de EXACTAMENTE n backticks antes del fin del párrafo.
    let j = i + n;
    let cierre = -1;
    while (j < texto.length) {
      if (texto[j] === "\n" && /^\n[ \t]*(\n|$)/.test(texto.slice(j, j + 80))) break;
      if (texto[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (texto[j + m] === "`") m++;
      if (m === n) {
        cierre = j;
        break;
      }
      j += m;
    }
    if (cierre < 0) {
      i += n;
      continue;
    }
    for (let k = i; k < cierre + n; k++) if (out[k] !== "\n") out[k] = " ";
    i = cierre + n;
  }
  return out.join("");
}

/** El texto con todo su código reemplazado por espacios. */
export function sinCodigo(texto: string): string {
  if (!texto.includes("`") && !texto.includes("~~~")) return texto;
  return sinCodigoEnLinea(sinBloques(texto));
}
