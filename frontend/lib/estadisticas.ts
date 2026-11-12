/**
 * Las estadísticas del vault para el dashboard de salud (`FUN-L-32`, parte B):
 * qué hay en el vault (tipos, pesos, carpetas de primer nivel, los más
 * pesados), cómo está la red (conectadas, componentes, histograma de
 * conexiones, las más conectadas), cuánto creció (notas nuevas por mes) y qué
 * etiquetas se usan. Módulo **puro**: lo arma `lib/estadisticasVault.ts` con lo
 * que ya leyó la salud (`lib/saludVault.ts`), y `scripts/test-estadisticas.mjs`
 * lo transpila e importa sin build.
 *
 * > [!important] Las cifras tienen que coincidir con las de las otras vistas
 * > - **Conexiones de una nota** = enlaces que salen + enlaces que llegan, con
 * >   el criterio de arista del grafo y de la barra de estado (`ES_ARISTA` y
 * >   `JOIN notas` en `lib/db/grafo.ts`, `conteoConexiones`): pares
 * >   `(desde, destino)` distintos, con destino resuelto, sin lazos y con las
 * >   dos puntas en el índice fuera de la papelera. Se derivan de las MISMAS
 * >   filas de `enlaces` que lee la salud (`filasDelIndice`, que ya anula el
 * >   destino que está en la papelera), así que no hace falta otra consulta.
 * > - **Huérfanas**: la población de la red es la de `calcularSalud` para las
 * >   huérfanas —notas markdown fuera de Esporas e instrucciones de agentes—, y
 * >   una huérfana es una de ellas sin enlaces que lleguen. Las cuenta igual que
 * >   el informe; el test de equivalencia lo comprueba sobre índices reales.
 * > - **Archivos**: la suma por grupo es el total, en cantidad y en bytes, y la
 * >   suma por carpeta de primer nivel también. Todos salen de UNA lista.
 */

// ── Grupos de tipos de archivo ──────────────────────────────────────────────

export type GrupoArchivo = "notas" | "imagenes" | "pdf" | "visuales" | "otros";

/** Los grupos en el orden del anillo y de las barras (spec, «Colores de las gráficas»). */
export const GRUPOS: readonly GrupoArchivo[] = ["notas", "imagenes", "pdf", "visuales", "otros"];

export const NOMBRE_GRUPO: Readonly<Record<GrupoArchivo, string>> = {
  notas: "Notas",
  imagenes: "Imágenes",
  pdf: "PDF",
  visuales: "Visuales",
  otros: "Otros",
};

/**
 * Las extensiones con grupo propio. Todo lo demás —`.base` incluido, y los
 * archivos sin extensión— es «Otros».
 */
export const EXTENSIONES_DE_GRUPO: Readonly<Record<Exclude<GrupoArchivo, "otros">, readonly string[]>> = {
  notas: ["md"],
  imagenes: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
  pdf: ["pdf"],
  visuales: ["excalidraw", "drawio", "canvas"],
};

/**
 * Las extensiones que el informe lista siempre, aunque tengan cero archivos
 * (spec, «Casos borde»: un tipo con cero no va a las gráficas pero sí a la
 * tabla del informe). Las de los grupos más `.base`, que es tipo de Mycelium.
 */
export const EXTENSIONES_CONOCIDAS: readonly string[] = [
  ...EXTENSIONES_DE_GRUPO.notas,
  ...EXTENSIONES_DE_GRUPO.imagenes,
  ...EXTENSIONES_DE_GRUPO.pdf,
  ...EXTENSIONES_DE_GRUPO.visuales,
  "base",
];

const GRUPO_DE_EXTENSION = new Map<string, GrupoArchivo>(
  (Object.entries(EXTENSIONES_DE_GRUPO) as [GrupoArchivo, readonly string[]][]).flatMap(([g, exts]) =>
    exts.map((e) => [e, g] as [string, GrupoArchivo]),
  ),
);

/** El nombre con el que se muestra la carpeta raíz entre las de primer nivel. */
export const RAIZ = "(raíz)";

/**
 * La extensión de una ruta, en minúsculas y sin punto; vacía si no tiene. Como
 * `extensionDeRuta` (`lib/otrosArchivos.ts`) y `extension_de` de Rust: un
 * archivo que empieza con punto y no tiene otro (`.gitignore`) no tiene
 * extensión. Se repite acá para que el módulo sea puro (aquélla arrastra el
 * visor de imágenes).
 */
export function extensionDe(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 ? "" : nombre.slice(punto + 1).toLowerCase();
}

export function grupoDeExtension(extension: string): GrupoArchivo {
  return GRUPO_DE_EXTENSION.get(extension.toLowerCase()) ?? "otros";
}

// ── Tipos del resultado ─────────────────────────────────────────────────────

/** Un archivo del vault tal como lo vio el recorrido del disco (`recorrer_vault`). */
export type ArchivoDelVault = { ruta: string; bytes: number };

export type Cuenta = { cantidad: number; bytes: number };

/** Una extensión. `extension` vacía = archivos sin extensión. */
export type TipoDeArchivo = Cuenta & { extension: string; grupo: GrupoArchivo };

export type CarpetaPrimerNivel = Cuenta & {
  /** El nombre de la carpeta, o `RAIZ` para los archivos sueltos en la raíz. */
  carpeta: string;
  porGrupo: Record<GrupoArchivo, Cuenta>;
  /** El grupo que más pesa en la carpeta (para teñir el anillo exterior). */
  grupoMayor: GrupoArchivo;
};

export type ArchivoPesado = { ruta: string; extension: string; grupo: GrupoArchivo; bytes: number };

export type ComposicionArchivos = {
  total: Cuenta;
  /** Los cinco grupos, siempre, aunque alguno tenga cero. */
  porGrupo: Record<GrupoArchivo, Cuenta>;
  /**
   * Una entrada por extensión: las de `EXTENSIONES_CONOCIDAS` siempre (con 0
   * si no hay), más las que aparezcan. Por bytes descendente, después por
   * cantidad y por extensión. Las gráficas filtran `cantidad > 0`.
   */
  porTipo: TipoDeArchivo[];
  /** Carpetas de primer nivel con algún archivo, por bytes descendente. */
  carpetas: CarpetaPrimerNivel[];
  /** Los `TOPE_PESADOS` archivos más pesados. */
  masPesados: ArchivoPesado[];
};

/** Un cubo del histograma de conexiones por nota. `hasta: null` = sin tope. */
export type CuboConexiones = {
  etiqueta: string;
  desde: number;
  hasta: number | null;
  notas: number;
  /** Cuántas de esas notas son huérfanas (nadie las enlaza): van en gris. */
  huerfanas: number;
};

export type NotaConectada = {
  ruta: string;
  titulo: string;
  /** `salientes + entrantes`: los dos números de la barra de estado, sumados. */
  conexiones: number;
  salientes: number;
  entrantes: number;
};

export type RedVault = {
  /**
   * La población: notas markdown fuera de Esporas e instrucciones de agentes
   * (la de las huérfanas de `calcularSalud`). Los lienzos, dibujos, diagramas
   * y tablas no se cuentan como notas de la red, pero sus enlaces sí cuentan
   * (un lienzo que tiene una nota como tarjeta la conecta).
   */
  notas: number;
  /** Notas de la población con al menos una conexión. */
  conectadas: number;
  /** `conectadas / notas`, de 0 a 100 (0 si no hay notas). */
  porcentajeConectadas: number;
  /**
   * Grupos de notas unidas entre sí por enlaces (en cualquier sentido) que
   * tienen al menos una nota de la población. Las notas sin conexiones NO son
   * componentes: se cuentan en `sinConexiones`.
   */
  componentes: number;
  /** Notas de la población en el componente más grande (la red principal). */
  redPrincipal: number;
  /** `componentes - 1`: los grupos sueltos fuera de la red principal. */
  islas: number;
  /** Notas de la población con cero conexiones (el cubo «0»). */
  sinConexiones: number;
  /** Notas de la población que nadie enlaza: las mismas de `informe.huerfanas`. */
  huerfanas: number;
  histograma: CuboConexiones[];
  /** Las `TOPE_CONECTADAS` notas de la población con más conexiones. */
  masConectadas: NotaConectada[];
};

export type MesCrecimiento = { /** `AAAA-MM`, hora local. */ mes: string; notas: number };

export type Crecimiento = {
  /** Los últimos 12 meses, del más viejo al actual (incluido), siempre 12. */
  meses: MesCrecimiento[];
  /** Notas nuevas en esos 12 meses. */
  total: number;
  /**
   * `false` si las fechas no dicen cuándo se crearon las notas: `creado_en` es
   * la fecha en que el índice vio la nota por primera vez, y cuando un vault
   * que ya existía se indexa de una vez, casi todas comparten esa fecha (en un
   * vault real, 1.220 de 1.246 con el mismo instante). La UI lo dice en vez
   * de dibujar un pico falso.
   */
  confiable: boolean;
  /** La tanda más grande con la misma fecha exacta (la indexación inicial, casi siempre). */
  lote: { fecha: string; notas: number } | null;
};

export type EtiquetaUsada = { etiqueta: string; notas: number };

export type EtiquetasVault = {
  /** Etiquetas distintas (sin distinguir mayúsculas ni tildes, como la búsqueda `tag:`). */
  distintas: number;
  notasConEtiqueta: number;
  /** Las `TOPE_ETIQUETAS` más usadas, por cantidad de notas. */
  masUsadas: EtiquetaUsada[];
};

export type EnlacesVault = {
  /** Aristas del grafo: pares `(desde, destino)` distintos entre notas del índice. */
  total: number;
  /** `total / notasIndice`: enlaces que salen por nota, en promedio. */
  promedioPorNota: number;
  /** Notas del índice fuera de la papelera, de todos los tipos (el divisor). */
  notasIndice: number;
};

export type EstadisticasVault = {
  archivos: ComposicionArchivos;
  red: RedVault;
  crecimiento: Crecimiento;
  etiquetas: EtiquetasVault;
  enlaces: EnlacesVault;
};

// ── Topes ───────────────────────────────────────────────────────────────────

export const TOPE_PESADOS = 5;
export const TOPE_CONECTADAS = 5;
export const TOPE_ETIQUETAS = 8;
export const MESES_CRECIMIENTO = 12;

/**
 * Cuándo las fechas de creación no sirven: si la tanda más grande con el mismo
 * instante tiene al menos el 30 % de las notas y al menos 20. En los índices
 * reales medidos (2026-11-02): 1.220 de 1.246 (98 %) en un vault indexado de
 * una vez —no confiable—, y 70 de 1.525 (5 %) y 45 de 253 (18 %) en dos que
 * crecieron dentro de Mycelium.
 */
export const LOTE_NO_CONFIABLE = { fraccion: 0.3, minimo: 20 };

// ── Composición ─────────────────────────────────────────────────────────────

const cero = (): Cuenta => ({ cantidad: 0, bytes: 0 });
const porGrupoVacio = (): Record<GrupoArchivo, Cuenta> => ({
  notas: cero(),
  imagenes: cero(),
  pdf: cero(),
  visuales: cero(),
  otros: cero(),
});
const sumar = (c: Cuenta, bytes: number) => {
  c.cantidad += 1;
  c.bytes += bytes;
};
/** Un tamaño que no llegó (un binario viejo sin `bytes`) o roto cuenta como 0. */
const bytesValidos = (b: unknown) => (typeof b === "number" && Number.isFinite(b) && b > 0 ? Math.floor(b) : 0);

export function calcularComposicion(archivos: readonly ArchivoDelVault[]): ComposicionArchivos {
  const total = cero();
  const porGrupo = porGrupoVacio();
  const porExtension = new Map<string, TipoDeArchivo>();
  for (const e of EXTENSIONES_CONOCIDAS) {
    porExtension.set(e, { extension: e, grupo: grupoDeExtension(e), cantidad: 0, bytes: 0 });
  }
  const carpetas = new Map<string, CarpetaPrimerNivel>();
  const pesados: ArchivoPesado[] = [];

  for (const a of archivos) {
    const bytes = bytesValidos(a.bytes);
    const extension = extensionDe(a.ruta);
    const grupo = grupoDeExtension(extension);
    sumar(total, bytes);
    sumar(porGrupo[grupo], bytes);
    let tipo = porExtension.get(extension);
    if (!tipo) {
      tipo = { extension, grupo, cantidad: 0, bytes: 0 };
      porExtension.set(extension, tipo);
    }
    sumar(tipo, bytes);
    const barra = a.ruta.indexOf("/");
    const nombre = barra < 0 ? RAIZ : a.ruta.slice(0, barra);
    let carpeta = carpetas.get(nombre);
    if (!carpeta) {
      carpeta = { carpeta: nombre, cantidad: 0, bytes: 0, porGrupo: porGrupoVacio(), grupoMayor: "otros" };
      carpetas.set(nombre, carpeta);
    }
    sumar(carpeta, bytes);
    sumar(carpeta.porGrupo[grupo], bytes);
    pesados.push({ ruta: a.ruta, extension, grupo, bytes });
  }

  for (const c of carpetas.values()) {
    // El que más pesa; si nada pesa (todo vacío), el que más archivos tiene. Empate: orden de GRUPOS.
    let mayor: GrupoArchivo = GRUPOS[0];
    for (const g of GRUPOS) {
      const a = c.porGrupo[g];
      const m = c.porGrupo[mayor];
      if (a.bytes > m.bytes || (a.bytes === m.bytes && a.cantidad > m.cantidad)) mayor = g;
    }
    c.grupoMayor = mayor;
  }

  const porRuta = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    total,
    porGrupo,
    porTipo: [...porExtension.values()].sort(
      (a, b) => b.bytes - a.bytes || b.cantidad - a.cantidad || porRuta(a.extension, b.extension),
    ),
    carpetas: [...carpetas.values()].sort(
      (a, b) => b.bytes - a.bytes || b.cantidad - a.cantidad || porRuta(a.carpeta, b.carpeta),
    ),
    masPesados: pesados.sort((a, b) => b.bytes - a.bytes || porRuta(a.ruta, b.ruta)).slice(0, TOPE_PESADOS),
  };
}

// ── La red ──────────────────────────────────────────────────────────────────

/** Los cubos del histograma (spec): 0, 1, 2, 3–5, 6–10, 11–20, 21+. */
export const CUBOS_CONEXIONES: readonly { etiqueta: string; desde: number; hasta: number | null }[] = [
  { etiqueta: "0", desde: 0, hasta: 0 },
  { etiqueta: "1", desde: 1, hasta: 1 },
  { etiqueta: "2", desde: 2, hasta: 2 },
  { etiqueta: "3–5", desde: 3, hasta: 5 },
  { etiqueta: "6–10", desde: 6, hasta: 10 },
  { etiqueta: "11–20", desde: 11, hasta: 20 },
  { etiqueta: "21+", desde: 21, hasta: null },
];

export function cuboDe(conexiones: number): number {
  for (let i = CUBOS_CONEXIONES.length - 1; i >= 0; i--) {
    if (conexiones >= CUBOS_CONEXIONES[i].desde) return i;
  }
  return 0;
}

/** Una nota del índice, lo mínimo (la forma de `NotaIndice` de `lib/db/indiceIa.ts`). */
export type NotaDeLaRed = { id: string; titulo: string; carpetaId: string | null; tipo: string };

/** Una fila de `enlaces` (la forma de `FilaEnlace` de `lib/salud.ts`). */
export type FilaDeLaRed = { desde: string; destino: string | null };

/**
 * Las aristas: pares distintos con las dos puntas en `ids`, sin lazos. Es el
 * `ES_ARISTA` + `JOIN notas` de `lib/db/grafo.ts` sobre las filas de
 * `filasDelIndice` (que ya excluyen el origen en la papelera y anulan el
 * destino en la papelera).
 */
export function aristasDe(filas: readonly FilaDeLaRed[], ids: ReadonlySet<string>): [string, string][] {
  const vistos = new Set<string>();
  const pares: [string, string][] = [];
  for (const f of filas) {
    if (f.destino === null || f.destino === f.desde) continue;
    if (!ids.has(f.desde) || !ids.has(f.destino)) continue;
    const k = `${f.desde}\u0000${f.destino}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    pares.push([f.desde, f.destino]);
  }
  return pares;
}

/** Salientes y entrantes por nota: los dos números de `conteoConexiones`. */
export function gradosDe(aristas: readonly [string, string][]): Map<string, { salientes: number; entrantes: number }> {
  const g = new Map<string, { salientes: number; entrantes: number }>();
  const de = (id: string) => {
    let v = g.get(id);
    if (!v) {
      v = { salientes: 0, entrantes: 0 };
      g.set(id, v);
    }
    return v;
  };
  for (const [d, h] of aristas) {
    de(d).salientes += 1;
    de(h).entrantes += 1;
  }
  return g;
}

export type EntradaRed = {
  /** Todas las notas del índice fuera de la papelera (todos los tipos). */
  notas: readonly NotaDeLaRed[];
  aristas: readonly [string, string][];
  /** ¿Queda fuera de la población? (Esporas, instrucciones de agentes: `excluida` de `lib/salud.ts`). */
  excluida: (nota: NotaDeLaRed) => boolean;
};

export function calcularRed({ notas, aristas, excluida }: EntradaRed): RedVault {
  const poblacion = notas.filter((n) => n.tipo === "markdown" && !excluida(n));
  const grados = gradosDe(aristas);

  // Componentes: unión-búsqueda sobre todas las notas (un lienzo o una Espora
  // también une), contando solo las que tienen alguna nota de la población.
  const padre = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (padre.has(r) && padre.get(r) !== r) r = padre.get(r)!;
    // Compresión de camino.
    let y = x;
    while (y !== r) {
      const p = padre.get(y)!;
      padre.set(y, r);
      y = p;
    }
    return r;
  };
  for (const [d, h] of aristas) {
    if (!padre.has(d)) padre.set(d, d);
    if (!padre.has(h)) padre.set(h, h);
    const a = raiz(d);
    const b = raiz(h);
    if (a !== b) padre.set(a, b);
  }

  const histograma: CuboConexiones[] = CUBOS_CONEXIONES.map((c) => ({ ...c, notas: 0, huerfanas: 0 }));
  const tamanoComponente = new Map<string, number>();
  const conectadasLista: NotaConectada[] = [];
  let huerfanas = 0;
  for (const n of poblacion) {
    const g = grados.get(n.id);
    const salientes = g?.salientes ?? 0;
    const entrantes = g?.entrantes ?? 0;
    const conexiones = salientes + entrantes;
    const cubo = histograma[cuboDe(conexiones)];
    cubo.notas += 1;
    if (entrantes === 0) {
      cubo.huerfanas += 1;
      huerfanas += 1;
    }
    if (conexiones > 0) {
      const r = raiz(n.id);
      tamanoComponente.set(r, (tamanoComponente.get(r) ?? 0) + 1);
      conectadasLista.push({ ruta: n.id, titulo: n.titulo, conexiones, salientes, entrantes });
    }
  }

  const tamanos = [...tamanoComponente.values()];
  const componentes = tamanos.length;
  const conectadas = conectadasLista.length;
  return {
    notas: poblacion.length,
    conectadas,
    porcentajeConectadas: poblacion.length === 0 ? 0 : (conectadas / poblacion.length) * 100,
    componentes,
    redPrincipal: componentes === 0 ? 0 : Math.max(...tamanos),
    islas: Math.max(0, componentes - 1),
    sinConexiones: histograma[0].notas,
    huerfanas,
    histograma,
    masConectadas: conectadasLista
      .sort((a, b) => b.conexiones - a.conexiones || (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0))
      .slice(0, TOPE_CONECTADAS),
  };
}

// ── Crecimiento ─────────────────────────────────────────────────────────────

const dosCifras = (n: number) => String(n).padStart(2, "0");
/** `AAAA-MM` de una fecha, en hora local (lo que el usuario llama «este mes»). */
export const mesLocal = (d: Date) => `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}`;

/**
 * Notas nuevas por mes en los últimos 12 meses, desde `creado_en`. Las fechas
 * que no se pueden leer no cuentan en ningún mes (pero sí en la población del
 * lote, que mide qué parte del vault comparte un instante).
 */
export function calcularCrecimiento(fechas: readonly string[], ahora: Date): Crecimiento {
  const meses: MesCrecimiento[] = [];
  for (let i = MESES_CRECIMIENTO - 1; i >= 0; i--) {
    meses.push({ mes: mesLocal(new Date(ahora.getFullYear(), ahora.getMonth() - i, 1)), notas: 0 });
  }
  const indice = new Map(meses.map((m, i) => [m.mes, i]));
  const porInstante = new Map<string, number>();
  let total = 0;
  for (const f of fechas) {
    porInstante.set(f, (porInstante.get(f) ?? 0) + 1);
    const d = new Date(f);
    if (Number.isNaN(d.getTime())) continue;
    const i = indice.get(mesLocal(d));
    if (i === undefined) continue;
    meses[i].notas += 1;
    total += 1;
  }
  let lote: Crecimiento["lote"] = null;
  for (const [fecha, notas] of porInstante) {
    if (lote === null || notas > lote.notas || (notas === lote.notas && fecha < lote.fecha)) lote = { fecha, notas };
  }
  const confiable =
    lote === null ||
    !(lote.notas >= LOTE_NO_CONFIABLE.minimo && lote.notas >= LOTE_NO_CONFIABLE.fraccion * fechas.length);
  return { meses, total, confiable, lote };
}

// ── Todo junto ──────────────────────────────────────────────────────────────

export type EntradaEstadisticas = {
  /** Los archivos del recorrido del disco: notas y otros, ya sin lo de `.mycignore`. */
  archivos: readonly ArchivoDelVault[];
  /** Notas del índice fuera de la papelera (`notasDelIndice`). */
  notas: readonly NotaDeLaRed[];
  /** Filas de `enlaces` (`filasDelIndice`). */
  filas: readonly FilaDeLaRed[];
  excluida: (nota: NotaDeLaRed) => boolean;
  /** `creado_en` por nota del índice (`fechasDeCreacion`). */
  creacion: readonly { id: string; creadoEn: string }[];
  /** Lo que ya agregó SQLite (`etiquetasDelIndice`). */
  etiquetas: EtiquetasVault;
  ahora: Date;
  /**
   * ¿Queda afuera esta ruta por estar bajo una carpeta oculta? (`FUN-S-38`,
   * `enCarpetaOculta` de `lib/salud.ts` cuando las ocultas no se muestran).
   * Esos archivos no cuentan, esas notas no son población y sus enlaces
   * salientes no son aristas; pero siguen siendo destino, como en `calcularSalud`.
   * Ausente: no se deja nada afuera.
   */
  oculta?: (ruta: string) => boolean;
};

export function calcularEstadisticas(e: EntradaEstadisticas): EstadisticasVault {
  const oculta = e.oculta ?? (() => false);
  const ids = new Set(e.notas.map((n) => n.id));
  const aristas = aristasDe(
    e.filas.filter((f) => !oculta(f.desde)),
    ids,
  );
  const excluida = (n: NotaDeLaRed) => e.excluida(n) || oculta(n.id);
  const visibles = e.notas.reduce((s, n) => (oculta(n.id) ? s : s + 1), 0);
  // Crecimiento de la misma población que la red: notas markdown de memoria.
  const enPoblacion = new Set(e.notas.filter((n) => n.tipo === "markdown" && !excluida(n)).map((n) => n.id));
  const fechas = e.creacion.filter((c) => enPoblacion.has(c.id)).map((c) => c.creadoEn);
  return {
    archivos: calcularComposicion(e.oculta ? e.archivos.filter((a) => !oculta(a.ruta)) : e.archivos),
    red: calcularRed({ notas: e.notas, aristas, excluida }),
    crecimiento: calcularCrecimiento(fechas, e.ahora),
    etiquetas: e.etiquetas,
    enlaces: {
      total: aristas.length,
      promedioPorNota: visibles === 0 ? 0 : aristas.length / visibles,
      notasIndice: visibles,
    },
  };
}

/** Comprueba la coherencia interna (lo usan los tests; barato, sirve también en desarrollo). */
export function incoherencias(e: EstadisticasVault): string[] {
  const out: string[] = [];
  const { archivos: a, red } = e;
  const suma = (l: Cuenta[]) => l.reduce((s, c) => ({ cantidad: s.cantidad + c.cantidad, bytes: s.bytes + c.bytes }), cero());
  const igual = (x: Cuenta, y: Cuenta, que: string) => {
    if (x.cantidad !== y.cantidad || x.bytes !== y.bytes) out.push(`${que}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  };
  igual(suma(GRUPOS.map((g) => a.porGrupo[g])), a.total, "grupos vs total");
  igual(suma(a.porTipo), a.total, "tipos vs total");
  igual(suma(a.carpetas), a.total, "carpetas vs total");
  for (const c of a.carpetas) igual(suma(GRUPOS.map((g) => c.porGrupo[g])), c, `grupos de ${c.carpeta}`);
  const hist = red.histograma.reduce((s, c) => s + c.notas, 0);
  if (hist !== red.notas) out.push(`histograma ${hist} ≠ notas ${red.notas}`);
  const hu = red.histograma.reduce((s, c) => s + c.huerfanas, 0);
  if (hu !== red.huerfanas) out.push(`huérfanas del histograma ${hu} ≠ ${red.huerfanas}`);
  if (red.conectadas + red.sinConexiones !== red.notas) out.push("conectadas + sin conexiones ≠ notas");
  return out;
}
