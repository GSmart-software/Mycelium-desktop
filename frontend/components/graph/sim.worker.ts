// «Graph Worker» de Mycelium (`FUN-L-25` · B4 y Parte C, `DEF-109`): corre la
// física del cúmulo (`fisica.ts` + `cicloFisica.ts`, los MISMOS
// módulos que usa el hilo principal como respaldo) fuera del hilo de la
// interfaz, como hace Obsidian.
//
// Desde la Parte C el worker corre LIBRE: itera por su cuenta, tantos pasos
// como puede, lleva la energía (`alpha`) y avisa cuando se asienta. El hilo
// principal ya no pide pasos: dibuja lo último que llegó. Antes pedía uno por
// frame, así que asentarse costaba ~1.000 frames (decenas de segundos).
//
// Protocolo (lo arma `motorFisica.ts`):
//   → { tipo: "iniciar", n, pos, aristas, centro, constantes, continuo, buffers }
//   → { tipo: "correr", alpha }            darle energía (arranque, nodos nuevos)
//   → { tipo: "parar" }
//   → { tipo: "fijar", i, x, y, seq }      arrastre (sube `alphaObjetivo` a 0,3)
//   → { tipo: "soltar" }
//   → { tipo: "colocar", datos, seq }      nodos movidos a mano: `[i, x, y, …]`
//   → { tipo: "activos", mascara }         construcción temporal (`null` = todos)
//   → { tipo: "devolver", buffer }         el principal ya copió esas posiciones
//   ← { tipo: "posiciones", pos, alpha, asentado, pasos, seq }
//
// Posiciones: como mucho una publicación cada 16 ms, en un `Float32Array`
// transferido. Hay DOS buffers que van y vuelven (ping-pong): el principal
// devuelve el que ya copió y el worker escribe en el otro, sin reservar
// memoria por mensaje (a 60 mensajes por segundo, esa basura eran tirones del
// recolector). Si no hay buffer libre —el principal todavía no consumió los
// dos—, esa publicación se salta: la siguiente lleva lo más nuevo.
import {
  type Ciclo,
  avanzarCiclo,
  calentar,
  colocarEn,
  crearCiclo,
  fijar,
  soltar,
} from "./cicloFisica";
import { type ConstantesFisica, crearEstado } from "./fisica";

export type MensajeAlWorker =
  | {
      tipo: "iniciar";
      n: number;
      pos: Float64Array;
      aristas: Int32Array;
      centro: number;
      constantes: ConstantesFisica;
      continuo: boolean;
      /** Los dos buffers del ping-pong (transferidos). */
      buffers: Float32Array[];
    }
  | { tipo: "correr"; alpha: number }
  | { tipo: "parar" }
  | { tipo: "fijar"; i: number; x: number; y: number; seq: number }
  | { tipo: "soltar" }
  | { tipo: "colocar"; datos: Float64Array; seq: number }
  | { tipo: "activos"; mascara: Uint8Array | null }
  | { tipo: "devolver"; buffer: Float32Array };

export type MensajeDelWorker = {
  tipo: "posiciones";
  pos: Float32Array;
  alpha: number;
  /** Última publicación de esta corrida: el grafo se asentó. */
  asentado: boolean;
  /** Pasos desde el último arranque. */
  pasos: number;
  /** Último `fijar`/`colocar` aplicado: lo movido a mano después no se pisa. */
  seq: number;
};

// El `self` del worker, sin arrastrar la lib `webworker` (choca con `dom` en el
// mismo programa de TypeScript).
const ambito = self as unknown as {
  onmessage: ((ev: MessageEvent<MensajeAlWorker>) => void) | null;
  postMessage(m: MensajeDelWorker, transferir: Transferable[]): void;
};

/** Cada tanda de pasos dura como mucho esto; entre tandas se atienden mensajes. */
const TANDA_MS = 8;
/** Como mucho una publicación de posiciones por frame. */
const PUBLICAR_MS = 16;
/** Con la simulación continua ya casi quieta, un paso por frame y no más. */
const RITMO_CONTINUO_MS = 16;

let ciclo: Ciclo | null = null;
const libres: Float32Array[] = [];
let ultimaPublicacion = 0;
/** El asentamiento se publica sí o sí: si no había buffer, queda pendiente. */
let asentadoPendiente = false;
let seqAplicado = 0;
let programado = false;

// `MessageChannel` para ceder entre tandas: `setTimeout(0)` se va a 4 ms de
// espera tras unas cuantas vueltas anidadas; esto vuelve enseguida, después de
// atender los mensajes que llegaron (arrastre, pausa).
const canal = new MessageChannel();
canal.port1.onmessage = () => bucle();

function programar(retraso = 0) {
  if (programado) return;
  programado = true;
  if (retraso > 0) setTimeout(() => bucle(), retraso);
  else canal.port2.postMessage(null);
}

function publicar(asentado: boolean): boolean {
  if (!ciclo) return false;
  const buf = libres.pop();
  if (!buf) return false;
  buf.set(ciclo.estado.pos);
  ultimaPublicacion = performance.now();
  ambito.postMessage(
    {
      tipo: "posiciones",
      pos: buf,
      alpha: ciclo.alpha,
      asentado,
      pasos: ciclo.pasos,
      seq: seqAplicado,
    },
    [buf.buffer],
  );
  return true;
}

function bucle() {
  programado = false;
  const c = ciclo;
  if (!c || !c.corriendo) return;
  const lento = c.continuo && c.alpha < 0.01;
  avanzarCiclo(c, TANDA_MS, () => performance.now(), lento ? 1 : Infinity);
  if (!c.corriendo) {
    if (!publicar(true)) asentadoPendiente = true;
    return;
  }
  if (performance.now() - ultimaPublicacion >= PUBLICAR_MS) publicar(false);
  programar(lento ? RITMO_CONTINUO_MS : 0);
}

function arrancar() {
  asentadoPendiente = false;
  programar();
}

ambito.onmessage = (ev) => {
  const m = ev.data;
  if (m.tipo === "iniciar") {
    ciclo = crearCiclo(crearEstado(m.n, m.pos, m.aristas, m.centro), m.constantes, m.continuo);
    libres.length = 0;
    libres.push(...m.buffers);
    return;
  }
  if (m.tipo === "devolver") {
    if (m.buffer.length === (ciclo?.estado.n ?? 0) * 2) libres.push(m.buffer);
    if (asentadoPendiente && publicar(true)) asentadoPendiente = false;
    return;
  }
  const c = ciclo;
  if (!c) return;
  switch (m.tipo) {
    case "correr":
      calentar(c, m.alpha);
      arrancar();
      break;
    case "parar":
      c.corriendo = false;
      break;
    case "fijar":
      fijar(c, m.i, m.x, m.y);
      seqAplicado = m.seq;
      arrancar();
      break;
    case "soltar":
      soltar(c);
      break;
    case "colocar":
      for (let j = 0; j < m.datos.length; j += 3) colocarEn(c, m.datos[j], m.datos[j + 1], m.datos[j + 2]);
      seqAplicado = m.seq;
      break;
    case "activos":
      c.estado.activos = m.mascara;
      break;
  }
};
