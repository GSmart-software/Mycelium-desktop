/**
 * La revisión del vault para el dashboard de salud (`FUN-L-32`): **una sola**
 * pasada que arma el informe de salud de `FUN-L-30` y las estadísticas nuevas
 * (`lib/estadisticas.ts`) con los mismos datos. La alimentan el panel, la
 * pestaña y el informe como nota. Solo desktop.
 *
 * > [!warning] Solo cuando se pide
 * > Se llama al abrir el panel o la pestaña y con «Volver a revisar». Nunca al
 * > guardar ni de fondo: el costo de la app estaba en el reparto por evento
 * > (`Auditoria de eficiencia 2026-11-01`). Nada acá se suscribe a nada.
 *
 * Costo de una revisión:
 * - un recorrido del disco (`recorrer_vault`, el mismo del indexador, en un
 *   hilo de Rust: no traba la ventana), que trae notas y otros archivos con su
 *   tamaño y ya sin lo que ignora `.mycignore`;
 * - las lecturas del informe (`datosDelIndice`: notas, alias, carpetas y filas
 *   de `enlaces`, sin contenido; más las de líneas y propiedades, como siempre);
 * - dos sentencias más: `fechasDeCreacion` y `etiquetasDelIndice` (agregada
 *   en SQLite). Las conexiones salen de las filas que ya leyó el informe.
 */
import { invoke } from "@tauri-apps/api/core";
import { etiquetasDelIndice, fechasDeCreacion } from "@/lib/db/indiceIa";
import { getVaultActual } from "@/lib/db/vaultContext";
import { carpetaEsporas } from "@/lib/esporasVault";
import {
  calcularEstadisticas,
  TOPE_ETIQUETAS,
  type ArchivoDelVault,
  type EstadisticasVault,
} from "@/lib/estadisticas";
import { excluida, type InformeSalud } from "@/lib/salud";
import { datosDelIndice, informeConDatos } from "@/lib/saludVault";

/** Lo que devuelve `recorrer_vault` y usa la revisión (ver `RecorridoVault` en `archivos.rs`). */
type RecorridoConTamanos = {
  archivosMeta: { rutaRelativa: string; bytes?: number }[];
  otros: { rutaRelativa: string; bytes?: number }[];
};

export type RevisionVault = {
  informe: InformeSalud;
  estadisticas: EstadisticasVault;
  /** Cuándo terminó la revisión (ISO). */
  revisadoEn: string;
  /** Cuánto tardó, en ms. */
  duracionMs: number;
};

/** Notas y otros archivos del recorrido, en una lista. */
export function archivosDelRecorrido(r: RecorridoConTamanos): ArchivoDelVault[] {
  const out: ArchivoDelVault[] = [];
  for (const a of r.archivosMeta) out.push({ ruta: a.rutaRelativa, bytes: a.bytes ?? 0 });
  for (const a of r.otros) out.push({ ruta: a.rutaRelativa, bytes: a.bytes ?? 0 });
  return out;
}

/** Revisa el vault abierto: informe de salud + estadísticas, de una vez. */
export async function revisarVault(): Promise<RevisionVault> {
  const inicio = performance.now();
  const esporas = carpetaEsporas();
  const [datos, recorrido, creacion] = await Promise.all([
    datosDelIndice(),
    invoke<RecorridoConTamanos>("recorrer_vault", { origen: getVaultActual() }),
    fechasDeCreacion(),
  ]);
  const fuera = (n: { id: string; carpetaId: string | null }) => excluida(n, esporas);
  const excluidas = datos.notas.filter(fuera).map((n) => n.id);
  const [informe, etiquetas] = await Promise.all([
    informeConDatos(datos),
    etiquetasDelIndice(excluidas, TOPE_ETIQUETAS),
  ]);
  const estadisticas = calcularEstadisticas({
    archivos: archivosDelRecorrido(recorrido),
    notas: datos.notas,
    filas: datos.filas,
    excluida: fuera,
    creacion,
    etiquetas,
    ahora: new Date(),
  });
  return {
    informe,
    estadisticas,
    revisadoEn: new Date().toISOString(),
    duracionMs: Math.round(performance.now() - inicio),
  };
}
