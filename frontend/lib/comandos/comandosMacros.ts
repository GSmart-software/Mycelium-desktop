/**
 * Los comandos de las macros (`FUN-XL-04`, Parte 6):
 *
 * - los **comandos con datos** que ejecutan los pasos de una macro
 *   (`editor.insertar-texto`, `nota.abrir`, `espora.crear`). Están en el
 *   registro como cualquier otro, pero con `requiereArgs`: sin datos no hacen
 *   nada, así que no salen en la paleta ni en los atajos;
 * - `bandeja.abrir`, que faltaba como comando (la Bandeja como nota
 *   completa, `FUN-L-33`) y usa la macro «Ordenar la Bandeja»;
 * - grabar una macro y abrir la sección de Configuración;
 * - y un comando `macro.<id>` por cada macro del usuario (`comandosDeMacros`),
 *   que el workspace registra con `useRegistrarMacros`.
 *
 * Cada comando con datos **espera** a que su acción termine (devuelve una
 * promesa): así el paso siguiente de la macro no arranca antes de tiempo.
 */
import { CircleDot, FileInput, Inbox, TextCursorInput, Workflow } from "lucide-react";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { carpetaDestino, abrirCreado } from "@/lib/crear";
import { getView, notaDeVista } from "@/lib/editor/viewRegistry";
import { normalizarCarpetaEsporas } from "@/lib/esporas";
import { resolveWikilink } from "@/lib/wikilinks";
import { avisar } from "@/stores/avisosStore";
import { useAuthStore } from "@/stores/authStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { grabandoAtajo } from "./grabacion";
import {
  COMANDO_DE_PASO,
  ejecutarMacro,
  expandirVariables,
  idDeComandoMacro,
  textoFallo,
  type EntornoMacro,
  type Macro,
  type ResultadoMacro,
} from "./macros";
import { abrirNota, enfocarNota, urlDeNota } from "./navegar";
import {
  detenerGrabacion,
  empezarGrabacion,
  fijarMacroEnCurso,
  grabandoMacro,
  macroEnCurso,
  macrosActuales,
  useMacros,
} from "./preferenciasMacros";
import { comandoPorId, resolverTexto, type ArgsComando, type Comando, type ContextoComando } from "./registro";
import { useRegistrarComandos } from "./useComandos";

// ── esperar ────────────────────────────────────────────────────────────────

/** Espera `n` cuadros: lo que tarda React en pintar lo que cambió en un store. */
export const esperarCuadros = (n = 2) =>
  new Promise<void>((listo) => {
    const paso = (quedan: number) => (quedan <= 0 ? listo() : requestAnimationFrame(() => paso(quedan - 1)));
    paso(n);
  });

/** Espera a que `cond` devuelva algo, cuadro a cuadro, hasta `ms`. `null` si no llegó. */
async function esperarHasta<T>(cond: () => T | null | undefined, ms = 3000): Promise<T | null> {
  const fin = Date.now() + ms;
  for (;;) {
    const r = cond();
    if (r) return r;
    if (Date.now() > fin) return null;
    await esperarCuadros(1);
  }
}

const textoArg = (args: ArgsComando | undefined, clave: string) => {
  const v = args?.[clave];
  return typeof v === "string" ? v : "";
};

/** El título de la nota activa (para `{{titulo}}`), o vacío. */
function tituloActivo(): string {
  const id = useTabsStore.getState().activeNotaId();
  return (id && useVaultStore.getState().notas.find((n) => n.id === id)?.titulo) || "";
}

// ── los comandos con datos ─────────────────────────────────────────────────

/**
 * Inserta `texto` donde está el cursor de la nota del panel activo,
 * reemplazando lo seleccionado. Espera a que el editor de la nota activa esté
 * montado (tras abrir o crear una nota en el paso anterior).
 */
async function insertarTexto(args?: ArgsComando) {
  const crudo = textoArg(args, "texto");
  if (!crudo) throw new Error("no hay texto para insertar");
  const vista = await esperarHasta(() => {
    const { activePaneId, activeNotaId } = useTabsStore.getState();
    const v = getView(activePaneId);
    const nota = activeNotaId();
    return v && nota && notaDeVista(v) === nota && v.dom.isConnected ? v : null;
  });
  if (!vista) throw new Error("no hay una nota abierta en el editor del panel activo");
  const texto = expandirVariables(crudo, { titulo: tituloActivo() });
  vista.dispatch({ ...vista.state.replaceSelection(texto), scrollIntoView: true, userEvent: "input.paste" });
  vista.focus();
}

/**
 * Abre la nota `nota` (una ruta o un título, resuelto como un `[[enlace]]`).
 * Si no existe y `crear` está encendido, la crea —con las carpetas que falten—
 * con `contenido`, cuyo `{{titulo}}` es el de la nota nueva.
 */
async function abrirNotaConArgs(ctx: ContextoComando, args?: ArgsComando) {
  const ref = expandirVariables(textoArg(args, "nota"), { titulo: tituloActivo() })
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/\\/g, "/");
  if (!ref) throw new Error("falta la nota que se abre");
  const { notas, carpetas } = useVaultStore.getState();
  const nota = notas.find((n) => n.id === ref) ?? resolveWikilink(ref.replace(/\.md$/i, ""), notas, carpetas);
  if (nota) {
    abrirNota(ctx.navegar, nota.id);
    return;
  }
  if (args?.crear !== true) throw new Error(`no hay una nota «${ref}»`);
  const limpia = ref.replace(/\.md$/i, "");
  const barra = limpia.lastIndexOf("/");
  const titulo = limpia.slice(barra + 1).trim();
  if (!titulo) throw new Error(`«${ref}» no es un nombre de nota`);
  let carpeta: string | null = null;
  if (barra > 0) {
    const ruta = normalizarCarpetaEsporas(limpia.slice(0, barra));
    if (!ruta) throw new Error(`la carpeta de «${ref}» no es válida`);
    const { asegurarCarpeta } = await import("@/lib/esporasVault");
    carpeta = await asegurarCarpeta(ruta);
  }
  const id = await useVaultStore.getState().createNota(carpeta, "markdown", titulo);
  const contenido = textoArg(args, "contenido");
  if (contenido) {
    const final = useVaultStore.getState().notas.find((n) => n.id === id)?.titulo ?? titulo;
    await api(`/notas/${encodeURIComponent(id)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: expandirVariables(contenido, { titulo: final }) },
    });
  }
  abrirNota(ctx.navegar, id);
  // Una nota recién creada abre con el cursor al principio: un paso «texto»
  // siguiente escribía ANTES del contenido inicial («hola…# Ideas», visto en
  // la prueba en vivo del 2026-11-06). Se deja el cursor al final, donde se
  // seguiría escribiendo.
  const vista = await esperarHasta(() => {
    const v = getView(useTabsStore.getState().activePaneId);
    return v && notaDeVista(v) === id && v.dom.isConnected ? v : null;
  });
  if (vista) vista.dispatch({ selection: { anchor: vista.state.doc.length } });
}

/** Crea una nota desde la Espora `espora` (por nombre) en `carpeta`, o en la seleccionada. */
async function crearDesdeEspora(ctx: ContextoComando, args?: ArgsComando) {
  const nombre = expandirVariables(textoArg(args, "espora")).trim();
  if (!nombre) throw new Error("falta el nombre de la Espora");
  const { listarEsporas, carpetaEsporas, crearNotaDesdeEspora, asegurarCarpeta } = await import("@/lib/esporasVault");
  const espora = listarEsporas().find((e) => e.titulo.toLowerCase() === nombre.toLowerCase());
  if (!espora) throw new Error(`no hay una Espora «${nombre}» en la carpeta «${carpetaEsporas()}»`);
  const crudaCarpeta = expandirVariables(textoArg(args, "carpeta")).trim();
  let carpeta = carpetaDestino();
  if (crudaCarpeta) {
    const ruta = normalizarCarpetaEsporas(crudaCarpeta);
    if (!ruta) throw new Error(`la carpeta «${crudaCarpeta}» no es válida`);
    carpeta = await asegurarCarpeta(ruta);
  }
  abrirCreado(ctx.navegar, await crearNotaDesdeEspora(espora, carpeta), "nota");
}

/** Abre la Bandeja del vault como nota completa (no en vista previa), creándola si falta. */
async function abrirBandeja(ctx: ContextoComando) {
  const { asegurarBandeja } = await import("@/lib/bandejaVault");
  const id = await asegurarBandeja();
  const tabs = useTabsStore.getState();
  tabs.openNote(id);
  const s = useTabsStore.getState();
  const hoja = allLeaves(s.root).find((l) => l.id === s.activePaneId);
  if (hoja?.activeTabId) s.pinTab(hoja.id, hoja.activeTabId);
  ctx.navegar(urlDeNota(id));
  enfocarNota(id);
}

// ── ejecutar una macro ─────────────────────────────────────────────────────

/** El entorno real: el registro, las macros guardadas y los cuadros del navegador. */
function entornoReal(ctx: ContextoComando): EntornoMacro {
  return {
    ctx,
    comando: (id) => {
      const c = comandoPorId(id);
      return c && { ...c, titulo: resolverTexto(c.titulo) ?? id };
    },
    macro: (id) => macrosActuales().find((m) => m.id === id),
    esperar: (ms) => new Promise((listo) => window.setTimeout(listo, ms)),
    entrePasos: () => esperarCuadros(2),
  };
}

/**
 * Ejecuta la macro `id` y avisa si un paso falla, diciendo cuál. No corre
 * mientras se graba un atajo (la tecla es la que se quiere asignar) ni si ya
 * hay otra macro en curso (se mezclarían los pasos).
 */
export async function ejecutarMacroPorId(id: string, ctx: ContextoComando): Promise<ResultadoMacro | null> {
  if (grabandoAtajo()) return null;
  const macro = macrosActuales().find((m) => m.id === id);
  if (!macro) {
    avisar(`No se pudo ejecutar la macro: «${id}» ya no existe.`);
    return null;
  }
  const otra = macroEnCurso();
  if (otra) {
    const nombre = macrosActuales().find((m) => m.id === otra)?.nombre ?? otra;
    avisar(`La macro «${nombre}» todavía está en curso: espera a que termine.`);
    return null;
  }
  fijarMacroEnCurso(macro.id);
  let r: ResultadoMacro;
  try {
    r = await ejecutarMacro(macro, entornoReal(ctx));
  } finally {
    fijarMacroEnCurso(null);
  }
  if (!r.ok) {
    console.error(`[Mycelium] macro «${macro.nombre}»:`, r);
    avisar(`No se pudo terminar la macro: ${textoFallo(r)}.`);
  }
  return r;
}

/** El comando de una macro: `macro.<id>`, en la categoría «Macros». */
export function comandoDeMacro(m: Macro): Comando {
  const n = m.pasos.length;
  return {
    id: idDeComandoMacro(m.id),
    titulo: `Macro: ${m.nombre}`,
    detalle: n === 1 ? "1 paso" : `${n} pasos`,
    icono: Workflow,
    categoria: "macros",
    ejecutar: (ctx) => ejecutarMacroPorId(m.id, ctx),
  };
}

/** Los comandos de todas las macros. */
export const comandosDeMacros = (macros: readonly Macro[]): Comando[] => macros.map(comandoDeMacro);

/** Registra un comando por macro mientras el workspace está montado, y los renueva al cambiar. */
export function useRegistrarMacros() {
  const { macros } = useMacros();
  // Solo cambia lo que el comando muestra (id, nombre, cuántos pasos): editar el
  // texto de un paso no vuelve a dar de baja y de alta los comandos.
  const firma = JSON.stringify(macros.map((m) => [m.id, m.nombre, m.pasos.length]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lista = useMemo(() => comandosDeMacros(macros), [firma]);
  useRegistrarComandos(lista);
}

// ── la grabación ───────────────────────────────────────────────────────────

/** Empieza o detiene la grabación. Al detenerla, lleva a Configuración → Macros para guardarla. */
export function alternarGrabacion() {
  if (!grabandoMacro()) {
    empezarGrabacion();
    avisar("Grabando una macro: lo que ejecutes desde la paleta o con un atajo queda anotado.");
    return;
  }
  const pasos = detenerGrabacion();
  if (!pasos.length) {
    avisar("Se detuvo la grabación: no se anotó ningún paso.");
    return;
  }
  // Desde Configuración → Macros ya se ve lo grabado; si no, se abre ahí.
  if (!useUiStore.getState().settingsOpen) useUiStore.getState().abrirAjustes("macros");
}

// ── el catálogo ────────────────────────────────────────────────────────────

export const COMANDOS_MACROS: readonly Comando[] = [
  {
    id: COMANDO_DE_PASO.texto,
    titulo: "Insertar texto en la nota",
    icono: TextCursorInput,
    categoria: "editor",
    requiereArgs: true,
    ejecutar: (_ctx, args) => insertarTexto(args),
  },
  {
    id: COMANDO_DE_PASO.abrir,
    titulo: "Abrir una nota",
    icono: FileInput,
    categoria: "navegacion",
    requiereArgs: true,
    ejecutar: (ctx, args) => abrirNotaConArgs(ctx, args),
  },
  {
    id: COMANDO_DE_PASO.espora,
    titulo: "Crear una nota desde una Espora",
    icono: CircleDot,
    categoria: "notas",
    requiereArgs: true,
    ejecutar: (ctx, args) => crearDesdeEspora(ctx, args),
  },
  {
    id: "bandeja.abrir",
    titulo: "Abrir la Bandeja del vault",
    detalle: "Como nota completa, para ordenarla",
    icono: Inbox,
    categoria: "notas",
    ejecutar: (ctx) => abrirBandeja(ctx),
  },
  {
    id: "macros.grabar",
    titulo: () => (grabandoMacro() ? "Detener la grabación de la macro" : "Grabar una macro"),
    detalle: () =>
      grabandoMacro()
        ? "Y guardar lo grabado en Configuración → Macros"
        : "Anota lo que ejecutes desde la paleta o con un atajo",
    icono: Workflow,
    categoria: "macros",
    noSeGraba: true,
    ejecutar: () => alternarGrabacion(),
  },
  {
    id: "macros.configurar",
    titulo: "Editar las macros",
    detalle: "Configuración → Macros",
    icono: Workflow,
    categoria: "macros",
    noSeGraba: true,
    ejecutar: () => useUiStore.getState().abrirAjustes("macros"),
  },
];
