/**
 * La paleta de las gráficas del tema activo, para un componente (`FUN-L-32`).
 *
 * La app no avisa de un cambio de tema con un evento: lo que cambia son los
 * atributos de `<html>` (`data-theme`, `data-dark`, `data-atmosfera`, y `style`
 * con un tema propio) y los `<style>` del `<head>` (los snippets). Se observa
 * lo mismo que `lib/mermaid.ts`, con un solo par de observadores para toda la
 * ventana y solo mientras haya algún componente suscripto: sin gráficas a la
 * vista no hay nada escuchando.
 *
 * La lectura de los tokens va en `leerPaletaGraficas`, que guarda en caché por
 * combinación de colores: si el cambio no tocó los colores de la paleta, el
 * objeto es el mismo y React no vuelve a dibujar.
 */
import { useSyncExternalStore } from "react";
import { leerPaletaGraficas, paletaEnCache, TOKENS_POR_DEFECTO, type PaletaGraficas } from "@/lib/paletaGraficas";

const oyentes = new Set<() => void>();
let actual: PaletaGraficas | null = null;
let desconectar: (() => void) | null = null;

function releer() {
  const nueva = leerPaletaGraficas();
  if (nueva === actual) return;
  actual = nueva;
  for (const o of oyentes) o();
}

function conectar() {
  if (typeof MutationObserver === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Cambiar de tema toca varios atributos seguidos: una sola relectura por ráfaga.
  const programar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      releer();
    }, 50);
  };
  const html = new MutationObserver(programar);
  html.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-dark", "data-atmosfera", "style"],
  });
  const head = new MutationObserver(programar);
  head.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => {
    if (timer) clearTimeout(timer);
    html.disconnect();
    head.disconnect();
  };
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  if (!desconectar) {
    desconectar = conectar();
    // Pudo cambiar el tema mientras nadie miraba.
    releer();
  }
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0 && desconectar) {
      desconectar();
      desconectar = null;
    }
  };
}

function leer(): PaletaGraficas {
  if (!actual) actual = leerPaletaGraficas();
  return actual;
}

function enServidor(): PaletaGraficas {
  const d = TOKENS_POR_DEFECTO;
  return paletaEnCache(d.acento, d.glow, d.gris, d.modo, d.superficie);
}

/** La paleta del tema activo; el componente se redibuja al cambiar de tema o de modo. */
export function usePaletaGraficas(): PaletaGraficas {
  return useSyncExternalStore(suscribir, leer, enServidor);
}
