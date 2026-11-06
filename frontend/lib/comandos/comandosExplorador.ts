/**
 * Las acciones del menú del explorador como comandos (`FUN-XL-04`, Parte 4):
 * renombrar, mover, duplicar, copiar el enlace, abrir al lado, exportar,
 * mostrar en el explorador del sistema y eliminar, sobre el **elemento
 * seleccionado** del árbol. Las registra `ExplorerPanel` mientras está montado
 * (`useRegistrarComandos`): el estado que tocan —el renombrado en línea, el
 * diálogo «Mover a…»— vive en el componente y no en un store.
 *
 * El elemento seleccionado es la última fila del árbol que tuvo el foco (con
 * el teclado o con el mouse) y, si ninguna lo tuvo, el archivo abierto. La
 * paleta lo nombra: «Renombrar «Ideas»».
 *
 * Sin atajos de fábrica: en el árbol ya están F2 (renombrar) y Shift+F10 (el
 * menú), y una letra sola no puede ser atajo. El usuario puede darles uno en
 * Configuración.
 *
 * Lógica pura —los íconos aparte— para que la pruebe `scripts/test-comandos.mjs`.
 */
import {
  Columns2,
  Copy,
  FileDown,
  FileOutput,
  FolderInput,
  FolderOpen,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Comando, IconoComando } from "./registro";

/** El elemento seleccionado del árbol. */
export type SeleccionExplorador = {
  tipo: "nota" | "carpeta" | "otro";
  /** Lo que se lee en la paleta: el título, el nombre de la carpeta o del archivo. */
  nombre: string;
  /** Solo notas: ¿es markdown? (Exportar es solo de las notas markdown.) */
  markdown?: boolean;
};

/** Lo que el explorador sabe hacer con el elemento seleccionado. */
export type AccionesExplorador = {
  seleccion: () => SeleccionExplorador | null;
  /** ¿Hay un vault de carpeta? (Mostrar en el explorador del sistema.) */
  hayCarpetaEnDisco: () => boolean;
  renombrar: () => void;
  mover: () => void;
  duplicar: () => void;
  copiarEnlace: () => void;
  abrirAlLado: () => void;
  exportarMd: () => void;
  exportarPdf: () => void;
  mostrarEnSistema: () => void;
  eliminar: () => void;
};

type Def = {
  id: string;
  accion: string;
  icono: IconoComando;
  tipos: readonly SeleccionExplorador["tipo"][];
  hacer: (a: AccionesExplorador) => void;
  soloMarkdown?: boolean;
  soloEnDisco?: boolean;
};

const DEFS: readonly Def[] = [
  { id: "explorador.renombrar", accion: "Renombrar", icono: Pencil, tipos: ["nota", "carpeta", "otro"], hacer: (a) => a.renombrar() },
  { id: "explorador.mover", accion: "Mover a…", icono: FolderInput, tipos: ["nota", "carpeta"], hacer: (a) => a.mover() },
  { id: "explorador.duplicar", accion: "Duplicar", icono: Copy, tipos: ["nota", "otro"], hacer: (a) => a.duplicar() },
  { id: "explorador.copiar-enlace", accion: "Copiar el enlace a", icono: Link2, tipos: ["nota"], hacer: (a) => a.copiarEnlace() },
  { id: "explorador.abrir-al-lado", accion: "Abrir al lado", icono: Columns2, tipos: ["nota", "otro"], hacer: (a) => a.abrirAlLado() },
  {
    id: "explorador.exportar-md",
    accion: "Exportar como .md",
    icono: FileDown,
    tipos: ["nota"],
    soloMarkdown: true,
    hacer: (a) => a.exportarMd(),
  },
  {
    id: "explorador.exportar-pdf",
    accion: "Exportar como PDF",
    icono: FileOutput,
    tipos: ["nota"],
    soloMarkdown: true,
    hacer: (a) => a.exportarPdf(),
  },
  {
    id: "explorador.mostrar-en-sistema",
    accion: "Mostrar en el explorador del sistema",
    icono: FolderOpen,
    tipos: ["nota", "carpeta", "otro"],
    soloEnDisco: true,
    hacer: (a) => a.mostrarEnSistema(),
  },
  { id: "explorador.eliminar", accion: "Eliminar", icono: Trash2, tipos: ["nota", "carpeta", "otro"], hacer: (a) => a.eliminar() },
];

/** ¿La acción vale para lo seleccionado? */
function vale(d: Def, a: AccionesExplorador): boolean {
  const s = a.seleccion();
  if (!s || !d.tipos.includes(s.tipo)) return false;
  if (d.soloMarkdown && !s.markdown) return false;
  if (d.soloEnDisco && !a.hayCarpetaEnDisco()) return false;
  return true;
}

/** Los comandos del explorador, sobre las acciones dadas. La lista se arma una vez. */
export function comandosExplorador(a: AccionesExplorador): Comando[] {
  return DEFS.map(
    (d): Comando => ({
      id: d.id,
      titulo: () => {
        const s = a.seleccion();
        return s ? `${d.accion} «${s.nombre}»` : `${d.accion} (lo seleccionado en el explorador)`;
      },
      detalle: "En el explorador",
      icono: d.icono,
      categoria: "explorador",
      disponible: () => vale(d, a),
      ejecutar: () => {
        if (vale(d, a)) d.hacer(a);
      },
    }),
  );
}
