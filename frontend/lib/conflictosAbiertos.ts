import { atarAPestanas } from "@/lib/cachePestanas";
import { confirmar } from "@/lib/confirmar";
import { rutaDeCopiaDeEmergencia } from "@/lib/conflictoExterno";
import { getVaultActual } from "@/lib/db/vaultContext";
import { escribirNota } from "@/lib/db/vaultFs";
import { BANDEJA_PERSONAL_ID, TITULO_BANDEJA_PERSONAL } from "@/lib/pestanas";
import { avisar } from "@/stores/avisosStore";
import { allLeaves, findLeaf, useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Pestañas con un conflicto pendiente con el disco (`DEF-138`) y los caminos
 * que las reemplazan o las cierran sin perder lo del usuario (`DEF-177`).
 *
 * Una nota en conflicto tiene lo del usuario **solo en memoria**: el guardado
 * está en pausa hasta que elija en la barra. Todo camino que se lleva la
 * pestaña —cerrarla, navegar a otra nota en ella, que la IA la cierre, salir
 * del vault, cerrar la ventana— tiraría lo suyo. Por eso:
 *
 * - **Lo que hace el usuario pregunta**: cerrar (`cerrarPestanaSinPerder`),
 *   atrás/adelante (`navegarHistorialSinPerder`) y salir del vault
 *   (`guardarConflictosSinPerder`). Si acepta, lo suyo se guarda como copia
 *   —«Título (copia local)»— y la nota queda como la dejaron afuera; si no, no
 *   pasa nada.
 * - **Lo que no puede esperar una respuesta** (la IA borra la nota, el archivo
 *   desaparece de afuera, cualquier camino que no pase por lo de arriba) guarda
 *   la copia solo y avisa: el barrido de las pestañas cerradas
 *   (`lib/cachePestanas.ts`) entrega acá cada conflicto que suelta.
 * - **Cerrar la ventana** no deja esperar nada: lo suyo va a un archivo aparte
 *   con fecha y hora (`escribirCopiasDeEmergencia`), también para las
 *   pestañas en conflicto que no se ven.
 * - Abrir otra nota desde una pestaña de vista previa la reemplazaba: una
 *   pestaña en conflicto queda fija al registrarse, así que abrir otra nota
 *   abre una pestaña nueva y esta sigue ahí.
 *
 * El editor registra acá su conflicto al entrar y lo da de baja al resolverlo
 * (no al desmontarse: una pestaña que no se ve también puede estar en
 * conflicto, y su texto sigue en la caché de la pestaña). Es la misma idea que
 * `lib/guardadoPendiente.ts`, para lo que no se puede guardar solo.
 */

type Conflicto = {
  notaId: string;
  /** Guarda lo del usuario como copia y carga lo de afuera. `true` si quedó a salvo. */
  guardarCopia: () => Promise<boolean>;
  /** Lo que tiene escrito el usuario ahora. */
  contenido: () => string;
};

/**
 * Atado a la vida de las pestañas (`FUN-M-58`): una pestaña que se va sin pasar
 * por las funciones de abajo ya no tiene a quién preguntarle. Antes el barrido
 * solo soltaba la entrada, y con ella lo escrito (`DEF-177`); ahora le guarda
 * la copia sin preguntar.
 */
const abiertos = atarAPestanas(new Map<string, Conflicto>(), (_clave, conflicto) => {
  // Fuera del barrido, que corre dentro de un `set` del store de pestañas: la
  // copia crea una nota y toca otros stores.
  queueMicrotask(() => void resguardar(conflicto));
});

/** El editor de la pestaña `instanceId` entró en conflicto. */
export function registrarConflicto(
  instanceId: string,
  notaId: string,
  guardarCopia: () => Promise<boolean>,
  contenido: () => string,
): void {
  abiertos.set(instanceId, { notaId, guardarCopia, contenido });
  // Una pestaña de vista previa se reemplaza al abrir otra nota: en conflicto,
  // eso se llevaba lo escrito. Fija, abrir otra nota abre otra pestaña.
  const { root, pinTab } = useTabsStore.getState();
  const hoja = allLeaves(root).find((l) => l.tabs.some((t) => t.id === instanceId));
  if (hoja) pinTab(hoja.id, instanceId);
}

/** El conflicto de la pestaña se resolvió (o la pestaña se cerró). */
export function olvidarConflicto(instanceId: string): void {
  abiertos.delete(instanceId);
}

/** ¿La pestaña tiene un conflicto pendiente? */
export function hayConflicto(instanceId: string): boolean {
  return abiertos.has(instanceId);
}

function tituloDe(notaId: string): string {
  if (notaId === BANDEJA_PERSONAL_ID) return TITULO_BANDEJA_PERSONAL;
  return useVaultStore.getState().notas.find((n) => n.id === notaId)?.titulo ?? "la nota";
}

/**
 * La ruta (en el vault) sobre la que se arma la copia de emergencia. La Bandeja
 * personal (`FUN-L-33`) no está en el vault y su id no es una ruta (`:` no
 * vale en un nombre de Windows): su copia va a la raíz, con su título.
 */
function rutaBaseDeCopia(notaId: string): string {
  return notaId === BANDEJA_PERSONAL_ID ? `${TITULO_BANDEJA_PERSONAL}.md` : notaId;
}

/**
 * Si la pestaña tiene un conflicto, pregunta antes de `accion` y, si el usuario
 * acepta, guarda lo suyo como copia. Devuelve si se puede seguir.
 */
async function resguardarPreguntando(tabId: string, accion: string, boton: string): Promise<boolean> {
  const conflicto = abiertos.get(tabId);
  if (!conflicto) return true;
  const acepta = await confirmar(
    `«${tituloDe(conflicto.notaId)}» tiene cambios tuyos sin guardar y el archivo cambió fuera de Mycelium. ` +
      `Para ${accion}, lo tuyo se guarda como una copia aparte y la nota queda como la dejaron afuera.`,
    boton,
  );
  if (!acepta) return false;
  // Mientras se preguntaba, la pestaña pudo irse por otro lado (la IA borró la
  // nota): el barrido ya le guardó la copia, y no hay que hacer otra.
  if (abiertos.get(tabId) !== conflicto) return false;
  if (!(await conflicto.guardarCopia())) return false;
  olvidarConflicto(tabId);
  return true;
}

/**
 * Cierra la pestaña `tabId` del panel `paneId`, salvo que tenga un conflicto
 * pendiente y el usuario no quiera guardar lo suyo como copia. Devuelve si se
 * cerró. Quien cierra una pestaña por acción del usuario (la X, Supr, Ctrl+W,
 * anclarla al panel lateral) pasa por acá y no por `closeTab` directo.
 */
export async function cerrarPestanaSinPerder(paneId: string, tabId: string): Promise<boolean> {
  if (!(await resguardarPreguntando(tabId, "cerrarla", "Guardar copia y cerrar"))) return false;
  useTabsStore.getState().closeTab(paneId, tabId);
  return true;
}

/**
 * Atrás (`-1`) o adelante (`+1`) en el historial de la pestaña activa del
 * panel, con la misma pregunta que al cerrarla si tiene un conflicto: navegar
 * reemplaza la pestaña, y con ella lo escrito (`DEF-177`). Devuelve si navegó.
 * Las flechas de la barra de pestañas y Alt+←/→ pasan por acá y no por
 * `navegarHistorial` directo.
 */
export async function navegarHistorialSinPerder(paneId: string, delta: -1 | 1): Promise<boolean> {
  const store = useTabsStore.getState();
  if (store.destinoHistorial(paneId, delta) === null) return false;
  const tabId = findLeaf(store.root, paneId)?.activeTabId;
  if (!tabId) return false;
  const accion = "ir a otra nota en esta pestaña";
  if (!(await resguardarPreguntando(tabId, accion, "Guardar copia y seguir"))) return false;
  // La pregunta es modal, pero el destino se vuelve a mirar: lo de afuera pudo
  // cambiar la pestaña mientras tanto.
  if (findLeaf(useTabsStore.getState().root, paneId)?.activeTabId !== tabId) return false;
  useTabsStore.getState().navegarHistorial(paneId, delta);
  return true;
}

/**
 * Antes de soltar todas las pestañas (salir del vault): si alguna tiene un
 * conflicto, pregunta una vez por todas y guarda lo de cada una como copia.
 * Devuelve si se puede seguir; si una copia falla, no se sigue.
 */
export async function guardarConflictosSinPerder(accion: string, boton: string): Promise<boolean> {
  const pendientes = [...abiertos.entries()];
  if (pendientes.length === 0) return true;
  const quienes =
    pendientes.length === 1
      ? `«${tituloDe(pendientes[0][1].notaId)}» tiene`
      : `${pendientes.length} notas tienen`;
  const lasNotas = pendientes.length === 1 ? "la nota queda" : "las notas quedan";
  const acepta = await confirmar(
    `${quienes} cambios tuyos sin guardar y el archivo cambió fuera de Mycelium. ` +
      `Para ${accion}, lo tuyo se guarda como una copia aparte y ${lasNotas} como la dejaron afuera.`,
    boton,
  );
  if (!acepta) return false;
  for (const [tabId, conflicto] of pendientes) {
    if (abiertos.get(tabId) !== conflicto) continue; // ya se resguardó por otro lado
    if (!(await conflicto.guardarCopia())) return false;
    olvidarConflicto(tabId);
  }
  return true;
}

/**
 * Guarda la copia de un conflicto sin preguntar. Si la copia normal falla
 * (`guardarCopia` ya avisó el motivo), lo escribe en un archivo aparte con
 * fecha y hora, como al cerrar la ventana: lo del usuario no se tira nunca.
 */
async function resguardar(conflicto: Conflicto): Promise<void> {
  let ok = false;
  try {
    ok = await conflicto.guardarCopia();
  } catch {
    ok = false;
  }
  if (ok) return;
  const ruta = rutaDeCopiaDeEmergencia(rutaBaseDeCopia(conflicto.notaId), new Date());
  try {
    await escribirNota(getVaultActual(), ruta, conflicto.contenido());
    avisar(`Lo tuyo de «${tituloDe(conflicto.notaId)}» quedó en «${ruta}».`);
  } catch (e) {
    console.error("[Mycelium] no se pudo guardar la copia de emergencia:", e);
    avisar(`No se pudo guardar lo tuyo de «${tituloDe(conflicto.notaId)}». Cópialo antes de seguir.`);
  }
}

/**
 * Guarda sin preguntar la copia de todos los conflictos pendientes y los da de
 * baja. Es la red de `salir()` del vault, para quien llegue sin haber
 * preguntado: después de esto las pestañas se pueden soltar.
 */
export async function resguardarConflictos(): Promise<void> {
  const pendientes = [...abiertos.entries()];
  for (const [tabId, conflicto] of pendientes) {
    if (abiertos.get(tabId) !== conflicto) continue;
    olvidarConflicto(tabId);
    await resguardar(conflicto);
  }
}

/**
 * Al cerrar la ventana no se puede preguntar ni esperar: lo de cada nota en
 * conflicto —se vea o no su pestaña— se escribe en un archivo aparte, con fecha
 * y hora, y el de la nota queda como lo dejaron afuera (`DEF-138`). Una sola
 * escritura por copia, sin pasar por el índice: el próximo indexado la
 * encuentra. La misma nota en dos paneles con el mismo texto deja una copia;
 * con textos distintos, una por texto (un segundo más en el nombre).
 *
 * Devuelve las rutas escritas (para los tests).
 */
export function escribirCopiasDeEmergencia(ahora = new Date()): string[] {
  let vault: string;
  try {
    vault = getVaultActual();
  } catch {
    return []; // sin vault abierto no hay dónde escribir
  }
  const escritas: string[] = [];
  const vistos = new Map<string, Set<string>>();
  for (const conflicto of abiertos.values()) {
    const texto = conflicto.contenido();
    const deLaNota = vistos.get(conflicto.notaId) ?? new Set<string>();
    if (deLaNota.has(texto)) continue;
    const sello = new Date(ahora.getTime() + deLaNota.size * 1000);
    deLaNota.add(texto);
    vistos.set(conflicto.notaId, deLaNota);
    const ruta = rutaDeCopiaDeEmergencia(rutaBaseDeCopia(conflicto.notaId), sello);
    escritas.push(ruta);
    void escribirNota(vault, ruta, texto).catch(() => {});
  }
  return escritas;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    if (abiertos.size > 0) escribirCopiasDeEmergencia();
  });
}
