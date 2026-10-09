/**
 * Render de bloques ```mermaid en el preview (HU-18). Import dinámico para
 * no cargar mermaid hasta que haga falta. Sintaxis inválida → mensaje de
 * error inline sin romper el resto de la nota (CA3).
 *
 * Es el ÚNICO lugar que llama a Mermaid: lectura, dividido, vista lateral,
 * panel enlazado, ayuda y PDF pasan todos por `renderMermaidIn`.
 *
 * Colores (`DEF-142`): Mermaid no sigue el CSS de la página, pinta con lo que
 * recibe en `initialize`. Se le pasan los tokens `--mic-mermaid-*` resueltos
 * (tema × modo × atmósfera, y lo que pise un snippet) y, cuando cambian, cada
 * diagrama de la ventana se vuelve a dibujar desde su fuente.
 */

import { variablesMermaid, type ColoresMermaid } from "@/lib/mermaidTema";

let seq = 0;

/** Cómo se colorea un render. */
export type TemaMermaid =
  /** El de Mycelium en este momento, y se redibuja si cambia (por defecto). */
  | "mycelium"
  /**
   * El `neutral` de Mermaid, fijo: grises sobre blanco. Para el PDF con «Fondo
   * blanco» (papel blanco, texto negro, sin acentos): se lee en una impresora
   * en blanco y negro y no depende del tema de la ventana, que puede ser oscuro
   * aunque el documento se imprima claro.
   */
  | "imprimir";

/** Fuente de cada diagrama dibujado con el tema de Mycelium, para redibujarlo. */
const fuentes = new WeakMap<HTMLElement, string>();
/** La clave de colores con la que se dibujó cada diagrama. */
const claves = new WeakMap<HTMLElement, string>();

// Mermaid es global: `initialize` + `render` de dos renders a la vez (la nota y
// el PDF, que usan temas distintos) se pisarían. Todo pasa por esta cola.
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(trabajo: () => Promise<T>): Promise<T> {
  const r = cola.then(trabajo, trabajo);
  cola = r.catch(() => undefined);
  return r;
}

const TOKENS: Record<keyof ColoresMermaid, string> = {
  fondo: "--mic-mermaid-fondo",
  nodo: "--mic-mermaid-nodo",
  nodo2: "--mic-mermaid-nodo-2",
  grupo: "--mic-mermaid-grupo",
  borde: "--mic-mermaid-borde",
  linea: "--mic-mermaid-linea",
  texto: "--mic-mermaid-texto",
};

/**
 * Los tokens `--mic-mermaid-*` como `#rrggbb`, vistos desde `dentro` (así cuenta
 * un snippet que los pise solo en `.mic-preview`). Los tokens llevan
 * `color-mix()`, que `getComputedStyle` no resuelve en una variable: se pinta
 * cada color en un píxel de un canvas y se lee. Uno con transparencia se
 * compone sobre el fondo.
 */
function leerColores(dentro: HTMLElement): ColoresMermaid {
  const sonda = document.createElement("span");
  sonda.style.display = "none";
  dentro.appendChild(sonda);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

  let fondo: [number, number, number] = [255, 255, 255];
  const resolver = (token: string): string => {
    sonda.style.color = "";
    sonda.style.color = `var(${token})`;
    const css = getComputedStyle(sonda).color;
    if (!ctx) return css;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const al = a / 255;
    const rgb = [r, g, b].map((c, i) => c * al + fondo[i] * (1 - al)) as [number, number, number];
    return "#" + rgb.map(hex).join("");
  };

  try {
    const salida = {} as ColoresMermaid;
    salida.fondo = resolver(TOKENS.fondo);
    const f = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(salida.fondo);
    if (f) fondo = [parseInt(f[1], 16), parseInt(f[2], 16), parseInt(f[3], 16)];
    for (const k of Object.keys(TOKENS) as (keyof ColoresMermaid)[]) {
      if (k !== "fondo") salida[k] = resolver(TOKENS[k]);
    }
    return salida;
  } finally {
    sonda.remove();
  }
}

/** La configuración de Mermaid para un tema, y una clave que la identifica. */
function configuracion(tema: TemaMermaid, dentro: HTMLElement) {
  if (tema === "imprimir") return { clave: "imprimir", config: { theme: "neutral" as const } };
  const colores = leerColores(dentro);
  const fuente = getComputedStyle(dentro).fontFamily || undefined;
  return {
    clave: JSON.stringify([colores, fuente]),
    config: { theme: "base" as const, themeVariables: variablesMermaid(colores, fuente) },
  };
}

async function dibujar(host: HTMLElement, fuente: string, clave: string): Promise<boolean> {
  const { default: mermaid } = await import("mermaid");
  const id = `mic-mermaid-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, fuente);
    host.innerHTML = svg;
    claves.set(host, clave);
    return true;
  } catch (error) {
    // mermaid.render deja nodos huérfanos ante error — limpiarlos
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    throw error;
  }
}

export async function renderMermaidIn(
  container: HTMLElement,
  tema: TemaMermaid = "mycelium",
): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  if (blocks.length === 0) return;
  if (tema === "mycelium") vigilarTema();

  await enCola(async () => {
    const { default: mermaid } = await import("mermaid");
    const { clave, config } = configuracion(tema, container);
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", ...config });

    for (const code of Array.from(blocks)) {
      const pre = code.parentElement;
      if (!pre || !pre.isConnected) continue;
      const source = code.textContent ?? "";
      const host = document.createElement("div");
      host.className = "mic-mermaid";

      try {
        await dibujar(host, source, clave);
        if (tema === "mycelium") fuentes.set(host, source);
        pre.replaceWith(host);
      } catch (error) {
        const message = document.createElement("p");
        message.className = "mic-mermaid-error";
        message.textContent = `Diagrama Mermaid inválido: ${
          error instanceof Error ? error.message.split("\n")[0] : "error de sintaxis"
        }`;
        pre.insertAdjacentElement("afterend", message);
      }
    }
  });
}

/**
 * Vuelve a dibujar los diagramas de la ventana cuyos colores ya no son los del
 * tema. Cada contenedor resuelve sus tokens (un snippet puede pisarlos solo en
 * una vista); si la clave no cambió, no se toca.
 */
function redibujarTodo(): Promise<void> {
  return enCola(async () => {
    const hosts = Array.from(document.querySelectorAll<HTMLElement>(".mic-mermaid")).filter((h) =>
      fuentes.has(h),
    );
    if (hosts.length === 0) return;
    const { default: mermaid } = await import("mermaid");
    for (const host of hosts) {
      if (!host.isConnected) continue;
      const dentro = host.parentElement ?? document.body;
      const { clave, config } = configuracion("mycelium", dentro);
      if (claves.get(host) === clave) continue;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", ...config });
      try {
        await dibujar(host, fuentes.get(host)!, clave);
      } catch {
        // esperado solo si Mermaid falla con un tema y no con otro: el dibujo
        // anterior queda, con los colores viejos.
      }
    }
  });
}

let vigilando = false;

/**
 * Una sola vez: al cambiar el tema, el modo o la atmósfera (atributos de
 * `<html>`) o los snippets (`<style>` del `<head>`), redibujar. Agrupa las
 * ráfagas: cambiar de tema toca varios atributos seguidos.
 */
function vigilarTema() {
  if (vigilando || typeof MutationObserver === "undefined") return;
  vigilando = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const programar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void redibujarTodo();
    }, 80);
  };
  new MutationObserver(programar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-dark", "data-atmosfera", "style"],
  });
  new MutationObserver(programar).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
