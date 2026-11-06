/**
 * La Bandeja personal sobre el disco (`FUN-L-33`, Parte B): un archivo fuera
 * de todo vault, en la carpeta de datos de la app, el mismo desde todos los
 * vaults y ventanas. No se indexa: no entra en la búsqueda, los enlaces, el
 * grafo ni la IA del vault.
 *
 * Se habla con él solo por dos comandos de Rust acotados a ESE archivo
 * (`src-tauri/src/bandeja_personal.rs`), que no reciben rutas: leer y guardar
 * con la huella de la base. **Anotar** es leer, agregar la entrada al final con
 * `agregarEntrada` (`lib/bandeja.ts`: el mismo formato que la Bandeja del
 * vault, una sola fuente) y guardar con la huella de lo leído; si otra ventana
 * escribió en el medio, Rust no escribe (conflicto) y se reintenta sobre lo
 * nuevo. Rust compara y escribe dentro de un candado de proceso, así que dos
 * ventanas anotando a la vez no se pisan.
 *
 * Después de cada escritura Rust avisa a todas las ventanas
 * (`bandeja-personal-cambiada`); cada una lo reparte con `escucharBandejaPersonal`
 * como un cambio externo de la pestaña (`avisarRecarga`) y como un apunte nuevo
 * para el contador del explorador (`EVENTO_BANDEJA`).
 */
import { agregarEntrada, type Captura } from "@/lib/bandeja";
import { huellaDeTexto } from "@/lib/conflictoExterno";
import { DbError } from "@/lib/db/errors";
import { EVENTO_BANDEJA, avisarRecarga } from "@/lib/eventos";
import { BANDEJA_PERSONAL_ID } from "@/lib/pestanas";

/** Cuántas veces se reintenta anotar si el archivo cambia entre leer y escribir. */
const REINTENTOS = 5;

/** El evento de Rust cuando la app escribió la Bandeja personal (cualquier ventana). */
const EVENTO_RUST = "bandeja-personal-cambiada";

/** El mensaje del 409, como el del guardado de una nota (`DEF-138`). */
const MENSAJE_CAMBIO = "La Bandeja personal cambió desde otra ventana o fuera de Mycelium.";

export type Leida = { contenido: string; existe: boolean; ruta: string };
type Guardada = { conflicto: boolean; huella: string | null };

async function invocar<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Lee la Bandeja personal. Sin el archivo, contenido vacío y `existe: false`;
 * con `crear`, se crea vacío (al abrirla como nota: «si se borró por fuera, se
 * recrea al abrirla»).
 */
export async function leerBandejaPersonal(crear = false): Promise<Leida> {
  return invocar<Leida>("bandeja_personal_leer", { crear });
}

/**
 * Guarda el contenido entero. `esperado` es lo que quien guarda leyó: si el
 * archivo ya no lo tiene, no se escribe y se lanza un 409 (`DbError`), como el
 * guardado de una nota. `undefined` o `null`: se escribe igual (la decisión
 * explícita «Quedarme con lo mío», o una carga que falló).
 */
export async function guardarBandejaPersonal(contenido: string, esperado?: string | null): Promise<void> {
  const huellaEsperada = esperado === undefined || esperado === null ? null : await huellaDeTexto(esperado);
  const r = await invocar<Guardada>("bandeja_personal_guardar", { contenido, huellaEsperada });
  if (r.conflicto) throw new DbError(409, MENSAJE_CAMBIO);
}

/** Las capturas, de a una en esta ventana: dos Enter seguidos no leen la misma versión. */
let cola: Promise<unknown> = Promise.resolve();

/** Anota `captura` al final de la Bandeja personal, bajo el encabezado del día. */
export function anotarEnBandejaPersonal(captura: Captura, ahora = new Date()): Promise<void> {
  const turno = cola.then(() => anotar(captura, ahora));
  cola = turno.catch(() => undefined);
  return turno;
}

async function anotar(captura: Captura, ahora: Date): Promise<void> {
  for (let intento = 0; intento < REINTENTOS; intento++) {
    const previo = (await leerBandejaPersonal()).contenido;
    try {
      // Con la base leída: si el archivo no existía, la base es el vacío, y
      // Rust lo crea (un archivo que no está siempre se puede escribir).
      await guardarBandejaPersonal(agregarEntrada(previo, captura, ahora), previo);
      return;
    } catch (e) {
      if (e instanceof DbError && e.status === 409) continue;
      throw e;
    }
  }
  throw new Error("La Bandeja personal cambiaba mientras se anotaba. Vuelve a intentarlo.");
}

/**
 * Escucha los cambios de la Bandeja personal hechos desde **cualquier**
 * ventana (también esta) y los reparte como lo que son para esta ventana: un
 * cambio externo del archivo para su pestaña (`avisarRecarga` con su id: sin
 * cambios propios se recarga; con cambios, barra de conflicto) y un apunte
 * nuevo para el contador del explorador. Devuelve con qué dejar de escuchar.
 */
export async function escucharBandejaPersonal(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(EVENTO_RUST, () => {
    avisarRecarga([BANDEJA_PERSONAL_ID]);
    window.dispatchEvent(new CustomEvent(EVENTO_BANDEJA, { detail: { ruta: BANDEJA_PERSONAL_ID } }));
  });
}
