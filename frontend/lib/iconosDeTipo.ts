import {
  FileQuestion,
  FileText,
  LayoutDashboard,
  Link2,
  Share2,
  Shapes,
  Table2,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { NotaTipo } from "@/stores/vaultStore";

/**
 * Qué ícono le corresponde a cada tipo de documento (`FUN-S-11`).
 *
 * Vive acá y no en cada componente porque la respuesta tiene que ser **la
 * misma** en los tres sitios donde se contesta: el árbol del explorador, la
 * sombra que sigue al puntero al arrastrar, y la pestaña. Un archivo que en el
 * árbol es una tabla y en su pestaña un documento no se lee como dos vistas de
 * lo mismo, se lee como un error.
 *
 * Los que no son `NotaTipo` —el grafo, las referencias, una consola, un archivo
 * que Mycelium no indexa— van aparte porque no son documentos del vault: no
 * tienen fila en `notas` y nunca la van a tener.
 */
export const ICONO_POR_TIPO: Record<NotaTipo, LucideIcon> = {
  markdown: FileText,
  excalidraw: Shapes,
  base: Table2,
  canvas: LayoutDashboard,
};

/** El grafo de conexiones. Es el mismo ícono que su sección del rail. */
export const ICONO_GRAFO = Share2;

/** La pantalla de referencias del vault (`FUN-L-17`). */
export const ICONO_REFERENCIAS = Link2;

/** Una consola integrada (`FUN-L-07`). Solo aparece en desktop. */
export const ICONO_CONSOLA = Terminal;

/**
 * Un archivo que Mycelium lista pero no indexa (`FUN-L-11`): un PDF, una
 * imagen, código. El signo de pregunta es deliberado — dice «esto no es una
 * nota», que es justo lo que hay que saber antes de abrirlo.
 */
export const ICONO_OTRO_ARCHIVO = FileQuestion;
