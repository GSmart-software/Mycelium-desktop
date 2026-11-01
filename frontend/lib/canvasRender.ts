/**
 * Vista previa de un lienzo embebido en una nota: `![[lienzo.canvas]]` y, por
 * `FUN-S-18`, `![[lienzo]]` (`FUN-S-19`).
 *
 * Decisión del usuario (2026-10-31): una **vista previa de solo lectura**; un
 * clic abre el lienzo en su pestaña, como el embed de draw.io. No es un lienzo
 * navegable dentro de la nota: sería un segundo editor por cada embed.
 *
 * Se dibuja con DOM a secas —no con React— porque la llaman igual la vista de
 * lectura (un `innerHTML` que no es de React) y el widget de la vista en vivo.
 * Lo que pinta es lo mismo que `CanvasView`: grupos al fondo, flechas y
 * tarjetas (`ordenDePintado`, `aristasDibujables`), con el HTML de cada tarjeta
 * de `htmlDeTarjeta`, que comparten los dos.
 *
 * > [!danger] Seguridad (`DEF-159`, `DEF-160`)
 * > El `.canvas` es un archivo ajeno. Nada de él se interpola en HTML: el texto
 * > de las tarjetas pasa por `renderNota` —el pipeline saneado de las notas,
 * > que escapa el HTML y quita los `href` peligrosos (`rehypeSanearUrls`)—, una
 * > tarjeta de enlace por `htmlTarjetaEnlace`, y los rótulos (título de nota,
 * > etiqueta de grupo) van por `textContent`. El color pasa por `colorCss`,
 * > que solo deja un hex o un preset; las coordenadas ya son números.
 */

import { api } from "@/lib/api";
import {
  aristasDibujables,
  cajaDeNodos,
  colorCss,
  htmlTarjetaEnlace,
  ordenDePintado,
  parsearCanvas,
  type Nodo,
} from "@/lib/canvas";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { destinoExterno } from "@/lib/enlacesExternos";
import { carpetaDeNota, rellenarImagenesEn } from "@/lib/imagenesRender";
import { renderNota } from "@/lib/markdown";
import { notaDeRuta } from "@/lib/rutasNotas";
import { useVaultStore, type TreeNota } from "@/stores/vaultStore";

/**
 * El HTML del cuerpo de una tarjeta, según su tipo. Lo usan la tarjeta del
 * lienzo (`CanvasView`) y la vista previa embebida: una sola definición de qué
 * se muestra y por qué camino saneado pasa.
 *
 * - `text`: su markdown, por el pipeline de las notas.
 * - `file`: el contenido de la nota (quien llama lo lee), igual.
 * - `link`: la URL escapada; enlace solo si es un destino externo permitido.
 * - `group`: nada (el rótulo es su etiqueta).
 */
export function htmlDeTarjeta(nodo: Nodo, contenido: string | null): string {
  if (nodo.tipo === "text") return renderNota(nodo.texto ?? "");
  if (nodo.tipo === "file") return renderNota(contenido ?? "");
  // Escapado y validado: la URL viene cruda del archivo (`DEF-159`).
  if (nodo.tipo === "link") return htmlTarjetaEnlace(nodo.url, destinoExterno);
  return "";
}

/** El `.canvas` al que apunta un embed, si existe. */
export function resolverDestinoCanvas(ref: string): TreeNota | undefined {
  const { notas, carpetas } = useVaultStore.getState();
  const conExtension = /\.canvas$/i.test(ref) ? ref : `${ref}.canvas`;
  const destino = resolveWikilink(conExtension, notas, carpetas);
  return destino && destino.tipo === "canvas" ? destino : undefined;
}

/** Alto máximo de la vista previa, en píxeles: un lienzo alto se achica más. */
const ALTO_MAXIMO = 520;
/** Ancho que se supone si el bloque todavía no está en la página. */
const ANCHO_POR_DEFECTO = 700;
/** Cuántas tarjetas de nota se leen como mucho: el resto muestra solo su título. */
const MAX_NOTAS_LEIDAS = 40;

let siguienteId = 0;

const leerContenido = (id: string): Promise<string | null> =>
  api<{ contenido?: string }>(`/notas/${encodeURIComponent(id)}/contenido`)
    .then((r) => r.contenido ?? "")
    .catch(() => null);

/** Un div posicionado en el mundo del lienzo. */
function caja(n: Nodo, origen: { x: number; y: number }, clase: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = clase;
  div.style.left = `${n.x - origen.x}px`;
  div.style.top = `${n.y - origen.y}px`;
  div.style.width = `${n.ancho}px`;
  div.style.height = `${n.alto}px`;
  const css = colorCss(n.color);
  if (css) {
    div.style.borderColor = css;
    div.style.setProperty("--mic-canvas-color", css);
    div.classList.add("mic-canvas-con-color");
  }
  return div;
}

/**
 * Dibuja el lienzo en `bloque`. Nunca lanza: un lienzo que no existe o no se
 * puede leer deja el motivo y la nota sigue leyéndose. Devuelve el id del
 * lienzo, que es lo que necesita quien maneja el clic para abrir la pestaña.
 */
export async function dibujarCanvasEn(bloque: HTMLElement, ref: string): Promise<string | null> {
  bloque.classList.add("mic-canvas-block");
  bloque.setAttribute("data-diag", ref);
  const destino = resolverDestinoCanvas(ref);
  if (!destino) {
    bloque.classList.add("mic-canvas-error");
    bloque.textContent = `No existe el lienzo "${ref}".`;
    return null;
  }
  bloque.setAttribute("data-nota", destino.id);
  bloque.title = "Clic para abrir el lienzo";

  let canvas;
  try {
    const r = await api<{ contenido?: string }>(`/notas/${encodeURIComponent(destino.id)}/contenido`);
    canvas = parsearCanvas(r.contenido ?? "");
  } catch (e) {
    bloque.classList.add("mic-canvas-error");
    bloque.textContent = `No se pudo leer el lienzo "${ref}": ${e instanceof Error ? e.message : String(e)}`;
    return destino.id;
  }

  const limites = cajaDeNodos(canvas.nodos);
  if (limites === null) {
    bloque.classList.add("mic-canvas-vacio");
    bloque.textContent = `El lienzo "${destino.titulo}" está vacío — clic para abrirlo.`;
    return destino.id;
  }

  // Las notas de las tarjetas, leídas en paralelo (hasta un tope).
  const { notas } = useVaultStore.getState();
  const tarjetasDeNota = canvas.nodos.filter((n) => n.tipo === "file" && n.archivo);
  const contenidos = new Map<string, string | null>();
  await Promise.all(
    tarjetasDeNota.slice(0, MAX_NOTAS_LEIDAS).map(async (n) => {
      const id = notaDeRuta(n.archivo!, notas);
      if (id !== null && !contenidos.has(id)) contenidos.set(id, await leerContenido(id));
    }),
  );

  const margen = 16;
  const origen = { x: limites.x - margen, y: limites.y - margen };
  const ancho = limites.ancho + 2 * margen;
  const alto = limites.alto + 2 * margen;

  const marco = document.createElement("div");
  marco.className = "mic-canvas-marco";
  const mundo = document.createElement("div");
  mundo.className = "mic-canvas-mundo";
  mundo.style.width = `${ancho}px`;
  mundo.style.height = `${alto}px`;
  marco.appendChild(mundo);

  const { grupos, tarjetas } = ordenDePintado(canvas.nodos);
  const carpeta = carpetaDeNota(destino.id);

  // 1) Grupos al fondo.
  for (const g of grupos) {
    const div = caja(g, origen, "mic-canvas-grupo");
    const etiqueta = document.createElement("span");
    etiqueta.className = "mic-canvas-grupo-etiqueta";
    etiqueta.textContent = g.etiqueta ?? "";
    div.appendChild(etiqueta);
    mundo.appendChild(div);
  }

  // 2) Las flechas. Un id de punta propio por embed: dos SVG con el mismo id en
  // la página apuntarían al primero, que puede desaparecer.
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "mic-canvas-aristas");
  svg.setAttribute("width", String(ancho));
  svg.setAttribute("height", String(alto));
  svg.setAttribute("viewBox", `${origen.x} ${origen.y} ${ancho} ${alto}`);
  svg.setAttribute("aria-hidden", "true");
  const idPunta = `mic-canvas-embed-punta-${++siguienteId}`;
  const defs = document.createElementNS(NS, "defs");
  const marker = document.createElementNS(NS, "marker");
  marker.setAttribute("id", idPunta);
  marker.setAttribute("markerWidth", "9");
  marker.setAttribute("markerHeight", "9");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "4.5");
  marker.setAttribute("orient", "auto-start-reverse");
  const punta = document.createElementNS(NS, "path");
  punta.setAttribute("d", "M 0 0 L 9 4.5 L 0 9 z");
  punta.setAttribute("class", "mic-canvas-punta");
  marker.appendChild(punta);
  defs.appendChild(marker);
  svg.appendChild(defs);
  for (const { a, trazo } of aristasDibujables(canvas)) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", trazo.d);
    path.setAttribute("class", "mic-canvas-arista");
    const css = colorCss(a.color);
    if (css) path.style.stroke = css;
    if (a.hastaPunta !== "none") path.setAttribute("marker-end", `url(#${idPunta})`);
    if (a.desdePunta === "arrow") path.setAttribute("marker-start", `url(#${idPunta})`);
    svg.appendChild(path);
  }
  mundo.appendChild(svg);

  // 3) Las tarjetas, en el orden del archivo.
  for (const n of tarjetas) {
    const div = caja(n, origen, `mic-canvas-tarjeta mic-canvas-tarjeta-${n.tipo}`);
    if (n.tipo === "file") {
      const id = n.archivo ? notaDeRuta(n.archivo, notas) : null;
      const nota = id !== null ? notas.find((x) => x.id === id) : undefined;
      const titulo = document.createElement("div");
      titulo.className = "mic-canvas-tarjeta-titulo";
      titulo.textContent = nota?.titulo ?? n.archivo ?? "";
      div.appendChild(titulo);
      if (nota === undefined) {
        const roto = document.createElement("p");
        roto.className = "mic-canvas-roto";
        roto.textContent = `La nota ${n.archivo ?? ""} ya no existe.`;
        div.appendChild(roto);
        mundo.appendChild(div);
        continue;
      }
      const cuerpo = document.createElement("div");
      cuerpo.className = "mic-preview mic-canvas-tarjeta-cuerpo";
      // `htmlDeTarjeta` → `renderNota`: el mismo camino saneado de las notas.
      cuerpo.innerHTML = htmlDeTarjeta(n, contenidos.get(nota.id) ?? null);
      div.appendChild(cuerpo);
    } else {
      const cuerpo = document.createElement("div");
      cuerpo.className = "mic-preview mic-canvas-tarjeta-cuerpo";
      cuerpo.innerHTML = htmlDeTarjeta(n, null);
      div.appendChild(cuerpo);
    }
    mundo.appendChild(div);
  }
  rellenarImagenesEn(mundo, carpeta);

  // Ajustado al ancho del bloque (y a un alto máximo), nunca agrandado.
  const ajustar = () => {
    const disponible = bloque.clientWidth || ANCHO_POR_DEFECTO;
    const escala = Math.min(1, disponible / ancho, ALTO_MAXIMO / alto);
    mundo.style.transform = `scale(${escala})`;
    marco.style.width = `${ancho * escala}px`;
    marco.style.height = `${alto * escala}px`;
  };
  bloque.replaceChildren(marco);
  ajustar();
  if (typeof ResizeObserver !== "undefined") {
    const observador = new ResizeObserver(() => {
      if (!bloque.isConnected) observador.disconnect();
      else ajustar();
    });
    observador.observe(bloque);
  }
  return destino.id;
}

/**
 * Reemplaza los marcadores `a.mic-canvas[data-diag]` por la vista previa del
 * lienzo. Espeja a `renderDrawioIn`.
 *
 * Con `perezoso`, cada lienzo se lee y se dibuja recién cuando el bloque entra
 * en pantalla: una nota índice con muchos lienzos no los carga todos al abrir.
 * La exportación a PDF lo pide sin pereza, porque su contenedor está fuera de
 * la vista y no entraría nunca.
 */
export async function renderCanvasIn(container: HTMLElement, perezoso = true): Promise<void> {
  const anclas = container.querySelectorAll<HTMLElement>("a.mic-canvas[data-diag]");
  const pendientes: Promise<unknown>[] = [];
  for (const ancla of Array.from(anclas)) {
    const ref = ancla.getAttribute("data-diag");
    if (!ref) continue;
    const bloque = document.createElement("div");
    ancla.replaceWith(bloque);
    // Con pereza no se espera: el bloque puede no verse nunca, y quien llama
    // no tiene por qué quedarse colgado de eso.
    const dibujo = dibujarCanvasPerezoso(bloque, ref, perezoso);
    if (!perezoso) pendientes.push(dibujo);
  }
  await Promise.all(pendientes);
}

/**
 * `dibujarCanvasEn`, pero esperando a que el bloque se vea si `perezoso`.
 * Mientras tanto muestra el nombre del lienzo, con el mismo clic.
 */
export function dibujarCanvasPerezoso(
  bloque: HTMLElement,
  ref: string,
  perezoso = true,
): Promise<string | null> {
  if (!perezoso || typeof IntersectionObserver === "undefined") return dibujarCanvasEn(bloque, ref);
  bloque.classList.add("mic-canvas-block", "mic-canvas-cargando");
  bloque.setAttribute("data-diag", ref);
  const destino = resolverDestinoCanvas(ref);
  if (destino) bloque.setAttribute("data-nota", destino.id);
  bloque.textContent = `Lienzo ${destino?.titulo ?? ref}`;
  return new Promise((resolver) => {
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        bloque.classList.remove("mic-canvas-cargando");
        void dibujarCanvasEn(bloque, ref).then(resolver);
      },
      { rootMargin: "200px" },
    );
    observador.observe(bloque);
  });
}
