/**
 * Abrir la pestaña «Salud del vault» (`FUN-L-32`). Al abrirla se cierra el
 * panel lateral de salud, si es el que está a la vista, para dejarle lugar
 * (spec, «2. Pestaña propia»). La llaman el botón del panel, la paleta de
 * comandos y quien necesite mostrar el tablero.
 */
import { SALUD_TAB_ID } from "@/lib/pestanas";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useTabsStore } from "@/stores/tabsStore";

/**
 * Abre (o enfoca) la pestaña de salud y cierra el panel de salud del rail.
 * `navegar` pone la URL en la pestaña (`router.replace`), como en el resto de
 * la app; sin él la pestaña se abre igual.
 */
export function abrirPestanaSalud(navegar?: (id: string) => void): void {
  useTabsStore.getState().openNote(SALUD_TAB_ID);
  navegar?.(SALUD_TAB_ID);
  const panel = usePanelLayoutStore.getState();
  if (panel.activeSection === "salud") usePanelLayoutStore.setState({ activeSection: null });
}
