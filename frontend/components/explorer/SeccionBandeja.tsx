"use client";

import { Columns2, FileText, Inbox, Link2, Pencil, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MOTIVO_NO_ELIMINA,
  MOTIVO_NO_RENOMBRA,
  RUTA_BANDEJA_DEFECTO,
  normalizarRutaBandeja,
} from "@/lib/bandeja";
import { asegurarBandeja, entradasDeBandeja } from "@/lib/bandejaVault";
import { EVENTO_BANDEJA, EVENTO_NOTA_GUARDADA, EVENTO_RECARGA } from "@/lib/eventos";
import { enlaceANota } from "@/lib/menuNota";
import { avisoTocaA } from "@/lib/recargaExterna";
import { nombreDeVault } from "@/lib/vaultMode";
import { avisar, avisarFallo } from "@/stores/avisosStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { SectionHeader } from "./ExplorerPanel";
import styles from "./ExplorerPanel.module.css";

/** Dónde se recuerda si la sección está plegada, como `mic-sec-archivos`. */
const CLAVE_PLEGADO = "mic-sec-bandeja";

const ico = (Icono: typeof Inbox) => <Icono size={15} aria-hidden />;

/**
 * La sección «Bandeja» del explorador (`FUN-L-33`): arriba de «Archivos»,
 * plegable como ella, con una entrada por bandeja y su contador de entradas sin
 * procesar.
 *
 * Hoy hay una sola entrada, la **Bandeja del vault**. La lista está armada para
 * sumar la **Bandeja personal** (la Parte B de `FUN-L-33`): cada entrada es un
 * `FilaBandeja` con su propio contador, menú y forma de abrirse.
 */
export function SeccionBandeja() {
  const [plegada, setPlegada] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(CLAVE_PLEGADO) === "1",
  );
  const alternar = () =>
    setPlegada((v) => {
      const siguiente = !v;
      localStorage.setItem(CLAVE_PLEGADO, siguiente ? "1" : "0");
      return siguiente;
    });

  return (
    <div className={`${styles.paneBandeja} mic-explorador-bandeja`}>
      <SectionHeader title="Bandeja" collapsed={plegada} onToggle={alternar} />
      {!plegada && (
        <div className={styles.listaBandejas}>
          <FilaBandejaVault />
        </div>
      )}
    </div>
  );
}

/** La ruta de la Bandeja del vault, siguiendo la preferencia (normalizada). */
function useRutaBandeja(): string {
  const bruta = usePreferencesStore((s) => s.prefs.rutaBandeja);
  return normalizarRutaBandeja(bruta ?? "") ?? RUTA_BANDEJA_DEFECTO;
}

/**
 * Cuántas entradas sin procesar tiene la Bandeja del vault. Se relee del disco
 * al anotar (`EVENTO_BANDEJA`), cuando la app guarda la nota
 * (`EVENTO_NOTA_GUARDADA`) y cuando cambia por fuera (`EVENTO_RECARGA` con su
 * ruta): leer un archivo chico es más simple y más fiel que llevar la cuenta.
 */
function useEntradas(ruta: string, rutaVault: string | null): number {
  const [entradas, setEntradas] = useState(0);
  useEffect(() => {
    if (!rutaVault) return;
    let vivo = true;
    const releer = () => {
      void entradasDeBandeja()
        .then((n) => {
          if (vivo) setEntradas(n);
        })
        .catch(() => {
          // Sin poder leerla, mejor sin número que con uno viejo.
          if (vivo) setEntradas(0);
        });
    };
    const alGuardar = (e: Event) => {
      if ((e as CustomEvent<{ notaId?: string }>).detail?.notaId === ruta) releer();
    };
    const alRecargar = (e: Event) => {
      if (avisoTocaA(e, ruta)) releer();
    };
    releer();
    window.addEventListener(EVENTO_BANDEJA, releer);
    window.addEventListener(EVENTO_NOTA_GUARDADA, alGuardar);
    window.addEventListener(EVENTO_RECARGA, alRecargar);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_BANDEJA, releer);
      window.removeEventListener(EVENTO_NOTA_GUARDADA, alGuardar);
      window.removeEventListener(EVENTO_RECARGA, alRecargar);
    };
  }, [ruta, rutaVault]);
  return entradas;
}

/** La entrada «Del vault · <nombre>». */
function FilaBandejaVault() {
  const router = useRouter();
  const activa = useSearchParams().get("note");
  const ruta = useRutaBandeja();
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const entradas = useEntradas(ruta, rutaVault);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const nombre = rutaVault ? nombreDeVault(rutaVault) : "";

  /** Abre la Bandeja (creándola si falta). `fija`: como nota completa, no en vista previa. */
  const abrir = (como: "previa" | "fija" | "al-lado") => {
    void asegurarBandeja()
      .then((id) => {
        const tabs = useTabsStore.getState();
        if (como === "al-lado") tabs.splitPaneWithNota(id, tabs.activePaneId, "right");
        else tabs.openNote(id);
        if (como === "fija") {
          const s = useTabsStore.getState();
          const hoja = allLeaves(s.root).find((l) => l.id === s.activePaneId);
          if (hoja?.activeTabId) s.pinTab(hoja.id, hoja.activeTabId);
        }
        router.replace(`/workspace?note=${encodeURIComponent(id)}`);
      })
      .catch(avisarFallo("abrir la Bandeja"));
  };

  const copiarEnlace = () => {
    void asegurarBandeja()
      .then((id) => {
        const { notas, carpetas } = useVaultStore.getState();
        const nota = notas.find((n) => n.id === id);
        if (!nota) throw new Error("la Bandeja todavía no está en el índice");
        const enlace = enlaceANota(nota, notas, carpetas);
        return navigator.clipboard.writeText(enlace).then(() => avisar(`Enlace copiado: ${enlace}`));
      })
      .catch(avisarFallo("copiar el enlace"));
  };

  const items: MenuItem[] = [
    { label: "Abrir como nota", icono: ico(FileText), onClick: () => abrir("fija") },
    { label: "Abrir al lado", icono: ico(Columns2), onClick: () => abrir("al-lado") },
    {
      label: "Copiar enlace",
      icono: ico(Link2),
      title: "Copia el [[enlace]] a la Bandeja para pegarlo en otra nota",
      onClick: copiarEnlace,
    },
    // Visibles y apagadas, con el motivo: así se entiende por qué no están.
    { label: "Renombrar", icono: ico(Pencil), separadorAntes: true, disabled: true, title: MOTIVO_NO_RENOMBRA },
    { label: "Mover a la papelera", icono: ico(Trash2), disabled: true, title: MOTIVO_NO_ELIMINA },
  ];

  const abierta = activa === ruta;
  return (
    <>
      <button
        type="button"
        className={[styles.row, styles.filaBandeja, abierta ? styles.rowActive : "", "mic-bandeja-fila"]
          .filter(Boolean)
          .join(" ")}
        data-bandeja="vault"
        aria-current={abierta ? "page" : undefined}
        title={`Bandeja de este vault (${ruta}). Doble clic: abrir como nota; clic derecho: menú`}
        onClick={() => abrir("previa")}
        onDoubleClick={() => abrir("fija")}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <Inbox size={15} className={styles.noteIcon} aria-hidden />
        <span className={styles.name}>
          Del vault <span className={styles.bandejaDetalle}>· {nombre}</span>
        </span>
        {entradas > 0 && (
          <span
            className={`${styles.bandejaCuenta} mic-bandeja-cuenta`}
            aria-label={`${entradas} ${entradas === 1 ? "entrada" : "entradas"} sin procesar`}
          >
            {entradas}
          </span>
        )}
      </button>
      {menu && <ContextMenu {...menu} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
