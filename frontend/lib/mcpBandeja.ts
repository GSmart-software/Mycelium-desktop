/**
 * `mycelium_bandeja` del MCP de control (`FUN-S-40`; spec en
 * `docs/features/mcp-control.md` § «Parte 5»): leer las dos Bandejas —la del
 * vault y la personal— con sus entradas numeradas, y quitar entradas por
 * número, **por el mismo camino que la app**:
 *
 * - la del vault, con el guardado con base (`esperado`) que usa la captura
 *   rápida (`reescribirBandeja`, `lib/bandejaVault.ts`): si cambió entre la
 *   lectura y la escritura, Rust no escribe;
 * - la personal, con `bandeja_personal_guardar` y la huella de lo leído
 *   (`guardarBandejaPersonal`, `lib/bandejaPersonal.ts`): el candado de
 *   proceso y la comparación los hace Rust (`bandeja_personal.rs`).
 *
 * Quitar exige la **huella** de la lectura del agente: si la Bandeja cambió
 * desde entonces (una captura, una edición), los números ya no significan lo
 * mismo, así que contesta `CAMBIO_CONCURRENTE` sin escribir. Quitar va al
 * registro de actividad con su Deshacer. La lógica pura (numerar, quitar, los
 * textos) está en `lib/mcpBandejaLogica.ts`. Lo llama `lib/mcpControl.ts`.
 */
import type { Atendido, Objetivo } from "@/lib/actividadIa";
import { ApiError } from "@/lib/api";
import { rutaBandeja } from "@/lib/bandejaRuta";
import { guardarBandejaPersonal, leerBandejaPersonal } from "@/lib/bandejaPersonal";
import { reescribirBandeja } from "@/lib/bandejaVault";
import { huellaDeTexto } from "@/lib/conflictoExterno";
import { getVaultActual } from "@/lib/db/vaultContext";
import { DbError } from "@/lib/db/errors";
import { leerArchivoTexto } from "@/lib/db/vaultFs";
import {
  efectoQuitar,
  entradasDeBandeja,
  motivoSinDeshacerBandeja,
  nombreBandeja,
  quitarEntradas,
  type BandejaIa,
  type DeshacerBandeja,
} from "@/lib/mcpBandejaLogica";

/** Un error del contrato, para que `mcpControl.ts` lo convierta en respuesta. */
export class FalloBandeja extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

/** Cuántas entradas se pueden quitar en una llamada. */
const TOPE_QUITAR = 500;

type Leida = { bandeja: BandejaIa; ruta: string; existe: boolean; contenido: string };

async function leer(b: BandejaIa): Promise<Leida> {
  if (b === "vault") {
    const ruta = rutaBandeja();
    const texto = await leerArchivoTexto(getVaultActual(), ruta);
    return { bandeja: b, ruta, existe: texto !== null, contenido: texto ?? "" };
  }
  const r = await leerBandejaPersonal(false);
  return { bandeja: b, ruta: r.ruta, existe: r.existe, contenido: r.contenido };
}

/**
 * Escribe por el camino de la app, con `esperado` como base. `false` si el
 * archivo cambió desde `esperado` (no se escribió nada).
 */
async function escribir(b: BandejaIa, ruta: string, contenido: string, esperado: string): Promise<boolean> {
  try {
    if (b === "vault") await reescribirBandeja(ruta, contenido, esperado);
    else await guardarBandejaPersonal(contenido, esperado);
    return true;
  } catch (e) {
    if ((e instanceof ApiError || e instanceof DbError) && e.status === 409) return false;
    throw e;
  }
}

function cambioConcurrente(b: BandejaIa): FalloBandeja {
  return new FalloBandeja(
    "CAMBIO_CONCURRENTE",
    `${nombreBandeja(b)} cambió desde que la leíste (una captura, una edición): los números ya no son los mismos. ` +
      "No se quitó nada: vuelve a leerla y elige de nuevo.",
  );
}

function objetivoDe(b: BandejaIa, ruta: string): Objetivo {
  return b === "vault" ? { tipo: "nota", ruta } : { tipo: "bandeja_personal" };
}

/** `mycelium_bandeja({accion, bandeja?, huella?, entradas?})`. */
export async function bandeja(args: Record<string, unknown>): Promise<Atendido> {
  const accion = args.accion ?? "leer";
  if (accion !== "leer" && accion !== "quitar") {
    throw new FalloBandeja("INVALIDO", "`accion` es «leer» o «quitar».");
  }
  const b = args.bandeja;
  if (b !== undefined && b !== null && b !== "vault" && b !== "personal") {
    throw new FalloBandeja("INVALIDO", "`bandeja` es «vault» o «personal».");
  }
  return accion === "leer" ? leerBandejas(b ?? null) : quitar(b ?? null, args);
}

async function leerBandejas(b: BandejaIa | null): Promise<Atendido> {
  const cuales: BandejaIa[] = b ? [b] : ["vault", "personal"];
  const bandejas = [];
  for (const c of cuales) {
    const l = await leer(c);
    bandejas.push({
      bandeja: c,
      ruta: l.ruta,
      existe: l.existe,
      huella: l.existe ? await huellaDeTexto(l.contenido) : null,
      entradas: entradasDeBandeja(l.contenido).map(({ numero, dia, hora, texto, tarea, debajo }) => ({
        numero,
        dia,
        hora,
        texto,
        tarea,
        debajo,
      })),
    });
  }
  // Leer no cambia nada: no se anota (como leer el calendario).
  return { resultado: { accion: "leer", bandejas }, sinRegistro: true };
}

async function quitar(b: BandejaIa | null, args: Record<string, unknown>): Promise<Atendido> {
  if (b === null) throw new FalloBandeja("INVALIDO", "Para quitar, `bandeja` es obligatoria: «vault» o «personal».");
  const huella = typeof args.huella === "string" ? args.huella.trim().toLowerCase() : "";
  if (huella === "") {
    throw new FalloBandeja("INVALIDO", "Falta `huella`: la que dio la lectura (mycelium_bandeja con accion «leer»).");
  }
  const numeros = args.entradas;
  if (
    !Array.isArray(numeros) ||
    numeros.length === 0 ||
    numeros.length > TOPE_QUITAR ||
    !numeros.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1)
  ) {
    throw new FalloBandeja("INVALIDO", `\`entradas\` es una lista de números de entrada (desde 1, hasta ${TOPE_QUITAR} por llamada).`);
  }
  const l = await leer(b);
  if (!l.existe) {
    throw new FalloBandeja("NO_ENCONTRADO", `${nombreBandeja(b)} no existe todavía (${l.ruta}): no hay nada que quitar.`);
  }
  if ((await huellaDeTexto(l.contenido)) !== huella) throw cambioConcurrente(b);
  const r = quitarEntradas(l.contenido, numeros as number[]);
  if (!r.ok) {
    throw new FalloBandeja(
      "INVALIDO",
      `${r.fuera.length === 1 ? "La entrada" : "Las entradas"} ${r.fuera.join(", ")} no ${r.fuera.length === 1 ? "existe" : "existen"}: ` +
        `${nombreBandeja(b)} tiene ${r.total}. No se quitó nada.`,
    );
  }
  if (!(await escribir(b, l.ruta, r.contenido, l.contenido))) throw cambioConcurrente(b);
  const huellaNueva = await huellaDeTexto(r.contenido);
  const efecto = efectoQuitar(b, r.quitadas, r.diasQuitados);
  const deshacer: DeshacerBandeja = {
    tipo: "bandeja_reponer",
    bandeja: b,
    ruta: l.ruta,
    antes: l.contenido,
    huella: huellaNueva,
    cuantas: r.quitadas.length,
  };
  return {
    resultado: {
      accion: "quitar",
      bandeja: b,
      ruta: l.ruta,
      efecto,
      huella: huellaNueva,
      quedan: entradasDeBandeja(r.contenido).length,
    },
    actividad: { efecto, objetivo: objetivoDe(b, l.ruta), deshacer },
  };
}

/**
 * Deshace un `quitar`: repone el contenido de antes, por el mismo camino, si la
 * Bandeja sigue exactamente como la dejó la IA. Devuelve el texto del aviso.
 */
export async function deshacerBandeja(d: DeshacerBandeja): Promise<string> {
  const actual = d.bandeja === "vault"
    ? await leerArchivoTexto(getVaultActual(), d.ruta)
    : await leerBandejaPersonal(false).then((r) => (r.existe ? r.contenido : null));
  const motivo = motivoSinDeshacerBandeja(d, actual === null ? null : await huellaDeTexto(actual));
  if (motivo) throw new Error(motivo);
  if (!(await escribir(d.bandeja, d.ruta, d.antes, actual!))) {
    throw new Error(`${nombreBandeja(d.bandeja)} cambió mientras se reponía: no se tocó nada.`);
  }
  return `Volví a poner ${d.cuantas === 1 ? "la entrada quitada" : `las ${d.cuantas} entradas quitadas`} en ${nombreBandeja(d.bandeja)}.`;
}
