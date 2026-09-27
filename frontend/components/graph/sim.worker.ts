// «Graph Worker» de Mycelium (`FUN-L-25` · B4, `DEF-109`): corre la física del
// cúmulo y del sustrato (`fisica.ts`, el MISMO módulo que usa el hilo
// principal como respaldo) fuera del hilo de la interfaz, como hace Obsidian.
//
// Protocolo (lo arma `motorFisica.ts`):
//   → { tipo: "iniciar", n, pos, aristas, centro, constantes }  al construir
//   → { tipo: "constantes", constantes }                         al cambiar opciones
//   → { tipo: "paso", alpha, fijo, activos, colocados, buffer }  un paso por pedido
//   ← { tipo: "posiciones", pos: Float32Array }                  transferido
//
// El hilo principal pide un paso por frame como máximo y no pide otro hasta
// recibir la respuesta: el ritmo queda acotado por construcción, y la energía
// (`alpha`) y el reposo los sigue llevando él, que es quien sabe si hay
// interacción.
import { type ConstantesFisica, type EstadoFisica, crearEstado, paso } from "./fisica";

export type MensajeAlWorker =
  | {
      tipo: "iniciar";
      n: number;
      pos: Float64Array;
      aristas: Int32Array;
      centro: number;
      constantes: ConstantesFisica;
    }
  | { tipo: "constantes"; constantes: ConstantesFisica }
  | {
      tipo: "paso";
      alpha: number;
      /** Nodo arrastrado (no se integra); −1 = ninguno. */
      fijo: number;
      /** Máscara de la construcción temporal; `null` = todos participan. */
      activos: Uint8Array | null;
      /** Nodos que el hilo principal movió a mano: `[i, x, y, …]` (velocidad a 0). */
      colocados: Float64Array | null;
      /** El buffer de la respuesta anterior, devuelto para no reservar otro. */
      buffer: Float32Array | null;
    };

export type MensajeDelWorker = { tipo: "posiciones"; pos: Float32Array };

// El `self` del worker, sin arrastrar la lib `webworker` (choca con `dom` en el
// mismo programa de TypeScript).
const ambito = self as unknown as {
  onmessage: ((ev: MessageEvent<MensajeAlWorker>) => void) | null;
  postMessage(m: MensajeDelWorker, transferir: Transferable[]): void;
};

let estado: EstadoFisica | null = null;
let constantes: ConstantesFisica | null = null;

ambito.onmessage = (ev) => {
  const m = ev.data;
  if (m.tipo === "iniciar") {
    estado = crearEstado(m.n, m.pos, m.aristas, m.centro);
    constantes = m.constantes;
    return;
  }
  if (m.tipo === "constantes") {
    constantes = m.constantes;
    return;
  }
  if (!estado || !constantes) return;
  const { pos, vel } = estado;
  const c = m.colocados;
  if (c) {
    for (let j = 0; j < c.length; j += 3) {
      const i = c[j];
      pos[i * 2] = c[j + 1];
      pos[i * 2 + 1] = c[j + 2];
      vel[i * 2] = 0;
      vel[i * 2 + 1] = 0;
    }
  }
  estado.activos = m.activos;
  estado.fijo = m.fijo;
  paso(estado, constantes, m.alpha);
  const salida =
    m.buffer && m.buffer.length === estado.n * 2 ? m.buffer : new Float32Array(estado.n * 2);
  salida.set(pos);
  ambito.postMessage({ tipo: "posiciones", pos: salida }, [salida.buffer]);
};
