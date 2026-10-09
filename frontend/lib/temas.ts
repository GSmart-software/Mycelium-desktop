/**
 * Temas de color (HU-12): la lógica pura, sin React ni el DOM, para que la
 * prueben `scripts/test-temas.mjs` y `scripts/test-capa-datos.mjs`.
 *
 * Un tema decide QUÉ colores (los `--mic-raw-*` de `styles/tokens.css`); el
 * modo, claro u oscuro; y la atmósfera (lib/atmosferas.ts), cómo se reparten.
 *
 * El tercero, `arrecife` (`FUN-M-51`), es distinto de los otros dos en tres
 * cosas, y las tres viven acá para que no haya que adivinarlas en los
 * componentes:
 *  - **Solo se ofrece con el modo desarrollador** (`soloDev`). Apagar el modo no
 *    lo saca: un vault que lo tiene se sigue pintando así. Ver
 *    `docs/features/tema-arrecife.md`.
 *  - **No admite atmósferas**: trae sus propios fondos, marco y forma
 *    (`styles/arrecife.css`), y una atmósfera los pisaría.
 *  - Es la marca de otro proyecto del usuario, no de Mycelium.
 */
import { atmosferaValida, ATMOSFERA_CLARO_DEFECTO, ATMOSFERA_OSCURO_DEFECTO, type Atmosfera } from "./atmosferas";
import { comandosDisponibles } from "./modoDev";

export type Tema = "bioluminiscencia" | "cantarela" | "arrecife";

export const TEMA_DEFECTO: Tema = "bioluminiscencia";

/** Una muestra de Configuración → Apariencia, con la paleta oscura del tema. */
export type InfoTema = {
  id: Tema;
  nombre: string;
  canvas: string;
  mist: string;
  glow: string;
  accent: string;
  /** Solo existe con el modo desarrollador (`FUN-S-36`). */
  soloDev?: boolean;
};

export const TEMAS: readonly InfoTema[] = [
  { id: "bioluminiscencia", nombre: "Bioluminiscencia", canvas: "#071219", mist: "#0a1a24", glow: "#3DFFC4", accent: "#19E6FF" },
  { id: "cantarela", nombre: "Cantarela", canvas: "#1b1305", mist: "#241a08", glow: "#FFC247", accent: "#C77F2E" },
  // Los acentos de la marca tal cual (cian y violeta), no los derivados que usa
  // la interfaz para leerse: la muestra es la identidad, no un texto.
  { id: "arrecife", nombre: "Arrecife", canvas: "#14171E", mist: "#1D222C", glow: "#7444E4", accent: "#3AB8D8", soloDev: true },
];

/**
 * El tema guardado, si es uno que existe; si no, el de defecto. El archivo de
 * preferencias vive en la carpeta del usuario y se puede editar a mano.
 *
 * `arrecife` es válido **siempre**, esté o no el modo dev: el modo decide si se
 * puede ELEGIR, no si un vault que ya lo tiene se puede abrir así.
 */
export function temaValido(v: unknown, defecto: Tema = TEMA_DEFECTO): Tema {
  return TEMAS.some((t) => t.id === v) ? (v as Tema) : defecto;
}

/** Las muestras que se ofrecen en Apariencia: sin el modo dev, sin las `soloDev`. */
export function temasVisibles(dev: boolean): InfoTema[] {
  return comandosDisponibles(TEMAS, dev);
}

/** ¿Las atmósferas se aplican a este tema? Con Arrecife, no. */
export function admiteAtmosfera(tema: Tema): boolean {
  return tema !== "arrecife";
}

/**
 * La atmósfera que se pinta (el `data-atmosfera` de `<html>`), o `null` si el
 * tema no admite ninguna. La guardada no se toca: vuelve sola al cambiar a un
 * tema que sí la admite.
 */
export function atmosferaEnUso(
  tema: Tema,
  modoOscuro: boolean,
  prefs: { atmosferaOscuro: unknown; atmosferaClaro: unknown },
): Atmosfera | null {
  if (!admiteAtmosfera(tema)) return null;
  return modoOscuro
    ? atmosferaValida(prefs.atmosferaOscuro, ATMOSFERA_OSCURO_DEFECTO)
    : atmosferaValida(prefs.atmosferaClaro, ATMOSFERA_CLARO_DEFECTO);
}
