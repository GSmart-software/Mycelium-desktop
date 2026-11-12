/**
 * La Bandeja del vault sobre el disco (`FUN-L-33`): crearla si falta, anotar al
 * final y leer su contenido para el contador. La lógica pura (formato, conteo,
 * ruta) está en `lib/bandeja.ts`; la ruta configurada, en `lib/bandejaRuta.ts`.
 *
 * > [!important] Anotar no pasa por el editor
 * > Se lee el archivo, se le agrega la entrada al final y se guarda con la
 * > huella de lo leído (`PUT /notas/{id}/contenido` con `esperado`, el mismo
 * > guardado con base del editor, `DEF-138`): si alguien lo cambió entre la
 * > lectura y la escritura —el editor autoguardando, otra ventana, la IA—, Rust
 * > no escribe y se reintenta sobre lo nuevo. Nada de lo que había se pisa.
 * >
 * > Después se avisa como un **cambio externo** (`avisarRecarga` con la ruta):
 * > una pestaña de la Bandeja sin cambios se recarga sola, y una con cambios
 * > sin guardar entra en la barra de conflicto de `DEF-138`/`DEF-177`, donde el
 * > usuario elige. Su próximo autoguardado tampoco pisaría la entrada: va con
 * > su base vieja y Rust lo rechaza.
 */
import { api, ApiError } from "@/lib/api";
import { agregarEntrada, contarEntradas, type Captura } from "@/lib/bandeja";
import { rutaBandeja } from "@/lib/bandejaRuta";
import { huellaDeTexto } from "@/lib/conflictoExterno";
import { getVaultActual } from "@/lib/db/vaultContext";
import { guardarNota, leerArchivoTexto } from "@/lib/db/vaultFs";
import { asegurarCarpeta } from "@/lib/esporasVault";
import { EVENTO_BANDEJA, avisarRecarga } from "@/lib/eventos";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Cuántas veces se reintenta anotar si el archivo cambia entre leer y escribir. */
const REINTENTOS = 5;

const token = () => useAuthStore.getState().accessToken;

/**
 * Que exista la Bandeja: en disco y en el índice. Si el archivo falta (nunca se
 * anotó, o se borró por fuera), se crea vacío. Devuelve su ruta.
 *
 * La creación va con la huella del texto vacío: Rust escribe si el archivo no
 * existe, y si apareció entre medio con contenido, no lo pisa (conflicto, que
 * acá no importa: ya existe).
 */
export async function asegurarBandeja(): Promise<string> {
  const ruta = rutaBandeja();
  const vault = getVaultActual();
  let creada = false;
  if ((await leerArchivoTexto(vault, ruta)) === null) {
    const barra = ruta.lastIndexOf("/");
    // La carpeta, por el store: así entra al árbol (y al índice) como cualquier
    // otra, en vez de aparecer recién con el próximo recorrido del disco.
    if (barra > 0) await asegurarCarpeta(ruta.slice(0, barra));
    await guardarNota(vault, ruta, "", await huellaDeTexto(""));
    creada = true;
  }
  const vs = useVaultStore.getState();
  if (creada || !vs.notas.some((n) => n.id === ruta)) {
    const { indexarNotaADemanda } = await import("@/lib/db/indexer");
    await indexarNotaADemanda(vault, ruta, "markdown");
    if (vs.vaultId) await vs.loadTree(vs.vaultId);
    if (creada) useGraphStore.getState().markStale();
  }
  return ruta;
}

/** Las capturas, de a una: dos Enter seguidos no leen la misma versión. */
let cola: Promise<unknown> = Promise.resolve();

/**
 * Anota `captura` al final de la Bandeja del vault, bajo el encabezado del día.
 * Crea la Bandeja si falta. Devuelve la ruta donde anotó.
 */
export function anotarEnBandeja(captura: Captura, ahora = new Date()): Promise<string> {
  const turno = cola.then(() => anotar(captura, ahora));
  cola = turno.catch(() => undefined);
  return turno;
}

async function anotar(captura: Captura, ahora: Date): Promise<string> {
  const ruta = await asegurarBandeja();
  const vault = getVaultActual();
  for (let intento = 0; intento < REINTENTOS; intento++) {
    const previo = (await leerArchivoTexto(vault, ruta)) ?? "";
    const nuevo = agregarEntrada(previo, captura, ahora);
    try {
      await reescribirBandeja(ruta, nuevo, previo);
    } catch (e) {
      // 409: el archivo cambió entre la lectura y la escritura. Se vuelve a
      // leer y a agregar sobre lo nuevo.
      if (e instanceof ApiError && e.status === 409) continue;
      throw e;
    }
    return ruta;
  }
  throw new Error("La Bandeja cambiaba mientras se anotaba. Vuelve a intentarlo.");
}

/**
 * Escribe la Bandeja del vault entera con la base `esperado` (lo que se leyó):
 * si el archivo ya no la tiene, Rust no escribe y lanza un 409 (`ApiError`).
 * Después avisa como un cambio externo y al contador del explorador. Lo usan
 * la captura y `mycelium_bandeja` (`FUN-S-40`, `lib/mcpBandeja.ts`).
 */
export async function reescribirBandeja(ruta: string, contenido: string, esperado: string): Promise<void> {
  await api(`/notas/${encodeURIComponent(ruta)}/contenido`, {
    method: "PUT",
    token: token(),
    body: { contenido, esperado },
  });
  avisarRecarga([ruta]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENTO_BANDEJA, { detail: { ruta } }));
  }
}

/** Cuántas entradas sin procesar tiene la Bandeja; 0 si todavía no existe. */
export async function entradasDeBandeja(): Promise<number> {
  const texto = await leerArchivoTexto(getVaultActual(), rutaBandeja());
  return texto === null ? 0 : contarEntradas(texto);
}
