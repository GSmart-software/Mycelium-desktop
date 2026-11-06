"use client";

import { ChevronRight, CircleDot, FilePlus2, FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import { carpetaEsporas, listarEsporas, type Espora } from "@/lib/esporasVault";
import { ICONO_POR_TIPO } from "@/lib/iconosDeTipo";
import {
  ESTADO_INICIAL_NUEVO,
  OPCIONES_NUEVO,
  teclaEnNuevo,
  tituloConDetalle,
  type EstadoNuevo,
  type OpcionNuevo,
} from "@/lib/comandos/nuevo";
import { anotarPaso } from "@/lib/comandos/preferenciasMacros";
import { carpetaDestino, crearDesdeEsporaYAbrir, crearYAbrir, pedirYCrearCarpeta } from "@/lib/crear";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { avisarFallo } from "@/stores/avisosStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
// La piel de la paleta de comandos (Ctrl+P), temas incluidos.
import styles from "./PaletaComandos.module.css";

const ICONO: Record<OpcionNuevo["tipo"], ComponentType<{ size?: number }>> = {
  nota: ICONO_POR_TIPO.markdown,
  carpeta: FolderPlus,
  lienzo: ICONO_POR_TIPO.canvas,
  tabla: ICONO_POR_TIPO.base,
  dibujo: ICONO_POR_TIPO.excalidraw,
  diagrama: ICONO_POR_TIPO.drawio,
  espora: CircleDot,
};

/**
 * El menú «Nuevo…» (`FUN-XL-04`, Parte 4, Ctrl+Shift+N): crear cualquier cosa
 * sin mouse. Primer paso, los tipos; «Nueva desde Espora…» abre un segundo
 * paso con las plantillas. Se crea en la carpeta seleccionada del explorador
 * (o en la raíz), con la misma lógica que el explorador (`lib/crear.ts`).
 *
 * Teclado (`teclaEnNuevo`): ↑/↓ recorren, Enter elige, → entra a las Esporas,
 * ← o Esc vuelven a los tipos, Esc en los tipos cierra.
 */
export function DialogoNuevo() {
  const paso = useUiStore((s) => s.nuevo);
  if (!paso) return null;
  // Con `key`: el comando «Nueva desde Espora…» con el diálogo ya abierto lo
  // vuelve a abrir directo en las Esporas.
  return <Dialogo key={paso} pasoInicial={paso} />;
}

function Dialogo({ pasoInicial }: { pasoInicial: "tipos" | "esporas" }) {
  const router = useRouter();
  const navegar = useCallback((url: string) => router.replace(url), [router]);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const idLista = useId();
  const [estado, setEstado] = useState<EstadoNuevo>({ ...ESTADO_INICIAL_NUEVO, paso: pasoInicial });
  const cerrar = useCallback(() => useUiStore.getState().setNuevo(null), []);
  useDialogoModal({ abierto: true, cerrar, dialogoRef });

  const notas = useVaultStore((s) => s.notas);
  const rutaEsporas = usePreferencesStore((s) => s.prefs.carpetaEsporas);
  // `listarEsporas` lee la carpeta de las preferencias: cambiarla rehace la lista.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const esporas = useMemo(() => listarEsporas(notas), [notas, rutaEsporas]);

  const enEsporas = estado.paso === "esporas";
  const cantidad = enEsporas ? esporas.length : OPCIONES_NUEVO.length;

  // Al cambiar de paso, el foco sigue en la lista (sin Esporas, en el aviso).
  useEffect(() => {
    const destino = dialogoRef.current?.querySelector<HTMLElement>("[role='listbox'], p[tabindex]");
    // Al cambiar de paso, la lista que tenía el foco puede desmontarse (sin
    // Esporas se reemplaza por el aviso) y el foco cae en `body` antes de este
    // efecto: también ahí se recupera (visto en la prueba en vivo, 2026-11-06).
    const activo = document.activeElement;
    const focoPerdido = !activo || activo === document.body;
    if (destino && (focoPerdido || dialogoRef.current?.contains(activo)) && activo !== destino) {
      destino.focus();
    }
  }, [estado.paso]);

  // La opción activa se ve.
  useEffect(() => {
    listaRef.current?.children[estado.activa]?.scrollIntoView({ block: "nearest" });
  }, [estado]);

  function elegirTipo(o: OpcionNuevo) {
    if (o.tipo === "espora") {
      setEstado({ paso: "esporas", activa: 0 });
      return;
    }
    cerrar();
    // Si se graba una macro (`FUN-XL-04`, Parte 6), lo elegido es el paso.
    anotarPaso({ tipo: "comando", comando: o.comando });
    if (o.tipo === "carpeta") {
      void pedirYCrearCarpeta(carpetaDestino()).catch(avisarFallo("crear la carpeta"));
    } else {
      void crearYAbrir(navegar, o.tipo).catch(avisarFallo(`crear «${o.titulo}»`));
    }
  }

  function elegirEspora(e: Espora) {
    cerrar();
    anotarPaso({ tipo: "espora", espora: e.titulo });
    void crearDesdeEsporaYAbrir(navegar, e).catch(avisarFallo(`crear la nota desde «${e.titulo}»`));
  }

  function elegir(i: number) {
    if (enEsporas) {
      const e = esporas[i];
      if (e) elegirEspora(e);
    } else {
      const o = OPCIONES_NUEVO[i];
      if (o) elegirTipo(o);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const abreSubmenu = !enEsporas && OPCIONES_NUEVO[estado.activa]?.tipo === "espora";
    const r = teclaEnNuevo(estado, e.key, cantidad, abreSubmenu);
    if (r.accion === "nada") return;
    e.preventDefault();
    // Esc lo resuelve este diálogo (volver o cerrar): que no lo vea también
    // `useDialogoModal`, que cerraría desde las Esporas.
    e.stopPropagation();
    if (r.accion === "mover") setEstado(r.estado);
    else if (r.accion === "elegir") elegir(r.indice);
    else if (r.accion === "volver") {
      setEstado({ paso: "tipos", activa: OPCIONES_NUEVO.findIndex((o) => o.tipo === "espora") });
    } else cerrar();
  }

  const idOpcion = (i: number) => `${idLista}-${i}`;
  const titulo = enEsporas ? "Nueva nota desde una Espora" : "Nuevo";

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={styles.paleta}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        data-cede-a-la-ayuda
      >
        <div className={styles.campo}>
          {enEsporas ? (
            <CircleDot size={16} aria-hidden className={styles.lupa} />
          ) : (
            <FilePlus2 size={16} aria-hidden className={styles.lupa} />
          )}
          <span className={styles.input} aria-hidden>
            {enEsporas ? "Nueva nota desde una Espora…" : "Nuevo…"}
          </span>
        </div>
        {enEsporas && esporas.length === 0 ? (
          <p className={styles.vacio} tabIndex={0} onKeyDown={onKeyDown}>
            No hay Esporas en <code>{carpetaEsporas()}</code>. Crea plantillas desde el panel de Esporas
            del rail. <kbd>←</kbd> vuelve.
          </p>
        ) : (
          <ul
            ref={listaRef}
            id={idLista}
            role="listbox"
            tabIndex={0}
            className={styles.lista}
            aria-label={titulo}
            aria-activedescendant={cantidad ? idOpcion(estado.activa) : undefined}
            onKeyDown={onKeyDown}
          >
            {enEsporas
              ? esporas.map((e, i) => (
                  <li
                    key={e.id}
                    id={idOpcion(i)}
                    role="option"
                    aria-selected={i === estado.activa}
                    className={i === estado.activa ? `${styles.opcion} ${styles.opcionActiva}` : styles.opcion}
                    onPointerMove={() => i !== estado.activa && setEstado({ ...estado, activa: i })}
                    onClick={() => elegirEspora(e)}
                  >
                    <CircleDot size={15} aria-hidden />
                    <span className={styles.titulo}>{e.titulo}</span>
                  </li>
                ))
              : OPCIONES_NUEVO.map((o, i) => {
                  const Icono = ICONO[o.tipo];
                  return (
                    <li
                      key={o.tipo}
                      id={idOpcion(i)}
                      role="option"
                      aria-selected={i === estado.activa}
                      data-tipo={o.tipo}
                      className={i === estado.activa ? `${styles.opcion} ${styles.opcionActiva}` : styles.opcion}
                      onPointerMove={() => i !== estado.activa && setEstado({ ...estado, activa: i })}
                      onClick={() => elegirTipo(o)}
                    >
                      <Icono size={15} />
                      <span className={styles.titulo}>{tituloConDetalle(o)}</span>
                      {o.tipo === "espora" && <ChevronRight size={14} aria-hidden />}
                    </li>
                  );
                })}
          </ul>
        )}
        <p className={styles.pie} aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd> moverse · <kbd>Enter</kbd> crear ·{" "}
          {enEsporas ? (
            <>
              <kbd>←</kbd> o <kbd>Esc</kbd> volver
            </>
          ) : (
            <>
              <kbd>→</kbd> Esporas · <kbd>Esc</kbd> cerrar
            </>
          )}{" "}
          · en la carpeta seleccionada
        </p>
      </div>
    </div>
  );
}
