/**
 * La salud del vault por el MCP de control (`FUN-L-30`): `mycelium_salud` y
 * `mycelium_validar_nota`. Solo desktop y de solo lectura: el mismo informe que
 * el panel de salud (`lib/saludVault.ts`), recortado para el agente.
 *
 * `mycelium_validar_nota` es el **chequeo de cierre** de una nota que el agente
 * acaba de escribir: título único, enlaces que resuelven, alguien la enlaza, y
 * lo que se registre con `registrarValidadorNota` (`lib/salud.ts`) —ahí se
 * enchufan las propiedades válidas de los esquemas de `FUN-M-46`—.
 */
import type { Atendido } from "@/lib/actividadIa";
import { contenidosDe, filasHacia } from "@/lib/db/indiceIa";
import { carpetaEsporas } from "@/lib/esporasVault";
import { FalloIndice, notaDelIndice } from "@/lib/mcpIndice";
import { normalizarObjetivo } from "@/lib/mcpControlLogica";
import {
  chequeosBasicos,
  informeParaIa,
  validadoresNota,
  type Alcance,
  type Chequeo,
} from "@/lib/salud";
import { informeDeSalud } from "@/lib/saludVault";
import { useVaultStore } from "@/stores/vaultStore";

function soloClaves(args: Record<string, unknown>, conocidas: string[]): void {
  for (const k of Object.keys(args)) {
    if (!conocidas.includes(k)) {
      throw new FalloIndice("INVALIDO", `\`${k}\`: no es un campo de esta herramienta (son: ${conocidas.join(", ")}).`, { campo: k });
    }
  }
}

function textoOpcional(args: Record<string, unknown>, campo: string): string {
  const v = args[campo];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new FalloIndice("INVALIDO", `\`${campo}\`: es un texto.`, { campo });
  return v.trim();
}

/**
 * El alcance que pidió el agente: vacío es el vault; una carpeta por su ruta
 * (con `/` al final para forzarla); una nota por ruta o título. Una carpeta y
 * una nota que responden igual son `AMBIGUO`, como en `mycelium_renombrar`.
 */
export function resolverAlcance(pedido: string): Alcance {
  const o = normalizarObjetivo(pedido);
  if (o === "") return { tipo: "vault" };
  const { carpetas } = useVaultStore.getState();
  const forzada = o.endsWith("/");
  const ruta = o.replace(/\/+$/, "");
  const carpeta = carpetas.find((c) => c.id === ruta) ?? carpetas.find((c) => c.id.toLowerCase() === ruta.toLowerCase());
  if (forzada) {
    if (carpeta) return { tipo: "carpeta", ruta: carpeta.id };
    const parecidas = carpetas
      .filter((c) => c.id.toLowerCase().includes(ruta.toLowerCase().split("/").pop() ?? ""))
      .slice(0, 5)
      .map((c) => ({ titulo: c.nombre, ruta: `${c.id}/` }));
    throw new FalloIndice("NO_ENCONTRADO", `No hay ninguna carpeta «${ruta}» en el vault.`, { candidatas: parecidas });
  }
  let nota: string | null = null;
  try {
    nota = notaDelIndice(o).id;
  } catch (e) {
    if (!carpeta || !(e instanceof FalloIndice) || e.codigo !== "NO_ENCONTRADO") throw e;
  }
  if (nota !== null && carpeta) {
    throw new FalloIndice("AMBIGUO", `«${o}» es una carpeta y también una nota.`, { rutas: [`${carpeta.id}/`, nota] });
  }
  return nota !== null ? { tipo: "nota", ruta: nota } : { tipo: "carpeta", ruta: carpeta!.id };
}

// ── mycelium_salud ──────────────────────────────────────────────────────────

export async function salud(args: Record<string, unknown>): Promise<Atendido> {
  soloClaves(args, ["alcance"]);
  const alcance = resolverAlcance(textoOpcional(args, "alcance"));
  const informe = await informeDeSalud(alcance);
  return { resultado: informeParaIa(informe), sinRegistro: true };
}

// ── mycelium_validar_nota ───────────────────────────────────────────────────

export async function validarNota(args: Record<string, unknown>): Promise<Atendido> {
  soloClaves(args, ["ruta"]);
  const pedido = textoOpcional(args, "ruta");
  if (pedido === "") throw new FalloIndice("INVALIDO", "`ruta`: es un texto no vacío.", { campo: "ruta" });
  const nota = notaDelIndice(pedido);
  const [informe, entrantes, contenidos] = await Promise.all([
    informeDeSalud({ tipo: "nota", ruta: nota.id }),
    filasHacia(nota.id),
    contenidosDe([nota.id]),
  ]);
  const backlinks = [...new Set(entrantes.map((f) => f.desde))];
  const contexto = { nota, informe, backlinks, contenido: contenidos.get(nota.id) ?? "" };
  const chequeos: Chequeo[] = chequeosBasicos(contexto, carpetaEsporas());
  for (const v of validadoresNota()) {
    try {
      chequeos.push(...(await v(contexto)));
    } catch (e) {
      // Un validador que falla no tapa a los demás: se informa como chequeo.
      chequeos.push({ id: "validador", ok: false, titulo: "Un validador falló", detalle: [String((e as Error)?.message ?? e)] });
    }
  }
  return {
    resultado: {
      nota: { ruta: nota.id, titulo: nota.titulo, tipo: nota.tipo },
      ok: chequeos.every((c) => c.ok),
      chequeos,
    },
    sinRegistro: true,
  };
}
