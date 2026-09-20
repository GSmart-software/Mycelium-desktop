"use client";

import { FilePlus, Palette, PanelLeft, Search, Settings, SunMoon, Terminal, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ICONO_POR_TIPO } from "@/lib/iconosDeTipo";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { ATMOSFERAS } from "@/lib/atmosferas";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useRecientesStore } from "@/stores/recientesStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore, type TreeCarpeta } from "@/stores/vaultStore";
import { IconoGrafo } from "./IconoGrafo";
import styles from "./PaletaComandos.module.css";

/**
 * La paleta de la barra superior (rediseño del cascarón, 2026-09-19): el centro
 * del marco pasa de ser un buscador que no hacía nada (`DEF-090`) a ser el
 * camino corto a cualquier nota o acción, como el selector rápido de Obsidian y
 * la paleta de VS Code.
 *
 * Un solo campo. Por defecto busca notas por nombre (Ctrl+O); si el texto
 * empieza con «>», busca comandos (Ctrl+P). Sin coincidencia exacta ofrece crear
 * la nota con ese nombre. Patrón combobox: el foco queda en el campo y la
 * opción activa se anuncia con `aria-activedescendant`.
 */

type Opcion = {
  id: string;
  titulo: string;
  detalle?: string;
  icono: LucideIcon | typeof IconoGrafo;
  ejecutar: () => unknown;
};

/** Sin tildes ni mayúsculas: «documentacion» encuentra «Documentación». */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Puntaje de coincidencia: empieza igual > contiene > las letras en orden
 * (subsecuencia). `null` = no coincide. Menor es mejor.
 */
function puntaje(texto: string, consulta: string): number | null {
  if (!consulta) return 0;
  const t = normalizar(texto);
  const q = normalizar(consulta);
  if (t.startsWith(q)) return 0;
  const i = t.indexOf(q);
  if (i >= 0) return 1 + i / 100;
  let j = 0;
  for (const c of t) if (c === q[j]) j++;
  return j === q.length ? 3 : null;
}

/** Ruta legible de una carpeta («docs / procesos»), para desempatar homónimas. */
function rutaDe(carpetaId: string | null, porId: Map<string, TreeCarpeta>): string {
  const partes: string[] = [];
  for (let id = carpetaId; id; ) {
    const c = porId.get(id);
    if (!c) break;
    partes.unshift(c.nombre);
    id = c.padreId;
  }
  return partes.join(" / ");
}

const MAX_RESULTADOS = 50;

/**
 * Tras abrir una nota desde la paleta, el foco va a la nota y no vuelve a lo que
 * estaba enfocado antes (el diálogo lo devuelve al cerrar): si era otra
 * pestaña, quedaba un anillo sobre algo que ya no está activo. Se espera a que
 * el pane activo monte el documento, unos cuadros como máximo.
 */
function enfocarNota(notaId: string, intentos = 30) {
  requestAnimationFrame(() => {
    const { activePaneId, activeNotaId } = useTabsStore.getState();
    const cuerpo = document.querySelector(`[data-pane-id="${CSS.escape(activePaneId)}"]`);
    const destino =
      cuerpo?.querySelector<HTMLElement>(".cm-content") ??
      cuerpo?.querySelector<HTMLElement>(".mic-preview");
    if (activeNotaId() === notaId && destino) {
      if (!destino.isContentEditable && !destino.hasAttribute("tabindex")) destino.tabIndex = -1;
      destino.focus();
    } else if (intentos > 0) {
      enfocarNota(notaId, intentos - 1);
    }
  });
}

export function PaletaComandos() {
  const modo = useUiStore((s) => s.paleta);
  const setPaleta = useUiStore((s) => s.setPaleta);
  const abierto = modo !== null;
  const router = useRouter();
  const notas = useVaultStore((s) => s.notas);
  const recientes = useRecientesStore((s) => s.recientes);
  const carpetas = useVaultStore((s) => s.carpetas);

  const [texto, setTexto] = useState("");
  const [activa, setActiva] = useState(0);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const idLista = useId();
  const idTitulo = useId();

  const cerrar = useCallback(() => setPaleta(null), [setPaleta]);
  useDialogoModal({ abierto, cerrar, dialogoRef });

  // Cada apertura arranca limpia; en modo comandos, con el «>» ya puesto.
  useEffect(() => {
    if (!abierto) return;
    setTexto(modo === "comandos" ? ">" : "");
    setActiva(0);
  }, [abierto, modo]);

  const abrirNota = useCallback(
    (id: string) => {
      useTabsStore.getState().openNote(id);
      router.replace(`/workspace?note=${encodeURIComponent(id)}`);
      enfocarNota(id);
    },
    [router],
  );

  const comandos: Opcion[] = useMemo(
    () => [
      {
        id: "cmd-nueva-nota",
        titulo: "Nueva nota",
        detalle: "En la carpeta seleccionada",
        icono: FilePlus,
        ejecutar: async () => {
          const v = useVaultStore.getState();
          abrirNota(await v.createNota(v.activeFolderId));
        },
      },
      {
        id: "cmd-buscar",
        titulo: "Buscar en el contenido del vault",
        icono: Search,
        ejecutar: () => usePanelLayoutStore.setState({ activeSection: "search", lastSection: "search" }),
      },
      {
        id: "cmd-grafo",
        titulo: "Abrir el grafo de conexiones",
        icono: IconoGrafo,
        ejecutar: () => abrirNota(GRAPH_TAB_ID),
      },
      {
        id: "cmd-explorador",
        titulo: "Mostrar u ocultar el explorador",
        detalle: "Ctrl+\\",
        icono: PanelLeft,
        ejecutar: () => usePanelLayoutStore.getState().toggleSection("explorer"),
      },
      {
        id: "cmd-consola",
        titulo: "Nueva consola",
        icono: Terminal,
        ejecutar: async () => {
          const { crearTerminal } = await import("@/lib/terminal");
          router.replace(`/workspace?note=${encodeURIComponent(crearTerminal())}`);
        },
      },
      {
        id: "cmd-modo",
        titulo: usePreferencesStore.getState().modoOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
        icono: SunMoon,
        ejecutar: () => usePreferencesStore.getState().toggleDark(),
      },
      {
        id: "cmd-config",
        titulo: "Abrir la configuración (Ctrl+,)",
        icono: Settings,
        ejecutar: () => useUiStore.getState().setSettingsOpen(true),
      },
      // Atmósfera del modo en uso (la del otro modo se cambia en Configuración).
      ...ATMOSFERAS.map((a) => {
        const { modoOscuro, prefs } = usePreferencesStore.getState();
        const clave = modoOscuro ? "atmosferaOscuro" : "atmosferaClaro";
        return {
          id: `cmd-atmosfera-${a.id}`,
          titulo: `Atmósfera: ${a.nombre}`,
          detalle: prefs[clave] === a.id ? `En uso en modo ${modoOscuro ? "oscuro" : "claro"}` : a.descripcion,
          icono: Palette,
          ejecutar: () => usePreferencesStore.getState().setPref(clave, a.id),
        };
      }),
    ],
    // El título del cambio de modo se recalcula en cada apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [abrirNota, router, abierto],
  );

  const enComandos = texto.startsWith(">");
  const consulta = (enComandos ? texto.slice(1) : texto).trim();
  /** ¿Lo que se está listando son las notas recientes y no una búsqueda? */
  const mostrandoRecientes =
    !enComandos && !consulta && recientes.some((id) => notas.some((n) => n.id === id));

  const opciones: Opcion[] = useMemo(() => {
    if (enComandos) {
      return comandos
        .map((c) => ({ c, p: puntaje(c.titulo, consulta) }))
        .filter((x) => x.p !== null)
        .sort((a, b) => a.p! - b.p!)
        .map((x) => x.c);
    }
    const porId = new Map(carpetas.map((c) => [c.id, c]));
    const aOpcion = (n: (typeof notas)[number]) => ({
      id: `nota-${n.id}`,
      titulo: n.titulo,
      detalle: rutaDe(n.carpetaId, porId),
      icono: ICONO_POR_TIPO[n.tipo] ?? ICONO_POR_TIPO.markdown,
      ejecutar: () => abrirNota(n.id),
    });

    // Sin consulta: las últimas notas que se miraron. Listar el vault entero en
    // orden alfabético no ayudaba a nadie —lo que casi siempre se busca es
    // volver a una nota de hace un rato— y además destapaba la chatarra de
    // herramientas del vault (crítica del cascarón, 2026-09-20).
    if (!consulta) {
      const porIdNota = new Map(notas.map((n) => [n.id, n]));
      const vistas = recientes.map((id) => porIdNota.get(id)).filter((n) => n !== undefined);
      if (vistas.length > 0) return vistas.map(aOpcion);
    }

    const halladas = notas
      .map((n) => ({ n, p: puntaje(n.titulo, consulta) }))
      .filter((x) => x.p !== null)
      .sort((a, b) => a.p! - b.p! || a.n.titulo.localeCompare(b.n.titulo))
      .slice(0, MAX_RESULTADOS)
      .map(({ n }) => aOpcion(n));
    const exacta = notas.some((n) => normalizar(n.titulo) === normalizar(consulta));
    if (consulta && !exacta) {
      halladas.push({
        id: "crear",
        titulo: `Crear nota «${consulta}»`,
        detalle: "En la carpeta seleccionada",
        icono: FilePlus,
        ejecutar: async () => {
          const v = useVaultStore.getState();
          abrirNota(await v.createNota(v.activeFolderId, "markdown", consulta));
        },
      });
    }
    return halladas;
  }, [enComandos, consulta, comandos, notas, carpetas, recientes, abrirNota]);

  // La opción activa siempre existe y se ve.
  useEffect(() => setActiva(0), [texto]);
  useEffect(() => {
    listaRef.current
      ?.querySelector<HTMLElement>(`[data-indice="${activa}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activa]);

  if (!abierto) return null;

  const ejecutar = (o: Opcion | undefined) => {
    if (!o) return;
    cerrar();
    void o.ejecutar();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!opciones.length) return;
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActiva((a) => (a + paso + opciones.length) % opciones.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      ejecutar(opciones[activa]);
    }
  };

  const idOpcion = (i: number) => `${idLista}-${i}`;

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={styles.paleta}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
      >
        <h2 id={idTitulo} className={styles.oculto}>
          {enComandos ? "Ejecutar un comando" : "Ir a una nota"}
        </h2>
        <div className={styles.campo}>
          <Search size={16} aria-hidden className={styles.lupa} />
          <input
            className={styles.input}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={enComandos ? "Escribí un comando…" : "Ir a una nota…  (empezá con > para comandos)"}
            role="combobox"
            aria-expanded="true"
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={opciones.length ? idOpcion(activa) : undefined}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ul
          ref={listaRef}
          id={idLista}
          role="listbox"
          className={styles.lista}
          aria-label={mostrandoRecientes ? "Notas recientes" : "Resultados"}
        >
          {opciones.map((o, i) => {
            const Icono = o.icono;
            return (
              <li
                key={o.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activa}
                data-indice={i}
                className={i === activa ? `${styles.opcion} ${styles.opcionActiva}` : styles.opcion}
                onPointerMove={() => i !== activa && setActiva(i)}
                onClick={() => ejecutar(o)}
              >
                <Icono size={15} aria-hidden />
                <span className={styles.titulo}>{o.titulo}</span>
                {o.detalle && <span className={styles.detalle}>{o.detalle}</span>}
              </li>
            );
          })}
          {opciones.length === 0 && (
            <li className={styles.vacio} role="option" aria-selected="false" aria-disabled="true">
              {enComandos ? "Ningún comando se llama así." : "Escribí el nombre de una nota."}
            </li>
          )}
        </ul>
        <p className={styles.pie} aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd> moverse · <kbd>Enter</kbd> abrir · <kbd>Ctrl+O</kbd> notas ·{" "}
          <kbd>Ctrl+P</kbd> o <kbd>&gt;</kbd> comandos · <kbd>Esc</kbd> cerrar
        </p>
      </div>
    </div>
  );
}
