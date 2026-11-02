/**
 * El informe de salud como nota del vault (`FUN-L-32`, parte E): revisa (o
 * reusa una revisión ya hecha), arma el Markdown con `lib/informeSalud.ts`, lo
 * guarda en `<carpeta de informes>/Salud del vault AAAA-MM-DD.md`, lo abre y
 * avisa dónde quedó. Lo llaman la paleta de comandos, la pestaña y el panel.
 *
 * Crea la carpeta y la nota con las MISMAS funciones del store que usan el
 * explorador y las Esporas (`createCarpeta`, `createNota`), que indexan,
 * actualizan el árbol y cuidan los `[[enlaces]]` de las homónimas; el
 * contenido se escribe después con la API de contenido, como hace
 * `crearNotaDesdeEspora`.
 */
import { api } from "@/lib/api";
import { normalizarCarpetaEsporas } from "@/lib/esporas";
import { asegurarCarpeta } from "@/lib/esporasVault";
import { refreshAllLiveViews } from "@/lib/editor/refrescoVivo";
import { revisarVault, type RevisionVault } from "@/lib/estadisticasVault";
import { CARPETA_INFORMES_DEFECTO, markdownInformeSalud, tituloInforme } from "@/lib/informeSalud";
import { avisar, avisarFallo } from "@/stores/avisosStore";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Ruta (normalizada) de la carpeta de informes configurada. */
export function carpetaInformes(): string {
  const bruta = usePreferencesStore.getState().prefs.carpetaInformes;
  return normalizarCarpetaEsporas(bruta ?? "") ?? CARPETA_INFORMES_DEFECTO;
}

export type OpcionesGenerarInforme = {
  /**
   * Una revisión ya hecha (la que muestra el panel o la pestaña), para no
   * recorrer el vault otra vez. Sin ella, se revisa ahora.
   */
  revision?: RevisionVault;
  /**
   * Cómo pone la vista la URL en la nota abierta (`router.replace`). La URL es
   * la fuente de navegación de la app: sin ella la pestaña se abre igual, pero
   * una recarga volvería a la anterior. La paleta la pasa; el panel y la
   * pestaña, si tienen el router a mano, también.
   */
  navegar?: (notaId: string) => void;
};

/**
 * El título libre para el informe de esa fecha: el del día, o con la hora si
 * ya hay una nota que se llame así en cualquier carpeta (así el nuevo no nace
 * homónimo y los `[[Salud del vault …]]` no quedan ambiguos).
 */
function tituloLibre(fecha: Date): string {
  const ocupados = new Set(useVaultStore.getState().notas.map((n) => n.titulo.toLowerCase()));
  const delDia = tituloInforme(fecha);
  return ocupados.has(delDia.toLowerCase()) ? tituloInforme(fecha, true) : delDia;
}

/**
 * Genera el informe como nota y la abre. Devuelve la ruta (el id) de la nota.
 * Si algo falla, avisa y vuelve a lanzar el error para que el botón que lo
 * llamó deje de esperar.
 */
export async function generarInformeSalud(opciones: OpcionesGenerarInforme = {}): Promise<string> {
  try {
    const revision = opciones.revision ?? (await revisarVault());
    const rutaVault = useVaultSessionStore.getState().rutaActual;
    const vault = rutaVault ? rutaVault.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : undefined;
    const contenido = markdownInformeSalud(revision, { vault });

    const carpeta = await asegurarCarpeta(carpetaInformes());
    const titulo = tituloLibre(new Date(revision.revisadoEn));
    const id = await useVaultStore.getState().createNota(carpeta, "markdown", titulo);
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido },
    });
    // El informe trae `[[enlaces]]` y una etiqueta: el grafo queda desactualizado.
    useGraphStore.getState().markStale();
    refreshAllLiveViews();

    useTabsStore.getState().openNote(id);
    opciones.navegar?.(id);
    avisar(`Informe de salud guardado en «${id}».`);
    return id;
  } catch (e) {
    avisarFallo("generar el informe de salud")(e);
    throw e;
  }
}
