/**
 * `mycelium_diccionario` del MCP de control (`FUN-L-09`, Parte 4), atendido
 * con **el mismo camino que la UI**: `cambiarPalabrasDe("vault", …)` del
 * corrector (`lib/ortografia/corrector.ts`), que relee el archivo, lo escribe
 * con el formato de siempre por la cola de escrituras y avisa al worker y a los
 * editores abiertos —las palabras agregadas dejan de subrayarse sin recargar,
 * como con «Agregar al diccionario del vault» del clic derecho—, y a la lista
 * de Configuración.
 *
 * Solo el diccionario **del vault** (`.mycelium/diccionario.txt`). La
 * validación, los textos y el deshacer son puros y están en
 * `lib/mcpDiccionarioLogica.ts`. Lo llama `lib/mcpControl.ts`.
 */
import type { Atendido } from "@/lib/actividadIa";
import {
  aplicarDeshacer,
  efectoAgregar,
  efectoQuitar,
  listado,
  puedeDeshacerDiccionario,
  separarAceptadas,
  separarParaQuitar,
  textoAgregar,
  textoDeshacer,
  textoQuitar,
  validarDiccionario,
  type DeshacerDiccionario,
} from "@/lib/mcpDiccionarioLogica";
import { mismaRuta } from "@/lib/mcpControlLogica";
import { cambiarPalabrasDe, cargandoPersonales, palabrasDe } from "@/lib/ortografia/corrector";
import { vaultActual } from "@/lib/ortografia/diccionarios";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";

/** Un error del contrato, para que `mcpControl.ts` lo convierta en respuesta. */
export class FalloDiccionario extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

/**
 * El corrector de esta ventana apunta al vault de la ventana y no está leyendo
 * sus diccionarios personales. Si lo estuviera, lo que se escribiera podría
 * quedar debajo de lo que esa lectura trae: `OCUPADA`, y la IA repite.
 */
function comprobarListo(): void {
  const vault = vaultActual();
  const propio = useVaultSessionStore.getState().rutaActual;
  if (vault === null || propio === null || !mismaRuta(vault, propio)) {
    throw new FalloDiccionario("OCUPADA", "Mycelium todavía está cargando el vault.", {
      etapa: "cargando el vault",
      reintentar_en_ms: 1000,
    });
  }
  if (cargandoPersonales()) {
    throw new FalloDiccionario("OCUPADA", "El corrector está cargando los diccionarios personales.", {
      etapa: "cargando el diccionario del vault",
      reintentar_en_ms: 500,
    });
  }
}

function errorDeArchivo(e: unknown): FalloDiccionario {
  return new FalloDiccionario(
    "INVALIDO",
    `No se pudo leer o escribir .mycelium/diccionario.txt: ${e instanceof Error ? e.message : String(e)}. ` +
      "No se cambió nada; decíselo al usuario.",
    { campo: "diccionario.txt" },
  );
}

export async function diccionario(args: Record<string, unknown>): Promise<Atendido> {
  const v = validarDiccionario(args);
  if (!v.ok) throw new FalloDiccionario(v.error.codigo, v.error.mensaje, v.error.datos);
  comprobarListo();
  const pedido = v.valor;

  if (pedido.accion === "listar") {
    let palabras: string[];
    try {
      palabras = await palabrasDe("vault");
    } catch (e) {
      throw errorDeArchivo(e);
    }
    // Listar no cambia nada: no va al registro (sus fallos sí).
    return { resultado: listado(palabras), sinRegistro: true };
  }

  if (pedido.accion === "agregar") {
    const { aceptadas, rechazadas } = separarAceptadas(pedido.palabras);
    let antes: string[] = [];
    let despues: string[] = [];
    if (aceptadas.length) {
      try {
        ({ antes, despues } = await cambiarPalabrasDe("vault", (actuales) => [...actuales, ...aceptadas]));
      } catch (e) {
        throw errorDeArchivo(e);
      }
    } else {
      despues = antes = await palabrasDe("vault").catch((e) => {
      throw errorDeArchivo(e);
    });
    }
    const e = efectoAgregar(aceptadas, rechazadas, antes, despues);
    const efecto = textoAgregar(e);
    return {
      resultado: { efecto, ...e },
      actividad: {
        efecto,
        ...(e.agregadas.length ? { deshacer: { tipo: "diccionario_quitar", palabras: e.agregadas } as const } : {}),
      },
    };
  }

  const { aceptadas, rechazadas } = separarParaQuitar(pedido.palabras);
  let antes: string[] = [];
  let despues: string[] = [];
  if (aceptadas.length) {
    const fuera = new Set(aceptadas);
    try {
      ({ antes, despues } = await cambiarPalabrasDe("vault", (actuales) => actuales.filter((p) => !fuera.has(p))));
    } catch (e) {
      throw errorDeArchivo(e);
    }
  } else {
    despues = antes = await palabrasDe("vault").catch((e) => {
      throw errorDeArchivo(e);
    });
  }
  const e = efectoQuitar(aceptadas, rechazadas, antes, despues);
  const efecto = textoQuitar(e);
  return {
    resultado: { efecto, ...e },
    actividad: {
      efecto,
      ...(e.quitadas.length ? { deshacer: { tipo: "diccionario_agregar", palabras: e.quitadas } as const } : {}),
    },
  };
}

// ── Deshacer, desde el registro ─────────────────────────────────────────────

/**
 * Deshace un agregar o un quitar. La comprobación de «cambió después» se hace
 * **dentro de la escritura**, contra el archivo de ese momento: si no se puede,
 * lanza y no se escribe nada.
 */
export async function deshacerDiccionario(d: DeshacerDiccionario): Promise<string> {
  comprobarListo();
  await cambiarPalabrasDe("vault", (actuales) => {
    const posible = puedeDeshacerDiccionario(new Set(actuales), d);
    if (!posible.ok) throw new FalloDiccionario("NO_ENCONTRADO", `No se puede deshacer: ${posible.porque}.`);
    return aplicarDeshacer(actuales, d);
  });
  return textoDeshacer(d);
}
