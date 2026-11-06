"use client";

/**
 * El catálogo de comandos desde React (`FUN-XL-04`, Parte 1): registrar
 * comandos mientras un componente está montado, leer la lista viva y el
 * despachador de atajos del workspace.
 */
import { useEffect, useSyncExternalStore } from "react";
import { avisarFallo } from "@/stores/avisosStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { resolverTexto, comandoParaTecla, listarComandos, registrarComandos, suscribirComandos } from "./registro";
import type { Comando, ContextoComando } from "./registro";

/**
 * Suma los comandos al registro al montar y los saca al desmontar. La lista
 * tiene que ser estable (una constante de módulo o memorizada): si cambia, se
 * dan de baja y de alta otra vez.
 */
export function useRegistrarComandos(lista: readonly Comando[]) {
  useEffect(() => registrarComandos(lista), [lista]);
}

/** Los comandos registrados; se vuelve a pintar cuando cambian. */
export function useComandos(): readonly Comando[] {
  return useSyncExternalStore(suscribirComandos, listarComandos, listarComandos);
}

/** ¿Está encendido el modo desarrollador? (Se carga de Rust al arrancar.) */
export const modoDevActivo = () => useUpdaterStore.getState().estado?.dev ?? false;

/** Ejecuta un comando y avisa si falla, en vez de dejar una promesa rechazada. */
export function ejecutarComando(c: Comando, ctx: ContextoComando) {
  try {
    const r = c.ejecutar(ctx);
    if (r instanceof Promise) r.catch(avisarFallo(`ejecutar «${resolverTexto(c.titulo)}»`));
  } catch (err) {
    avisarFallo(`ejecutar «${resolverTexto(c.titulo)}»`)(err);
  }
}

/**
 * El despachador de atajos del workspace: un solo `keydown` en `window`, en
 * burbuja —la misma fase que tenían los atajos sueltos de `workspace/page.tsx`,
 * así CodeMirror, la consola y el lienzo atienden antes lo suyo—, que busca en
 * el registro el comando de la tecla y lo ejecuta. Los atajos con manejador
 * propio (F1, F12, la captura rápida) no pasan por acá.
 */
export function useDespachadorAtajos(navegar: (url: string) => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dev = modoDevActivo();
      const comando = comandoParaTecla(event, listarComandos(), dev);
      if (!comando) return;
      if (comando.ignorarSiPrevenido && event.defaultPrevented) return;
      const ctx: ContextoComando = { navegar, dev };
      if (comando.disponible && !comando.disponible(ctx)) return;
      event.preventDefault();
      ejecutarComando(comando, ctx);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navegar]);
}
