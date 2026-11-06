/**
 * Abrir la Bandeja personal como nota completa (`FUN-L-33`, Parte B): en su
 * pestaña de id reservado (`BANDEJA_PERSONAL_ID`), que usa el editor de notas.
 * Lo usan la fila del explorador y el comando `bandeja.abrir-personal`.
 *
 * Aparte de `lib/bandejaPersonal.ts` porque toca el store de pestañas, y aquel
 * lo importa el dispatcher local (`lib/api.ts`).
 */
import { leerBandejaPersonal } from "@/lib/bandejaPersonal";
import { BANDEJA_PERSONAL_ID } from "@/lib/pestanas";
import { useTabsStore } from "@/stores/tabsStore";

/**
 * Abre la Bandeja personal en el panel activo (o en uno nuevo a la derecha,
 * `al-lado`). Si el archivo falta —nunca se anotó, o se borró por fuera—, se
 * crea vacío antes. Devuelve el id de la pestaña, para la URL.
 */
export async function abrirBandejaPersonal(como: "aqui" | "al-lado" = "aqui"): Promise<string> {
  await leerBandejaPersonal(true);
  const tabs = useTabsStore.getState();
  if (como === "al-lado") tabs.splitPaneWithNota(BANDEJA_PERSONAL_ID, tabs.activePaneId, "right");
  else tabs.openNote(BANDEJA_PERSONAL_ID);
  return BANDEJA_PERSONAL_ID;
}
