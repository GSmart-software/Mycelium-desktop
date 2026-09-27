/**
 * Qué palabras se revisan y qué se recuerda de ellas (`FUN-L-12`).
 *
 * Módulo **puro** —sin imports—: lo usa el `ViewPlugin` del editor y lo prueba
 * `scripts/test-ortografia.mjs` sin arrancar nada.
 */

/** Una palabra del documento, con su posición (`desde` inclusive, `hasta` exclusive). */
export type Palabra = { texto: string; desde: number; hasta: number };

/** Un tramo que no se corrige (código, enlaces, fórmulas…), en posiciones del documento. */
export type Intervalo = { desde: number; hasta: number };

/**
 * Un «token»: letras, marcas, dígitos y guion bajo, con apóstrofos internos
 * («l'amico», «don't»). Se toman los dígitos y el `_` dentro del token para
 * poder **descartarlo entero**: con solo letras, `abc123` daría la palabra
 * `abc`, y `mi_variable`, dos palabras sueltas que no son prosa.
 */
const TOKEN_RE = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu;
/** Dígitos o guion bajo: un identificador, una versión, una fecha. */
const NO_PROSA_RE = /[\p{N}_]/u;
/** Minúscula seguida de mayúscula: `camelCase`, `iPhone`, `JavaScript`. */
const CAMEL_RE = /\p{Ll}\p{Lu}/u;

/**
 * Las palabras de un texto que vale la pena revisar. `base` es la posición del
 * texto en el documento.
 *
 * Se descartan: los tokens con dígitos o `_`, los `camelCase` (nombres de
 * código o de productos que ningún diccionario tiene) y las de una sola letra
 * (una variable «x» o la inicial de un nombre: marcarlas no sirve de nada).
 */
export function extraerPalabras(texto: string, base = 0): Palabra[] {
  const palabras: Palabra[] = [];
  for (const m of texto.matchAll(TOKEN_RE)) {
    const t = m[0];
    if (NO_PROSA_RE.test(t) || CAMEL_RE.test(t)) continue;
    if ([...t].length < 2) continue;
    const desde = base + m.index;
    palabras.push({ texto: t, desde, hasta: desde + t.length });
  }
  return palabras;
}

/**
 * La forma en que se revisa y se guarda una palabra: el apóstrofo tipográfico
 * (’) pasa a recto ('), que es el que usan los diccionarios Hunspell. Así
 * «l’amico» y «l'amico» son la misma entrada del caché y del diccionario del
 * vault.
 */
export function normalizarPalabra(texto: string): string {
  return texto.replace(/’/g, "'");
}

/**
 * Las palabras que **no** tocan ningún intervalo excluido. Una palabra que se
 * superpone aunque sea en parte con uno —la mitad de un `[[enlace]]`— queda
 * afuera: mejor no marcar que marcar algo que no es prosa.
 *
 * `palabras` tiene que venir ordenada por posición (como la devuelve
 * `extraerPalabras`); `excluidos`, en cualquier orden.
 */
export function fueraDeExcluidos(palabras: Palabra[], excluidos: Intervalo[]): Palabra[] {
  if (excluidos.length === 0) return palabras;
  const iv = [...excluidos].sort((a, b) => a.desde - b.desde);
  const quedan: Palabra[] = [];
  let i = 0;
  // Fin más lejano de los intervalos que ya empezaron: un intervalo largo (un
  // bloque de código) puede tapar a varios cortos que empiezan después.
  let alcance = -Infinity;
  for (const p of palabras) {
    while (i < iv.length && iv[i].desde < p.hasta) {
      alcance = Math.max(alcance, iv[i].hasta);
      i++;
    }
    // Todos los intervalos con `desde < p.hasta` ya se contaron en `alcance`:
    // la palabra choca si alguno termina después de donde ella empieza.
    if (alcance > p.desde) continue;
    quedan.push(p);
  }
  return quedan;
}

/** Cuántas palabras recuerda el caché antes de empezar a olvidar las más viejas. */
export const TOPE_CACHE = 20_000;

/**
 * Lo que el hilo principal ya sabe: `palabra → correcta`. Existe para que el
 * editor solo le pregunte al worker lo **nuevo**: desplazarse por una nota ya
 * revisada no cuesta ni un mensaje.
 *
 * Se vacía al cambiar los diccionarios activos o el diccionario del vault
 * (`vaciar`). Cuando pasa del tope olvida las entradas más viejas —un `Map`
 * recorre en orden de inserción—, así una sesión larga no crece sin límite.
 */
export class CacheOrtografia {
  private readonly datos = new Map<string, boolean>();
  constructor(private readonly tope = TOPE_CACHE) {}

  get tamano(): number {
    return this.datos.size;
  }

  /** `true`/`false` si se sabe; `undefined` si hay que preguntar. */
  consultar(palabra: string): boolean | undefined {
    return this.datos.get(palabra);
  }

  /** Las palabras **únicas** que el caché no conoce, en el orden en que aparecen. */
  pendientes(palabras: Iterable<string>): string[] {
    const vistas = new Set<string>();
    const faltan: string[] = [];
    for (const p of palabras) {
      if (vistas.has(p)) continue;
      vistas.add(p);
      if (!this.datos.has(p)) faltan.push(p);
    }
    return faltan;
  }

  guardar(palabras: string[], correctas: boolean[]): void {
    for (let i = 0; i < palabras.length; i++) this.datos.set(palabras[i], correctas[i]);
    if (this.datos.size > this.tope) {
      let sobran = this.datos.size - this.tope;
      for (const clave of this.datos.keys()) {
        if (sobran-- <= 0) break;
        this.datos.delete(clave);
      }
    }
  }

  /** Marca una palabra como correcta ya, sin esperar al worker (agregar, ignorar). */
  aceptar(palabra: string): void {
    this.datos.set(palabra, true);
  }

  vaciar(): void {
    this.datos.clear();
  }
}

/**
 * Las palabras del diccionario del vault a partir del archivo
 * (`.mycelium/diccionario.txt`): una por renglón. Se ignoran los renglones
 * vacíos y los que empiezan con `#` (comentarios, por si alguien lo edita a
 * mano); se quitan duplicados y se ordena, para que el archivo reescrito sea
 * estable y un diff del vault muestre solo lo que cambió.
 */
export function leerDiccionarioVault(texto: string | null): string[] {
  if (!texto) return [];
  const palabras = new Set<string>();
  for (const renglon of texto.split(/\r?\n/)) {
    const p = normalizarPalabra(renglon.trim());
    if (p && !p.startsWith("#")) palabras.add(p);
  }
  return ordenarPalabras([...palabras]);
}

/** El contenido del archivo: una palabra por renglón, ordenadas, con salto final. */
export function escribirDiccionarioVault(palabras: string[]): string {
  const unicas = ordenarPalabras([...new Set(palabras.map(normalizarPalabra))]);
  return unicas.length ? unicas.join("\n") + "\n" : "";
}

function ordenarPalabras(palabras: string[]): string[] {
  return palabras.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * ¿Está una palabra en un conjunto de palabras aceptadas (el diccionario del
 * vault o las ignoradas)? Con la regla de mayúsculas de Hunspell: una palabra
 * guardada en minúscula vale también Capitalizada (a principio de oración) y
 * EN MAYÚSCULAS; una guardada con mayúscula («Mycelium») vale igual y en
 * mayúsculas, pero no en minúscula.
 */
export function aceptadaPor(conjunto: ReadonlySet<string>, palabra: string): boolean {
  if (conjunto.has(palabra)) return true;
  const minuscula = palabra.toLocaleLowerCase();
  if (minuscula !== palabra) {
    const capitalizada = palabra[0] + palabra.slice(1).toLocaleLowerCase();
    const esMayusculas = palabra === palabra.toLocaleUpperCase();
    // «Casa» o «CASA» valen si está «casa».
    if ((palabra === capitalizada || esMayusculas) && conjunto.has(minuscula)) return true;
    // «MYCELIUM» vale si está «Mycelium».
    if (esMayusculas) {
      const cap = minuscula[0].toLocaleUpperCase() + minuscula.slice(1);
      if (conjunto.has(cap)) return true;
    }
  }
  return false;
}
