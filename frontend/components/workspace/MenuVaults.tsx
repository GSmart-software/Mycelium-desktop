"use client";

import { AppWindow, ChevronDown, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { abrirVaultEnVentana, listarVaults, nombreDeVault, vincularVault, type VaultRef } from "@/lib/vaultMode";
import { avisar } from "@/stores/avisosStore";
import styles from "./MenuVaults.module.css";

/**
 * El nombre del vault en la barra superior, que además abre OTRO vault
 * (`FUN-S-24`).
 *
 * Para tener dos vaults a la vez había que salir del actual, abrir el segundo
 * «en ventana nueva» desde el selector y volver a abrir el primero. Ahora el
 * nombre despliega los vaults registrados: cada uno se abre en una ventana
 * nueva —o, si ya está abierto en otra, esa se trae al frente (`FUN-L-16`)— sin
 * tocar la de acá. «Abrir carpeta…» registra una carpeta nueva y hace lo mismo.
 */
export function MenuVaults({ rutaActual }: { rutaActual: string }) {
  const [abierto, setAbierto] = useState(false);
  const [vaults, setVaults] = useState<VaultRef[] | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };

  // La lista se pide al abrir el menú, no al montar: puede haber cambiado desde
  // otra ventana (una carpeta vinculada allá).
  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    listarVaults()
      .then((lista) => {
        if (vigente) setVaults(lista);
      })
      .catch((e) => {
        console.error("[Mycelium] vaults · no se pudo leer el registro de vaults", e);
        if (vigente) setVaults([]);
      });
    return () => {
      vigente = false;
    };
  }, [abierto]);

  // Afuera o Escape cierran; las flechas recorren los ítems.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) cerrar(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const siguiente = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[siguiente].focus();
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [abierto]);

  // El foco entra al primer ítem cuando la lista ya está.
  useEffect(() => {
    if (abierto && vaults !== null) {
      menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    }
  }, [abierto, vaults]);

  const abrirEnVentana = async (ruta: string) => {
    cerrar(false);
    try {
      const creada = await abrirVaultEnVentana(ruta);
      if (!creada) avisar(`«${nombreDeVault(ruta)}» ya estaba abierto: se trajo su ventana.`);
    } catch (e) {
      console.error("[Mycelium] vaults · no se pudo abrir el vault en otra ventana", e);
      avisar(`No se pudo abrir «${nombreDeVault(ruta)}».`);
    }
  };

  const abrirCarpeta = async () => {
    cerrar(false);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const elegida = await open({ directory: true });
      if (typeof elegida !== "string") return; // cancelado
      const vault = await vincularVault(elegida);
      await abrirEnVentana(vault.ruta);
    } catch (e) {
      console.error("[Mycelium] vaults · no se pudo vincular la carpeta", e);
      avisar(e instanceof Error ? e.message : "No se pudo abrir la carpeta.");
    }
  };

  const otros = (vaults ?? []).filter((v) => !mismaRuta(v.ruta, rutaActual));

  return (
    <div className={styles.raiz} ref={raiz}>
      <button
        ref={boton}
        type="button"
        className={styles.boton}
        title={`${rutaActual} · abrir otro vault`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => (abierto ? cerrar(false) : setAbierto(true))}
      >
        <span className={styles.nombre}>{nombreDeVault(rutaActual)}</span>
        <ChevronDown size={13} aria-hidden className={styles.flecha} />
      </button>

      {abierto && (
        <div ref={menu} className={styles.menu} role="menu" aria-label="Vaults">
          <div className={styles.actual}>
            <span className={styles.actualNombre}>{nombreDeVault(rutaActual)}</span>
            <span className={styles.actualNota}>Abierto en esta ventana</span>
          </div>

          {vaults === null ? (
            <p className={styles.vacio}>Cargando…</p>
          ) : otros.length > 0 ? (
            <>
              <p className={styles.seccion}>Abrir en una ventana nueva</p>
              {otros.map((v) => (
                <button
                  key={v.ruta}
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  title={v.ruta}
                  onClick={() => void abrirEnVentana(v.ruta)}
                >
                  <AppWindow size={14} aria-hidden className={styles.icono} />
                  <span className={styles.itemTexto}>
                    <span className={styles.itemNombre}>{v.nombre}</span>
                    <span className={styles.itemRuta}>{v.ruta}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <p className={styles.vacio}>No hay otros vaults registrados.</p>
          )}

          <div className={styles.separador} />
          <button type="button" role="menuitem" className={styles.item} onClick={() => void abrirCarpeta()}>
            <FolderPlus size={14} aria-hidden className={styles.icono} />
            <span className={styles.itemNombre}>Abrir carpeta…</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ¿Son la misma carpeta? En Windows las rutas no distinguen mayúsculas ni el
 * tipo de barra, y pueden venir con una barra final.
 */
function mismaRuta(a: string, b: string): boolean {
  const n = (r: string) => r.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return n(a) === n(b);
}
