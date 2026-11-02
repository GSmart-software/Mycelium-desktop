"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { RevisionVault } from "@/lib/estadisticasVault";
import { abrirPestanaSalud } from "@/lib/saludPestana";

/**
 * Las acciones que comparten el panel lateral de salud y la pestaña «Salud del
 * vault» (`FUN-L-32`): poner una pestaña en la URL, abrir la pestaña de salud y
 * generar el informe como nota.
 */

/** Pone la pestaña `id` en la URL, como el resto de la app. */
export function useNavegar(): (id: string) => void {
  const router = useRouter();
  return useCallback((id: string) => router.replace(`/workspace?note=${encodeURIComponent(id)}`), [router]);
}

/** Abre (o enfoca) la pestaña de salud; cierra el panel lateral de salud. */
export function useAbrirPestanaSalud(): () => void {
  const navegar = useNavegar();
  return useCallback(() => abrirPestanaSalud(navegar), [navegar]);
}

/**
 * Genera el informe como nota con la revisión que se está mostrando (no vuelve
 * a recorrer el vault) y lo abre. `generando` sirve para deshabilitar el botón
 * mientras tanto; los fallos ya los avisa `generarInformeSalud`.
 */
export function useGenerarInforme(revision: RevisionVault | null): { generando: boolean; generar: () => Promise<void> } {
  const navegar = useNavegar();
  const [generando, setGenerando] = useState(false);
  const generar = useCallback(async () => {
    if (!revision || generando) return;
    setGenerando(true);
    try {
      const { generarInformeSalud } = await import("@/lib/informeSaludVault");
      await generarInformeSalud({ revision, navegar });
    } catch {
      // `generarInformeSalud` ya avisó.
    } finally {
      setGenerando(false);
    }
  }, [revision, generando, navegar]);
  return { generando, generar };
}
