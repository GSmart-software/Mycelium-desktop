/**
 * Lo que se puede hacer con un archivo que Mycelium lista pero no indexa
 * (`FUN-S-27`): una imagen, un PDF, código, cualquier extensión. Son las
 * acciones del clic derecho de su fila en el explorador.
 *
 * No pasan por el índice —estos archivos no tienen fila en `notas`— sino directo
 * por los comandos de disco del vault (`vault_fs.rs`). El árbol se entera solo:
 * el watcher manda el cambio y `vaultStore.aplicarCambios` lo dibuja al instante
 * (`FUN-M-42`). Lo único que hay que acompañar a mano son las pestañas abiertas
 * del archivo, que se identifican por su ruta (`tabIdDeArchivo`).
 */
import {
  borrarAPapelera,
  borrarDefinitivo,
  copiarArchivo,
  moverRuta,
  sanearNombre,
  unir,
} from "@/lib/db/vaultFs";
import { downloadBlob } from "@/lib/export";
import { tabIdDeArchivo, urlDeArchivo, type OtroArchivo } from "@/lib/otrosArchivos";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Nombre sin la extensión (`captura.png` → `captura`; sin punto, entero). */
export function nombreSinExtension(otro: Pick<OtroArchivo, "nombre" | "extension">): string {
  return otro.extension ? otro.nombre.slice(0, -(otro.extension.length + 1)) : otro.nombre;
}

/** `.png`, o vacío si el archivo no tiene extensión. */
function sufijo(otro: Pick<OtroArchivo, "extension" | "nombre">): string {
  return otro.extension ? otro.nombre.slice(otro.nombre.length - otro.extension.length - 1) : "";
}

/** ¿Hay ya un archivo (nota u otro) con esa ruta, sin distinguir mayúsculas? */
function ocupada(ruta: string): boolean {
  const r = ruta.toLowerCase();
  const { otros, notas } = useVaultStore.getState();
  return otros.some((o) => o.ruta.toLowerCase() === r) || notas.some((n) => n.id.toLowerCase() === r);
}

/**
 * Renombra el archivo **conservando su extensión**: el campo edita solo el
 * nombre, como en Obsidian, así cambiar `captura` por `portada` no puede
 * convertir un PNG en un archivo sin tipo. Devuelve la ruta nueva, o `null` si
 * no hubo cambio.
 */
export async function renombrarOtro(vault: string, otro: OtroArchivo, nombreNuevo: string): Promise<string | null> {
  const limpio = sanearNombre(nombreNuevo, nombreSinExtension(otro));
  const destino = unir(otro.carpetaId, `${limpio}${sufijo(otro)}`);
  if (destino === otro.ruta) return null;
  // En Windows `Foto.png` y `foto.png` son el mismo archivo: cambiar solo las
  // mayúsculas se permite; chocar con OTRO archivo, no.
  if (destino.toLowerCase() !== otro.ruta.toLowerCase() && ocupada(destino)) {
    throw new Error(`Ya existe «${limpio}${sufijo(otro)}» en esa carpeta.`);
  }
  await moverRuta(vault, otro.ruta, destino);
  useTabsStore.getState().remapNota(tabIdDeArchivo(otro.ruta), tabIdDeArchivo(destino));
  return destino;
}

/** Duplica el archivo junto al original: `foto 1.png`, `foto 2.png`… */
export async function duplicarOtro(vault: string, otro: OtroArchivo): Promise<string> {
  const base = nombreSinExtension(otro);
  let n = 1;
  let destino = unir(otro.carpetaId, `${base} ${n}${sufijo(otro)}`);
  while (ocupada(destino)) {
    n += 1;
    destino = unir(otro.carpetaId, `${base} ${n}${sufijo(otro)}`);
  }
  await copiarArchivo(vault, otro.ruta, destino);
  return destino;
}

/**
 * «Guardar una copia…»: el exportar de un archivo que no es nota. Se descarga
 * tal cual —los bytes, sin conversión— por el mismo camino que «Exportar como
 * .md» (el diálogo de descarga del webview). Se leen por el protocolo de
 * archivos del vault, el mismo con el que el visor los muestra.
 */
export async function guardarCopiaOtro(vault: string, otro: OtroArchivo): Promise<void> {
  const respuesta = await fetch(urlDeArchivo(vault, otro.ruta));
  if (!respuesta.ok) throw new Error(`No se pudo leer «${otro.nombre}» (${respuesta.status}).`);
  downloadBlob(await respuesta.blob(), otro.nombre);
}

/**
 * Elimina el archivo mandándolo a la **papelera del sistema** (la de Windows),
 * de donde se recupera. No va a la papelera de Mycelium: esa lista notas del
 * índice, y un archivo que no es nota quedaría escondido en `.mycelium/.trash`
 * sin forma de verlo ni de traerlo de vuelta desde la app. Se pasa por la
 * papelera de Mycelium solo como escala, porque `borrar_definitivo` es el comando
 * que ya sabe entregar al sistema (y caer en un borrado definitivo si el sistema
 * no tiene papelera, `DEF-046`).
 */
export async function eliminarOtro(vault: string, otro: OtroArchivo): Promise<void> {
  const enPapelera = await borrarAPapelera(vault, otro.ruta);
  await borrarDefinitivo(vault, enPapelera);
  useTabsStore.getState().closeNotaEverywhere(tabIdDeArchivo(otro.ruta));
}
