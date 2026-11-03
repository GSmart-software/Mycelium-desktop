/**
 * La salud del vault sobre el índice de esta ventana (`FUN-L-30`): lee las
 * notas, las carpetas y las filas de `enlaces` (`lib/db/indiceIa.ts`), arma el
 * informe con la lógica pura de `lib/salud.ts` y le pone las líneas leyendo
 * **solo** el contenido de las notas que tienen problemas. Lo usan el panel de
 * salud y las herramientas `mycelium_salud` / `mycelium_validar_nota`, para que
 * los dos vean exactamente lo mismo. Solo desktop.
 *
 * Costo: tres consultas sin contenido (notas, carpetas, enlaces) y una de
 * contenido acotada a las notas con problemas. No relee archivos.
 *
 * Las propiedades (`FUN-M-46`): sin `esquemas.yml` solo se leen las notas cuyo
 * índice tiene un valor que empieza con `#` (candidatas al aviso del `#`); con
 * esquemas, el contenido de las notas markdown del alcance, en una consulta.
 */
import {
  carpetasDelIndice,
  contenidosDe,
  filasDelIndice,
  notasConValorAlmohadilla,
  notasDelIndice,
  type CarpetaIndice,
  type FilaIndice,
  type NotaIndice,
} from "@/lib/db/indiceIa";
import { notasQueNoCumplen } from "@/lib/esquemas";
import { asegurarEsquemas } from "@/lib/esquemasVault";
import { carpetaEsporas } from "@/lib/esporasVault";
import {
  calcularSalud,
  enAlcance,
  excluida,
  notasConProblemas,
  ponerLineas,
  type Alcance,
  type InformeSalud,
} from "@/lib/salud";
import { useVaultStore } from "@/stores/vaultStore";

/** Lo que el informe lee del índice: notas, carpetas y filas de `enlaces`. */
export type DatosDelIndice = { notas: NotaIndice[]; carpetas: CarpetaIndice[]; filas: FilaIndice[] };

/** Las tres lecturas sin contenido del informe (las reusa la revisión de `FUN-L-32`). */
export async function datosDelIndice(): Promise<DatosDelIndice> {
  const [notas, carpetas, filas] = await Promise.all([notasDelIndice(), carpetasDelIndice(), filasDelIndice()]);
  return { notas, carpetas, filas };
}

export async function informeDeSalud(alcance: Alcance = { tipo: "vault" }): Promise<InformeSalud> {
  return informeConDatos(await datosDelIndice(), alcance);
}

/**
 * El informe sobre datos ya leídos. La revisión del dashboard
 * (`lib/estadisticasVault.ts`) lee una vez y arma con lo mismo el informe y las
 * estadísticas: por eso sus huérfanas y rotos son los de `mycelium_salud`.
 */
export async function informeConDatos(
  { notas, carpetas, filas }: DatosDelIndice,
  alcance: Alcance = { tipo: "vault" },
): Promise<InformeSalud> {
  const informe = calcularSalud({
    notas,
    carpetas,
    filas,
    otros: useVaultStore.getState().otros.map((o) => o.ruta),
    carpetaEsporas: carpetaEsporas(),
    alcance,
  });
  const ids = notasConProblemas(informe);
  if (ids.length > 0) {
    const contenidos = await contenidosDe(ids);
    ponerLineas(informe, contenidos, new Map(notas.map((n) => [n.id, n.tipo])));
  }

  // Propiedades (`FUN-M-46`).
  const { esquemas, avisos } = await asegurarEsquemas();
  informe.avisosEsquemas = avisos;
  const esporas = carpetaEsporas();
  const candidatas = notas
    .filter((n) => n.tipo === "markdown" && enAlcance(n.id, alcance))
    .map((n) => ({ ...n, excluida: excluida(n, esporas) }));
  const enJuego = new Set(candidatas.map((n) => n.id));
  const aLeer = esquemas.length > 0 ? [...enJuego] : (await notasConValorAlmohadilla()).filter((id) => enJuego.has(id));
  if (aLeer.length > 0) {
    const contenidos = await contenidosDe(aLeer);
    informe.propiedades = notasQueNoCumplen(candidatas, contenidos, esquemas);
  }
  return informe;
}
