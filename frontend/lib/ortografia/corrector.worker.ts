// Worker del corrector ortográfico (`FUN-L-12`): carga el motor WASM
// (spellbook) y los diccionarios activos, y contesta qué palabras están bien y
// qué sugerir. Fuera del hilo de la interfaz: cargar el español cuesta
// 55–90 ms y una sugerencia 25–35 ms, y el editor nunca espera por eso.
//
// Una palabra es correcta si lo es en **alguno** de los diccionarios cargados,
// o si está en el diccionario del vault o en «Ignorar» (con la regla de
// mayúsculas de Hunspell, `aceptadaPor`). Sin ningún diccionario cargado, todo
// es correcto: no hay contra qué marcar.
//
// Protocolo (lo arma `lib/ortografia/corrector.ts`):
//   → { tipo: "iniciar", urlMotor }
//   → { tipo: "diccionarios", lista: [{ id, aff, dic }] }   reemplaza los cargados
//   → { tipo: "personales", palabras }                      diccionario del vault + ignoradas
//   → { tipo: "revisar", n, palabras }
//   → { tipo: "sugerir", n, palabra }
//   ← { tipo: "cargados", ids, errores: [{ id, mensaje }] }
//   ← { tipo: "revisado", n, correctas }
//   ← { tipo: "sugerido", n, sugerencias }
//   ← { tipo: "error", mensaje }                            el motor no arrancó
//
// Los mensajes se atienden **en orden**, en una cola: un «revisar» que llega
// mientras el motor todavía se descarga espera a que esté, en vez de contestar
// con lo que haya.
import { crearMotor, type DiccionarioMotor, type Motor } from "./motor";
import { aceptadaPor } from "./palabras";

export type MensajeAlCorrector =
  | { tipo: "iniciar"; urlMotor: string }
  | { tipo: "diccionarios"; lista: { id: string; aff: ArrayBuffer; dic: ArrayBuffer }[] }
  | { tipo: "personales"; palabras: string[] }
  | { tipo: "revisar"; n: number; palabras: string[] }
  | { tipo: "sugerir"; n: number; palabra: string };

export type MensajeDelCorrector =
  | { tipo: "cargados"; ids: string[]; errores: { id: string; mensaje: string }[] }
  | { tipo: "revisado"; n: number; correctas: boolean[] }
  | { tipo: "sugerido"; n: number; sugerencias: string[] }
  | { tipo: "error"; mensaje: string };

/** Cuántas sugerencias se devuelven como mucho (el menú muestra hasta 5). */
const MAX_SUGERENCIAS = 5;

type Cargado = { id: string; motor: DiccionarioMotor; aff: ArrayBuffer; dic: ArrayBuffer; agregadas: Set<string> };

let motor: Motor | null = null;
let cargados: Cargado[] = [];
let personales = new Set<string>();

const responder = (m: MensajeDelCorrector) => (self as unknown as Worker).postMessage(m);

/**
 * Suma las palabras personales a un diccionario, para que `sugerir` también
 * las proponga («Mycelum» → «Mycelium»). Solo las que el diccionario no da ya
 * por buenas: agregar «casa» al español no aporta nada.
 */
function sumarPersonales(c: Cargado, palabras: Iterable<string>) {
  for (const p of palabras) {
    if (c.agregadas.has(p) || c.motor.revisar(p)) continue;
    if (c.motor.agregar(p)) c.agregadas.add(p);
  }
}

function cargar(id: string, aff: ArrayBuffer, dic: ArrayBuffer): Cargado {
  if (!motor) throw new Error("El motor del corrector no está cargado.");
  const c: Cargado = { id, motor: motor.cargar(aff, dic), aff, dic, agregadas: new Set() };
  sumarPersonales(c, personales);
  return c;
}

async function atender(m: MensajeAlCorrector): Promise<void> {
  switch (m.tipo) {
    case "iniciar": {
      try {
        const r = await fetch(m.urlMotor);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        motor = await crearMotor(await r.arrayBuffer());
      } catch (e) {
        responder({ tipo: "error", mensaje: `No se pudo cargar el motor del corrector: ${String(e)}` });
      }
      return;
    }
    case "diccionarios": {
      for (const c of cargados) c.motor.liberar();
      cargados = [];
      const errores: { id: string; mensaje: string }[] = [];
      for (const d of m.lista) {
        try {
          cargados.push(cargar(d.id, d.aff, d.dic));
        } catch (e) {
          errores.push({ id: d.id, mensaje: e instanceof Error ? e.message : String(e) });
        }
      }
      responder({ tipo: "cargados", ids: cargados.map((c) => c.id), errores });
      return;
    }
    case "personales": {
      const nuevas = new Set(m.palabras);
      const quitadas = [...personales].some((p) => !nuevas.has(p));
      personales = nuevas;
      if (quitadas) {
        // spellbook no sabe «desagregar» una palabra (su `remove_stem` la marca
        // prohibida, y eso rompería la que otro diccionario tenga): se vuelve a
        // cargar cada diccionario desde sus bytes. Pasa solo al quitar una
        // palabra del diccionario del vault, que es raro.
        cargados = cargados.map((c) => {
          c.motor.liberar();
          return cargar(c.id, c.aff, c.dic);
        });
      } else {
        for (const c of cargados) sumarPersonales(c, personales);
      }
      return;
    }
    case "revisar": {
      const correctas = m.palabras.map(
        (p) => cargados.length === 0 || aceptadaPor(personales, p) || cargados.some((c) => c.motor.revisar(p)),
      );
      responder({ tipo: "revisado", n: m.n, correctas });
      return;
    }
    case "sugerir": {
      // De a una por diccionario, intercaladas: con español e inglés activos,
      // la mejor de cada uno queda arriba, en vez de cinco de un solo idioma.
      const listas = cargados.map((c) => c.motor.sugerir(m.palabra));
      const sugerencias: string[] = [];
      for (let i = 0; sugerencias.length < MAX_SUGERENCIAS && listas.some((l) => i < l.length); i++) {
        for (const l of listas) {
          const s = l[i];
          if (s !== undefined && s !== m.palabra && !sugerencias.includes(s)) sugerencias.push(s);
          if (sugerencias.length >= MAX_SUGERENCIAS) break;
        }
      }
      responder({ tipo: "sugerido", n: m.n, sugerencias });
      return;
    }
  }
}

let cola: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<MensajeAlCorrector>) => {
  const m = ev.data;
  cola = cola.then(() => atender(m)).catch((e) => {
    // Un fallo inesperado no debe dejar al hilo principal esperando para siempre.
    if (m.tipo === "revisar") responder({ tipo: "revisado", n: m.n, correctas: m.palabras.map(() => true) });
    else if (m.tipo === "sugerir") responder({ tipo: "sugerido", n: m.n, sugerencias: [] });
    else responder({ tipo: "error", mensaje: String(e) });
  });
};
