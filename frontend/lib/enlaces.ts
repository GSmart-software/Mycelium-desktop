/**
 * Núcleo de la auditoría y el re-enlazado de un vault adoptado (`FUN-M-17`), que
 * es también lo que consume la pantalla de la app (`FUN-L-17`).
 * Ver `docs/features/auditoria-y-relinkeado.md`.
 *
 * El problema: alguien adopta Mycelium sobre un proyecto Markdown que ya tenía,
 * abre el grafo y no hay ni una conexión — aunque sus documentos se referencien
 * entre sí desde siempre, con `` `HU-009` `` o con el nombre suelto en la prosa.
 * No le falta estructura: le falta traducir cómo la nombra.
 *
 * > [!danger] Las dos mitades tienen perfiles de riesgo OPUESTOS
 * > **Auditar no modifica ni un byte de ningún documento** (`candidatasDe`),
 * > **enlazar sí** (`aplicarFormas`). Están separadas hasta en los nombres para
 * > que nadie corra un diagnóstico y se encuentre el corpus reescrito.
 *
 * > [!important] El léxico es el mecanismo de seguridad, no la sintaxis
 * > Solo se toca lo que está en el léxico. Un backtick con un identificador de
 * > código que nadie declaró queda intacto. Por eso los backticks pueden ser la
 * > fuente principal de referencias sin volverse peligrosos.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-enlaces.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/frontmatter.ts`, `lib/esporas.ts` y `lib/bases.ts`.
 */

// ── El léxico: cómo se nombró históricamente cada documento ───────────────────

/** Un destino con las formas en que el corpus lo nombra. */
export type DestinoLexico = { titulo: string; formas: string[] };

/**
 * Memoria durable de la nomenclatura del corpus. Su valor no es el archivo: es
 * que **el costo se paga por forma**, no por documento ni por aparición.
 * Descubrir que `HU-009` es una referencia cubre sus 47 apariciones y sirve para
 * los documentos que se agreguen después.
 */
export type Lexico = {
  version: 1;
  /** `notaId` → destino. En desktop el id es la ruta relativa. */
  destinos: Record<string, DestinoLexico>;
  /** Lo que se decidió que NO es una referencia, para no volver a proponerlo. */
  descartadas: { forma: string; motivo: string }[];
};

export const LEXICO_VACIO: Lexico = { version: 1, destinos: {}, descartadas: [] };

/** Ruta del léxico dentro del vault. Se comparte con los comandos de la IA. */
export const RUTA_LEXICO = ".claude/enlaces-lexico.json";

/** Lee un léxico de su JSON, tolerando un archivo ausente o corrupto. */
export function leerLexico(json: string | null): Lexico {
  if (json === null || json.trim() === "") return { ...LEXICO_VACIO };
  try {
    const cru = JSON.parse(json) as Partial<Lexico>;
    const destinos: Record<string, DestinoLexico> = {};
    for (const [id, d] of Object.entries(cru.destinos ?? {})) {
      if (typeof d?.titulo !== "string" || !Array.isArray(d.formas)) continue;
      destinos[id] = {
        titulo: d.titulo,
        formas: d.formas.filter((f): f is string => typeof f === "string" && f.trim() !== ""),
      };
    }
    const descartadas = (cru.descartadas ?? []).filter(
      (d): d is { forma: string; motivo: string } => typeof d?.forma === "string",
    );
    return { version: 1, destinos, descartadas };
  } catch {
    // Un léxico ilegible no puede tumbar la auditoría: se arranca de cero. No se
    // sobrescribe hasta que el usuario guarde, así que el archivo original queda.
    return { ...LEXICO_VACIO };
  }
}

export function escribirLexico(lexico: Lexico): string {
  return `${JSON.stringify(lexico, null, 2)}\n`;
}

// ── Zonas que no se tocan ─────────────────────────────────────────────────────

export type Rango = { desde: number; hasta: number };

const RE_FENCE = /^([ \t]*)(`{3,}|~{3,})/;
const RE_WIKILINK = /!?\[\[[^\]]*\]\]/g;
const RE_URL = /\b(?:https?|ftp|mailto):\/?\/?[^\s)<>"']+/g;
const RE_IMAGEN = /!\[[^\]]*\]\([^)]*\)/g;

/**
 * Rangos del texto donde NO se sustituye nada:
 *
 * | Zona | Por qué |
 * |---|---|
 * | Frontmatter | Es metadato; el enlazado solo toca `aliases`, y a propósito |
 * | Bloques cercados | Es código de verdad |
 * | Wikilinks y embeds ya presentes | Idempotencia: aplicar dos veces no cambia nada |
 * | URLs | Un `HU-009` dentro de una URL no es una referencia |
 * | Imágenes `![alt](x)` | El alt no es prosa que enlazar |
 *
 * Los backticks **de una sola línea** NO están acá: son la fuente principal de
 * referencias. Lo que los vuelve seguros es el léxico, no la sintaxis.
 */
export function zonasProtegidas(texto: string): Rango[] {
  const zonas: Rango[] = [];
  const lineas = texto.split("\n");

  // Offset donde empieza cada línea, para traducir línea → posición absoluta.
  const inicios: number[] = [];
  let acumulado = 0;
  for (const l of lineas) {
    inicios.push(acumulado);
    acumulado += l.length + 1;
  }

  // Frontmatter: `---` en la primera línea, hasta el `---`/`...` que lo cierra.
  const sinCr = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  if (lineas.length > 1 && sinCr(lineas[0]) === "---") {
    for (let i = 1; i < lineas.length; i++) {
      const t = sinCr(lineas[i]);
      if (t === "---" || t === "...") {
        zonas.push({ desde: 0, hasta: inicios[i] + lineas[i].length });
        break;
      }
    }
  }

  // Bloques cercados: se cierran con una valla del MISMO carácter y al menos la
  // misma longitud, que es como los delimita CommonMark.
  let abierto: { char: string; largo: number; desde: number } | null = null;
  for (let i = 0; i < lineas.length; i++) {
    const m = RE_FENCE.exec(sinCr(lineas[i]));
    if (abierto === null) {
      if (m) abierto = { char: m[2][0], largo: m[2].length, desde: inicios[i] };
      continue;
    }
    if (m && m[2][0] === abierto.char && m[2].length >= abierto.largo) {
      zonas.push({ desde: abierto.desde, hasta: inicios[i] + lineas[i].length });
      abierto = null;
    }
  }
  // Una valla sin cerrar protege hasta el final: es lo prudente.
  if (abierto !== null) zonas.push({ desde: abierto.desde, hasta: texto.length });

  for (const re of [RE_WIKILINK, RE_IMAGEN, RE_URL]) {
    re.lastIndex = 0;
    for (let m = re.exec(texto); m !== null; m = re.exec(texto)) {
      zonas.push({ desde: m.index, hasta: m.index + m[0].length });
    }
  }

  return zonas.sort((a, b) => a.desde - b.desde);
}

const dentroDe = (zonas: Rango[], desde: number, hasta: number): boolean =>
  zonas.some((z) => desde < z.hasta && hasta > z.desde);

// ── Coincidencia ──────────────────────────────────────────────────────────────

/** Carácter que continúa una palabra: `HU-0091` no contiene a `HU-009`. */
const esCaracterDePalabra = (c: string | undefined): boolean =>
  c !== undefined && /[\p{L}\p{N}_-]/u.test(c);

/** Una forma del léxico ya lista para aplicar, con su destino. */
export type FormaCompilada = { forma: string; destino: string; titulo: string };

/**
 * Formas del léxico ordenadas **de más larga a más corta**. El orden importa:
 * con `HU-009` y `HU-009 Gestion` en el léxico, aplicar la corta primero partiría
 * la larga por la mitad.
 */
export function compilarFormas(lexico: Lexico): FormaCompilada[] {
  const out: FormaCompilada[] = [];
  for (const [destino, d] of Object.entries(lexico.destinos)) {
    for (const forma of d.formas) {
      if (forma.trim() !== "") out.push({ forma, destino, titulo: d.titulo });
    }
  }
  return out.sort((a, b) => b.forma.length - a.forma.length);
}

// ── Aplicación ────────────────────────────────────────────────────────────────

export type Reemplazo = {
  /** Texto tal como estaba (con sus backticks o su sintaxis de enlace). */
  antes: string;
  despues: string;
  forma: string;
  destino: string;
};

export type ResultadoAplicar = { texto: string; reemplazos: Reemplazo[] };

/** ¿El destino de un `[texto](destino)` es una nota del vault? */
function destinoEsNota(destino: string): boolean {
  const d = destino.trim().split("#")[0];
  if (d === "") return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(d)) return false; // http:, mailto:, …
  const base = d.slice(d.lastIndexOf("/") + 1);
  const punto = base.lastIndexOf(".");
  // Sin extensión, o `.md`: cualquier otra cosa (.png, .pdf) se deja intacta.
  return punto <= 0 || base.slice(punto).toLowerCase() === ".md";
}

/**
 * Convierte en `[[wikilinks]]` las referencias del léxico presentes en `texto`.
 *
 * Reglas (§ 7 de la spec):
 *
 * ```
 * `HU-009`                     →  [[HU-009]]     (los backticks se quitan)
 * HU-009                       →  [[HU-009]]
 * [HU-009](HU/HU-009 Ges….md)  →  [[HU-009]]
 * ```
 *
 * - **Todas** las apariciones, no solo la primera: así la regla es uniforme y
 *   re-ejecutable. El grafo sale igual —`grafo.ts` deduplica— pero el documento
 *   se lee mejor.
 * - Sin distinguir mayúsculas, **preservando el texto original**: se escribe
 *   `[[hu-009]]` si eso es lo que había, y resuelve igual porque la resolución de
 *   wikilinks tampoco distingue.
 * - **Idempotente**: un `[[HU-009]]` ya existente es zona protegida.
 * - Los finales de línea CRLF sobreviven porque solo se empalman trozos.
 */
export function aplicarFormas(texto: string, formas: FormaCompilada[]): ResultadoAplicar {
  const zonas = zonasProtegidas(texto);
  const bajo = texto.toLowerCase();

  type Match = Rango & { forma: FormaCompilada; antes: string; despues: string };
  const matches: Match[] = [];
  const tomado: Rango[] = [];

  for (const forma of formas) {
    const aguja = forma.forma.toLowerCase();
    if (aguja === "") continue;
    let desde = bajo.indexOf(aguja);
    while (desde !== -1) {
      const hasta = desde + aguja.length;
      const ok =
        !esCaracterDePalabra(texto[desde - 1]) &&
        !esCaracterDePalabra(texto[hasta]) &&
        !dentroDe(zonas, desde, hasta) &&
        // Una forma más larga ya se quedó con este trozo (van ordenadas).
        !dentroDe(tomado, desde, hasta);

      if (ok) {
        const m = expandirEnvoltorio(texto, desde, hasta);
        if (m !== null) {
          matches.push({ ...m, forma, antes: texto.slice(m.desde, m.hasta) });
          tomado.push({ desde: m.desde, hasta: m.hasta });
        }
      }
      desde = bajo.indexOf(aguja, desde + 1);
    }
  }

  matches.sort((a, b) => a.desde - b.desde);

  const partes: string[] = [];
  const reemplazos: Reemplazo[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.desde < cursor) continue; // solapado: ya se consumió
    partes.push(texto.slice(cursor, m.desde), m.despues);
    reemplazos.push({
      antes: m.antes,
      despues: m.despues,
      forma: m.forma.forma,
      destino: m.forma.destino,
    });
    cursor = m.hasta;
  }
  partes.push(texto.slice(cursor));

  return { texto: partes.join(""), reemplazos };
}

/**
 * Amplía la coincidencia a su envoltorio, si lo tiene: los backticks que la
 * rodean, o el `[texto](destino)` del que es la etiqueta. Devuelve `null` cuando
 * el envoltorio dice que ESTO no hay que tocarlo (un enlace a un `.png`, a una
 * URL): mejor no convertir que convertir mal.
 */
function expandirEnvoltorio(
  texto: string,
  desde: number,
  hasta: number,
): { desde: number; hasta: number; despues: string } | null {
  const literal = texto.slice(desde, hasta);

  // `HU-009` → se traga los backticks. Un `[[enlace]]` entre backticks se vería
  // literal, así que dejarlos sería romperlo.
  if (texto[desde - 1] === "`" && texto[hasta] === "`") {
    return { desde: desde - 1, hasta: hasta + 1, despues: `[[${literal}]]` };
  }

  // [HU-009](ruta) → el enlace entero.
  if (texto[desde - 1] === "[" && texto[hasta] === "]" && texto[hasta + 1] === "(") {
    const cierre = texto.indexOf(")", hasta + 2);
    if (cierre !== -1) {
      const destino = texto.slice(hasta + 2, cierre);
      if (!destinoEsNota(destino)) return null; // .png, http, ancla: intacto
      return { desde: desde - 1, hasta: cierre + 1, despues: `[[${literal}]]` };
    }
  }

  // Dentro de unos corchetes que NO son un enlace markdown: no se toca, para no
  // fabricar un `[[…]]` a partir de un `[algo]` que era otra cosa.
  if (texto[desde - 1] === "[" || texto[hasta] === "]") return null;

  return { desde, hasta, despues: `[[${literal}]]` };
}

// ── Auditoría: descubrir candidatas (NO modifica nada) ────────────────────────

/** Un documento del vault, tal como lo lee la auditoría. */
export type DocumentoTexto = { id: string; titulo: string; texto: string };

/** Una forma candidata a ser referencia, con la evidencia que la respalda. */
export type Candidata = {
  forma: string;
  /** Apariciones totales en todo el corpus. */
  apariciones: number;
  /** Cuántos documentos distintos la nombran. */
  documentos: number;
  /** De dónde salió, para que el usuario entienda por qué se la propone. */
  origen: "backticks" | "identificador" | "titulo" | "enlace-markdown";
  /** Nota del vault a la que parece apuntar, si se encontró una. */
  destino: string | null;
  destinoTitulo: string | null;
  /** Un fragmento real donde aparece, para poder decidir mirándolo. */
  ejemplo: string;
};

const RE_BACKTICK = /`([^`\n]{2,80})`/g;
const RE_IDENTIFICADOR = /\b([A-Z]{2,6}[-_ ]?\d{2,})\b/g;
const RE_ENLACE_MD = /\[([^\]\n]{1,120})\]\(([^)\n]*)\)/g;

/** Índice título → nota, y las formas ya decididas, para no volver a proponerlas. */
type Contexto = {
  porTitulo: Map<string, { id: string; titulo: string }>;
  yaEnLexico: Set<string>;
  descartadas: Set<string>;
};

function contextoDe(notas: { id: string; titulo: string }[], lexico: Lexico): Contexto {
  const porTitulo = new Map<string, { id: string; titulo: string }>();
  for (const n of notas) {
    const k = n.titulo.toLowerCase();
    if (!porTitulo.has(k)) porTitulo.set(k, n);
  }
  const yaEnLexico = new Set<string>();
  for (const d of Object.values(lexico.destinos)) {
    for (const f of d.formas) yaEnLexico.add(f.toLowerCase());
  }
  return {
    porTitulo,
    yaEnLexico,
    descartadas: new Set(lexico.descartadas.map((d) => d.forma.toLowerCase())),
  };
}

/**
 * Nota a la que parece apuntar una forma: por título exacto, o porque el título
 * **empieza** por ella (`HU-009` → «HU-009 Gestion de usuarios», que es como se
 * nombran los documentos con identificador).
 */
function destinoDe(forma: string, ctx: Contexto): { id: string; titulo: string } | null {
  const exacto = ctx.porTitulo.get(forma.toLowerCase());
  if (exacto) return exacto;

  // El prefijo solo vale a partir de tres caracteres: con dos, `fs` "encontraría"
  // cualquier nota que empiece por ahí y la coincidencia sería un accidente.
  if (forma.length < 3) return null;

  const prefijo = `${forma.toLowerCase()} `;
  let unico: { id: string; titulo: string } | null = null;
  for (const [k, nota] of ctx.porTitulo) {
    if (!k.startsWith(prefijo) && !k.startsWith(`${forma.toLowerCase()}-`)) continue;
    // Si más de un documento encaja, no se adivina: se deja sin destino y que lo
    // resuelva quien audita.
    if (unico !== null) return null;
    unico = nota;
  }
  return unico;
}

/** Fragmento alrededor de una posición, para mostrar la forma en contexto. */
function fragmento(texto: string, pos: number, largo: number): string {
  const desde = Math.max(0, pos - 40);
  const hasta = Math.min(texto.length, pos + largo + 40);
  const trozo = texto.slice(desde, hasta).replace(/\s+/g, " ").trim();
  return `${desde > 0 ? "…" : ""}${trozo}${hasta < texto.length ? "…" : ""}`;
}

/**
 * Recorre el corpus y propone formas candidatas. **No modifica nada** — es la
 * mitad segura de la funcionalidad, y la que sostiene toda la separación.
 *
 * Cuatro fuentes, por orden de fiabilidad:
 *
 * 1. **Enlaces Markdown** `[texto](otra.md)` — ya son una referencia declarada.
 * 2. **Backticks** `` `HU-009` `` — la fuente principal en la práctica.
 * 3. **Identificadores** sueltos (`HU-009`, `RF_012`) fuera de backticks.
 * 4. **Títulos de notas** nombrados literalmente en la prosa.
 *
 * Lo que ya está en el léxico o fue descartado no se vuelve a proponer: es lo que
 * hace que la segunda auditoría sea barata.
 */
export function candidatasDe(
  docs: DocumentoTexto[],
  notas: { id: string; titulo: string }[],
  lexico: Lexico = LEXICO_VACIO,
): Candidata[] {
  const ctx = contextoDe(notas, lexico);
  const acumulado = new Map<
    string,
    { forma: string; apariciones: number; docs: Set<string>; origen: Candidata["origen"]; ejemplo: string }
  >();

  /** Prioridad de origen: una fuente más fiable pisa a una menos fiable. */
  const rango: Record<Candidata["origen"], number> = {
    "enlace-markdown": 3,
    backticks: 2,
    identificador: 1,
    titulo: 0,
  };

  const anotar = (
    forma: string,
    origen: Candidata["origen"],
    doc: DocumentoTexto,
    pos: number,
  ) => {
    const limpia = forma.trim();
    const k = limpia.toLowerCase();
    if (limpia === "" || ctx.yaEnLexico.has(k) || ctx.descartadas.has(k)) return;
    // Una nota no se referencia a sí misma.
    if (limpia.toLowerCase() === doc.titulo.toLowerCase()) return;

    const previo = acumulado.get(k);
    if (previo) {
      previo.apariciones++;
      previo.docs.add(doc.id);
      if (rango[origen] > rango[previo.origen]) {
        previo.origen = origen;
        previo.ejemplo = fragmento(doc.texto, pos, limpia.length);
      }
      return;
    }
    acumulado.set(k, {
      forma: limpia,
      apariciones: 1,
      docs: new Set([doc.id]),
      origen,
      ejemplo: fragmento(doc.texto, pos, limpia.length),
    });
  };

  for (const doc of docs) {
    const zonas = zonasProtegidas(doc.texto);
    // Trozos del documento ya contados. Sin esto la MISMA aparición se contaría
    // varias veces —`\`HU-009\`` la ven los backticks y también el patrón de
    // identificador— y el número de apariciones, que es justo lo que se mira para
    // decidir si una forma vale la pena, saldría inflado.
    const contados: Rango[] = [];
    const tomar = (i: number, largo: number): boolean => {
      if (dentroDe(zonas, i, i + largo) || dentroDe(contados, i, i + largo)) return false;
      contados.push({ desde: i, hasta: i + largo });
      return true;
    };

    // El orden de las cuatro pasadas ES la prioridad: la fuente más fiable se
    // queda con el trozo y las siguientes ya no lo vuelven a contar.
    RE_ENLACE_MD.lastIndex = 0;
    for (let m = RE_ENLACE_MD.exec(doc.texto); m !== null; m = RE_ENLACE_MD.exec(doc.texto)) {
      if (doc.texto[m.index - 1] === "!") continue; // imagen
      // El enlace entero, destino incluido: un `HU-009` dentro de la RUTA no es
      // otra aparición en la prosa.
      if (!tomar(m.index, m[0].length)) continue;
      if (destinoEsNota(m[2])) anotar(m[1], "enlace-markdown", doc, m.index + 1);
    }

    RE_BACKTICK.lastIndex = 0;
    for (let m = RE_BACKTICK.exec(doc.texto); m !== null; m = RE_BACKTICK.exec(doc.texto)) {
      if (!tomar(m.index, m[0].length)) continue;
      anotar(m[1], "backticks", doc, m.index + 1);
    }

    RE_IDENTIFICADOR.lastIndex = 0;
    for (let m = RE_IDENTIFICADOR.exec(doc.texto); m !== null; m = RE_IDENTIFICADOR.exec(doc.texto)) {
      if (!tomar(m.index, m[0].length)) continue;
      anotar(m[1], "identificador", doc, m.index);
    }

    // Títulos nombrados en la prosa. Se buscan solo los que tienen cuerpo: un
    // título de una palabra corriente («Estado») produciría ruido sin fin.
    for (const nota of notas) {
      if (nota.id === doc.id || nota.titulo.length < 6) continue;
      const bajo = doc.texto.toLowerCase();
      const aguja = nota.titulo.toLowerCase();
      for (let i = bajo.indexOf(aguja); i !== -1; i = bajo.indexOf(aguja, i + 1)) {
        if (esCaracterDePalabra(doc.texto[i - 1])) continue;
        if (esCaracterDePalabra(doc.texto[i + nota.titulo.length])) continue;
        if (!tomar(i, nota.titulo.length)) continue;
        anotar(nota.titulo, "titulo", doc, i);
      }
    }
  }

  return [...acumulado.values()]
    .map((c) => {
      const destino = destinoDe(c.forma, ctx);
      return {
        forma: c.forma,
        apariciones: c.apariciones,
        documentos: c.docs.size,
        origen: c.origen,
        destino: destino?.id ?? null,
        destinoTitulo: destino?.titulo ?? null,
        ejemplo: c.ejemplo,
      };
    })
    .filter((c) => c.destino !== null || !esRuidoEvidente(c.forma))
    // Primero las que apuntan a una nota REAL, después por apariciones. El orden
    // importa más de lo que parece: sobre un vault técnico, ordenar solo por
    // apariciones pone arriba `.mycignore`, `desktop-tauri` y `---` —backticks de
    // código, no referencias— y el usuario tiene que descartar decenas de filas
    // antes de llegar a la primera útil. Apuntar a una nota que existe es la
    // señal más fuerte que hay, y es gratis.
    .sort(
      (a, b) =>
        Number(b.destino !== null) - Number(a.destino !== null) ||
        b.apariciones - a.apariciones ||
        a.forma.localeCompare(b.forma, "es"),
    );
}

/**
 * Formas que evidentemente no nombran a ningún documento. **Solo se aplica a las
 * que NO apuntan a una nota**: si una forma resuelve a un archivo real, sobrevive
 * pase lo que pase — el filtro no puede esconder una referencia de verdad.
 *
 * Sin esto, sobre un vault técnico la lista se llena de backticks de código
 * (`.md`, `---`, `1.2.0`) y decidir sale más caro que el problema que resuelve.
 */
function esRuidoEvidente(forma: string): boolean {
  const f = forma.trim();
  if (!/\p{L}/u.test(f)) return true; // `---`, `1.2.0`, `- [ ]`
  if (/^\.[\p{L}\p{N}]{1,12}$/u.test(f)) return true; // extensiones sueltas: `.md`, `.sig`
  if (/[(){}[\]<>|=;]/.test(f)) return true; // fragmentos de código
  return false;
}

// ── Diagnóstico ───────────────────────────────────────────────────────────────

export type Diagnostico = {
  documentos: number;
  /** Documentos que no contienen ni un `[[wikilink]]`. */
  sinEnlaces: number;
  wikilinks: number;
  /** Formas candidatas y sus apariciones, ya descontado el léxico. */
  candidatas: number;
  apariciones: number;
};

/**
 * El diagnóstico que `/vault-huerfanas` no sabía dar: no «todo está huérfano»,
 * sino cuántas referencias sin estructura hay y de qué formas.
 */
export function diagnosticar(docs: DocumentoTexto[], candidatas: Candidata[]): Diagnostico {
  let sinEnlaces = 0;
  let wikilinks = 0;
  for (const d of docs) {
    const n = (d.texto.match(RE_WIKILINK) ?? []).length;
    wikilinks += n;
    if (n === 0) sinEnlaces++;
  }
  return {
    documentos: docs.length,
    sinEnlaces,
    wikilinks,
    candidatas: candidatas.length,
    apariciones: candidatas.reduce((a, c) => a + c.apariciones, 0),
  };
}

/**
 * Añade formas al léxico bajo su destino, sin duplicar. Devuelve un léxico nuevo:
 * el original no se toca, para que la UI pueda descartar el cambio.
 */
export function conFormas(
  lexico: Lexico,
  altas: { forma: string; destino: string; titulo: string }[],
): Lexico {
  const destinos = { ...lexico.destinos };
  for (const { forma, destino, titulo } of altas) {
    const previo = destinos[destino] ?? { titulo, formas: [] };
    if (!previo.formas.some((f) => f.toLowerCase() === forma.toLowerCase())) {
      destinos[destino] = { titulo: previo.titulo, formas: [...previo.formas, forma] };
    }
  }
  return { ...lexico, destinos };
}

/** Registra formas descartadas, para no volver a proponerlas nunca. */
export function conDescartes(
  lexico: Lexico,
  descartes: { forma: string; motivo: string }[],
): Lexico {
  const vistas = new Set(lexico.descartadas.map((d) => d.forma.toLowerCase()));
  const nuevas = descartes.filter((d) => !vistas.has(d.forma.toLowerCase()));
  return { ...lexico, descartadas: [...lexico.descartadas, ...nuevas] };
}

// ── Reescritura de enlaces al renombrar (`FUN-M-08`) ─────────────────────────

/**
 * Bloques de código cercados, donde NO se reescribe nada: ahí un `[[x]]` está
 * mostrando la sintaxis, no enlazando.
 *
 * Es un juego de zonas distinto del de `zonasProtegidas`: aquella protege los
 * wikilinks existentes porque su trabajo es CREARLOS; acá los wikilinks
 * existentes son justamente el objetivo.
 */
function zonasDeCodigo(texto: string): Rango[] {
  const zonas: Rango[] = [];
  const cercado = /^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = cercado.exec(texto)) !== null) {
    zonas.push({ desde: m.index, hasta: m.index + m[0].length });
  }
  return zonas;
}

/** `[[destino]]`, `[[destino|alias]]`, `![[destino]]`, con ancla `#` o `^`. */
const RE_ENLACE_PARTIDO = /(!?)\[\[([^\[\]\n]+)\]\]/g;

/**
 * Cambia el destino de los `[[enlaces]]` que apuntaban a `viejo` para que
 * apunten a `nuevo` (`FUN-M-08`).
 *
 * Conserva **todo** lo demás del enlace: el `!` de un embed, el alias tras la
 * barra, y el ancla de sección (`#`) o de bloque (`^`). Solo se toca el tramo
 * del destino, que es lo único que el renombrado invalida.
 *
 * La comparación **no distingue mayúsculas**, igual que la resolución de
 * wikilinks: `[[mi nota]]` y `[[Mi Nota]]` apuntan a la misma.
 *
 * El frontmatter **sí** se reescribe: un wikilink en una propiedad es una
 * referencia de verdad, y romperlo sería tan malo como romper uno del cuerpo.
 *
 * Puro y sin imports, como el resto del módulo.
 */
export function reescribirEnlaces(
  texto: string,
  viejo: string,
  nuevo: string,
): { texto: string; cambios: number } {
  const buscado = viejo.trim().toLowerCase();
  if (buscado === "" || viejo.trim() === nuevo.trim()) return { texto, cambios: 0 };

  const codigo = zonasDeCodigo(texto);
  const enCodigo = (i: number) => codigo.some((z) => i >= z.desde && i < z.hasta);

  let cambios = 0;
  RE_ENLACE_PARTIDO.lastIndex = 0;
  const salida = texto.replace(RE_ENLACE_PARTIDO, (todo, embed: string, dentro: string, pos: number) => {
    if (enCodigo(pos)) return todo;

    // `destino#seccion|alias`: el alias corta primero, después el ancla.
    const barra = dentro.indexOf("|");
    const destinoYAncla = barra === -1 ? dentro : dentro.slice(0, barra);
    const alias = barra === -1 ? "" : dentro.slice(barra);

    const corte = destinoYAncla.search(/[#^]/);
    const destino = corte === -1 ? destinoYAncla : destinoYAncla.slice(0, corte);
    const ancla = corte === -1 ? "" : destinoYAncla.slice(corte);

    if (destino.trim().toLowerCase() !== buscado) return todo;

    cambios++;
    // Se respeta el espaciado que hubiera alrededor del destino.
    const izq = /^\s*/.exec(destino)?.[0] ?? "";
    const der = /\s*$/.exec(destino)?.[0] ?? "";
    return embed + "[[" + izq + nuevo.trim() + der + ancla + alias + "]]";
  });

  return { texto: salida, cambios };
}
