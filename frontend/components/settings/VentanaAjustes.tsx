"use client";

import { BookOpen, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { CustomCssSection } from "@/components/settings/CustomCssSection";
import { EditorSection } from "@/components/settings/EditorSection";
import { GraphSection } from "@/components/settings/GraphSection";
import { TerminalSection } from "@/components/settings/TerminalSection";
import { TypographySection } from "@/components/settings/TypographySection";
import { UpdaterSection } from "@/components/settings/UpdaterSection";
import { VaultSection } from "@/components/settings/VaultSection";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { APP_VERSION } from "@/lib/version";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import styles from "./VentanaAjustes.module.css";

/**
 * Configuración (`FUN-M-32`). Era un panel de 440px que entraba desde la
 * derecha con tres pestañas; cada ajuste nuevo lo apretaba más, hasta que
 * listas, editores y muestras no entraban. Ahora es una **ventana centrada** con
 * las categorías a la izquierda y un buscador arriba, como en Obsidian y VS
 * Code: el patrón que aguanta que sigan entrando opciones.
 *
 * Las secciones son las mismas de siempre; lo que cambia es dónde viven y
 * cuánto sitio tienen.
 */

/** La marca que señala el ajuste al que llevó la búsqueda (app/globals.css). */
const CLASE_DESTACADO = "mic-ajuste-destacado";

type CategoriaId =
  | "apariencia"
  | "tipografia"
  | "css"
  | "editor"
  | "grafo"
  | "consolas"
  | "vault"
  | "actualizaciones";

/**
 * Una entrada del buscador. El `rotulo` es el texto tal cual aparece en la
 * sección —así se lo encuentra en el DOM para saltar hasta él— y los `alias`
 * son cómo lo llamaría quien no sabe cómo se llama: buscar «ignorar» o
 * «indexar» no devolvía nada y el ajuste se llama «Archivos ignorados
 * (.mycignore)», que hay que adivinar (crítica de Configuración, 2026-09-20).
 */
type Ajuste = {
  rotulo: string;
  alias?: string[];
  /** Solo existe con el modo desarrollador (`FUN-S-36`): sin él no está en
   *  pantalla, así que ofrecerlo sería mandar a un salto que no llega a ningún
   *  lado —y además delataría que hay algo escondido—. */
  soloDev?: boolean;
};

type Categoria = {
  id: CategoriaId;
  nombre: string;
  descripcion: string;
  grupo: string;
  /** Lo que se puede buscar acá: el rótulo de cada ajuste y sus sinónimos. */
  ajustes: Ajuste[];
};

const CATEGORIAS: Categoria[] = [
  {
    id: "apariencia",
    nombre: "Apariencia",
    descripcion: "Los colores de Mycelium: el tema, el modo y la atmósfera de cada modo.",
    grupo: "Aspecto",
    ajustes: [
      { rotulo: "Tema", alias: ["colores", "bioluminiscencia", "cantarela", "paleta"] },
      // El tema de la marca Arrecife (`FUN-M-51`): su muestra solo existe con el
      // modo dev, y sin él buscarlo por su nombre no tiene que devolver nada.
      { rotulo: "Tema", alias: ["arrecife"], soloDev: true },
      // Lo mismo con el tema de la marca GSmart (`FUN-M-52`).
      { rotulo: "Tema", alias: ["gsmart"], soloDev: true },
      // Y con Bioluminiscencia experimental (`FUN-M-53`): por su id, por el
      // nombre de su muestra y por «experimental». «Bioluminiscencia» a secas
      // ya lleva al tema público (la entrada de arriba).
      { rotulo: "Tema", alias: ["bioexp", "biolum. exp.", "experimental"], soloDev: true },
      { rotulo: "Modo oscuro", alias: ["modo claro", "oscuro", "claro", "noche"] },
      { rotulo: "Atmósfera en modo oscuro", alias: ["abisal", "niebla", "bosque", "papel", "fondo"] },
      { rotulo: "Atmósfera en modo claro", alias: ["abisal", "niebla", "bosque", "papel", "fondo"] },
    ],
  },
  {
    id: "tipografia",
    nombre: "Tipografía",
    descripcion: "Con qué letra y a qué tamaño se escribe y se lee una nota.",
    grupo: "Aspecto",
    ajustes: [
      { rotulo: "Fuente del editor", alias: ["letra", "tipografía", "monoespaciada"] },
      { rotulo: "Tamaño del editor", alias: ["tamaño de letra", "zoom", "más grande"] },
      { rotulo: "Fuente del preview", alias: ["letra de lectura", "vista previa"] },
      { rotulo: "Tamaño del preview", alias: ["tamaño de letra", "lectura"] },
    ],
  },
  {
    id: "css",
    nombre: "Snippets CSS",
    descripcion: "Tu propio CSS sobre Mycelium: se aplica al instante y podés apagarlo cuando quieras.",
    grupo: "Aspecto",
    ajustes: [
      { rotulo: "Snippets de CSS", alias: ["estilos propios", "personalizar", "css"] },
      { rotulo: "Importar .css", alias: ["cargar estilos"] },
      { rotulo: "Descargar plantilla", alias: ["ejemplo de css", "variables"] },
      { rotulo: "Nuevo snippet", alias: ["crear estilo"] },
    ],
  },
  {
    id: "editor",
    nombre: "Editor",
    descripcion: "Cómo se comportan las pestañas, la escritura y el documento.",
    grupo: "Trabajo",
    ajustes: [
      { rotulo: "Ancho de tabulación", alias: ["tab", "sangría", "indentación", "espacios"] },
      { rotulo: "Pestañas de previsualización", alias: ["pestaña provisoria", "reemplazar pestaña"] },
      { rotulo: "Ícono del tipo en las pestañas", alias: ["íconos", "pestañas"] },
      { rotulo: "Autocerrar pares", alias: ["paréntesis", "comillas", "corchetes"] },
      { rotulo: "Números de línea", alias: ["numerar", "líneas", "canalón"] },
      { rotulo: "Mostrar título del archivo", alias: ["título", "nombre del archivo"] },
    ],
  },
  {
    id: "grafo",
    nombre: "Grafo",
    descripcion: "El comportamiento de la vista de conexiones.",
    grupo: "Trabajo",
    ajustes: [
      { rotulo: "Simulación continua", alias: ["grafo", "cpu", "rendimiento", "movimiento"] },
    ],
  },
  {
    id: "consolas",
    nombre: "Consolas",
    descripcion: "Qué pasa con las terminales integradas al cerrar y volver a abrir Mycelium.",
    grupo: "Trabajo",
    ajustes: [
      { rotulo: "Shell por defecto", alias: ["terminal", "consola", "powershell", "bash", "cmd"] },
      { rotulo: "Restaurar terminales al abrir", alias: ["sesiones", "reabrir"] },
      { rotulo: "Restaurar el historial", alias: ["scrollback", "texto anterior"] },
    ],
  },
  {
    id: "vault",
    nombre: "Vault",
    descripcion: "La carpeta abierta: qué se indexa, qué se exporta y qué sabe la IA de ella.",
    grupo: "Vault",
    ajustes: [
      { rotulo: "Abrir el último vault al iniciar", alias: ["inicio", "arranque"] },
      { rotulo: "Referencias del vault", alias: ["enlaces rotos", "reparar"] },
      { rotulo: "Exportar", alias: ["respaldo", "backup", "copia", "pdf", "carpeta", "zip"] },
      { rotulo: "Importar vault de Obsidian", alias: ["traer notas", "migrar", "obsidian"] },
      { rotulo: "Asistente IA (Claude Code)", alias: ["ia", "claude", "agente", "memoria", "instrucciones"] },
      {
        rotulo: "Dejar que la IA controle Mycelium",
        alias: ["mcp", "control", "servidor", "abrir notas", "claude code"],
      },
      {
        rotulo: "Archivos ignorados (.mycignore)",
        alias: ["ignorar", "excluir", "indexar", "no indexar", "ocultar carpeta", "mycignore"],
      },
      { rotulo: "Carpeta de Esporas", alias: ["plantillas", "esporas", "templates"] },
    ],
  },
  {
    id: "actualizaciones",
    nombre: "Actualizaciones",
    descripcion: "Cuándo busca versiones nuevas y cuál tenés instalada.",
    grupo: "Sistema",
    ajustes: [
      { rotulo: "Buscar actualizaciones automáticamente", alias: ["versión nueva", "actualizar"] },
      { rotulo: "Versión fijada", alias: ["volver atrás", "downgrade"] },
      { rotulo: "Versiones publicadas", alias: ["instalar otra versión", "historial"], soloDev: true },
      { rotulo: "Servidor de actualizaciones", alias: ["endpoint", "url"], soloDev: true },
    ],
  },
];

/** Los grupos, en el orden en que se muestran. */
const GRUPOS = ["Aspecto", "Trabajo", "Vault", "Sistema"];

/**
 * Lo que, buscado acá, ofrece abrir la ayuda (`FUN-L-27`): quien busca
 * «atajos» o «manual» en Configuración no busca un ajuste.
 */
const ALIAS_AYUDA = ["ayuda", "manual", "wiki", "documentacion", "como se usa", "atajos", "sintaxis", "f1"];

/** Sin tildes ni mayúsculas, para que «tipografia» encuentre «Tipografía». */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function contenido(id: CategoriaId) {
  switch (id) {
    case "apariencia":
      return <AppearanceSection />;
    case "tipografia":
      return <TypographySection />;
    case "css":
      return <CustomCssSection />;
    case "editor":
      return <EditorSection />;
    case "grafo":
      return <GraphSection />;
    case "consolas":
      return <TerminalSection />;
    case "vault":
      return <VaultSection />;
    case "actualizaciones":
      return <UpdaterSection />;
  }
}

export function VentanaAjustes() {
  const abierto = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);

  const [categoria, setCategoria] = useState<CategoriaId>("apariencia");
  const [consulta, setConsulta] = useState("");
  /** Ajuste al que hay que saltar en cuanto su categoría esté pintada, y el
   *  contador que dispara el salto aunque ya se esté en esa categoría. */
  const pendienteRef = useRef<string | null>(null);
  const [salto, setSalto] = useState(0);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  /**
   * Escape, el clic en el velo y la × pasan todos por acá. Ya no hay nada que
   * se pueda perder al cerrar: el único texto que se escribía en esta ventana,
   * el `.mycignore`, se edita desde `FUN-S-25` en su pestaña, que tiene su
   * propio guardado.
   */
  const cerrar = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);
  useDialogoModal({ abierto, cerrar, dialogoRef });

  // Cada apertura arranca limpia: sin búsqueda previa.
  useEffect(() => {
    if (!abierto) return;
    setConsulta("");
  }, [abierto]);

  /**
   * Ajustes que coinciden con la búsqueda, con su categoría. Se busca en el
   * rótulo y en los alias, pero lo que se muestra y a lo que se salta es
   * siempre el rótulo: el alias es una puerta, no un nombre nuevo.
   */
  const hallazgos = useMemo(() => {
    const q = normalizar(consulta.trim());
    if (!q) return [];
    const salida: { categoria: Categoria; ajuste: string }[] = [];
    for (const c of CATEGORIAS) {
      if (normalizar(c.nombre).includes(q)) salida.push({ categoria: c, ajuste: c.nombre });
      for (const a of c.ajustes) {
        if (a.soloDev && !dev) continue;
        const coincide =
          normalizar(a.rotulo).includes(q) ||
          (a.alias ?? []).some((alias) => normalizar(alias).includes(q));
        // Un mismo rótulo puede venir de dos entradas (una con alias solo para
        // el modo dev): se ofrece una vez.
        const repetido = salida.some((h) => h.categoria.id === c.id && h.ajuste === a.rotulo);
        if (coincide && !repetido) salida.push({ categoria: c, ajuste: a.rotulo });
      }
    }
    return salida.slice(0, 12);
  }, [consulta, dev]);

  /** ¿La búsqueda apunta a la ayuda y no a un ajuste? */
  const buscaAyuda = useMemo(() => {
    const q = normalizar(consulta.trim());
    return q.length > 0 && ALIAS_AYUDA.some((a) => a.startsWith(q) || q.startsWith(a));
  }, [consulta]);

  /** Cierra Configuración y abre la ayuda: una ventana modal a la vez. */
  const abrirAyuda = () => useUiStore.getState().abrirAyuda();

  /**
   * Va a un ajuste: abre su categoría y deja anotado a cuál hay que ir. El
   * salto en sí lo hace el efecto de abajo, cuando la categoría ya está
   * pintada.
   */
  const irA = (c: Categoria, ajuste: string) => {
    pendienteRef.current = ajuste;
    setCategoria(c.id);
    setConsulta("");
    setSalto((n) => n + 1);
  };

  /**
   * Lleva al ajuste anotado y lo señala un momento. Va en un efecto —y no en un
   * `requestAnimationFrame` tras el clic— porque ese cuadro **no llega** si la
   * ventana está en segundo plano: el navegador los pausa, y el salto se perdía.
   *
   * El ajuste se busca por su rótulo, comparando por PREFIJO y sin tildes:
   * varios llevan una aclaración detrás («Carpeta de Esporas (plantillas)»). Se
   * busca por texto a propósito, para que las secciones no tengan que registrar
   * nada: el índice es la lista de rótulos de este archivo.
   */
  useEffect(() => {
    const ajuste = pendienteRef.current;
    if (!ajuste) return;
    // Se consume acá y no con estado: cambiarlo volvería a disparar el efecto
    // y su limpieza quitaría la marca en el mismo instante en que se pone.
    pendienteRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    const buscado = normalizar(ajuste);
    const objetivo = [...panel.querySelectorAll<HTMLElement>("label, span, h3, h4, button")].find(
      (el) => {
        const texto = normalizar(el.textContent?.trim() ?? "");
        return texto.length <= buscado.length + 24 && texto.startsWith(buscado);
      },
    );
    if (!objetivo) return;
    const fila = objetivo.closest<HTMLElement>('[class*="toggleRow"], [class*="field"]') ?? objetivo;
    fila.scrollIntoView({ block: "center", behavior: "smooth" });
    // Clase GLOBAL (app/globals.css): la marca la lleva un elemento de otra
    // sección, y una clase de este módulo ahí sería una dependencia invisible.
    fila.classList.add(CLASE_DESTACADO);
    const id = window.setTimeout(() => fila.classList.remove(CLASE_DESTACADO), 1800);
    return () => window.clearTimeout(id);
  }, [salto, categoria]);

  /** Flechas para recorrer la lista de categorías, como cualquier lista. */
  const navTeclas = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    // Desde donde está el foco, no desde lo seleccionado: si no, con el foco en
    // una categoría y otra seleccionada, la flecha saltaba a un tercer sitio.
    const enfocada = (document.activeElement as HTMLElement | null)?.dataset?.categoria;
    const i = CATEGORIAS.findIndex((c) => c.id === (enfocada ?? categoria));
    const siguiente =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? CATEGORIAS.length - 1
          : e.key === "ArrowDown"
            ? (i + 1) % CATEGORIAS.length
            : (i - 1 + CATEGORIAS.length) % CATEGORIAS.length;
    setCategoria(CATEGORIAS[siguiente].id);
    navRef.current
      ?.querySelector<HTMLElement>(`[data-categoria="${CATEGORIAS[siguiente].id}"]`)
      ?.focus();
  };

  if (!abierto) return null;

  const actual = CATEGORIAS.find((c) => c.id === categoria) ?? CATEGORIAS[0];

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={styles.ventana}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajustes-titulo"
        data-cede-a-la-ayuda
      >
        <header className={styles.cabecera}>
          <h2 id="ajustes-titulo" className={styles.titulo}>
            Configuración
          </h2>
          <div className={styles.buscador}>
            <Search size={15} aria-hidden className={styles.lupa} />
            <input
              className={styles.campoBusqueda}
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hallazgos.length > 0) {
                  irA(hallazgos[0].categoria, hallazgos[0].ajuste);
                } else if (e.key === "Enter" && buscaAyuda) {
                  abrirAyuda();
                }
                if (e.key === "Escape" && consulta) {
                  e.stopPropagation();
                  setConsulta("");
                }
              }}
              placeholder="Buscar un ajuste…"
              aria-label="Buscar un ajuste"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button type="button" className={styles.cerrar} aria-label="Cerrar configuración" onClick={cerrar}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className={styles.cuerpo}>
          <nav
            ref={navRef}
            className={styles.categorias}
            aria-label="Categorías de configuración"
            onKeyDown={navTeclas}
          >
            {consulta.trim() ? (
              <div className={styles.resultados}>
                {buscaAyuda && (
                  <button type="button" className={styles.resultado} onClick={abrirAyuda}>
                    <span className={styles.resultadoAjuste}>Abrir la ayuda</span>
                    <span className={styles.resultadoCategoria}>Cómo se usa Mycelium · F1</span>
                  </button>
                )}
                {hallazgos.length === 0 && buscaAyuda ? null : hallazgos.length === 0 ? (
                  <p className={styles.sinResultados}>Ningún ajuste se llama así.</p>
                ) : (
                  hallazgos.map(({ categoria: c, ajuste }) => (
                    <button
                      key={`${c.id}-${ajuste}`}
                      type="button"
                      className={styles.resultado}
                      onClick={() => irA(c, ajuste)}
                    >
                      <span className={styles.resultadoAjuste}>{ajuste}</span>
                      <span className={styles.resultadoCategoria}>{c.nombre}</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              GRUPOS.map((grupo) => (
                <div key={grupo} className={styles.grupo}>
                  <h3 className={styles.grupoTitulo}>{grupo}</h3>
                  {CATEGORIAS.filter((c) => c.grupo === grupo).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-categoria={c.id}
                      className={c.id === categoria ? `${styles.categoria} ${styles.categoriaActiva}` : styles.categoria}
                      aria-current={c.id === categoria}
                      tabIndex={c.id === categoria ? 0 : -1}
                      onClick={() => setCategoria(c.id)}
                    >
                      {c.nombre}
                    </button>
                  ))}
                </div>
              ))
            )}
            {/* La ayuda no es una categoría más: no tiene ajustes ni se lee en
                este panel, sino en su propia ventana (decisión del usuario del
                2026-10-06). Por eso es un botón al pie de la lista, que cierra
                Configuración y la abre, y no una entrada entre las categorías. */}
            {!consulta.trim() && (
              <button type="button" className={styles.botonAyuda} onClick={abrirAyuda}>
                <BookOpen size={15} aria-hidden />
                <span className={styles.botonAyudaTexto}>Ayuda</span>
                <kbd className={styles.botonAyudaTecla}>F1</kbd>
              </button>
            )}
          </nav>

          <div className={styles.panel} ref={panelRef} key={actual.id}>
            <div className={styles.panelCabecera}>
              <h3 className={styles.panelTitulo}>{actual.nombre}</h3>
              <p className={styles.panelDescripcion}>{actual.descripcion}</p>
            </div>
            {contenido(actual.id)}
          </div>
        </div>

        {/* Hasta `FUN-S-36` el número era un botón: siete pulsaciones activaban el
            modo avanzado. Ahora el modo desarrollador se enciende desde la
            paleta y esto es texto. La marca «dev» solo se ve con el modo
            encendido: dice en qué estado está la app (por qué hay opciones de
            más en Actualizaciones) sin decir cómo se llega. */}
        <footer className={styles.pie}>
          <span className={styles.pieVersion}>
            Mycelium v{APP_VERSION}
            {dev && <span className={styles.pieDev}> · dev</span>}
          </span>
        </footer>
      </div>
    </div>
  );
}
