// Motor de la simulación del grafo (`FUN-L-25` · B4 y Parte C, `DEF-109`): la
// misma física (`fisica.ts` + `cicloFisica.ts`) en un Web Worker
// (`sim.worker.ts`) o, si no se puede, en el hilo principal. `MiniGraph.tsx`
// lo usa igual en los dos casos:
//
//   correr(alpha)   → darle energía (arranque, nodos nuevos)
//   precalcular(a)  → a ciegas hasta asentarse, sin posiciones intermedias
//                     (Parte E: sin caché, el grafo se calcula antes de verse)
//   residual(a)     → energía baja y ritmo «pedido»: un paso por frame
//   ritmo(r)        → «libre» (el worker corre solo) o «pedido» (un paso por
//                     cada `avanzar`, o sea por frame dibujado)
//   fijar/soltar    → arrastre de un nodo (sube la energía mientras dura)
//   colocar()       → el hilo principal movió un nodo a mano (aparición)
//   activos()       → qué nodos participan (construcción temporal)
//   avanzar()       → en el hilo principal, los pasos de este frame (6 ms);
//                     con el worker no hace nada: el worker corre solo
//   tomar()         → posiciones nuevas desde la última vez (o `null`)
//
// Con el worker la física va LIBRE (Parte C): el hilo principal no marca el
// ritmo ni lleva la energía; dibuja lo último que llegó y se entera por
// `corriendo` y `alAsentar` de cuándo el grafo se quedó quieto.
import {
  type Ciclo,
  avanzarCiclo,
  calentar,
  colocarEn,
  crearCiclo,
  fijar,
  precalcular,
  residual,
  soltar,
} from "./cicloFisica";
import type { ConstantesFisica, EstadoFisica } from "./fisica";
import type { MensajeAlWorker, MensajeDelWorker, Ritmo } from "./sim.worker";

export type MotorFisica = {
  /** `true` si la física corre en el worker. */
  readonly enWorker: boolean;
  /** `false` cuando el grafo se asentó (y nadie lo volvió a calentar). */
  readonly corriendo: boolean;
  /** La energía de lo último que se tomó. */
  readonly alpha: number;
  correr(alpha: number): void;
  /**
   * Precálculo a ciegas: corre hasta asentarse y solo entonces entrega
   * posiciones (`tomar`), avisando con `alAsentar`.
   */
  precalcular(alpha: number): void;
  /** Física residual: energía `alpha` (fijada, no sumada) y un paso por frame. */
  residual(alpha: number): void;
  ritmo(r: Ritmo): void;
  fijar(i: number, x: number, y: number): void;
  soltar(): void;
  colocar(i: number, x: number, y: number): void;
  activos(mascara: Uint8Array | null): void;
  avanzar(): void;
  tomar(): ArrayLike<number> | null;
  cerrar(): void;
};

export type OpcionesMotor = {
  /** Simulación continua (preferencia `graphContinuousSim`): nunca se asienta. */
  continuo: boolean;
  /** Llegaron posiciones (para despertar el bucle de dibujo). */
  alRecibir: () => void;
  /** El grafo se asentó: `pasos` desde el último arranque. */
  alAsentar: (pasos: number) => void;
};

/**
 * Por debajo de esta cantidad de nodos la física cuesta menos de medio
 * milisegundo por paso (el mini-grafo del panel): no vale un worker por grafo.
 */
export const MIN_NODOS_WORKER = 200;

/** Presupuesto de física por frame en el hilo principal (el respaldo). */
const PRESUPUESTO_LOCAL_MS = 6;
/**
 * Durante el precálculo a ciegas no se dibuja nada: el frame entero es de la
 * física, con margen para que siga por debajo de 16 ms.
 */
const PRESUPUESTO_LOCAL_CIEGO_MS = 12;

/** La física en el hilo principal, sobre el mismo `estado` que usa el dibujo. */
function motorLocal(
  estado: EstadoFisica,
  constantes: ConstantesFisica,
  op: OpcionesMotor,
  heredado?: { ciclo: Ciclo; aCiegas: boolean; ritmo: Ritmo },
): MotorFisica {
  const ciclo = crearCiclo(estado, constantes, op.continuo);
  if (heredado) {
    ciclo.alpha = heredado.ciclo.alpha;
    ciclo.objetivo = heredado.ciclo.objetivo;
    ciclo.corriendo = heredado.ciclo.corriendo;
  }
  let nuevo = false;
  let aCiegas = heredado?.aCiegas ?? false;
  let ritmo: Ritmo = heredado?.ritmo ?? "libre";
  return {
    enWorker: false,
    get corriendo() {
      return ciclo.corriendo;
    },
    get alpha() {
      return ciclo.alpha;
    },
    correr(alpha) {
      calentar(ciclo, alpha);
    },
    precalcular(alpha) {
      precalcular(ciclo, alpha);
      aCiegas = true;
    },
    residual(alpha) {
      residual(ciclo, alpha);
      ritmo = "pedido";
    },
    ritmo(r) {
      ritmo = r;
    },
    fijar(i, x, y) {
      fijar(ciclo, i, x, y);
    },
    soltar() {
      soltar(ciclo);
    },
    colocar() {
      // `estado` es el mismo que el del dibujo: ya lo movió quien llama.
    },
    activos(mascara) {
      estado.activos = mascara;
    },
    avanzar() {
      if (!ciclo.corriendo) return;
      if (ritmo === "pedido" && !aCiegas) {
        avanzarCiclo(ciclo, 0, () => performance.now(), 1); // un paso por frame
      } else {
        const presupuesto = aCiegas ? PRESUPUESTO_LOCAL_CIEGO_MS : PRESUPUESTO_LOCAL_MS;
        avanzarCiclo(ciclo, presupuesto, () => performance.now());
      }
      if (ciclo.corriendo && aCiegas) return; // a ciegas: nada que entregar todavía
      aCiegas = false;
      nuevo = true;
      if (!ciclo.corriendo) op.alAsentar(ciclo.pasos);
    },
    tomar() {
      if (!nuevo) return null;
      nuevo = false;
      return estado.pos;
    },
    cerrar() {},
  };
}

/**
 * Crea el motor. Usa el worker si el navegador lo permite, el grafo es lo
 * bastante grande y no se pidió movimiento reducido; si no —o si el worker
 * falla al cargar o en marcha— cae al hilo principal con los mismos módulos,
 * sin perder las posiciones (el `estado` del hilo principal se mantiene
 * espejado con lo último que llegó).
 */
export function crearMotor(
  estado: EstadoFisica,
  constantes: ConstantesFisica,
  op: OpcionesMotor,
): MotorFisica {
  const reducido =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof Worker === "undefined" || reducido || estado.n < MIN_NODOS_WORKER) {
    return motorLocal(estado, constantes, op);
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return motorLocal(estado, constantes, op);
  }

  let local: MotorFisica | null = null; // respaldo, si el worker falla en marcha
  /** Lo que el hilo principal sabe del ciclo del worker (para el respaldo y el dibujo). */
  const espejo: Ciclo = crearCiclo(estado, constantes, op.continuo);
  let recibido: Float32Array | null = null;
  /** Índice movido a mano → `seq` del mensaje que lo movió. */
  const pendientes = new Map<number, number>();
  let seq = 0;
  /** Precálculo a ciegas en curso en el worker (si cae, el respaldo lo sigue igual). */
  let aCiegas = false;
  let ritmo: Ritmo = "libre";
  /** Con ritmo «pedido»: se pidió un paso y su respuesta todavía no llegó. */
  let pedidoEnCurso = false;

  const enviar = (m: MensajeAlWorker, transferir: Transferable[] = []) => {
    if (!local) worker.postMessage(m, transferir);
  };
  const devolver = (buf: Float32Array) => enviar({ tipo: "devolver", buffer: buf }, [buf.buffer]);

  const caer = () => {
    if (local) return;
    worker.terminate();
    local = motorLocal(estado, constantes, op, { ciclo: espejo, aCiegas, ritmo });
    recibido = null;
  };
  worker.onmessage = (ev: MessageEvent<MensajeDelWorker>) => {
    const m = ev.data;
    pedidoEnCurso = false;
    // Si el anterior no se llegó a dibujar, se descarta y vuelve al worker.
    if (recibido) devolver(recibido);
    recibido = m.pos;
    espejo.alpha = m.alpha;
    espejo.pasos = m.pasos;
    for (const [i, s] of pendientes) if (s <= m.seq) pendientes.delete(i);
    if (m.asentado) {
      aCiegas = false;
      // Solo una vez por corrida: a un pedido llegado tarde (el grafo ya se
      // había asentado) el worker también responde `asentado`.
      if (espejo.corriendo) {
        espejo.corriendo = false;
        op.alAsentar(m.pasos);
      }
    }
    op.alRecibir();
  };
  worker.onerror = (ev) => {
    ev.preventDefault();
    caer();
    op.alRecibir();
  };
  const n2 = estado.n * 2;
  const buffers = [new Float32Array(n2), new Float32Array(n2)];
  enviar(
    {
      tipo: "iniciar",
      n: estado.n,
      pos: Float64Array.from(estado.pos),
      aristas: estado.aristas,
      centro: estado.centro,
      constantes,
      continuo: op.continuo,
      buffers,
    },
    buffers.map((b) => b.buffer),
  );

  return {
    get enWorker() {
      return local === null;
    },
    get corriendo() {
      return local ? local.corriendo : espejo.corriendo;
    },
    get alpha() {
      return local ? local.alpha : espejo.alpha;
    },
    correr(alpha) {
      if (local) return local.correr(alpha);
      calentar(espejo, alpha);
      enviar({ tipo: "correr", alpha });
    },
    precalcular(alpha) {
      if (local) return local.precalcular(alpha);
      precalcular(espejo, alpha);
      aCiegas = true;
      enviar({ tipo: "precalcular", alpha });
    },
    residual(alpha) {
      if (local) return local.residual(alpha);
      residual(espejo, alpha);
      ritmo = "pedido";
      enviar({ tipo: "residual", alpha });
    },
    ritmo(r) {
      if (local) return local.ritmo(r);
      if (r === ritmo) return;
      ritmo = r;
      enviar({ tipo: "ritmo", ritmo: r });
    },
    fijar(i, x, y) {
      if (local) return local.fijar(i, x, y);
      fijar(espejo, i, x, y); // también mueve `estado`, que es el del dibujo
      pendientes.set(i, ++seq);
      enviar({ tipo: "fijar", i, x, y, seq });
    },
    soltar() {
      if (local) return local.soltar();
      soltar(espejo);
      enviar({ tipo: "soltar" });
    },
    colocar(i, x, y) {
      if (local) return;
      colocarEn(espejo, i, x, y);
      pendientes.set(i, ++seq);
      enviar({ tipo: "colocar", datos: Float64Array.of(i, x, y), seq });
    },
    activos(mascara) {
      estado.activos = mascara;
      if (local) return;
      enviar({ tipo: "activos", mascara: mascara ? mascara.slice() : null });
    },
    avanzar() {
      if (local) return local.avanzar();
      // Ritmo «pedido»: un paso por frame, y el siguiente recién cuando llegó
      // la respuesta del anterior (mientras se dibuja, el worker calcula).
      if (ritmo !== "pedido" || aCiegas || !espejo.corriendo || pedidoEnCurso) return;
      pedidoEnCurso = true;
      enviar({ tipo: "paso" });
    },
    tomar() {
      if (local) return local.tomar();
      const r = recibido;
      if (!r) return null;
      recibido = null;
      // Espejo en el hilo principal (el respaldo y el dibujo parten de acá),
      // salvo lo que se movió a mano y el worker todavía no vio.
      const pos = estado.pos;
      if (pendientes.size === 0) {
        for (let j = 0; j < n2; j++) pos[j] = r[j];
      } else {
        for (let i = 0; i < estado.n; i++) {
          if (pendientes.has(i)) continue;
          pos[i * 2] = r[i * 2];
          pos[i * 2 + 1] = r[i * 2 + 1];
        }
      }
      devolver(r); // ya está copiado: el worker puede escribir en él
      return pos;
    },
    cerrar() {
      if (!local) worker.terminate();
    },
  };
}
