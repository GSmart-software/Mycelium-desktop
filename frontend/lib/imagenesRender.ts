/**
 * Dibujar las imágenes embebidas en una nota (`DEF-126`): la parte con DOM,
 * store y Tauri de lo que resuelve `lib/imagenes.ts`.
 *
 * La vista de lectura (`lib/markdown.ts`) deja un hueco
 * `span.mic-img[data-mic-img]` por cada imagen del vault —no un `<img>` con la
 * ruta escrita, que el webview pediría relativa a la página y daría el ícono
 * roto— y quien muestra la nota lo rellena con `rellenarImagenesEn`, porque
 * solo él sabe **qué nota es** y, por tanto, desde qué carpeta se resuelve
 * `![](foto.png)`. La vista en vivo usa `resolverImagen` + `dibujarImagenEn`
 * desde su widget. Una sola resolución para las dos vistas: la lección de
 * `FUN-L-20` (el embed que se veía al leer y desaparecía al editar).
 *
 * El `src` es la URL del protocolo `asset:` (`urlDeArchivo`), la misma que usa
 * el visor de archivos (`FUN-L-11`): el ámbito lo abre Rust al registrar el
 * vault y cubre solo su carpeta.
 */
import {
  esUrlExterna,
  indexarImagenes,
  resolverEmbedImagen,
  resolverRutaImagen,
  type IndiceImagenes,
  type Tamano,
} from "@/lib/imagenes";
import { urlDeArchivo, type OtroArchivo } from "@/lib/otrosArchivos";
import { getVaultActual } from "@/lib/db/vaultContext";
import { useVaultStore } from "@/stores/vaultStore";

/** Una imagen embebida, tal como se escribió en la nota. */
export type EmbedImagen = {
  /** `wiki` = `![[ref]]`; `md` = `![alt](ref)`. */
  forma: "wiki" | "md";
  ref: string;
  alt: string;
  tamano: Tamano | null;
};

/** A qué se resolvió: la URL que se carga, o el motivo por el que no hay. */
export type ImagenResuelta = { src: string } | { falta: string };

let cache: { otros: OtroArchivo[]; indice: IndiceImagenes } | null = null;

/**
 * Índice de las imágenes del vault, rehecho solo cuando cambia la lista de
 * otros archivos (el store entrega una lista nueva en cada reindexado). La
 * vista en vivo resuelve en cada pulsación: recorrer la lista cada vez sería
 * pagar por algo que casi nunca cambia.
 */
function indiceActual(): IndiceImagenes {
  const otros = useVaultStore.getState().otros;
  if (cache === null || cache.otros !== otros) {
    cache = { otros, indice: indexarImagenes(otros.map((o) => o.ruta)) };
  }
  return cache.indice;
}

/** Carpeta (ruta relativa) de una nota, o `null` si está en la raíz o no se conoce. */
export function carpetaDeNota(notaId: string | null | undefined): string | null {
  if (!notaId) return null;
  return useVaultStore.getState().notas.find((n) => n.id === notaId)?.carpetaId ?? null;
}

/** Resuelve un embed contra el vault abierto. */
export function resolverImagen(embed: EmbedImagen, carpetaNota: string | null): ImagenResuelta {
  const falta = { falta: `No se encontró la imagen «${embed.ref}».` };
  // Una URL de afuera va tal cual (sin decodificar: el `%20` es suyo).
  const crudo = embed.ref.trim().replace(/^<([^]*)>$/, "$1").trim();
  if (embed.forma === "md" && esUrlExterna(crudo)) return { src: crudo };
  const ruta =
    embed.forma === "wiki"
      ? resolverEmbedImagen(embed.ref, indiceActual())
      : resolverRutaImagen(embed.ref, carpetaNota, indiceActual());
  if (ruta === null) return falta;
  // El vault abierto, del contexto mínimo de la capa de datos y no del store
  // de sesión: este módulo lo importa la vista en vivo, y el store arrastra
  // medio árbol de módulos (y un ciclo) detrás.
  let vault: string;
  try {
    vault = getVaultActual();
  } catch {
    return falta;
  }
  return { src: urlDeArchivo(vault, ruta) };
}

/**
 * Pinta la imagen (o el aviso) dentro de `caja`. Idempotente: si ya muestra esa
 * misma URL no la vuelve a pedir, así que repetirlo tras cada cambio del vault
 * no hace parpadear nada.
 */
export function dibujarImagenEn(caja: HTMLElement, embed: EmbedImagen, resuelta: ImagenResuelta) {
  caja.classList.add("mic-img");
  caja.classList.remove("mic-img-pendiente");
  if ("falta" in resuelta) {
    mostrarAviso(caja, resuelta.falta);
    return;
  }
  const previa = caja.querySelector("img");
  if (previa && previa.getAttribute("src") === resuelta.src) return;

  const img = document.createElement("img");
  img.alt = embed.alt || embed.ref;
  // Sin `loading="lazy"`: la exportación a PDF imprime desde un iframe de 0×0,
  // donde una imagen perezosa no se pediría nunca.
  img.decoding = "async";
  if (embed.tamano) {
    // En estilo y no en atributos: el CSS de `.mic-img img` pone `height: auto`
    // (para que el `max-width` no la deforme) y le ganaría a un atributo.
    img.style.width = `${embed.tamano.ancho}px`;
    if (embed.tamano.alto) {
      img.style.height = `${embed.tamano.alto}px`;
      img.style.objectFit = "contain";
    }
  }
  // Un archivo que está en la lista pero no se puede leer (borrado recién,
  // fuera del ámbito del protocolo) muestra el aviso, no el ícono roto.
  img.addEventListener("error", () => mostrarAviso(caja, `No se pudo cargar la imagen «${embed.ref}».`), {
    once: true,
  });
  img.src = resuelta.src;
  caja.classList.remove("mic-img-falta");
  caja.replaceChildren(img);
}

function mostrarAviso(caja: HTMLElement, texto: string) {
  caja.classList.add("mic-img-falta");
  caja.textContent = texto;
}

/**
 * Rellena los huecos de imagen que dejó `renderNota` en `contenedor`.
 * `carpetaNota` es la carpeta de la nota mostrada (`carpetaDeNota`).
 */
export function rellenarImagenesEn(contenedor: HTMLElement, carpetaNota: string | null) {
  for (const caja of Array.from(contenedor.querySelectorAll<HTMLElement>("span[data-mic-img]"))) {
    const ancho = Number(caja.dataset.ancho ?? "");
    const alto = Number(caja.dataset.alto ?? "");
    const embed: EmbedImagen = {
      forma: caja.dataset.forma === "wiki" ? "wiki" : "md",
      ref: caja.dataset.micImg ?? "",
      alt: caja.dataset.alt ?? "",
      tamano: ancho > 0 ? (alto > 0 ? { ancho, alto } : { ancho }) : null,
    };
    dibujarImagenEn(caja, embed, resolverImagen(embed, carpetaNota));
  }
}

/**
 * Espera a que terminen de cargar (o de fallar) las imágenes de un documento,
 * con un tope: el PDF se imprime con lo que haya, nunca se queda colgado.
 */
export async function esperarImagenes(raiz: ParentNode, topeMs = 4000): Promise<void> {
  const pendientes = Array.from(raiz.querySelectorAll("img")).filter((img) => !img.complete);
  if (pendientes.length === 0) return;
  const todas = Promise.all(
    pendientes.map(
      (img) =>
        new Promise<void>((listo) => {
          img.addEventListener("load", () => listo(), { once: true });
          img.addEventListener("error", () => listo(), { once: true });
        }),
    ),
  );
  await Promise.race([todas, new Promise((listo) => setTimeout(listo, topeMs))]);
}
