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
//   → { tipo: "precalcular", alpha }       a ciegas hasta asentarse (Parte E)
//   → { tipo: "residual", alpha }          energía baja, a un paso por pedido (Parte E)
//   → { tipo: "ritmo", ritmo }             "libre" (tandas propias) o "pedido"
//   → { tipo: "paso" }                     un paso y su publicación (ritmo "pedido")
//   → { tipo: "parar" }
//   → { tipo: "fijar", i, x, y, seq }      arrastre (sube `alphaObjetivo` a 0,3)
//   → { tipo: "soltar" }
//   → { tipo: "colocar", datos, seq }      nodos movidos a mano: `[i, x, y, …]`
//   → { tipo: "activos", mascara }         construcción temporal (`null` = todos)
//   → { tipo: "moviles", mascara }         arrastre local: solo esos se integran (Parte F)
//   → { tipo: "devolver", buffer }         el principal ya copió esas posiciones
//   ← { tipo: "posiciones", pos, alpha, asentado, pasos, seq }
//
// Precálculo a ciegas (Parte E): sin caché de posiciones, el grafo se calcula
// ENTERO antes de dibujarse. Mientras dura, el worker no publica nada
// intermedio —el hilo principal no tiene qué dibujar—; solo el resultado final,
// con `asentado: true`.
//
// Ritmo (Parte E): después del revelado el worker deja de correr libre y da
// UN paso por cada pedido del hilo principal, que pide uno por frame dibujado.
// Así cada paso se ve y ninguno se saltea: el movimiento residual y el del
// arrastre no dan saltos. La construcción temporal sigue corriendo libre.
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
  precalcular,
  residual,
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
  | { tipo: "precalcular"; alpha: number }
  | { tipo: "residual"; alpha: number }
  | { tipo: "ritmo"; ritmo: Ritmo }
  | { tipo: "paso" }
  | { tipo: "parar" }
  | { tipo: "fijar"; i: number; x: number; y: number; seq: number }
  | { tipo: "soltar" }
  | { tipo: "colocar"; datos: Float64Array; seq: number }
  | { tipo: "activos"; mascara: Uint8Array | null }
  | { tipo: "moviles"; mascara: Uint8Array | null }
  | { tipo: "devolver"; buffer: Float32Array };

/** Quién marca los pasos: el worker solo (`libre`) o el hilo principal, de a uno (`pedido`). */
export type Ritmo = "libre" | "pedido";

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
/**
 * Publicación que no encontró buffer y se debe igual (el asentamiento, o la
 * respuesta a un pedido de paso): `true`/`false` = con qué `asentado`.
 */
let pendiente: boolean | null = null;
let seqAplicado = 0;
let programado = false;
/** Precálculo a ciegas en curso: no se publica nada hasta asentarse. */
let aCiegas = false;
let ritmo: Ritmo = "libre";

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
  if (ritmo === "pedido" && !aCiegas) return; // los pasos los pide el hilo principal
  const lento = !aCiegas && c.continuo && c.alpha < 0.01;
  avanzarCiclo(c, TANDA_MS, () => performance.now(), lento ? 1 : Infinity);
  if (!c.corriendo) {
    aCiegas = false;
    if (!publicar(true)) pendiente = true;
    return;
  }
  if (!aCiegas && performance.now() - ultimaPublicacion >= PUBLICAR_MS) publicar(false);
  programar(lento ? RITMO_CONTINUO_MS : 0);
}

function arrancar() {
  pendiente = null;
  if (ritmo === "libre" || aCiegas) programar();
}

/** Un paso pedido por el hilo principal, y su publicación (siempre hay respuesta). */
function pasoPedido(c: Ciclo) {
  if (c.corriendo) avanzarCiclo(c, 0, () => performance.now(), 1);
  if (!publicar(!c.corriendo)) pendiente = !c.corriendo;
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
    if (pendiente !== null && publicar(pendiente)) pendiente = null;
    return;
  }
  const c = ciclo;
  if (!c) return;
  switch (m.tipo) {
    case "correr":
      calentar(c, m.alpha);
      arrancar();
      break;
    case "residual":
      residual(c, m.alpha);
      ritmo = "pedido";
      break;
    case "ritmo":
      ritmo = m.ritmo;
      if (c.corriendo) arrancar();
      break;
    case "paso":
      pasoPedido(c);
      break;
    case "precalcular":
      precalcular(c, m.alpha);
      aCiegas = true;
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
    case "moviles":
      c.estado.moviles = m.mascara;
      break;
  }
};
