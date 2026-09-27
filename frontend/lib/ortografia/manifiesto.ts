/**
 * El manifiesto de diccionarios publicado en R2 y el estado de cada idioma
 * (`FUN-L-12`, § 4 de `docs/features/corrector-ortografico.md`).
 *
 * Módulo **puro** —sin imports—: el texto del manifiesto lo trae Rust (desktop)
 * o `fetch` (web) y acá solo se valida y se interpreta. Lo prueba
 * `scripts/test-ortografia.mjs`.
 */

/** Una variante descargable de un idioma: `es-AR`, `en-US`… */
export type Variante = {
  /** Región ISO (`AR`, `ES`, `US`) o M49 (`419`). */
  region: string;
  /** Identificador de la variante y nombre de sus archivos: `es-AR`. */
  id: string;
  /** Versión del diccionario (no de la app): forma parte de la ruta, que es inmutable. */
  version: string;
  /** URLs absolutas (ya resueltas contra la del manifiesto) del `.aff.gz` y el `.dic.gz`. */
  aff: string;
  dic: string;
  /** `sha256` en hexadecimal del archivo **descomprimido**: se verifica antes de activarlo. */
  sha256Aff: string;
  sha256Dic: string;
  /** Tamaño de la descarga (los dos `.gz`), para mostrarlo antes de descargar. */
  bytes: number;
  /** URL absoluta de su `LICENSE.txt`, que se baja junto al diccionario. */
  licencia: string;
};

export type Idioma = {
  /** Lengua: `es`, `en`, `it`. Es lo que el usuario activa, no la variante. */
  id: string;
  nombre: string;
  variantes: Variante[];
  /** La variante sin región conocida o sin variante para la región: `es-ES`. */
  porDefecto: string;
  licencia: string;
  urlLicencia: string;
  urlFuente: string;
  autor: string;
};

export type Manifiesto = { version: 1; idiomas: Idioma[] };

/** Un diccionario ya descargado en esta instalación. */
export type Descargado = { id: string; version: string };

const ID_VARIANTE_RE = /^[a-z]{2,3}-[A-Z0-9]{2,3}$/;
const ID_IDIOMA_RE = /^[a-z]{2,3}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** La lengua de una variante: `es-AR` → `es`. */
export function lenguaDeVariante(id: string): string {
  return id.split("-")[0];
}

/** Resuelve una URL del manifiesto contra la del propio manifiesto. */
export function resolverUrl(base: string, relativa: string): string {
  return new URL(relativa, base).href;
}

function texto(o: Record<string, unknown>, clave: string, donde: string): string {
  const v = o[clave];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`El manifiesto de diccionarios no es válido: falta «${clave}» en ${donde}.`);
  }
  return v;
}

function objeto(v: unknown, donde: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`El manifiesto de diccionarios no es válido: ${donde} no es un objeto.`);
  }
  return v as Record<string, unknown>;
}

/**
 * Valida el manifiesto y resuelve sus URLs contra `urlManifiesto` (pueden ser
 * relativas: así la carpeta se puede mudar, o servir desde una carpeta local
 * en desarrollo, sin reescribirlo).
 *
 * Un error de forma **lanza**, con un mensaje para mostrar: un manifiesto roto
 * no debe llevar a descargar algo a medias. Un idioma sin ninguna variante
 * válida se descarta entero; un campo de más, se ignora (versiones futuras del
 * manifiesto pueden sumar campos).
 */
export function parsearManifiesto(contenido: string, urlManifiesto: string): Manifiesto {
  let crudo: unknown;
  try {
    crudo = JSON.parse(contenido);
  } catch {
    throw new Error("El manifiesto de diccionarios no es JSON válido.");
  }
  const raiz = objeto(crudo, "la raíz");
  if (raiz.version !== 1) {
    throw new Error(
      `El manifiesto de diccionarios es de una versión que esta app no conoce (${String(raiz.version)}). Actualizá Mycelium.`,
    );
  }
  if (!Array.isArray(raiz.idiomas)) {
    throw new Error("El manifiesto de diccionarios no es válido: falta la lista «idiomas».");
  }

  const idiomas: Idioma[] = [];
  for (const [i, bruto] of raiz.idiomas.entries()) {
    const o = objeto(bruto, `el idioma ${i + 1}`);
    const id = texto(o, "id", `el idioma ${i + 1}`);
    if (!ID_IDIOMA_RE.test(id)) {
      throw new Error(`El manifiesto de diccionarios no es válido: «${id}» no es un código de idioma.`);
    }
    if (!Array.isArray(o.variantes)) {
      throw new Error(`El manifiesto de diccionarios no es válido: «${id}» no tiene variantes.`);
    }
    const variantes: Variante[] = o.variantes.map((b, j) => {
      const donde = `la variante ${j + 1} de «${id}»`;
      const v = objeto(b, donde);
      const vid = texto(v, "id", donde);
      if (!ID_VARIANTE_RE.test(vid) || lenguaDeVariante(vid) !== id) {
        throw new Error(`El manifiesto de diccionarios no es válido: «${vid}» no es una variante de «${id}».`);
      }
      const version = texto(v, "version", donde);
      if (!VERSION_RE.test(version)) {
        throw new Error(`El manifiesto de diccionarios no es válido: la versión de «${vid}» no es X.Y.Z.`);
      }
      const sha256Aff = texto(v, "sha256Aff", donde).toLowerCase();
      const sha256Dic = texto(v, "sha256Dic", donde).toLowerCase();
      if (!SHA256_RE.test(sha256Aff) || !SHA256_RE.test(sha256Dic)) {
        throw new Error(`El manifiesto de diccionarios no es válido: el hash de «${vid}» no es un sha256.`);
      }
      const bytes = v.bytes;
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
        throw new Error(`El manifiesto de diccionarios no es válido: el tamaño de «${vid}» no es un número.`);
      }
      const aff = resolverUrl(urlManifiesto, texto(v, "aff", donde));
      return {
        region: texto(v, "region", donde).toUpperCase(),
        id: vid,
        version,
        aff,
        dic: resolverUrl(urlManifiesto, texto(v, "dic", donde)),
        sha256Aff,
        sha256Dic,
        bytes,
        // Junto a los archivos de la variante, salvo que el manifiesto diga otra cosa.
        licencia: typeof v.licencia === "string" ? resolverUrl(urlManifiesto, v.licencia) : resolverUrl(aff, "LICENSE.txt"),
      };
    });
    if (variantes.length === 0) continue;
    const porDefecto = typeof o.porDefecto === "string" ? o.porDefecto : variantes[0].id;
    idiomas.push({
      id,
      nombre: texto(o, "nombre", `«${id}»`),
      variantes,
      porDefecto: variantes.some((v) => v.id === porDefecto) ? porDefecto : variantes[0].id,
      licencia: texto(o, "licencia", `«${id}»`),
      urlLicencia: resolverUrl(urlManifiesto, texto(o, "urlLicencia", `«${id}»`)),
      urlFuente: texto(o, "urlFuente", `«${id}»`),
      autor: texto(o, "autor", `«${id}»`),
    });
  }
  return { version: 1, idiomas };
}

/** Compara dos versiones `X.Y.Z`: negativo si `a < b`. */
export function compararVersiones(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * El diccionario descargado de una lengua, si hay alguno. Si hubiera más de uno
 * (la región del sistema cambió y se bajó otra variante), el de `preferida`.
 */
export function descargadoDe(
  lengua: string,
  descargados: Descargado[],
  preferida: string | null = null,
): Descargado | null {
  const propios = descargados.filter((d) => lenguaDeVariante(d.id) === lengua);
  return propios.find((d) => d.id === preferida) ?? propios[0] ?? null;
}

export type EstadoIdioma = {
  /** La variante que corresponde a la región del sistema. */
  variante: Variante | null;
  /** Lo descargado de esta lengua, si hay. */
  instalado: Descargado | null;
  /**
   * Hay algo mejor que lo descargado: una versión nueva de la misma variante, o
   * la variante de la región cuando lo descargado es otra (se cambió la región
   * del sistema, o se publicó la variante que antes faltaba).
   */
  actualizable: boolean;
};

export function estadoIdioma(idioma: Idioma, descargados: Descargado[], variante: Variante | null): EstadoIdioma {
  const instalado = descargadoDe(idioma.id, descargados, variante?.id ?? null);
  const actualizable =
    instalado !== null &&
    variante !== null &&
    (instalado.id !== variante.id || compararVersiones(instalado.version, variante.version) < 0);
  return { variante, instalado, actualizable };
}

/**
 * Qué diccionarios cargar: uno por lengua activa que esté descargada. No
 * necesita el manifiesto —sin conexión, lo descargado sigue funcionando—.
 * `preferidas` son las variantes de la región del sistema, si se conocen.
 */
export function diccionariosACargar(
  activas: string[],
  descargados: Descargado[],
  preferidas: string[] = [],
): Descargado[] {
  const lista: Descargado[] = [];
  for (const lengua of activas) {
    const pref = preferidas.find((p) => lenguaDeVariante(p) === lengua) ?? null;
    const d = descargadoDe(lengua, descargados, pref);
    if (d) lista.push(d);
  }
  return lista;
}

/** «226 KB», «1,4 MB»: el tamaño de una descarga, para mostrar. */
export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
