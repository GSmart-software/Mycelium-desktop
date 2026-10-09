/**
 * Temas de color (HU-12): la lógica pura, sin React ni el DOM, para que la
 * prueben `scripts/test-temas.mjs` y `scripts/test-capa-datos.mjs`.
 *
 * Un tema decide QUÉ colores (los `--mic-raw-*` de `styles/tokens.css`); el
 * modo, claro u oscuro; y la atmósfera (lib/atmosferas.ts), cómo se reparten.
 *
 * Los **temas de marca** —`arrecife` (`FUN-M-51`) y `gsmart` (`FUN-M-52`)— son
 * distintos de los dos de Mycelium en dos cosas, y las dos viven acá para que no
 * haya que adivinarlas en los componentes:
 *  - **Solo se ofrecen con el modo desarrollador** (`soloDev`). Apagar el modo no
 *    los saca: un vault que tiene uno se sigue pintando así. Ver
 *    `docs/features/tema-arrecife.md` y `docs/features/tema-gsmart.md`.
 *  - **No admiten atmósferas** (`TEMAS_DE_MARCA`): traen sus propios fondos,
 *    marco y forma (`styles/arrecife.css`, `styles/gsmart.css`), y una atmósfera
 *    los pisaría.
 *
 * De dónde sale cada marca: Arrecife es la de otro proyecto del usuario y
 * GSmart, su marca personal. «De marca» acá quiere decir «trae su propia
 * forma», no «es de otro».
 *
 * Un tema guardado que ya no existe cae al de defecto (`temaValido`). Es lo que
 * le pasa a un vault que tenía el tema experimental retirado el 2026-10-09
 * (`FUN-M-53`).
 */
import { atmosferaValida, ATMOSFERA_CLARO_DEFECTO, ATMOSFERA_OSCURO_DEFECTO, type Atmosfera } from "./atmosferas";
import { comandosDisponibles } from "./modoDev";

export type Tema = "bioluminiscencia" | "cantarela" | "arrecife" | "gsmart";

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
  // GSmart (`FUN-M-52`), la marca personal del usuario: los colores del
  // símbolo —el aguamarina de las líneas de la G y el cian del degradado— sobre
  // el carbón. El azul profundo, la otra punta, casi no se ve sobre ese fondo.
  { id: "gsmart", nombre: "GSmart", canvas: "#1E2023", mist: "#25282B", glow: "#A3ECE2", accent: "#12A8E8", soloDev: true },
];

/**
 * Los temas de marca: traen sus propios fondos, marco y forma, y por eso no
 * admiten atmósferas. Un tema de marca nuevo se suma acá (y a `TEMAS`, con
 * `soloDev` si va detrás del modo).
 */
export const TEMAS_DE_MARCA: readonly Tema[] = ["arrecife", "gsmart"];

/**
 * El tema guardado, si es uno que existe; si no, el de defecto. El archivo de
 * preferencias vive en la carpeta del usuario y se puede editar a mano.
 *
 * Los temas `soloDev` (`arrecife`, `gsmart`) son válidos **siempre**, esté o no
 * el modo dev: el modo decide si se puede ELEGIR, no si un vault que ya lo tiene
 * se puede abrir así.
 */
export function temaValido(v: unknown, defecto: Tema = TEMA_DEFECTO): Tema {
  return TEMAS.some((t) => t.id === v) ? (v as Tema) : defecto;
}

/** Las muestras que se ofrecen en Apariencia: sin el modo dev, sin las `soloDev`. */
export function temasVisibles(dev: boolean): InfoTema[] {
  return comandosDisponibles(TEMAS, dev);
}

/** ¿Las atmósferas se aplican a este tema? Con los de marca, no. */
export function admiteAtmosfera(tema: Tema): boolean {
  return !TEMAS_DE_MARCA.includes(tema);
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
