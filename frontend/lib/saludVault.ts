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
 */
import { carpetasDelIndice, contenidosDe, filasDelIndice, notasDelIndice } from "@/lib/db/indiceIa";
import { carpetaEsporas } from "@/lib/esporasVault";
import { calcularSalud, notasConProblemas, ponerLineas, type Alcance, type InformeSalud } from "@/lib/salud";
import { useVaultStore } from "@/stores/vaultStore";

export async function informeDeSalud(alcance: Alcance = { tipo: "vault" }): Promise<InformeSalud> {
  const [notas, carpetas, filas] = await Promise.all([notasDelIndice(), carpetasDelIndice(), filasDelIndice()]);
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
  return informe;
}
