"use client";

import { Sprout } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { carpetaEsporas, listarEsporas, type Espora } from "@/lib/esporasVault";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./EsporaMenu.module.css";

/**
 * Lista de Esporas para insertar en la nota abierta (`FUN-M-03`, spec § 3.2).
 * Va en un portal a `<body>` con posición fija, como el popover de enlaces: así
 * no lo recorta el overflow de la toolbar ni un ancestro con `transform`.
 *
 * El aviso lo decide quien inserta (p. ej. un frontmatter que no se pudo
 * fusionar): mientras haya aviso el menú sigue abierto para que se lea.
 */
export function EsporaMenu({
  top,
  left,
  aviso,
  onElegir,
  onCerrar,
}: {
  top: number;
  left: number;
  aviso: string | null;
  onElegir: (espora: Espora) => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const notas = useVaultStore((s) => s.notas);
  const rutaConfigurada = usePreferencesStore((s) => s.prefs.carpetaEsporas);
  const esporas = useMemo(() => listarEsporas(notas), [notas, rutaConfigurada]);
  const carpeta = useMemo(() => carpetaEsporas(), [rutaConfigurada]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onCerrar();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCerrar]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ position: "fixed", top, left }} role="menu">
      {esporas.length === 0 ? (
        <p className={styles.vacio}>
          No hay Esporas en <code>{carpeta}</code>. Creá plantillas desde el panel de Esporas
          del rail.
        </p>
      ) : (
        esporas.map((espora) => (
          <button
            key={espora.id}
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => onElegir(espora)}
          >
            <Sprout size={14} aria-hidden />
            <span className={styles.nombre}>{espora.titulo}</span>
          </button>
        ))
      )}
      {aviso && (
        <p className={styles.aviso} role="alert">
          {aviso}
        </p>
      )}
    </div>,
    document.body,
  );
}
