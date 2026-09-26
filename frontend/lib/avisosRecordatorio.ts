/**
 * El programador de avisos de los recordatorios (`FUN-L-22`, § 5.1 de la spec)
 * y la notificación del sistema (§ 5.2).
 *
 * **Cuándo revisa.** Una vez por minuto, alineado al cambio de minuto —un
 * recordatorio «a las 10:00» avisa a las 10:00 y no a las 10:00:59—, y además:
 *
 *   - al volver de la suspensión del equipo. Con el equipo dormido los
 *     temporizadores no corren; al despertar, el tic siguiente llega con un
 *     salto grande y ese salto es la señal. También se revisa al volver la
 *     ventana a primer plano, que suele ser lo primero que pasa al despertar;
 *   - a medianoche no hace falta nada especial: es un minuto más, y ahí vencen
 *     los de «todo el día».
 *
 * No se busca más precisión: nadie espera un recordatorio al segundo.
 *
 * El módulo no conoce el store (lo recibe como función): así no hay ciclo entre
 * `recordatoriosStore` y el programador.
 */
import { primerRenglon, type Aviso } from "@/lib/recordatorios";

const MINUTO_MS = 60_000;
/** Un tic que llega con más atraso que esto es que el equipo estuvo suspendido. */
const SALTO_SUSPENSION_MS = 2 * MINUTO_MS;

let temporizador: ReturnType<typeof setTimeout> | null = null;
let ultimoTic = 0;
let revisarActual: (() => void) | null = null;

function programarSiguiente() {
  const ahora = Date.now();
  // Hasta el próximo cambio de minuto, con un respiro para caer ya adentro.
  const espera = MINUTO_MS - (ahora % MINUTO_MS) + 250;
  temporizador = setTimeout(tic, espera);
}

function tic() {
  const ahora = Date.now();
  const salto = ahora - ultimoTic;
  ultimoTic = ahora;
  if (salto > SALTO_SUSPENSION_MS) {
    console.info("[Mycelium] recordatorios · se revisa tras una pausa (¿suspensión?)");
  }
  revisarActual?.();
  programarSiguiente();
}

function alVolver() {
  if (document.visibilityState === "visible") revisarActual?.();
}

/** Arranca el programador. Idempotente: si ya corría, lo reemplaza. */
export function iniciarProgramador(revisar: () => void): void {
  detenerProgramador();
  revisarActual = revisar;
  ultimoTic = Date.now();
  programarSiguiente();
  document.addEventListener("visibilitychange", alVolver);
  window.addEventListener("focus", alVolver);
}

/** Lo detiene al salir del vault: los avisos de un vault cerrado no suenan. */
export function detenerProgramador(): void {
  if (temporizador !== null) clearTimeout(temporizador);
  temporizador = null;
  revisarActual = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", alVolver);
    window.removeEventListener("focus", alVolver);
  }
}

// ── Notificación del sistema ───────────────────────────────────────────────

/**
 * Qué avisos ya se notificaron en esta sesión: la clave de la ocurrencia y el
 * momento (uno pospuesto vuelve a notificar al llegar su nueva hora). Sin esto,
 * una tarjeta abierta mandaría una notificación por minuto.
 */
const notificados = new Set<string>();

export function olvidarNotificados(): void {
  notificados.clear();
}

/** Si la ventana se está viendo: al frente y sin minimizar. */
async function ventanaALaVista(): Promise<boolean> {
  if (document.visibilityState !== "visible") return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const v = getCurrentWindow();
    const [enfocada, minimizada] = await Promise.all([v.isFocused(), v.isMinimized()]);
    return enfocada && !minimizada;
  } catch {
    // Fuera de Tauri (o sin permiso): nos quedamos con lo que dice el documento.
    return document.hasFocus();
  }
}

/**
 * Manda la notificación de Windows de los avisos nuevos, **solo** si la ventana
 * no se ve —minimizada, sin foco o tapada—. Con la ventana al frente la tarjeta
 * ya está a la vista y la notificación sería un duplicado. Hacerle clic trae la
 * ventana (lo resuelve `recordatorios.rs`).
 */
export function notificarNuevos(avisos: Aviso[]): void {
  const nuevos = avisos.filter((a) => !notificados.has(`${a.clave}|${a.momento.getTime()}`));
  if (nuevos.length === 0) return;
  for (const a of nuevos) notificados.add(`${a.clave}|${a.momento.getTime()}`);
  void (async () => {
    if (await ventanaALaVista()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const a of nuevos) {
        await invoke("notificar_recordatorio", {
          titulo: a.recordatorio.titulo,
          cuerpo: primerRenglon(a.recordatorio.detalle),
        });
      }
    } catch (e) {
      // La tarjeta ya está en la ventana: se verá al volver. Solo queda constancia.
      console.error("[Mycelium] recordatorios · no se pudo mandar la notificación", e);
    }
  })();
}
