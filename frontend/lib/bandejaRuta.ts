/**
 * Dónde está la Bandeja del vault (`FUN-L-33`) y si un archivo o carpeta es
 * ella o la contiene.
 *
 * Módulo aparte y liviano (solo lee la preferencia) porque lo importa
 * `stores/vaultStore.ts`, que es **el lugar común** de la protección: renombrar,
 * mover y mandar a la papelera pasan por él desde el explorador, el título de
 * la nota, el arrastre y el MCP. `lib/bandejaVault.ts`, que escribe en el
 * vault, importa a su vez el store: tenerlo todo junto sería un ciclo.
 */
import {
  MOTIVO_NO_ELIMINA,
  MOTIVO_NO_MUEVE,
  MOTIVO_NO_RENOMBRA,
  RUTA_BANDEJA_DEFECTO,
  carpetaContieneRuta,
  esRutaBandeja,
  normalizarRutaBandeja,
} from "@/lib/bandeja";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** La ruta (normalizada) de la Bandeja del vault abierto. */
export function rutaBandeja(): string {
  const bruta = usePreferencesStore.getState().prefs.rutaBandeja;
  return normalizarRutaBandeja(bruta ?? "") ?? RUTA_BANDEJA_DEFECTO;
}

/** ¿La nota `id` es la Bandeja del vault? */
export function esBandeja(id: string): boolean {
  return esRutaBandeja(id, rutaBandeja());
}

/** ¿La carpeta `id` contiene la Bandeja del vault? */
export function carpetaConBandeja(id: string): boolean {
  return carpetaContieneRuta(id, rutaBandeja());
}

/** El error que lanza la protección. Con nombre, para reconocerlo si hace falta. */
export class BandejaProtegida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "BandejaProtegida";
  }
}

/** Lanza si `id` es la Bandeja: no se renombra, no se mueve, no se elimina. */
export function protegerBandeja(id: string, accion: "renombrar" | "mover" | "eliminar"): void {
  if (!esBandeja(id)) return;
  throw new BandejaProtegida(
    accion === "renombrar"
      ? `${MOTIVO_NO_RENOMBRA}.`
      : accion === "mover"
        ? `${MOTIVO_NO_MUEVE}.`
        : `${MOTIVO_NO_ELIMINA}.`,
  );
}

/**
 * Lanza si la carpeta `id` contiene la Bandeja y se la quiere eliminar: se
 * llevaría la Bandeja a la papelera. Renombrarla o moverla sí se puede: la
 * preferencia sigue a la carpeta (`seguirCarpeta`).
 */
export function protegerCarpetaConBandeja(id: string): void {
  if (!carpetaConBandeja(id)) return;
  throw new BandejaProtegida(
    `«${id}» contiene la Bandeja del vault (${rutaBandeja()}), que no se elimina. ` +
      "Cambia su ubicación en Configuración → Vault antes de eliminar la carpeta.",
  );
}
