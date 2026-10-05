/**
 * El árbol del explorador **en vivo** (`FUN-M-42`): primero el árbol, después
 * el índice, como Obsidian.
 *
 * Hasta acá, un archivo agregado desde fuera recorría el debounce del watcher
 * (400 ms), el del frontend (300 ms), el indexado COMPLETO del vault y la
 * recarga del árbol desde el índice antes de aparecer: ~1 s, y el explorador
 * esperaba al índice entero. Ahora el evento del watcher dice qué hay en cada
 * ruta (`CambioVault`, de `vault_watch.rs`) y el árbol se actualiza con él en
 * el acto (`aplicarCambios`); el índice se pone al día después, solo con esas
 * rutas (`indexarRutas`).
 *
 * Por qué alcanza con aplicar el cambio y no hay que «reconciliar ids»: en el
 * índice del desktop el id de una nota **es su ruta relativa** (y el de una
 * carpeta, la suya). La entrada que se agrega al árbol antes de indexar tiene ya
 * el id definitivo: las pestañas, los enlaces y el grafo la encuentran igual
 * cuando el índice la alcanza.
 *
 * Lo que sí hay que cuidar es que una recarga del árbol desde el índice
 * (`vaultStore.loadTree`, que llaman todas las operaciones de la app) no borre
 * lo que el índice todavía no tiene. Para eso están los **pendientes**: los
 * cambios aplicados al árbol cuyo indexado no terminó. `loadTree` los vuelve a
 * aplicar encima de lo que leyó del índice.
 *
 * Todo lo de este módulo es puro salvo el registro de pendientes, y no importa
 * nada en tiempo de ejecución: se prueba con `node --test
 * scripts/test-arbol-vivo.mjs`.
 */
import type { OtroArchivo } from "@/lib/otrosArchivos";
import type { NotaTipo, TreeCarpeta, TreeNota } from "@/stores/vaultStore";

/** Qué hay AHORA en una ruta del vault, según el watcher (`vault_watch.rs`). */
export type EstadoRuta = "nota" | "otro" | "carpeta" | "ausente";

/**
 * Una ruta que cambió. `tipo` es el de la nota si `estado` es `nota`, la
 * extensión si es `otro` y vacío en los demás casos. `mtime` es el que tenía en
 * disco al emitirse el evento (0 si ya no existe): con él se reconocen los
 * guardados de la propia app (`esEscrituraPropia`, `FUN-M-38`).
 *
 * `ausente` no dice si lo que se fue era una carpeta: se quita la ruta y todo lo
 * que cuelgue de ella. Un renombrado llega como el origen `ausente` y el
 * destino con lo que es.
 */
export type CambioVault = { ruta: string; mtime: number; estado: EstadoRuta; tipo: string };

/** Lo que el explorador muestra: lo mismo que guarda `vaultStore`. */
export type Arbol = {
  carpetas: readonly TreeCarpeta[];
  notas: readonly TreeNota[];
  otros: readonly OtroArchivo[];
};

/** Lo que devuelve el comando `recorrer_vault` (ver `archivos.rs`). */
export type RecorridoVault = {
  archivosMeta: { rutaRelativa: string; mtime: number; tipo: string }[];
  otros: { rutaRelativa: string; mtime?: number; tipo: string }[];
  directorios: string[];
};

/**
 * Los tipos de nota. El `Record<NotaTipo, …>` hace que un tipo nuevo no compile
 * hasta agregarlo acá (ver `lib/extensionesDeTipo.ts`).
 */
const TIPOS_NOTA: Record<NotaTipo, true> = {
  markdown: true,
  excalidraw: true,
  base: true,
  canvas: true,
  drawio: true,
};

/** El tipo de nota de un `tipo` del recorrido; `markdown` si no lo reconoce. */
export function tipoDeNota(tipo: string): NotaTipo {
  return tipo in TIPOS_NOTA ? (tipo as NotaTipo) : "markdown";
}

/** Extensión (en minúsculas) → tipo de nota, como `tipo_de` en `archivos.rs`. */
const NOTA_POR_EXTENSION: Record<string, NotaTipo> = {
  md: "markdown",
  excalidraw: "excalidraw",
  base: "base",
  canvas: "canvas",
  drawio: "drawio",
};

/** El tipo de nota de una ruta, o `null` si no es una nota (no se indexa). */
export function tipoDeNotaPorRuta(ruta: string): NotaTipo | null {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  if (punto <= 0) return null;
  return NOTA_POR_EXTENSION[nombre.slice(punto + 1).toLowerCase()] ?? null;
}

/**
 * El orden de `COLLATE NOCASE` de SQLite: pliega solo `A`–`Z` y después compara
 * por unidades. El explorador agrupa las carpetas y las notas en el orden en que
 * vienen (el de `tree()`), así que lo que se inserta acá tiene que caer donde lo
 * pondría el índice; si no, una nota nueva aparecería al final y saltaría de
 * lugar al indexarse.
 */
export function compararNocase(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x >= 65 && x <= 90) x += 32;
    if (y >= 65 && y <= 90) y += 32;
    if (x !== y) return x - y;
  }
  return a.length - b.length;
}

/** Inserta `item` en la lista (ordenada por `clave`) donde le toca. Muta. */
function insertarOrdenado<T>(lista: T[], item: T, clave: (t: T) => string): void {
  const k = clave(item);
  let i = lista.findIndex((t) => compararNocase(clave(t), k) > 0);
  if (i === -1) i = lista.length;
  lista.splice(i, 0, item);
}

/** Carpeta que contiene una ruta (`null` en la raíz). */
function carpetaDe(ruta: string): string | null {
  const i = ruta.lastIndexOf("/");
  return i === -1 ? null : ruta.slice(0, i);
}

/** Último segmento de una ruta. */
function nombreDe(ruta: string): string {
  return ruta.slice(ruta.lastIndexOf("/") + 1);
}

/** Título de una nota: su nombre sin la última extensión (como `tituloDeRuta`). */
function tituloDe(ruta: string): string {
  return nombreDe(ruta).replace(/\.[^.]+$/, "");
}

/**
 * Aplica al árbol lo que dice el watcher. Devuelve el árbol nuevo, o `null` si
 * no cambió nada —el caso de cada guardado de la propia app, que el watcher
 * también ve—, para no re-renderizar el explorador en balde.
 *
 * Idempotente: aplicar dos veces el mismo cambio no hace nada la segunda. Es lo
 * que permite reaplicar los pendientes sobre cada recarga desde el índice y que
 * los eventos de las operaciones de la propia app —que ya recargaron el árbol—
 * no tengan efecto.
 *
 * Las listas que no cambian se devuelven tal cual (misma referencia).
 */
export function aplicarCambios(arbol: Arbol, cambios: readonly CambioVault[]): Arbol | null {
  let carpetas = arbol.carpetas as TreeCarpeta[];
  let notas = arbol.notas as TreeNota[];
  let otros = arbol.otros as OtroArchivo[];
  // Copia al primer cambio de cada lista (las del store no se mutan).
  let carpetasPropias = false;
  let notasPropias = false;
  let otrosPropios = false;
  const idsCarpetas = new Set(carpetas.map((c) => c.id));
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  const rutasOtros = new Set(otros.map((o) => o.ruta));

  const editarCarpetas = () => {
    if (!carpetasPropias) (carpetas = [...carpetas]), (carpetasPropias = true);
    return carpetas;
  };
  const editarNotas = () => {
    if (!notasPropias) (notas = [...notas]), (notasPropias = true);
    return notas;
  };
  const editarOtros = () => {
    if (!otrosPropios) (otros = [...otros]), (otrosPropios = true);
    return otros;
  };

  /** Quita lo que haya EXACTAMENTE en `ruta` (salvo la clase `menos`, si la hay). */
  const quitarExacto = (ruta: string, menos: "nota" | "otro" | "carpeta" | null) => {
    if (menos !== "nota" && notaPorId.has(ruta)) {
      notaPorId.delete(ruta);
      notas = notas.filter((n) => n.id !== ruta);
      notasPropias = true;
    }
    if (menos !== "otro" && rutasOtros.has(ruta)) {
      rutasOtros.delete(ruta);
      otros = otros.filter((o) => o.ruta !== ruta);
      otrosPropios = true;
    }
    if (menos !== "carpeta" && idsCarpetas.has(ruta)) {
      idsCarpetas.delete(ruta);
      carpetas = carpetas.filter((c) => c.id !== ruta);
      carpetasPropias = true;
      quitarDebajo(ruta);
    }
  };

  /** Quita todo lo que cuelgue de la carpeta `ruta`. */
  const quitarDebajo = (ruta: string) => {
    const pre = `${ruta}/`;
    if (notas.some((n) => n.id.startsWith(pre))) {
      notas = notas.filter((n) => !n.id.startsWith(pre));
      notasPropias = true;
      for (const id of [...notaPorId.keys()]) if (id.startsWith(pre)) notaPorId.delete(id);
    }
    if (otros.some((o) => o.ruta.startsWith(pre))) {
      otros = otros.filter((o) => !o.ruta.startsWith(pre));
      otrosPropios = true;
      for (const r of [...rutasOtros]) if (r.startsWith(pre)) rutasOtros.delete(r);
    }
    if (carpetas.some((c) => c.id.startsWith(pre))) {
      carpetas = carpetas.filter((c) => !c.id.startsWith(pre));
      carpetasPropias = true;
      for (const id of [...idsCarpetas]) if (id.startsWith(pre)) idsCarpetas.delete(id);
    }
  };

  /** Asegura la carpeta `dir` y todos sus ancestros. */
  const asegurarCarpeta = (dir: string | null) => {
    if (dir === null || idsCarpetas.has(dir)) return;
    asegurarCarpeta(carpetaDe(dir));
    // Si había un archivo con esa ruta (se reemplazó por una carpeta), fuera.
    quitarExacto(dir, "carpeta");
    idsCarpetas.add(dir);
    insertarOrdenado(editarCarpetas(), { id: dir, padreId: carpetaDe(dir), nombre: nombreDe(dir) }, (c) => c.nombre);
  };

  for (const c of cambios) {
    if (c.ruta === "") continue;
    switch (c.estado) {
      case "ausente":
        // Si era una carpeta, `quitarExacto` se lleva también su contenido. No
        // hace falta buscar contenido bajo una ruta que no era carpeta: todo lo
        // que hay en el árbol tiene su carpeta en él (`asegurarCarpeta`, y el
        // índice deriva las carpetas de las rutas). Así borrar mil archivos
        // sueltos no recorre las listas mil veces.
        quitarExacto(c.ruta, null);
        break;
      case "carpeta":
        asegurarCarpeta(c.ruta);
        break;
      case "nota": {
        quitarExacto(c.ruta, "nota");
        asegurarCarpeta(carpetaDe(c.ruta));
        const tipo = tipoDeNota(c.tipo);
        const previa = notaPorId.get(c.ruta);
        if (previa && previa.tipo === tipo) break;
        const nota: TreeNota = {
          id: c.ruta,
          carpetaId: carpetaDe(c.ruta),
          titulo: tituloDe(c.ruta),
          tipo,
          actualizadoEn: new Date(c.mtime > 0 ? c.mtime : Date.now()).toISOString(),
        };
        const lista = editarNotas();
        if (previa) lista.splice(lista.indexOf(previa), 1);
        insertarOrdenado(lista, nota, (n) => n.titulo);
        notaPorId.set(c.ruta, nota);
        break;
      }
      case "otro": {
        quitarExacto(c.ruta, "otro");
        asegurarCarpeta(carpetaDe(c.ruta));
        if (rutasOtros.has(c.ruta)) break;
        rutasOtros.add(c.ruta);
        editarOtros().push({
          ruta: c.ruta,
          nombre: nombreDe(c.ruta),
          extension: c.tipo,
          carpetaId: carpetaDe(c.ruta),
        });
        break;
      }
    }
  }

  if (!carpetasPropias && !notasPropias && !otrosPropios) return null;
  return { carpetas, notas, otros };
}

/**
 * Qué le falta o le sobra al árbol respecto del disco (`FUN-M-42`), como
 * cambios listos para `aplicarCambios`. Es la reconciliación: Windows pierde
 * eventos en ráfagas grandes (`ReadDirectoryChangesW` desborda su búfer) y lo
 * que se perdió no llega nunca por el watcher.
 *
 * Primero lo que sobra (`ausente`) y después lo que falta, para que una ruta
 * que cambió de clase (un archivo que ahora es carpeta) se quite antes de
 * volver a entrar. Las notas se comparan por ruta y tipo: si el CONTENIDO
 * cambió, lo ve el indexado incremental (por `mtime`), no el árbol.
 */
export function diferenciasConDisco(arbol: Arbol, recorrido: RecorridoVault): CambioVault[] {
  const notasDisco = new Map(recorrido.archivosMeta.map((a) => [a.rutaRelativa, a]));
  const otrosDisco = new Map(recorrido.otros.map((o) => [o.rutaRelativa, o]));
  const dirsDisco = new Set<string>();
  const agregarDir = (dir: string | null) => {
    while (dir !== null && !dirsDisco.has(dir)) {
      dirsDisco.add(dir);
      dir = carpetaDe(dir);
    }
  };
  for (const d of recorrido.directorios) agregarDir(d);
  for (const r of notasDisco.keys()) agregarDir(carpetaDe(r));
  for (const r of otrosDisco.keys()) agregarDir(carpetaDe(r));

  const sobran: CambioVault[] = [];
  const faltan: CambioVault[] = [];
  const ausente = (ruta: string) => sobran.push({ ruta, mtime: 0, estado: "ausente", tipo: "" });

  for (const c of arbol.carpetas) if (!dirsDisco.has(c.id)) ausente(c.id);
  for (const n of arbol.notas) {
    const enDisco = notasDisco.get(n.id);
    if (!enDisco) ausente(n.id);
  }
  for (const o of arbol.otros) if (!otrosDisco.has(o.ruta)) ausente(o.ruta);

  const carpetasArbol = new Set(arbol.carpetas.map((c) => c.id));
  const notasArbol = new Map(arbol.notas.map((n) => [n.id, n]));
  const otrosArbol = new Set(arbol.otros.map((o) => o.ruta));
  for (const d of dirsDisco) {
    if (!carpetasArbol.has(d)) faltan.push({ ruta: d, mtime: 0, estado: "carpeta", tipo: "" });
  }
  for (const [ruta, a] of notasDisco) {
    const previa = notasArbol.get(ruta);
    if (!previa || previa.tipo !== tipoDeNota(a.tipo)) {
      faltan.push({ ruta, mtime: a.mtime, estado: "nota", tipo: a.tipo });
    }
  }
  for (const [ruta, o] of otrosDisco) {
    if (!otrosArbol.has(ruta)) faltan.push({ ruta, mtime: o.mtime ?? 0, estado: "otro", tipo: o.tipo });
  }
  return [...sobran, ...faltan];
}

// ── Pendientes: lo aplicado al árbol que el índice todavía no tiene ─────────

/**
 * Ruta → último cambio aplicado al árbol y todavía no indexado. El orden del
 * `Map` es el cronológico de la ÚLTIMA vez que se anotó cada ruta (se borra y
 * se vuelve a poner): reaplicarlos en ese orden da el estado de ahora aunque
 * una carpeta se haya ido y vuelto entre medio.
 */
const pendientes = new Map<string, CambioVault>();

/** Anota cambios recién aplicados al árbol, a la espera de su indexado. */
export function anotarPendientes(cambios: readonly CambioVault[]): void {
  for (const c of cambios) {
    pendientes.delete(c.ruta);
    pendientes.set(c.ruta, c);
  }
}

/**
 * Da por indexados estos cambios. Solo quita una ruta si su pendiente es
 * EXACTAMENTE ese cambio (el mismo objeto): si mientras se indexaba llegó otro
 * más nuevo para la misma ruta, ese sigue pendiente.
 */
export function quitarPendientes(cambios: readonly CambioVault[]): void {
  for (const c of cambios) if (pendientes.get(c.ruta) === c) pendientes.delete(c.ruta);
}

/** Los pendientes, en orden. */
export function pendientesActuales(): CambioVault[] {
  return [...pendientes.values()];
}

/** Olvida los pendientes (al cambiar de vault, o tras un recorrido completo). */
export function vaciarPendientes(): void {
  pendientes.clear();
}
