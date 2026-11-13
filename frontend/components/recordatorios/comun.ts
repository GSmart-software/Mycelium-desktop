"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { confirmar } from "@/lib/confirmar";
import { markMissingWikilinks, resolveWikilink } from "@/lib/editor/wikilink";
import { pedirSaltoAAncla } from "@/lib/editor/pendingMatch";
import { mismaRuta } from "@/lib/mcpControlLogica";
import { resolverReferencia } from "@/lib/wikilinks";
import { atenderClicEnEnlace } from "@/lib/enlacesExternos";
import { aDate, type Ocurrencia, type Recordatorio, type Repeticion } from "@/lib/recordatorios";
import { CALENDAR_TAB_ID } from "@/lib/pestanas";
import { abrirVaultEnVentana, listarVaults, nombreDeVault } from "@/lib/vaultMode";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Piezas comunes del calendario (`FUN-L-22`): la navegación de los
 * `[[enlaces]]` del detalle y los textos de fecha que comparten la pestaña, el
 * panel, el modal y la tarjeta.
 */

// ── Los enlaces de un recordatorio personal de otro vault (`FUN-M-60`) ──────

/**
 * El vault de origen de un recordatorio si es **otro** que el abierto: sus
 * `[[enlaces]]` se resuelven allá. `null` si es de este vault (o no lo dice).
 */
export function vaultAjeno(
  r: Pick<Recordatorio, "vaultOrigen"> | null | undefined,
  rutaActual: string | null,
): string | null {
  const origen = r?.vaultOrigen;
  if (!origen || rutaActual === null || mismaRuta(origen, rutaActual)) return null;
  return origen;
}

/** Los vaults vinculados, para saber si el de origen sigue estándolo. Se leen al montar. */
export function useVaultsVinculados(): string[] | null {
  const [rutas, setRutas] = useState<string[] | null>(null);
  useEffect(() => {
    let vivo = true;
    listarVaults()
      .then((v) => {
        if (vivo) setRutas(v.map((x) => x.ruta));
      })
      .catch(() => {
        if (vivo) setRutas([]);
      });
    return () => {
      vivo = false;
    };
  }, []);
  return rutas;
}

const estaVinculado = (rutas: readonly string[] | null, origen: string) =>
  rutas !== null && rutas.some((r) => mismaRuta(r, origen));

/**
 * Marca los enlaces del detalle renderizado. De este vault, como en una nota:
 * rotos si la nota no existe. De otro vault todavía vinculado, ninguno roto (se
 * resuelven allá, al hacer clic); de uno que ya no está vinculado, todos rotos.
 */
export function marcarEnlaces(
  root: HTMLElement,
  ajeno: string | null,
  vinculados: readonly string[] | null,
  notas: Parameters<typeof markMissingWikilinks>[1],
  carpetas: Parameters<typeof markMissingWikilinks>[2],
): void {
  if (ajeno === null) {
    markMissingWikilinks(root, notas, carpetas);
    return;
  }
  const roto = vinculados !== null && !estaVinculado(vinculados, ajeno);
  root.querySelectorAll<HTMLAnchorElement>("a.mic-wikilink").forEach((a) => {
    a.classList.toggle("mic-wikilink-missing", roto);
    a.title = roto
      ? `El vault «${nombreDeVault(ajeno)}» ya no está vinculado`
      : `Se abre en el vault «${nombreDeVault(ajeno)}»`;
  });
}

/** Dónde se anotan las notas a abrir en otra ventana: compartido entre ventanas. */
const CLAVE_PENDIENTE = "mycelium:recordatorio-nota-pendiente";
/** El evento que avisa a las demás ventanas que hay una nota pendiente. */
const EVENTO_PENDIENTE = "recordatorio-nota-pendiente";
/** Un pedido viejo no se atiende: el usuario ya no lo espera. */
const VIGENCIA_PENDIENTE_MS = 2 * 60_000;

type NotaPendiente = { vault: string; titulo: string; cuando: number };

function leerPendientes(): NotaPendiente[] {
  try {
    const datos: unknown = JSON.parse(localStorage.getItem(CLAVE_PENDIENTE) ?? "[]");
    return Array.isArray(datos) ? (datos as NotaPendiente[]) : [];
  } catch {
    return [];
  }
}

function escribirPendientes(lista: NotaPendiente[]): void {
  try {
    localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(lista));
  } catch {
    // Sin almacenamiento, el vault se abre igual; solo no va a la nota.
  }
}

/** Toma (y olvida) la nota pendiente para ese vault, si hay una vigente. */
function tomarPendiente(vault: string): string | null {
  const ahora = Date.now();
  const lista = leerPendientes();
  if (lista.length === 0) return null;
  const vigentes = lista.filter((p) => ahora - p.cuando < VIGENCIA_PENDIENTE_MS);
  const i = vigentes.findIndex((p) => mismaRuta(p.vault, vault));
  const titulo = i < 0 ? null : vigentes[i].titulo;
  if (i >= 0) vigentes.splice(i, 1);
  escribirPendientes(vigentes);
  return titulo;
}

/**
 * Seguir un enlace de un recordatorio personal creado en OTRO vault: ofrece
 * abrir ese vault —en su ventana, o una nueva (`FUN-L-16`)— y la nota ahí. Si
 * el vault ya no está vinculado, el enlace está roto: no pasa nada, sin error.
 * Devuelve si se abrió.
 */
async function abrirEnVaultDeOrigen(origen: string, titulo: string): Promise<boolean> {
  let vinculados: string[];
  try {
    vinculados = (await listarVaults()).map((v) => v.ruta);
  } catch {
    return false;
  }
  if (!estaVinculado(vinculados, origen)) return false;
  const ok = await confirmar(
    `Este recordatorio personal se creó en el vault «${nombreDeVault(origen)}», y sus enlaces son de allá. ¿Abrir «${titulo}» en ese vault?`,
    "Abrir el vault",
  );
  if (!ok) return false;
  escribirPendientes([...leerPendientes(), { vault: origen, titulo, cuando: Date.now() }]);
  try {
    await abrirVaultEnVentana(origen);
    // Si el vault ya estaba abierto, su ventana se entera por el evento; una
    // ventana nueva la toma al terminar de cargar.
    const { emit } = await import("@tauri-apps/api/event");
    await emit(EVENTO_PENDIENTE);
  } catch (e) {
    console.error("[Mycelium] recordatorios · no se pudo abrir el vault de origen", e);
  }
  return true;
}

/**
 * Los `[[enlaces]]` de un recordatorio se resuelven contra el vault como en una
 * nota cualquiera: `abrir` abre la nota (y avisa con `alAbrir`, para cerrar lo
 * que tape) y `existe` es lo que pinta un enlace roto.
 *
 * `ajeno`: el vault de origen de un personal creado en otro vault
 * (`vaultAjeno`). Entonces el enlace se resuelve allá: `abrir` ofrece abrir ese
 * vault, y `existe` dice si sigue vinculado.
 */
export function useEnlacesDelVault(alAbrir?: () => void, ajeno: string | null = null) {
  const router = useRouter();
  const vinculados = useVaultsVinculados();
  const abrirAca = useCallback(
    (titulo: string) => {
      const { notas, carpetas } = useVaultStore.getState();
      const { nota: destino, ancla } = resolverReferencia(titulo, notas, carpetas);
      if (!destino) return;
      useTabsStore.getState().openNote(destino.id);
      router.replace(`/workspace?note=${destino.id}`);
      // `[[Nota#Encabezado]]`: además de abrirla, ir al encabezado (`DEF-141`).
      if (ancla) pedirSaltoAAncla(destino.id, ancla);
      alAbrir?.();
    },
    [router, alAbrir],
  );
  const abrir = useCallback(
    (titulo: string) => {
      if (ajeno === null) {
        abrirAca(titulo);
        return;
      }
      void abrirEnVaultDeOrigen(ajeno, titulo).then((abierto) => {
        if (abierto) alAbrir?.();
      });
    },
    [ajeno, abrirAca, alAbrir],
  );
  const existe = useCallback(
    (titulo: string) => {
      if (ajeno !== null) return vinculados === null || estaVinculado(vinculados, ajeno);
      const { notas, carpetas } = useVaultStore.getState();
      return resolveWikilink(titulo, notas, carpetas) !== undefined;
    },
    [ajeno, vinculados],
  );

  /** Clic dentro del detalle renderizado: enlaces del vault y de la web. */
  const onClicDetalle = useCallback(
    (event: React.MouseEvent) => {
      // Un enlace a la web va al navegador del sistema (`DEF-101`); ningún
      // `<a>` navega la webview (`DEF-160`).
      atenderClicEnEnlace(event, { abrirNota: abrir });
    },
    [abrir],
  );

  return { abrir, existe, onClicDetalle, vinculados, abrirAca };
}

/**
 * La otra punta de `abrirEnVaultDeOrigen`: si otra ventana pidió abrir una nota
 * de ESTE vault (un enlace de un recordatorio personal), se abre en cuanto el
 * vault tiene sus notas. Va montado una vez en el workspace.
 */
export function useNotaPendienteDeOtroVault(): void {
  const rutaActual = useVaultSessionStore((s) => s.rutaActual);
  const hayNotas = useVaultStore((s) => s.notas.length > 0);
  const { abrirAca } = useEnlacesDelVault();
  const intentar = useCallback(() => {
    if (rutaActual === null || !hayNotas) return;
    const titulo = tomarPendiente(rutaActual);
    if (titulo !== null) abrirAca(titulo);
  }, [rutaActual, hayNotas, abrirAca]);

  useEffect(() => {
    intentar();
    let dejar: (() => void) | null = null;
    let vivo = true;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen(EVENTO_PENDIENTE, () => intentar()))
      .then((fn) => {
        if (vivo) dejar = fn;
        else fn();
      })
      .catch(() => undefined); // fuera de Tauri no hay otras ventanas
    return () => {
      vivo = false;
      dejar?.();
    };
  }, [intentar]);
}

/** Abre (o enfoca) la pestaña del calendario. */
export function useAbrirCalendario() {
  const router = useRouter();
  return useCallback(() => {
    useTabsStore.getState().openNote(CALENDAR_TAB_ID);
    router.replace(`/workspace?note=${CALENDAR_TAB_ID}`);
  }, [router]);
}

const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const INICIALES_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «vie 25 sep». */
export function fechaCorta(fecha: string): string {
  const d = aDate(fecha);
  return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

/** «viernes 25 de septiembre de 2026». */
export function fechaCompleta(fecha: string): string {
  return aDate(fecha).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** «10:30» o «Todo el día». */
export function horaDe(o: Ocurrencia): string {
  return o.recordatorio.hora ?? "Todo el día";
}

/** Cómo se lee la repetición de un recordatorio, con su referencia concreta. */
export function describirRepeticion(repeticion: Repeticion, fecha: string): string | null {
  const d = aDate(fecha);
  switch (repeticion) {
    case "ninguna":
      return null;
    case "dia":
      return "Se repite cada día";
    case "semana":
      return `Se repite cada ${DIAS_SEMANA[(d.getDay() + 6) % 7].toLowerCase()}`;
    case "mes":
      return `Se repite cada mes, el día ${d.getDate()}`;
    case "anio":
      return `Se repite cada año, el ${d.toLocaleDateString("es", { day: "numeric", month: "long" })}`;
  }
}
