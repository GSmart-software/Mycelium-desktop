// Motor de la simulación del grafo (`FUN-L-25` · B4, `DEF-109`): la misma
// física (`fisica.ts`) en un Web Worker (`sim.worker.ts`) o, si no se puede, en
// el hilo principal. `MiniGraph.tsx` lo usa igual en los dos casos:
//
//   tomar()    → posiciones nuevas desde la última vez (o `null`)
//   avanzar()  → pide un paso con esta energía; `true` si lo dio o lo encargó
//   colocar()  → el hilo principal movió un nodo a mano (arrastre, aparición)
//
// Con el worker, `avanzar` no bloquea: manda el pedido y la respuesta llega en
// un frame posterior (como mucho uno en vuelo). En el hilo principal, el paso
// corre ahí mismo y `tomar` lo devuelve enseguida.
import { type ConstantesFisica, type EstadoFisica, paso } from "./fisica";
import type { MensajeAlWorker, MensajeDelWorker } from "./sim.worker";

export type MotorFisica = {
  /** `true` si la física corre en el worker. */
  readonly enWorker: boolean;
  tomar(): ArrayLike<number> | null;
  avanzar(alpha: number, fijo: number, activos: Uint8Array | null): boolean;
  colocar(i: number, x: number, y: number): void;
  cerrar(): void;
};

/**
 * Por debajo de esta cantidad de nodos la física cuesta menos de medio
 * milisegundo por paso (el mini-grafo del panel): no vale un worker por grafo.
 */
export const MIN_NODOS_WORKER = 200;

/** La física en el hilo principal, sobre el mismo `estado` que usa el dibujo. */
function motorLocal(estado: EstadoFisica, constantes: ConstantesFisica): MotorFisica {
  let nuevo = false;
  return {
    enWorker: false,
    tomar() {
      if (!nuevo) return null;
      nuevo = false;
      return estado.pos;
    },
    avanzar(alpha, fijo, activos) {
      estado.activos = activos;
      estado.fijo = fijo;
      paso(estado, constantes, alpha);
      nuevo = true;
      return true;
    },
    colocar() {
      // `estado` es el mismo que el del dibujo: ya lo movió quien llama.
    },
    cerrar() {},
  };
}

/**
 * Crea el motor. Usa el worker si el navegador lo permite, el grafo es lo
 * bastante grande y no se pidió movimiento reducido; si no —o si el worker
 * falla al cargar o en marcha— cae al hilo principal con el mismo módulo, sin
 * perder las posiciones (el `estado` del hilo principal se mantiene espejado).
 * `alRecibir` avisa que llegaron posiciones (para despertar el bucle).
 */
export function crearMotor(
  estado: EstadoFisica,
  constantes: ConstantesFisica,
  alRecibir: () => void,
): MotorFisica {
  const reducido =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof Worker === "undefined" || reducido || estado.n < MIN_NODOS_WORKER) {
    return motorLocal(estado, constantes);
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return motorLocal(estado, constantes);
  }

  let local: MotorFisica | null = null; // respaldo, si el worker falla en marcha
  let enVuelo = false;
  let recibido: Float32Array | null = null;
  /** Buffer ya aplicado, para devolvérselo al worker con el próximo pedido. */
  let libre: Float32Array | null = null;
  /** Colocados desde el último pedido: `[i, x, y, …]`. */
  let colocados: number[] = [];
  /** Índices colocados que el worker todavía no vio: su respuesta no los pisa. */
  const pendientes = new Set<number>();

  const caer = () => {
    if (local) return;
    worker.terminate();
    local = motorLocal(estado, constantes);
    enVuelo = false;
    recibido = null;
  };
  worker.onmessage = (ev: MessageEvent<MensajeDelWorker>) => {
    enVuelo = false;
    recibido = ev.data.pos;
    alRecibir();
  };
  worker.onerror = (ev) => {
    ev.preventDefault();
    caer();
    alRecibir();
  };
  const iniciar: MensajeAlWorker = {
    tipo: "iniciar",
    n: estado.n,
    pos: Float64Array.from(estado.pos),
    aristas: estado.aristas,
    centro: estado.centro,
    constantes,
  };
  worker.postMessage(iniciar);

  return {
    get enWorker() {
      return local === null;
    },
    tomar() {
      if (local) return local.tomar();
      const r = recibido;
      if (!r) return null;
      recibido = null;
      // Espejo en el hilo principal (el respaldo y `colocar` parten de acá),
      // salvo lo que se movió a mano después del pedido.
      const pos = estado.pos;
      for (let i = 0; i < estado.n; i++) {
        if (pendientes.has(i)) continue;
        pos[i * 2] = r[i * 2];
        pos[i * 2 + 1] = r[i * 2 + 1];
      }
      libre = r;
      return pos;
    },
    avanzar(alpha, fijo, activos) {
      if (local) return local.avanzar(alpha, fijo, activos);
      if (enVuelo) return false;
      const buffer = libre;
      libre = null;
      const msg: MensajeAlWorker = {
        tipo: "paso",
        alpha,
        fijo,
        activos: activos ? activos.slice() : null,
        colocados: colocados.length ? Float64Array.from(colocados) : null,
        buffer,
      };
      colocados = [];
      pendientes.clear();
      enVuelo = true;
      worker.postMessage(msg, buffer ? [buffer.buffer] : []);
      return true;
    },
    colocar(i, x, y) {
      if (local) return;
      colocados.push(i, x, y);
      pendientes.add(i);
    },
    cerrar() {
      if (!local) worker.terminate();
    },
  };
}
