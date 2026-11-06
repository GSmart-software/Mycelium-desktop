/**
 * Crear documentos del vault (`FUN-XL-04`, Parte 4): la misma lógica para los
 * botones y menús del explorador, el menú «Nuevo…» (Ctrl+Shift+N) y los
 * comandos `crear.*` de la paleta. Antes vivía como closures dentro de
 * `ExplorerPanel`, y desde el teclado no había forma de llegar a ella.
 *
 * Lee los stores en el momento de ejecutarse: no depende de ningún componente.
 * Abrir lo creado es cosa de quien llama (el explorador con su router, los
 * comandos con `abrirCreado`).
 */
import { api } from "@/lib/api";
import { baseInicial } from "@/lib/bases";
import { canvasInicial } from "@/lib/canvas";
import { diagramaInicial } from "@/lib/drawio";
import { crearNotaDesdeEspora, type Espora } from "@/lib/esporasVault";
import { abrirNota, urlDeNota } from "@/lib/comandos/navegar";
import type { TipoNuevo } from "@/lib/comandos/nuevo";
import { enfocarDocumentoActivo } from "@/lib/teclado/focoDom";
import { useAuthStore } from "@/stores/authStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore, type NotaTipo } from "@/stores/vaultStore";

/** Los tipos que son un archivo (todos menos la carpeta). */
export type TipoDocumento = Exclude<TipoNuevo, "carpeta">;

/** El tipo de archivo del vault de cada uno. */
const TIPO_DE_NOTA: Record<TipoDocumento, NotaTipo> = {
  nota: "markdown",
  lienzo: "canvas",
  tabla: "base",
  dibujo: "excalidraw",
  diagrama: "drawio",
};

/**
 * Lo que se escribe al crear, para que el archivo abra sin caso especial:
 * - una base con una vista mínima: vacía no mostraría nada y parecería rota;
 *   así se abre mostrando el vault entero, de donde se parte para filtrar;
 * - un lienzo vacío pero válido;
 * - un diagrama con una página vacía (`FUN-L-20`): uno de cero bytes el editor
 *   lo trataría como corrupto.
 */
const CONTENIDO_INICIAL: Partial<Record<TipoDocumento, () => string>> = {
  tabla: baseInicial,
  lienzo: canvasInicial,
  diagrama: diagramaInicial,
};

/** La carpeta donde se crea lo nuevo: la seleccionada en el explorador, o la raíz. */
export const carpetaDestino = () => useVaultStore.getState().activeFolderId;

/** Crea un documento en `carpetaId` (`null` = la raíz) y devuelve su id. No lo abre. */
export async function crearDocumento(tipo: TipoDocumento, carpetaId: string | null): Promise<string> {
  const id = await useVaultStore.getState().createNota(carpetaId, TIPO_DE_NOTA[tipo]);
  const inicial = CONTENIDO_INICIAL[tipo];
  if (inicial) {
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: inicial() },
    });
  }
  return id;
}

/**
 * Pide el nombre y crea una carpeta en `padreId`. `false` si se canceló. El
 * cuadro del sistema se opera con el teclado (Enter, Esc).
 */
export async function pedirYCrearCarpeta(padreId: string | null): Promise<boolean> {
  const nombre = window.prompt("Nombre de la carpeta:", "Nueva carpeta");
  if (!nombre) return false;
  await useVaultStore.getState().createCarpeta(nombre, padreId);
  return true;
}

/**
 * Abre lo recién creado y deja el foco donde sirve: en una nota, el título en
 * edición —lo que se escriba enseguida la nombra (`DEF-135`)—; en cualquier
 * otro documento, el documento seleccionado (Enter entra a editarlo).
 */
export function abrirCreado(navegar: (url: string) => void, id: string, tipo: TipoDocumento) {
  if (tipo === "nota") {
    abrirNota(navegar, id, { editarTitulo: true });
    return;
  }
  useTabsStore.getState().openNote(id);
  navegar(urlDeNota(id));
  enfocarDocumentoActivo(false);
}

/** Crea un documento en la carpeta seleccionada y lo abre. */
export async function crearYAbrir(navegar: (url: string) => void, tipo: TipoDocumento) {
  abrirCreado(navegar, await crearDocumento(tipo, carpetaDestino()), tipo);
}

/** Crea una nota desde una Espora en la carpeta seleccionada y la abre con el título en edición. */
export async function crearDesdeEsporaYAbrir(navegar: (url: string) => void, espora: Espora) {
  abrirCreado(navegar, await crearNotaDesdeEspora(espora, carpetaDestino()), "nota");
}
