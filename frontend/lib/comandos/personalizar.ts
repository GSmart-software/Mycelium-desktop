/**
 * Los atajos personalizados (`FUN-XL-04`, Parte 3): lo que el usuario cambió
 * en Configuración → Atajos de teclado, como **sobreescrituras** sobre los
 * atajos de fábrica de cada comando. Lógica pura, sin React ni stores, para que
 * la pruebe `scripts/test-atajos.mjs`; dónde se guardan lo resuelve
 * `preferenciasAtajos.ts`.
 *
 * Una sobreescritura es `id del comando → Atajo[] | null`:
 * - un id que no está usa los atajos de fábrica;
 * - `null` (o una lista vacía) lo deja **sin atajo**;
 * - una lista reemplaza a los de fábrica.
 *
 * **Un comando nuevo** (de una versión futura) toma su atajo de fábrica, salvo
 * que esa tecla ya la tenga otro comando por decisión del usuario: ahí queda
 * sin esa tecla —lo personalizado gana— y la sección lo avisa (`desplazados`).
 *
 * Los comandos con **manejador propio** (F1, F12, la captura rápida) no se
 * personalizan: su tecla la escucha su propio componente, no el despachador.
 */
import {
  atajoLimpio,
  atajoValido,
  mismoAtajo,
  problemaDeAtajo,
  reservaQueChoca,
  textoAtajo,
  type Atajo,
} from "./atajos";

export type Sobreescrituras = Readonly<Record<string, readonly Atajo[] | null>>;

/** Lo mínimo de un comando que hace falta acá (el `Comando` del registro lo cumple). */
export type ComandoConAtajos = {
  id: string;
  atajos?: readonly Atajo[];
  manejadorPropio?: boolean;
};

/** ¿Se puede cambiar el atajo de este comando? */
export const esPersonalizable = (c: ComandoConAtajos) => !c.manejadorPropio;

/** Lo que venga de `localStorage` → sobreescrituras válidas (lo inválido se descarta). */
export function normalizarSobreescrituras(crudo: unknown): Sobreescrituras {
  if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) return {};
  const salida: Record<string, Atajo[] | null> = {};
  for (const [id, valor] of Object.entries(crudo as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id)) continue;
    if (valor === null) {
      salida[id] = null;
      continue;
    }
    if (!Array.isArray(valor)) continue;
    const lista: Atajo[] = [];
    for (const a of valor) {
      const valido = atajoValido(a);
      // Lo que no se podría asignar desde Configuración tampoco entra por el archivo.
      if (!valido || problemaDeAtajo(valido) || reservaQueChoca(valido, id)) continue;
      if (!lista.some((b) => mismoAtajo(b, valido))) lista.push(valido);
    }
    salida[id] = lista.length ? lista : null;
  }
  return salida;
}

/** Un atajo de fábrica que se quedó sin tecla porque el usuario se la dio a otro comando. */
export type Desplazado = { id: string; atajo: Atajo; por: string };

export type Efectivos = {
  /** Los atajos que valen hoy, por id. */
  porId: ReadonlyMap<string, readonly Atajo[]>;
  desplazados: readonly Desplazado[];
};

/** Los atajos que valen hoy para cada comando: fábrica + sobreescrituras. */
export function calcularEfectivos(comandos: readonly ComandoConAtajos[], sobre: Sobreescrituras): Efectivos {
  const porId = new Map<string, readonly Atajo[]>();
  const desplazados: Desplazado[] = [];
  // Primero lo personalizado: es lo que gana.
  const personalizados: { atajo: Atajo; id: string }[] = [];
  for (const c of comandos) {
    if (!esPersonalizable(c) || !(c.id in sobre)) continue;
    const lista = sobre[c.id] ?? [];
    porId.set(c.id, lista);
    for (const a of lista) personalizados.push({ atajo: a, id: c.id });
  }
  for (const c of comandos) {
    if (porId.has(c.id)) continue;
    const fabrica = c.atajos ?? [];
    if (!esPersonalizable(c)) {
      porId.set(c.id, fabrica);
      continue;
    }
    const quedan: Atajo[] = [];
    for (const a of fabrica) {
      const duenio = personalizados.find((p) => mismoAtajo(p.atajo, a) && p.id !== c.id);
      if (duenio) desplazados.push({ id: c.id, atajo: a, por: duenio.id });
      else quedan.push(a);
    }
    porId.set(c.id, quedan);
  }
  return { porId, desplazados };
}

/** ¿El comando tiene sus atajos cambiados? */
export const estaPersonalizado = (id: string, sobre: Sobreescrituras) => id in sobre;

// ── asignar ────────────────────────────────────────────────────────────────

/** Por qué no se puede asignar una combinación a un comando. */
export type Choque =
  /** No sirve como atajo (una letra sola, AltGr…). */
  | { tipo: "invalido"; motivo: string }
  /** Es del sistema, de editar texto o de otro dueño fijo. */
  | { tipo: "reservada"; motivo: string }
  /** La tiene un comando que no se personaliza (F1, la captura). */
  | { tipo: "fijo"; id: string }
  /** La tiene otro comando: se puede reemplazar. */
  | { tipo: "otro"; id: string };

/**
 * ¿Qué impide darle `atajo` al comando `id`? `null` si nada. `visibles` son los
 * comandos que el usuario puede ver (sin los de desarrollador si el modo está
 * apagado): un choque con uno oculto no se nombra.
 */
export function choqueDe(
  atajo: Atajo,
  id: string,
  visibles: readonly ComandoConAtajos[],
  efectivos: Efectivos,
): Choque | null {
  const problema = problemaDeAtajo(atajo);
  if (problema) return { tipo: "invalido", motivo: problema };
  const reserva = reservaQueChoca(atajo, id);
  if (reserva) return { tipo: "reservada", motivo: `${textoAtajo(atajo)} está reservada: ${reserva.motivo.toLowerCase()}.` };
  for (const c of visibles) {
    if (c.id === id) continue;
    if (!(efectivos.porId.get(c.id) ?? []).some((a) => mismoAtajo(a, atajo))) continue;
    return esPersonalizable(c) ? { tipo: "otro", id: c.id } : { tipo: "fijo", id: c.id };
  }
  return null;
}

/** La lista de un comando con el cambio, y sin la sobreescritura si quedó igual que la de fábrica. */
function fijar(
  sobre: Sobreescrituras,
  c: ComandoConAtajos,
  lista: readonly Atajo[],
): Record<string, readonly Atajo[] | null> {
  const siguiente: Record<string, readonly Atajo[] | null> = { ...sobre };
  const fabrica = c.atajos ?? [];
  const igual = lista.length === fabrica.length && lista.every((a, i) => mismoAtajo(a, fabrica[i]));
  if (igual) delete siguiente[c.id];
  else siguiente[c.id] = lista.length ? lista.map(atajoLimpio) : null;
  return siguiente;
}

/**
 * Le da `atajo` al comando `id`, en el lugar `indice` de su lista (o al final
 * si es `null`). Si otro comando la tenía (`reemplazar`), se la quita: ese
 * comando queda con el resto de sus atajos. No valida: eso es `choqueDe`.
 */
export function asignarAtajo(
  sobre: Sobreescrituras,
  comandos: readonly ComandoConAtajos[],
  id: string,
  indice: number | null,
  atajo: Atajo,
): Sobreescrituras {
  const c = comandos.find((x) => x.id === id);
  if (!c || !esPersonalizable(c)) return sobre;
  const efectivos = calcularEfectivos(comandos, sobre);
  let siguiente: Sobreescrituras = sobre;
  // Quien la tenía la suelta (por fábrica o por una personalización anterior).
  for (const otro of comandos) {
    if (otro.id === id || !esPersonalizable(otro)) continue;
    const suyos = efectivos.porId.get(otro.id) ?? [];
    if (!suyos.some((a) => mismoAtajo(a, atajo))) continue;
    siguiente = fijar(siguiente, otro, suyos.filter((a) => !mismoAtajo(a, atajo)));
  }
  const actuales = [...(efectivos.porId.get(id) ?? [])];
  if (indice === null || indice >= actuales.length) actuales.push(atajo);
  else actuales[indice] = atajo;
  const sinRepetir = actuales.filter((a, i) => actuales.findIndex((b) => mismoAtajo(a, b)) === i);
  return fijar(siguiente, c, sinRepetir);
}

/** Le quita al comando `id` el atajo del lugar `indice`. */
export function quitarAtajo(
  sobre: Sobreescrituras,
  comandos: readonly ComandoConAtajos[],
  id: string,
  indice: number,
): Sobreescrituras {
  const c = comandos.find((x) => x.id === id);
  if (!c || !esPersonalizable(c)) return sobre;
  const actuales = [...(calcularEfectivos(comandos, sobre).porId.get(id) ?? [])];
  actuales.splice(indice, 1);
  return fijar(sobre, c, actuales);
}

/**
 * Vuelve el comando a sus atajos de fábrica. Si alguno lo tiene ahora otro
 * comando por decisión del usuario, ese otro lo suelta: restaurar es «como
 * venía».
 */
export function restaurarAtajo(
  sobre: Sobreescrituras,
  comandos: readonly ComandoConAtajos[],
  id: string,
): Sobreescrituras {
  const c = comandos.find((x) => x.id === id);
  const siguiente: Record<string, readonly Atajo[] | null> = { ...sobre };
  delete siguiente[id];
  if (!c) return siguiente;
  let resultado: Sobreescrituras = siguiente;
  for (const a of c.atajos ?? []) {
    for (const otro of comandos) {
      if (otro.id === id || !(otro.id in resultado)) continue;
      const suyos = resultado[otro.id] ?? [];
      if (suyos.some((b) => mismoAtajo(a, b))) {
        resultado = fijar(resultado, otro, suyos.filter((b) => !mismoAtajo(a, b)));
      }
    }
  }
  return resultado;
}
