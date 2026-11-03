/**
 * Vista previa de una base embebida en una nota: `![[tabla.base]]` y
 * `![[tabla.base#Vista]]` (`FUN-S-29`, propuesta 4 de `ia-vaults-intensivos`).
 *
 * Para que una nota índice muestre la tabla que la base ya deriva, en vez de
 * una copia escrita a mano que envejece. Es una **vista previa de solo
 * lectura**, como la de los lienzos (`FUN-S-19`): las filas y las columnas de la
 * vista, hasta un tope, y un clic abre la base en su pestaña —donde se filtra,
 * se ordena y se busca—.
 *
 * El motor es el de siempre (`parsearBase`, `construirTabla` de `lib/bases.ts`):
 * la misma consulta que `BaseView`, sin una segunda copia de los filtros. Solo
 * el dibujo es propio, con DOM a secas, porque lo llaman la vista de lectura y
 * el widget de la vista en vivo.
 *
 * > [!danger] Todo lo que viene de las notas va por `textContent`
 * > Los valores de las propiedades son texto del usuario (o de quien escribió la
 * > nota): ni un `innerHTML` en este archivo.
 */

import { api } from "@/lib/api";
import {
  construirTabla,
  parsearBase,
  textoPlanoDeCelda,
  tituloColumna,
  vistaDeEmbed,
  type NotaTabla,
} from "@/lib/bases";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { formatearFecha } from "@/lib/markdown";
import { useAuthStore } from "@/stores/authStore";
import { useVaultStore, type TreeNota } from "@/stores/vaultStore";

/** Cuántas filas muestra la vista previa; el resto se ve al abrir la base. */
export const FILAS_EMBED = 15;

/** La `.base` a la que apunta un embed, si existe. */
export function resolverDestinoBase(ref: string): TreeNota | undefined {
  const { notas, carpetas } = useVaultStore.getState();
  const conExtension = /\.base$/i.test(ref) ? ref : `${ref}.base`;
  const destino = resolveWikilink(conExtension, notas, carpetas);
  return destino && destino.tipo === "base" ? destino : undefined;
}

/** Un elemento con clase y texto. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  clase: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/** El contenido de una celda, con el mismo criterio que `Celda` de `BaseView`. */
function celda(columna: string, valores: string[] | undefined, nota: NotaTabla): HTMLElement {
  if (valores === undefined || valores.length === 0) return el("span", "mic-base-vacia", "—");
  if (columna === "file.ctime" || columna === "file.mtime") {
    return el("span", "mic-base-fecha", formatearFecha(valores[0]));
  }
  if (columna === "file.size") return el("span", "mic-base-numero", `${(nota.size / 1024).toFixed(1)} KB`);
  if (valores.length > 1 || columna === "file.tags") {
    const pildoras = el("span", "mic-base-pildoras");
    for (const v of valores) pildoras.appendChild(el("span", "mic-base-pildora", textoPlanoDeCelda(v)));
    return pildoras;
  }
  const unico = valores[0];
  if (unico === "true" || unico === "false") {
    const casilla = el("input", "");
    casilla.type = "checkbox";
    casilla.checked = unico === "true";
    casilla.disabled = true;
    casilla.setAttribute("aria-label", columna);
    return casilla;
  }
  if (/^-?\d+(\.\d+)?$/.test(unico)) return el("span", "mic-base-numero", unico);
  return el("span", "", textoPlanoDeCelda(unico));
}

/**
 * Dibuja la vista de la base en `bloque`. `vistaPedida` es el ancla del embed
 * (`#Vista`) o `null`. Nunca lanza: lo que no se puede mostrar deja el motivo.
 * Devuelve el id de la base, para que quien maneja el clic abra la pestaña.
 */
export async function dibujarBaseEn(
  bloque: HTMLElement,
  ref: string,
  vistaPedida: string | null,
): Promise<string | null> {
  bloque.classList.add("mic-base-block");
  bloque.setAttribute("data-diag", ref);
  const destino = resolverDestinoBase(ref);
  if (!destino) {
    bloque.classList.add("mic-base-error");
    bloque.textContent = `No existe la base "${ref}".`;
    return null;
  }
  bloque.setAttribute("data-nota", destino.id);
  bloque.title = "Clic para abrir la base";

  try {
    const token = useAuthStore.getState().accessToken;
    const vaultId = useAuthStore.getState().vaults[0]?.id ?? null;
    const [contenido, filas] = await Promise.all([
      api<{ contenido?: string }>(`/notas/${encodeURIComponent(destino.id)}/contenido`, { token }),
      vaultId
        ? api<{ notas: NotaTabla[] }>(`/vaults/${vaultId}/tabla`, { token })
        : Promise.resolve({ notas: [] as NotaTabla[] }),
    ]);
    const base = parsearBase(contenido.contenido ?? "");
    const elegida = vistaDeEmbed(base, vistaPedida);

    const cabecera = el("div", "mic-base-cabecera");
    cabecera.appendChild(el("span", "mic-base-titulo", destino.titulo));
    if (elegida !== null && elegida.vista.nombre) {
      cabecera.appendChild(el("span", "mic-base-vista", elegida.vista.nombre));
    }
    const contenidoBloque: HTMLElement[] = [cabecera];

    if (elegida === null) {
      contenidoBloque.push(el("p", "mic-base-aviso", "La base no tiene vistas."));
      bloque.replaceChildren(...contenidoBloque);
      return destino.id;
    }
    if (!elegida.encontrada) {
      contenidoBloque.push(
        el("p", "mic-base-aviso", `No hay una vista «${vistaPedida}»: se muestra la primera.`),
      );
    }

    const tabla = construirTabla(base, elegida.vista, filas.notas);
    if (!tabla.ok) {
      contenidoBloque.push(el("p", "mic-base-aviso", `${tabla.motivo} Clic para abrir la base.`));
      bloque.replaceChildren(...contenidoBloque);
      return destino.id;
    }

    if (tabla.filas.length === 0) {
      contenidoBloque.push(el("p", "mic-base-aviso", "Ninguna nota cumple los filtros de esta vista."));
      bloque.replaceChildren(...contenidoBloque);
      return destino.id;
    }

    const marco = el("div", "mic-base-marco");
    const t = el("table", "mic-base-tabla");
    const trCab = el("tr", "");
    for (const c of tabla.columnas) trCab.appendChild(el("th", "", tituloColumna(base, c)));
    t.appendChild(el("thead", "")).appendChild(trCab);
    const cuerpo = t.appendChild(el("tbody", ""));
    for (const { nota, celdas } of tabla.filas.slice(0, FILAS_EMBED)) {
      const tr = el("tr", "");
      celdas.forEach((valores, i) => {
        const td = el("td", "");
        td.appendChild(celda(tabla.columnas[i], valores, nota));
        tr.appendChild(td);
      });
      cuerpo.appendChild(tr);
    }
    marco.appendChild(t);
    contenidoBloque.push(marco);

    // Lo que no entra: las que deja fuera el tope de la vista previa. Las que
    // recorta el `limit` de la propia vista tampoco se ven al abrirla, así que
    // no se prometen.
    const mas = tabla.filas.length - FILAS_EMBED;
    contenidoBloque.push(
      el(
        "p",
        "mic-base-pie",
        mas > 0
          ? `${mas} ${mas === 1 ? "fila más" : "filas más"} — clic para abrir la base`
          : `${tabla.filas.length} ${tabla.filas.length === 1 ? "fila" : "filas"}`,
      ),
    );
    bloque.replaceChildren(...contenidoBloque);
  } catch (e) {
    bloque.classList.add("mic-base-error");
    bloque.textContent = `No se pudo leer la base "${ref}": ${e instanceof Error ? e.message : String(e)}`;
  }
  return destino.id;
}

/**
 * `dibujarBaseEn`, pero esperando a que el bloque se vea si `perezoso`: una
 * nota índice con varias tablas no las consulta todas al abrir. Mientras tanto
 * muestra el nombre de la base, con el mismo clic.
 */
export function dibujarBasePerezoso(
  bloque: HTMLElement,
  ref: string,
  vistaPedida: string | null,
  perezoso = true,
): Promise<string | null> {
  if (!perezoso || typeof IntersectionObserver === "undefined") {
    return dibujarBaseEn(bloque, ref, vistaPedida);
  }
  bloque.classList.add("mic-base-block", "mic-base-cargando");
  bloque.setAttribute("data-diag", ref);
  const destino = resolverDestinoBase(ref);
  if (destino) bloque.setAttribute("data-nota", destino.id);
  bloque.textContent = `Tabla ${destino?.titulo ?? ref}${vistaPedida ? ` › ${vistaPedida}` : ""}`;
  return new Promise((resolver) => {
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        bloque.classList.remove("mic-base-cargando");
        void dibujarBaseEn(bloque, ref, vistaPedida).then(resolver);
      },
      { rootMargin: "200px" },
    );
    observador.observe(bloque);
  });
}

/**
 * Reemplaza los marcadores `a.mic-base[data-diag]` por la vista previa de la
 * tabla. La vista pedida viaja en `data-ancla`. Espeja a `renderCanvasIn`.
 */
export async function renderBaseIn(container: HTMLElement, perezoso = true): Promise<void> {
  const anclas = container.querySelectorAll<HTMLElement>("a.mic-base[data-diag]");
  const pendientes: Promise<unknown>[] = [];
  for (const ancla of Array.from(anclas)) {
    const ref = ancla.getAttribute("data-diag");
    if (!ref) continue;
    const bloque = document.createElement("div");
    ancla.replaceWith(bloque);
    const dibujo = dibujarBasePerezoso(bloque, ref, ancla.getAttribute("data-ancla"), perezoso);
    if (!perezoso) pendientes.push(dibujo);
  }
  await Promise.all(pendientes);
}
