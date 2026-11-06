"use client";

/**
 * El catálogo de comandos desde React (`FUN-XL-04`, Parte 1): registrar
 * comandos mientras un componente está montado, leer la lista viva y el
 * despachador de atajos del workspace.
 */
import { useEffect, useSyncExternalStore } from "react";
import { avisarFallo } from "@/stores/avisosStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import {
  resolverTexto,
  comandoParaTecla,
  listarComandos,
  registrarComandos,
  sobreescriturasActuales,
  suscribirComandos,
  versionSobreescrituras,
} from "./registro";
import { grabandoAtajo } from "./grabacion";
import { estaPersonalizado } from "./personalizar";
import { cargarPreferenciasAtajos } from "./preferenciasAtajos";
import type { Comando, ContextoComando, Fase } from "./registro";

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

/**
 * Un número que cambia cuando el usuario cambia sus atajos: para que quien los
 * muestra (paleta, hoja, Configuración) se vuelva a pintar.
 */
export function useVersionAtajos(): number {
  return useSyncExternalStore(suscribirComandos, versionSobreescrituras, versionSobreescrituras);
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
 * El despachador de atajos del workspace: un `keydown` en `window` en burbuja
 * —la misma fase que tenían los atajos sueltos de `workspace/page.tsx`, así
 * CodeMirror, la consola y el lienzo atienden antes lo suyo— y otro en
 * captura para los pocos comandos `enCaptura` (F6), que tienen que llegar
 * aunque la consola o el editor se queden con la tecla. Busca en el registro
 * el comando de la tecla y lo ejecuta. Los atajos con manejador propio (F1,
 * F12, la captura rápida) no pasan por acá.
 */
export function useDespachadorAtajos(navegar: (url: string) => void) {
  useEffect(() => {
    // Los atajos del usuario (Parte 3), antes de la primera tecla.
    cargarPreferenciasAtajos();
    const atender = (fase: Fase) => (event: KeyboardEvent) => {
      if (grabandoAtajo()) return;
      const dev = modoDevActivo();
      const comando = comandoParaTecla(event, listarComandos(), dev, fase);
      if (!comando) return;
      // Un atajo que el usuario eligió no le quita la tecla a quien ya la usó
      // (el editor, un lienzo): los de fábrica se eligieron libres.
      const personalizado = estaPersonalizado(comando.id, sobreescriturasActuales());
      if ((comando.ignorarSiPrevenido || personalizado) && event.defaultPrevented) return;
      const ctx: ContextoComando = { navegar, dev };
      if (comando.disponible && !comando.disponible(ctx)) return;
      event.preventDefault();
      if (fase === "captura") event.stopPropagation();
      ejecutarComando(comando, ctx);
    };
    const enCaptura = atender("captura");
    const enBurbuja = atender("burbuja");
    window.addEventListener("keydown", enCaptura, true);
    window.addEventListener("keydown", enBurbuja);
    return () => {
      window.removeEventListener("keydown", enCaptura, true);
      window.removeEventListener("keydown", enBurbuja);
    };
  }, [navegar]);
}
