import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { EVENTO_ALIAS, avisarRecarga } from "@/lib/eventos";
import {
  SIN_REPARACION,
  alternarAliasDeNota,
  carpetaDeRuta,
  cambioRenombrar,
  extensionDeRuta,
  leerPrevia,
  movidosPorCarpeta,
  repararTrasOperacion,
  tituloDeRuta,
  type Movido,
  type Previa,
  type Reparacion,
} from "@/lib/repararEnlaces";
import { coincidencias, textoAviso, trasTraslados, type NotaRuta } from "@/lib/homonimos";
import { avisoCaracteresReemplazados, sanearNombre } from "@/lib/db/nombres";
import { avisar } from "@/stores/avisosStore";
import type { OtroArchivo } from "@/lib/otrosArchivos";
import {
  aplicarCambios as aplicarAlArbol,
  conservarIdentidad,
  mismaCarpeta,
  mismaNota,
  mismoOtro,
  pendientesActuales,
  vaciarPendientes,
  type CambioVault,
} from "@/lib/arbolVivo";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useTabsStore } from "@/stores/tabsStore";
import { refreshAllLiveViews } from "@/lib/editor/refrescoVivo";
import { TITULO_POR_DEFECTO } from "@/lib/extensionesDeTipo";
import { rutaTrasMoverCarpeta } from "@/lib/bandeja";
import { protegerBandeja, protegerCarpetaConBandeja, rutaBandeja } from "@/lib/bandejaRuta";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { seguirCarpeta, seguirRenombre } from "@/lib/lienzoBloqueo";

/**
 * Marca el grafo como desactualizado y redispara el live preview tras un cambio
 * que altera nodos/enlaces (también afecta el feedback de wikilinks rotos).
 */
const markGraphStale = () => {
  useGraphStore.getState().markStale();
  refreshAllLiveViews();
};

export type TreeCarpeta = { id: string; padreId: string | null; nombre: string };
export type NotaTipo = "markdown" | "excalidraw" | "base" | "canvas" | "drawio";
export type TreeNota = {
  id: string;
  carpetaId: string | null;
  titulo: string;
  tipo: NotaTipo;
  /**
   * Informativo: la fecha que tenía en el índice al cargarse. NO se mantiene al
   * día con los cambios de contenido —ni los guardados de la app ni, desde
   * `FUN-M-58`, los de afuera— y ningún componente lo lee de acá: quien necesite
   * la fecha la pide a `/notas/{id}` (el panel de la nota, la barra de estado).
   */
  actualizadoEn: string;
  /**
   * Los otros nombres de la nota: su propiedad `aliases` (`FUN-M-15`). Un
   * `[[alias]]` resuelve a ella si ningún título se llama así. Ausente si no
   * declara ninguno. Lo carga el árbol y lo mantiene al día `EVENTO_ALIAS`.
   */
  aliases?: string[];
};
export type PapeleraItem = {
  notaId: string;
  titulo: string;
  rutaOriginal: string;
  eliminadoEn: string;
};

type RawCarpeta = { id: string; padre_id: string | null; nombre: string };
type RawNota = {
  id: string;
  carpeta_id: string | null;
  titulo: string;
  tipo?: string;
  actualizado_en: string;
  aliases?: string[];
};
type RawPapeleraItem = {
  nota_id: string;
  titulo: string;
  ruta_original: string;
  eliminado_en: string;
};

type LastMove =
  | { type: "nota"; id: string; prevParentId: string | null }
  | { type: "carpeta"; id: string; prevParentId: string | null };

/** Lo que devuelve renombrar: el id (ruta) nuevo y qué pasó con los enlaces entrantes. */
export type ResultadoRenombrar = Reparacion & { id: string };

/** Opciones de renombrar una nota (`FUN-M-47`). */
export type OpcionesRenombrar = {
  /**
   * Agregar el título anterior a la propiedad `aliases` de la nota, para que
   * los `[[enlaces]]` que no se reescriben —texto citado, otros vaults, los que
   * se escriban después— sigan llegando. Los entrantes se reparan igual.
   */
  conservarAlias?: boolean;
};

/**
 * Lo que devuelve renombrar una nota: el título que obtuvo y, si se pidió
 * conservar el anterior como alias, si quedó (`false`: no es una nota `.md`, o
 * su frontmatter no se puede editar; `undefined`: no se pidió o no cambió).
 */
export type ResultadoRenombrarNota = ResultadoRenombrar & { titulo: string; aliasConservado?: boolean };

/**
 * Lo que devuelve mover. No lanza —el explorador lo llama sin esperar, al
 * soltar— pero dice si falló y por qué, para quien sí espera (el MCP).
 */
export type ResultadoMover = (Reparacion & { ok: true; id: string }) | { ok: false; error: string };

type VaultState = {
  vaultId: string | null;
  carpetas: TreeCarpeta[];
  notas: TreeNota[];
  papelera: PapeleraItem[];
  /**
   * Los archivos del vault que no se indexan (`FUN-S-03`), para el explorador.
   * Los deja el indexado completo (`FUN-M-38`): salen del mismo recorrido del
   * disco que las notas —apertura, importación, reconciliación— y no de cada
   * recarga del árbol, que antes volvía a recorrer el vault. Entre medio, los
   * actualizan los cambios del watcher (`aplicarCambios`, `FUN-M-42`).
   * Solo-desktop: en web queda vacío.
   */
  otros: OtroArchivo[];
  setOtros: (otros: OtroArchivo[]) => void;
  /**
   * Aplica al árbol lo que avisó el watcher (`FUN-M-42`), sin esperar al índice.
   * No toca el estado si no cambia nada (el caso de cada guardado propio).
   * Devuelve si el árbol cambió.
   */
  aplicarCambios: (cambios: readonly CambioVault[]) => boolean;
  /** Estado expandido/colapsado por carpeta — persiste en localStorage (HU-22 CA5). */
  expanded: Record<string, boolean>;
  /** Carpeta activa: destino de "Nueva nota"/importaciones (HU-23 CA1). */
  activeFolderId: string | null;
  /** Último movimiento, para deshacer con Ctrl+Z (HU-24 CA7). */
  lastMove: LastMove | null;
  /**
   * Recarga el árbol desde el índice. Las listas que quedan iguales conservan su
   * identidad (`FUN-M-58`). Devuelve si cambiaron las notas o las carpetas —y
   * entonces ya refrescó las vistas en vivo—; `false` también si la descartó una
   * recarga más nueva. `refrescarVistas` las refresca aunque el árbol no cambie:
   * para quien reescribió contenido de otras notas (sus embeds en vivo).
   */
  loadTree: (vaultId: string, opciones?: { refrescarVistas?: boolean }) => Promise<boolean>;
  loadPapelera: () => Promise<void>;
  createCarpeta: (nombre: string, padreId: string | null) => Promise<void>;
  renameCarpeta: (id: string, nombre: string) => Promise<ResultadoRenombrar>;
  deleteCarpeta: (id: string) => Promise<void>;
  moveCarpeta: (id: string, destinoId: string | null) => Promise<ResultadoMover>;
  /** `titulo` solo lo usan las Esporas (`FUN-M-03`): la nota nueva se llama como
   *  la plantilla. Sin él, el nombre por defecto de siempre. */
  createNota: (carpetaId: string | null, tipo?: NotaTipo, titulo?: string) => Promise<string>;
  renameNota: (id: string, titulo: string, opciones?: OpcionesRenombrar) => Promise<ResultadoRenombrarNota>;
  deleteNota: (id: string) => Promise<void>;
  duplicateNota: (id: string) => Promise<void>;
  moveNota: (id: string, destinoId: string | null) => Promise<ResultadoMover>;
  restoreNota: (id: string) => Promise<void>;
  deleteNotaForever: (id: string) => Promise<void>;
  /**
   * Recupera varias de la papelera de una vez (`FUN-S-04`). Sigue con las demás si
   * una falla, recarga papelera y árbol **una sola vez** al final, y devuelve los
   * ids que no se pudieron recuperar.
   */
  restoreNotas: (ids: readonly string[]) => Promise<string[]>;
  /** Elimina varias definitivamente (`FUN-S-04`), con el mismo criterio. */
  deleteNotasForever: (ids: readonly string[]) => Promise<string[]>;
  undoLastMove: () => Promise<void>;
  toggleExpanded: (id: string) => void;
  /** Despliega estas carpetas (sin plegar ninguna): «revelar» un archivo (`DEF-150 a`). */
  expandirCarpetas: (ids: Iterable<string>) => void;
  setActiveFolder: (id: string | null) => void;
  /** Carpetas descendientes de una carpeta (incluida ella) — para validar D&D. */
  subtreeIds: (id: string) => Set<string>;
  /**
   * Vacía el árbol al cambiar de vault (`DEF-044`). Mismo motivo que el `reset()`
   * del grafo: en modo carpeta todos los vaults comparten `LOCAL_VAULT_ID`, así
   * que el store no detecta el cambio por sí solo y se queda con las notas del
   * vault anterior hasta que `loadTree` termine.
   */
  reset: () => void;
};

const token = () => useAuthStore.getState().accessToken;

// Guard de generación para loadTree: si varias recargas se solapan (red lenta),
// solo la última iniciada puede escribir el estado. Evita que una recarga vieja
// (que leyó antes de un move) resuelva última y revierta el árbol.
let treeSeq = 0;


/**
 * Una nota reescrita puede estar abierta en un editor, que tiene que recargarla
 * o la pisaría con los enlaces viejos en su próximo guardado. Hasta `FUN-M-38`
 * lo avisaba el watcher; ahora ignora lo que escribe la propia app, así que
 * avisa quien escribe —ya con las pestañas remapeadas, para que nadie pida el
 * contenido por el id viejo—.
 */
function avisarReescritas(r: Reparacion): void {
  // Solo esas notas (`FUN-M-58`): sin rutas, todos los editores abiertos
  // volvían a leer su archivo para comparar.
  avisarRecarga(r.reescritas);
}

/**
 * La Bandeja del vault sigue a su carpeta (`FUN-L-33`): si se renombró o se
 * movió la carpeta que la contiene, la preferencia apunta a la ruta nueva. Sin
 * esto, la próxima captura crearía otra Bandeja vacía en la ruta vieja.
 */
function seguirCarpetaDeBandeja(de: string, a: string): void {
  if (de === a) return;
  const nueva = rutaTrasMoverCarpeta(rutaBandeja(), de, a);
  if (nueva !== null) usePreferencesStore.getState().setPref("rutaBandeja", nueva);
}

/**
 * Un lienzo bloqueado sigue bloqueado después de renombrarlo o moverlo, él o su
 * carpeta (`FUN-S-39`): la preferencia se guarda por ruta, así que se reapunta
 * como las pestañas abiertas.
 */
function seguirLienzosBloqueados(tipo: "nota" | "carpeta", de: string, a: string): void {
  if (de === a) return;
  const prefs = usePrefsVaultStore.getState();
  const lista = prefs.prefs.lienzosBloqueados;
  const nueva = tipo === "nota" ? seguirRenombre(lista, de, a) : seguirCarpeta(lista, de, a);
  if (nueva !== lista) prefs.set("lienzosBloqueados", nueva);
}

/** El vault después de que `movidos` cambien de ruta. */
function despuesDe(antes: readonly NotaRuta[], movidos: readonly Movido[]): NotaRuta[] {
  return trasTraslados(
    antes,
    movidos.map((m) => ({ id: m.id, idNuevo: m.idNuevo, titulo: m.cambio.tituloNuevo })),
  );
}

/** Las notas del árbol como las ve la reparación de homónimos (`DEF-134`). */
function comoRutas(notas: readonly TreeNota[]): NotaRuta[] {
  return notas.map((n) => ({ id: n.id, titulo: n.titulo, tipo: n.tipo, aliases: n.aliases }));
}

/**
 * Avisa que una operación dejó notas con el mismo título que otras (`DEF-134`)
 * y cuántas notas se reescribieron con la ruta para que sus enlaces siguieran
 * llevando a la misma nota. `siempre`: la operación **creó** la coincidencia
 * (renombrar, crear, duplicar) y se avisa aunque no se haya reescrito nada; si
 * solo la cambió de lugar (mover), se avisa solo si hubo que reescribir.
 */
function avisarCoincidencias(
  despues: readonly NotaRuta[],
  tocadas: readonly string[],
  r: Reparacion,
  siempre: boolean,
): void {
  if (!siempre && r.conRuta.length === 0) return;
  const texto = textoAviso(coincidencias(despues, tocadas), r.conRuta.length);
  if (texto !== null) avisar(texto);
}

/**
 * Después de crear o duplicar: los enlaces que iban a una homónima y ahora
 * resolverían a la nota nueva se escriben con la ruta de la de antes, y se avisa
 * la coincidencia (`DEF-134`).
 */
async function repararNueva(previa: Previa, nueva: NotaRuta & { tipo: NotaTipo }): Promise<void> {
  const r = await repararTrasOperacion(previa, [], [nueva], token());
  // «Sin título» en otra carpeta no es una coincidencia que valga la pena
  // anunciar cada vez que se crea una nota: solo si hubo que reescribir algo.
  const porDefecto = TITULO_POR_DEFECTO[nueva.tipo];
  const sufijo = nueva.titulo.startsWith(`${porDefecto} `) ? nueva.titulo.slice(porDefecto.length + 1) : null;
  const esPorDefecto = nueva.titulo === porDefecto || (sufijo !== null && /^\d+$/.test(sufijo));
  avisarCoincidencias([...previa.antes, nueva], [nueva.id], r, !esPorDefecto);
  avisarReescritas(r);
}

/**
 * Mueve una nota o una carpeta y repara los enlaces entrantes que el
 * movimiento rompe: los que llevan pista de carpeta (`[[Carpeta/Nota]]`); los
 * de título siguen resolviendo (`FUN-L-09`, Parte 3). Los retroenlaces se leen
 * ANTES: después ya no resuelven. Lo comparten mover y deshacer el último
 * movimiento (Ctrl+Z). Lanza si el repo rechaza el movimiento.
 *
 * Mover cambia la profundidad, y con ella cuál de dos homónimas gana un
 * `[[Título]]` sin ruta: también se miran los enlaces a las homónimas de lo que
 * se mueve, y el que cambiaría de destino pasa a llevar la ruta (`DEF-134`).
 */
async function moverConReparacion(
  tipo: "nota" | "carpeta",
  id: string,
  destinoId: string | null,
  notas: readonly TreeNota[],
  vaultId: string,
): Promise<Reparacion & { id: string }> {
  const afectadas = tipo === "nota" ? [id] : notas.filter((n) => n.id.startsWith(`${id}/`)).map((n) => n.id);
  const antes = comoRutas(notas);
  const titulos = antes.filter((n) => afectadas.includes(n.id)).map((n) => n.titulo);
  const previa = await leerPrevia(antes, afectadas, titulos, vaultId, token());
  const ruta = tipo === "nota" ? `/notas/${encodeURIComponent(id)}/mover` : `/carpetas/${encodeURIComponent(id)}/mover`;
  const res = await api<{ id: string }>(ruta, { method: "POST", token: token(), body: { destinoId } });
  if (res.id === id) return { id, ...SIN_REPARACION };
  if (tipo === "nota") useTabsStore.getState().remapNota(id, res.id);
  else useTabsStore.getState().remapCarpeta(id, res.id);
  seguirLienzosBloqueados(tipo, id, res.id);
  const movidos: Movido[] =
    tipo === "nota"
      ? [
          {
            id,
            idNuevo: res.id,
            cambio: {
              tituloViejo: tituloDeRuta(id),
              tituloNuevo: tituloDeRuta(id),
              carpetaVieja: carpetaDeRuta(id),
              carpetaNueva: carpetaDeRuta(res.id),
              extension: extensionDeRuta(id),
            },
          },
        ]
      : movidosPorCarpeta(notas, id, res.id);
  const reparacion = await repararTrasOperacion(previa, movidos, [], token());
  avisarCoincidencias(despuesDe(previa.antes, movidos), movidos.map((m) => m.idNuevo), reparacion, false);
  return { id: res.id, ...reparacion };
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vaultId: null,
      carpetas: [],
      notas: [],
      papelera: [],
      otros: [],
      expanded: {},
      activeFolderId: null,
      lastMove: null,

      setOtros(otros) {
        // La reconciliación los vuelve a pasar enteros aunque no cambie nada.
        const previos = get().otros;
        const lista = conservarIdentidad(previos, otros, (o) => o.ruta, mismoOtro);
        if (lista !== previos) set({ otros: lista });
      },

      async loadTree(vaultId, opciones) {
        const seq = ++treeSeq;
        const data = await api<{ carpetas: RawCarpeta[]; notas: RawNota[] }>(
          `/vaults/${vaultId}/tree`,
          { token: token() },
        );
        // Si ya se inició una recarga más nueva, descartar este resultado viejo.
        if (seq !== treeSeq) return false;

        const carpetas: TreeCarpeta[] = data.carpetas.map((c) => ({
          id: c.id,
          padreId: c.padre_id,
          nombre: c.nombre,
        }));
        const notas: TreeNota[] = data.notas.map((n) => ({
          id: n.id,
          carpetaId: n.carpeta_id,
          titulo: n.titulo,
          tipo:
            n.tipo === "excalidraw" ||
            n.tipo === "base" ||
            n.tipo === "canvas" ||
            n.tipo === "drawio"
              ? n.tipo
              : "markdown",
          actualizadoEn: n.actualizado_en,
          ...(n.aliases && n.aliases.length > 0 ? { aliases: n.aliases } : {}),
        }));

        // Lo que el watcher ya puso en el árbol y el índice todavía no tiene
        // (`FUN-M-42`): se vuelve a aplicar encima de lo que se leyó, o esta
        // recarga —la de cualquier operación de la app— lo haría desaparecer
        // hasta que terminara el indexado.
        const previo = get();
        const vivo = aplicarAlArbol({ carpetas, notas, otros: previo.otros }, pendientesActuales());
        // Lo que no cambió conserva su identidad (`FUN-M-58`): antes cada recarga
        // dejaba `notas` y `carpetas` nuevas aunque fueran iguales, y eso
        // redisparaba todo lo suscrito a ellas —los diagnósticos de cada editor,
        // el panel de salud, el explorador— tras CADA ciclo del watcher.
        const mismoVault = previo.vaultId === vaultId;
        const nuevasCarpetas = mismoVault
          ? conservarIdentidad(previo.carpetas, vivo?.carpetas ?? carpetas, (c) => c.id, mismaCarpeta)
          : [...(vivo?.carpetas ?? carpetas)];
        const nuevasNotas = mismoVault
          ? conservarIdentidad(previo.notas, vivo?.notas ?? notas, (n) => n.id, mismaNota)
          : [...(vivo?.notas ?? notas)];
        const nuevosOtros = vivo
          ? conservarIdentidad(previo.otros, vivo.otros, (o) => o.ruta, mismoOtro)
          : previo.otros;
        const cambio = nuevasCarpetas !== previo.carpetas || nuevasNotas !== previo.notas;
        if (!mismoVault || cambio || nuevosOtros !== previo.otros) {
          set({ vaultId, carpetas: nuevasCarpetas, notas: nuevasNotas, otros: nuevosOtros });
        }
        // Un editor montado antes de que llegara el árbol —las pestañas que se
        // restauran al abrir la app— decoró sus [[enlaces]] contra una lista vacía
        // y los marcó todos como inexistentes; nada lo volvía a evaluar (`DEF-122`).
        // Solo si cambió algo: con el árbol igual, los enlaces resuelven igual.
        if (cambio || !mismoVault || opciones?.refrescarVistas) refreshAllLiveViews();
        return cambio || !mismoVault;
      },

      aplicarCambios(cambios) {
        const { carpetas, notas, otros } = get();
        const vivo = aplicarAlArbol({ carpetas, notas, otros }, cambios);
        if (!vivo) return false;
        // Sin copiar: `aplicarAlArbol` devuelve copias nuevas de las listas que
        // cambió y LAS MISMAS de las que no (`FUN-M-58`). Antes se copiaban las
        // tres, y un archivo que no es nota cambiaba también la identidad de
        // `notas` y `carpetas`.
        set({
          carpetas: vivo.carpetas as TreeCarpeta[],
          notas: vivo.notas as TreeNota[],
          otros: vivo.otros as OtroArchivo[],
        });
        // Una nota que aparece o se va cambia qué `[[enlaces]]` resuelven: las
        // vistas en vivo los vuelven a evaluar contra la lista nueva.
        if (vivo.notas !== notas) refreshAllLiveViews();
        return true;
      },

      async loadPapelera() {
        const { vaultId } = get();
        if (!vaultId) return;
        const data = await api<{ items: RawPapeleraItem[] }>(
          `/vaults/${vaultId}/papelera`,
          { token: token() },
        );
        set({
          papelera: data.items.map((i) => ({
            notaId: i.nota_id,
            titulo: i.titulo,
            rutaOriginal: i.ruta_original,
            eliminadoEn: i.eliminado_en,
          })),
        });
      },

      async createCarpeta(nombre, padreId) {
        const { vaultId } = get();
        if (!vaultId) return;
        await api(`/vaults/${vaultId}/carpetas`, {
          method: "POST",
          token: token(),
          body: { nombre, padreId },
        });
        if (padreId) set((s) => ({ expanded: { ...s.expanded, [padreId]: true } }));
        await get().loadTree(vaultId);
      },

      async renameCarpeta(id, nombre) {
        // Las notas de la carpeta cambian de ruta: los enlaces con pista de
        // carpeta (`[[Vieja/Nota]]`) dejan de resolver. Se leen sus
        // retroenlaces ANTES (`FUN-L-09`, Parte 3).
        const notas = get().notas;
        const afectadas = notas.filter((n) => n.id.startsWith(`${id}/`));
        const previa = await leerPrevia(
          comoRutas(notas),
          afectadas.map((n) => n.id),
          afectadas.map((n) => n.titulo),
          get().vaultId!,
          token(),
        );
        const res = await api<{ id: string }>(`/carpetas/${encodeURIComponent(id)}`, {
          method: "PATCH",
          token: token(),
          body: { nombre },
        });
        let reparacion: Reparacion = SIN_REPARACION;
        // Modo carpeta: renombrar la carpeta cambia su ruta y la de todo su
        // subárbol; reapuntar las pestañas de las notas que colgaban de ella.
        if (res.id !== id) {
          seguirCarpetaDeBandeja(id, res.id);
          useTabsStore.getState().remapCarpeta(id, res.id);
          seguirLienzosBloqueados("carpeta", id, res.id);
          const movidos = movidosPorCarpeta(notas, id, res.id);
          reparacion = await repararTrasOperacion(previa, movidos, [], token());
          avisarCoincidencias(despuesDe(previa.antes, movidos), movidos.map((m) => m.idNuevo), reparacion, false);
        }
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews(); // la ruta cambió: refrescar wikilinks por ruta
        avisarReescritas(reparacion);
        // `DEF-150 m`: el saneo cambia `: ? * …` por `-`; decirlo.
        const reemplazo = avisoCaracteresReemplazados(nombre, res.id.split("/").pop());
        if (reemplazo) avisar(reemplazo);
        return { id: res.id, ...reparacion };
      },

      async deleteCarpeta(id) {
        // La Bandeja no se elimina (`FUN-L-33`), tampoco con su carpeta.
        protegerCarpetaConBandeja(id);
        await api(`/carpetas/${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
      },

      async moveCarpeta(id, destinoId) {
        const prev = get().carpetas.find((c) => c.id === id)?.padreId ?? null;
        const notas = get().notas;
        // Optimista: mover la carpeta en el árbol al instante (no esperar la red).
        set((s) => ({
          carpetas: s.carpetas.map((c) => (c.id === id ? { ...c, padreId: destinoId } : c)),
          lastMove: { type: "carpeta", id, prevParentId: prev },
          expanded: destinoId ? { ...s.expanded, [destinoId]: true } : s.expanded,
        }));
        let res: Reparacion & { id: string };
        try {
          res = await moverConReparacion("carpeta", id, destinoId, notas, get().vaultId!);
        } catch (err) {
          // Revertir si el backend rechazó el movimiento.
          console.error("[vault] fallo al mover carpeta:", err);
          set((s) => ({
            carpetas: s.carpetas.map((c) => (c.id === id ? { ...c, padreId: prev } : c)),
          }));
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        // Modo carpeta: mover la carpeta cambia su ruta (id) y la de su subárbol
        // (las pestañas ya las siguió `moverConReparacion`).
        if (res.id !== id) {
          seguirCarpetaDeBandeja(id, res.id);
          set((s) => ({
            lastMove:
              s.lastMove && s.lastMove.type === "carpeta" && s.lastMove.id === id
                ? { ...s.lastMove, id: res.id }
                : s.lastMove,
          }));
        }
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews(); // la ruta cambió: refrescar wikilinks por ruta
        avisarReescritas(res);
        return { ok: true, ...res };
      },

      async createNota(carpetaId, tipo = "markdown", titulo) {
        const { vaultId } = get();
        if (!vaultId) throw new Error("Sin vault activo");
        const base = titulo && titulo.trim() !== "" ? titulo.trim() : TITULO_POR_DEFECTO[tipo];
        // Una nota nueva con el título de otra se queda con sus `[[Título]]` sin
        // ruta si queda más cerca de la raíz (`DEF-134`): se lee ANTES quién
        // enlaza a las homónimas.
        const previa = await leerPrevia(comoRutas(get().notas), [], [base, sanearNombre(base)], vaultId, token());
        const result = await api<{ id: string }>(`/vaults/${vaultId}/notas`, {
          method: "POST",
          token: token(),
          body: { titulo: base, carpetaId, tipo },
        });
        await repararNueva(previa, { id: result.id, titulo: tituloDeRuta(result.id), tipo });
        if (carpetaId) set((s) => ({ expanded: { ...s.expanded, [carpetaId]: true } }));
        await get().loadTree(vaultId);
        markGraphStale();
        return result.id;
      },

      async renameNota(id, titulo, opciones) {
        // La Bandeja del vault no se renombra (`FUN-L-33`). Acá y no en cada
        // botón: el explorador, el título de la nota, las Esporas y el MCP
        // pasan todos por este método.
        protegerBandeja(id, "renombrar");
        // FUN-M-08: los `[[enlaces]]` resuelven por titulo, asi que renombrar
        // los rompe todos. Se leen los retroenlaces ANTES de renombrar —despues
        // ya no apuntan a nada y el indice no los encuentra— y se reescriben
        // despues, cuando el titulo nuevo ya es el bueno.
        //
        // DEF-134: también se leen los de las notas que ya se llaman como el
        // título nuevo. Si la renombrada queda más cerca de la raíz que ellas,
        // sus `[[Título]]` sin ruta pasarían a llevar a la renombrada: después
        // del renombrado se escriben con la ruta de la nota a la que iban.
        const anterior = get().notas.find((n) => n.id === id)?.titulo ?? null;
        const antes = comoRutas(get().notas);
        const previa =
          anterior !== null && anterior !== titulo
            ? await leerPrevia(antes, [id], [titulo.trim(), sanearNombre(titulo.trim())], get().vaultId!, token())
            : null;

        const res = await api<{ id: string; titulo?: string }>(
          `/notas/${encodeURIComponent(id)}`,
          { method: "PATCH", token: token(), body: { titulo } },
        );

        // DEF-084: el titulo que el archivo OBTUVO, no el que se pidio. No son
        // el mismo — un nombre de archivo no admite `? : * | " < > \ /` y el
        // saneo los sustituye por `-`— y reescribir los enlaces con el pedido
        // los dejaba apuntando a una nota que nunca existio. En silencio, y en
        // archivos que el usuario no esta mirando.
        //
        // Por eso la comparacion tambien se hace contra el efectivo: si el saneo
        // devuelve el nombre que ya tenia, no hubo renombrado y no hay nada que
        // reescribir. El `?? titulo` es para un backend que todavia no lo mande.
        const efectivo = res.titulo ?? titulo;
        let reparacion: Reparacion = SIN_REPARACION;
        if (previa !== null && anterior !== null && anterior !== efectivo) {
          // Por título y, desde `FUN-L-09`, también con pista de carpeta
          // (`[[Carpeta/Vieja]]`), que antes quedaba rota.
          const cambio = { ...cambioRenombrar(id, efectivo), tituloViejo: anterior };
          const movidos: Movido[] = [{ id, idNuevo: res.id, cambio }];
          reparacion = await repararTrasOperacion(previa, movidos, [], token());
          avisarCoincidencias(
            despuesDe(previa.antes, movidos),
            [res.id],
            reparacion,
            anterior.trim().toLowerCase() !== efectivo.trim().toLowerCase(),
          );
        }
        // Modo carpeta: renombrar cambia el id (=ruta). La pestaña abierta debe
        // seguir a la nota con su id nuevo antes de reconciliar el árbol.
        if (res.id !== id) {
          useTabsStore.getState().remapNota(id, res.id);
          seguirLienzosBloqueados("nota", id, res.id);
        }
        await get().loadTree(get().vaultId!);
        markGraphStale();
        avisarReescritas(reparacion);
        // `DEF-150 m`: el saneo cambia `: ? * …` por `-` (ver `DEF-084` arriba);
        // antes en silencio, ahora se le dice al usuario cómo quedó el nombre.
        const reemplazo = avisoCaracteresReemplazados(titulo, efectivo);
        if (reemplazo) avisar(reemplazo);
        // `FUN-M-47`: el nombre anterior como alias, DESPUÉS de reparar (los
        // entrantes ya apuntan al nombre nuevo; el alias es para lo que no se
        // reescribe). Si falla, el renombre ya está hecho: se avisa y listo.
        let aliasConservado: boolean | undefined;
        if (opciones?.conservarAlias && anterior !== null && anterior !== efectivo) {
          try {
            aliasConservado = await alternarAliasDeNota(res.id, anterior, token());
          } catch (e) {
            aliasConservado = false;
            console.error("[Mycelium] no se pudo conservar el nombre anterior como alias", e);
          }
          if (!aliasConservado) {
            avisar(
              extensionDeRuta(res.id).toLowerCase() === ".md"
                ? `No se pudo guardar «${anterior}» como alias: el frontmatter de la nota no se puede editar sin romperlo.`
                : `«${anterior}» no se guardó como alias: solo las notas .md tienen propiedades.`,
            );
          }
        }
        return { id: res.id, titulo: efectivo, ...reparacion, ...(aliasConservado === undefined ? {} : { aliasConservado }) };
      },

      async deleteNota(id) {
        protegerBandeja(id, "eliminar"); // `FUN-L-33`, como `renameNota`
        await api(`/notas/${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async duplicateNota(id) {
        // La copia se llama «X (copia)»: si ya hay una así en otra carpeta, es
        // una homónima nueva (`DEF-134`).
        const original = get().notas.find((n) => n.id === id);
        const pedido = original ? `${original.titulo} (copia)` : null;
        const previa =
          pedido !== null
            ? await leerPrevia(comoRutas(get().notas), [], [pedido, sanearNombre(pedido)], get().vaultId!, token())
            : null;
        const res = await api<{ id: string }>(`/notas/${encodeURIComponent(id)}/duplicar`, {
          method: "POST",
          token: token(),
        });
        if (previa !== null && original) {
          await repararNueva(previa, { id: res.id, titulo: tituloDeRuta(res.id), tipo: original.tipo });
        }
        await get().loadTree(get().vaultId!);
        markGraphStale();
      },

      async moveNota(id, destinoId) {
        // `FUN-L-33`: no lanza, como el resto de este método (ver `ResultadoMover`).
        try {
          protegerBandeja(id, "mover");
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
        const prev = get().notas.find((n) => n.id === id)?.carpetaId ?? null;
        const notas = get().notas;
        // Optimista: mover la nota en el árbol al instante (no esperar la red).
        set((s) => ({
          notas: s.notas.map((n) => (n.id === id ? { ...n, carpetaId: destinoId } : n)),
          lastMove: { type: "nota", id, prevParentId: prev },
          expanded: destinoId ? { ...s.expanded, [destinoId]: true } : s.expanded,
        }));
        let res: Reparacion & { id: string };
        try {
          res = await moverConReparacion("nota", id, destinoId, notas, get().vaultId!);
        } catch (err) {
          // Revertir si el backend rechazó el movimiento.
          console.error("[vault] fallo al mover nota:", err);
          set((s) => ({
            notas: s.notas.map((n) => (n.id === id ? { ...n, carpetaId: prev } : n)),
          }));
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        // Modo carpeta: mover cambia el id (=ruta). Apuntar deshacer al id nuevo
        // (las pestañas ya las siguió `moverConReparacion`).
        if (res.id !== id) {
          set((s) => ({
            lastMove:
              s.lastMove && s.lastMove.type === "nota" && s.lastMove.id === id
                ? { ...s.lastMove, id: res.id }
                : s.lastMove,
          }));
        }
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews(); // la ruta cambió: refrescar wikilinks por ruta
        avisarReescritas(res);
        return { ok: true, ...res };
      },

      async restoreNota(id) {
        await api(`/notas/${encodeURIComponent(id)}/recuperar`, { method: "POST", token: token() });
        await Promise.all([get().loadPapelera(), get().loadTree(get().vaultId!)]);
        markGraphStale();
      },

      async deleteNotaForever(id) {
        await api(`/notas/${encodeURIComponent(id)}/permanente`, { method: "DELETE", token: token() });
        await get().loadPapelera();
      },

      async restoreNotas(ids) {
        const fallidas: string[] = [];
        // De a una y en orden: dos recuperadas que vuelven a la misma carpeta con el
        // mismo nombre tienen que desambiguarse una después de la otra.
        for (const id of ids) {
          try {
            await api(`/notas/${encodeURIComponent(id)}/recuperar`, { method: "POST", token: token() });
          } catch {
            fallidas.push(id);
          }
        }
        await Promise.all([get().loadPapelera(), get().loadTree(get().vaultId!)]);
        markGraphStale();
        return fallidas;
      },

      async deleteNotasForever(ids) {
        const fallidas: string[] = [];
        for (const id of ids) {
          try {
            await api(`/notas/${encodeURIComponent(id)}/permanente`, { method: "DELETE", token: token() });
          } catch {
            fallidas.push(id);
          }
        }
        await get().loadPapelera();
        return fallidas;
      },

      async undoLastMove() {
        const move = get().lastMove;
        if (!move) return;
        set({ lastMove: null });
        // Con la misma reparación que el movimiento: si no, los enlaces que se
        // pasaron a la ruta nueva quedarían apuntando a donde ya no está.
        const r = await moverConReparacion(move.type, move.id, move.prevParentId, get().notas, get().vaultId!);
        await get().loadTree(get().vaultId!);
        refreshAllLiveViews();
        avisarReescritas(r);
      },

      toggleExpanded(id) {
        set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }));
      },

      expandirCarpetas(ids) {
        const faltan = [...ids].filter((id) => !get().expanded[id]);
        // Sin cambios no hay `set`: no se re-dibuja el árbol ni se persiste nada.
        if (faltan.length === 0) return;
        set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(faltan.map((id) => [id, true])) } }));
      },

      reset() {
        // `expanded` NO se toca: está persistido y es una preferencia de
        // visualización, no datos del vault. Los pendientes del árbol en vivo
        // (`FUN-M-42`) eran del vault anterior.
        vaciarPendientes();
        set({
          vaultId: null,
          carpetas: [],
          notas: [],
          papelera: [],
          otros: [],
          activeFolderId: null,
          lastMove: null,
        });
      },

      setActiveFolder(id) {
        set({ activeFolderId: id });
      },

      subtreeIds(id) {
        const { carpetas } = get();
        const result = new Set<string>([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const carpeta of carpetas) {
            if (
              carpeta.padreId !== null &&
              result.has(carpeta.padreId) &&
              !result.has(carpeta.id)
            ) {
              result.add(carpeta.id);
              changed = true;
            }
          }
        }
        return result;
      },
    }),
    {
      name: "micelio-explorer",
      partialize: (state) => ({ expanded: state.expanded }),
    },
  ),
);

/**
 * Los alias que cambió el índice (`FUN-M-15`): al guardar una nota o al indexar
 * lo que cambió por fuera. Se aplican a las notas del árbol sin releerlo; la
 * lista nueva invalida el índice por título y alias (`notasPorTitulo`), y las
 * vistas en vivo vuelven a evaluar sus `[[enlaces]]` contra ella.
 */
export function aplicarAliases(cambios: Record<string, string[]>): void {
  const { notas } = useVaultStore.getState();
  let cambio = false;
  const nuevas = notas.map((n) => {
    if (!Object.prototype.hasOwnProperty.call(cambios, n.id)) return n;
    const aliases = cambios[n.id];
    const antes = n.aliases ?? [];
    if (antes.length === aliases.length && antes.every((a, i) => a === aliases[i])) return n;
    cambio = true;
    const nueva: TreeNota = { ...n, aliases: [...aliases] };
    if (aliases.length === 0) delete nueva.aliases;
    return nueva;
  });
  if (!cambio) return;
  useVaultStore.setState({ notas: nuevas });
  markGraphStale();
}

if (typeof window !== "undefined") {
  window.addEventListener(EVENTO_ALIAS, (e) => {
    const detalle = (e as CustomEvent<{ aliases?: Record<string, string[]> }>).detail;
    if (detalle?.aliases) aplicarAliases(detalle.aliases);
  });
}
