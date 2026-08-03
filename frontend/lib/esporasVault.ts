/**
 * Esporas sobre el vault (`FUN-M-03`): listar las plantillas de la carpeta
 * configurada, crear notas a partir de ellas e insertarlas en una nota abierta.
 * La lógica pura (sustitución de variables, saneo de la ruta) está en
 * `lib/esporas.ts`; acá se le suma todo lo que toca el vault y el editor.
 * Ver `docs/features/esporas-plantillas.md`.
 */
import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { api } from "@/lib/api";
import {
  CARPETA_ESPORAS_DEFECTO,
  normalizarCarpetaEsporas,
  sustituirVariables,
} from "@/lib/esporas";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { cuerpoDe, ponerPropiedad, separarFrontmatter } from "@/lib/frontmatter";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Una plantilla: es una nota normal, así que su id es su ruta y su título su nombre. */
export type Espora = { id: string; titulo: string };

const token = () => useAuthStore.getState().accessToken;

/** Ruta (normalizada) de la carpeta de Esporas configurada. */
export function carpetaEsporas(): string {
  const bruta = usePreferencesStore.getState().prefs.carpetaEsporas;
  return normalizarCarpetaEsporas(bruta ?? "") ?? CARPETA_ESPORAS_DEFECTO;
}

/** ¿Existe en el vault la carpeta configurada? */
export function existeCarpetaEsporas(): boolean {
  const ruta = carpetaEsporas();
  return useVaultStore.getState().carpetas.some((c) => c.id === ruta);
}

/**
 * Plantillas de la carpeta configurada, por nombre. La lista es PLANA a
 * propósito: las subcarpetas no se recorren (spec § 1). Se leen del árbol que ya
 * tiene el store, así que no hace falta consultar el índice.
 */
export function listarEsporas(notas = useVaultStore.getState().notas): Espora[] {
  const ruta = carpetaEsporas();
  return notas
    .filter((n) => n.carpetaId === ruta && n.tipo === "markdown")
    .map((n) => ({ id: n.id, titulo: n.titulo }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
}

/** Contenido crudo de una plantilla (sin sustituir). */
export async function leerEspora(id: string): Promise<string> {
  const r = await api<{ contenido: string }>(
    `/notas/${encodeURIComponent(id)}/contenido`,
    { token: token() },
  );
  return r.contenido ?? "";
}

/**
 * Crea la carpeta de Esporas (y los ancestros que falten) si no existe. Se
 * verifica que cada tramo aparezca de verdad en el árbol: `createCarpeta`
 * desambigua con sufijo si el nombre está ocupado por un archivo, y en ese caso
 * es mejor avisar que dejar la carpeta configurada apuntando a la nada.
 */
export async function asegurarCarpetaEsporas(): Promise<string> {
  const ruta = carpetaEsporas();
  let acumulado: string | null = null;
  for (const segmento of ruta.split("/")) {
    const id: string = acumulado ? `${acumulado}/${segmento}` : segmento;
    if (!useVaultStore.getState().carpetas.some((c) => c.id === id)) {
      await useVaultStore.getState().createCarpeta(segmento, acumulado);
      if (!useVaultStore.getState().carpetas.some((c) => c.id === id)) {
        throw new Error(
          `No se pudo crear la carpeta «${id}»: ya hay una nota o carpeta con ese nombre.`,
        );
      }
    }
    acumulado = id;
  }
  return ruta;
}

/** Título de una nota a partir de su id (=ruta), por si el árbol aún no la trae. */
function tituloDeId(id: string): string {
  const base = id.slice(id.lastIndexOf("/") + 1);
  const punto = base.lastIndexOf(".");
  return punto <= 0 ? base : base.slice(0, punto);
}

/**
 * Crea una nota a partir de una Espora en `carpetaDestino` y devuelve su id.
 * El nombre sale del nombre de la plantilla; la desambiguación (`Reunión`,
 * `Reunión 2`) la resuelve `nombreNotaLibre` en la capa de datos, y `{{titulo}}`
 * se resuelve con el título FINAL, no con el que se pidió.
 *
 * La nota se crea vacía (`crearNota` no acepta contenido — misma forma de API
 * que en web) y el contenido se escribe después con `putContenido`.
 */
export async function crearNotaDesdeEspora(
  espora: Espora,
  carpetaDestino: string | null,
): Promise<string> {
  const plantilla = await leerEspora(espora.id);
  const id = await useVaultStore.getState().createNota(carpetaDestino, "markdown", espora.titulo);
  const titulo =
    useVaultStore.getState().notas.find((n) => n.id === id)?.titulo ?? tituloDeId(id);
  const contenido = sustituirVariables(plantilla, { titulo });
  await api(`/notas/${encodeURIComponent(id)}/contenido`, {
    method: "PUT",
    token: token(),
    body: { contenido },
  });
  // El contenido puede traer `[[enlaces]]` y `#tags`: el grafo queda desactualizado.
  useGraphStore.getState().markStale();
  refreshAllLiveViews();
  return id;
}

/** Crea una plantilla vacía en la carpeta de Esporas y devuelve su id. */
export async function crearEsporaVacia(): Promise<string> {
  const carpeta = await asegurarCarpetaEsporas();
  return useVaultStore.getState().createNota(carpeta, "markdown", "Nueva Espora");
}

// ── Insertar en una nota que ya existe (spec § 3.2) ───────────────────────────

/** Unión de dos listas de etiquetas sin duplicados (gana el orden de la nota). */
function unirTags(deLaNota: string[], deLaEspora: string[]): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  for (const t of [...deLaNota, ...deLaEspora]) {
    const k = t.toLowerCase();
    if (t !== "" && !vistas.has(k)) {
      vistas.add(k);
      out.push(t);
    }
  }
  return out;
}

/**
 * Fusiona las propiedades de la Espora en el frontmatter de la nota destino.
 * Insertar el bloque `---` en medio del documento lo convertiría en una línea
 * horizontal y un título fantasma —lo que `FUN-M-04` vino a arreglar—, así que
 * las propiedades van al frontmatter y solo el cuerpo va al cursor.
 *
 * Ante una clave que la nota ya tiene, **gana la de la nota**: la plantilla
 * aporta lo que falta, no pisa lo que el usuario escribió. Excepción: `tags`,
 * donde los dos conjuntos se unen sin duplicados.
 */
export function fusionarPropiedades(
  textoNota: string,
  textoEspora: string,
): { texto: string; aviso: string | null } {
  const fmEspora = separarFrontmatter(textoEspora);
  if (!fmEspora.hay || !fmEspora.soportado) {
    const aviso = fmEspora.hay
      ? `Mycelium no interpreta el frontmatter de la plantilla (${fmEspora.motivo}): se insertó solo el cuerpo.`
      : null;
    return { texto: textoNota, aviso };
  }
  if (fmEspora.props.length === 0) return { texto: textoNota, aviso: null };

  const fmNota = separarFrontmatter(textoNota);
  if (fmNota.hay && !fmNota.soportado) {
    return {
      texto: textoNota,
      aviso: `Mycelium no interpreta el frontmatter de esta nota (${fmNota.motivo}): se insertó el cuerpo, pero las propiedades de la plantilla no se pudieron fusionar.`,
    };
  }

  const propsNota = fmNota.hay && fmNota.soportado ? fmNota.props : [];
  const yaEstan = new Set(propsNota.map((p) => p.clave.toLowerCase()));

  let texto = textoNota;
  for (const p of fmEspora.props) {
    const clave = p.clave.toLowerCase();
    if (clave === "tags") {
      const deLaNota = propsNota.find((x) => x.clave.toLowerCase() === "tags");
      const actuales = Array.isArray(deLaNota?.valor) ? (deLaNota.valor as string[]) : [];
      const nuevas = Array.isArray(p.valor) ? (p.valor as string[]) : [];
      texto = ponerPropiedad(texto, deLaNota?.clave ?? p.clave, unirTags(actuales, nuevas), "lista");
      continue;
    }
    if (yaEstan.has(clave)) continue; // gana lo que el usuario ya escribió
    texto = ponerPropiedad(texto, p.clave, p.valor, p.tipo);
  }
  return { texto, aviso: null };
}

/** Desplazamiento (en caracteres) donde empieza la línea `linea` de `texto`. */
function offsetDeLinea(texto: string, linea: number): number {
  if (linea <= 0) return 0;
  const partes = texto.split("\n");
  let off = 0;
  for (let i = 0; i < linea && i < partes.length; i++) off += partes[i].length + 1;
  return Math.min(off, texto.length);
}

/** Primer carácter del cuerpo (tras el frontmatter) de un texto. */
function inicioDelCuerpo(texto: string): number {
  return offsetDeLinea(texto, separarFrontmatter(texto).cuerpoDesde);
}

/**
 * Inserta una Espora en la nota abierta: el cuerpo en la posición del cursor y
 * las propiedades fusionadas en el frontmatter, todo en UNA transacción de
 * CodeMirror para que `Ctrl+Z` lo deshaga en un solo paso.
 *
 * No se reescribe el archivo por debajo (`putContenido`) a propósito: el
 * autoguardado del editor pisaría el cambio y el deshacer no lo vería — misma
 * razón que en `FUN-M-04`.
 *
 * Devuelve un aviso cuando algo no se pudo fusionar, o `null` si fue limpio.
 */
export function insertarEsporaEnVista(
  view: EditorView,
  textoEspora: string,
  tituloNota: string,
): string | null {
  const doc = view.state.doc.toString();
  const sustituida = sustituirVariables(textoEspora, { titulo: tituloNota });

  // El cuerpo de una plantilla con frontmatter arranca con la línea en blanco
  // que separa el bloque del contenido: insertarla dejaría un hueco de más.
  const fmEspora = separarFrontmatter(sustituida);
  const cuerpo = fmEspora.hay
    ? cuerpoDe(sustituida, fmEspora).replace(/^\n+/, "")
    : cuerpoDe(sustituida, fmEspora);

  const { texto: conProps, aviso } = fusionarPropiedades(doc, sustituida);

  const finViejo = inicioDelCuerpo(doc);
  const prefijoNuevo = conProps.slice(0, inicioDelCuerpo(conProps));
  const prefijoViejo = doc.slice(0, finViejo);

  // El cursor dentro del frontmatter no es un sitio válido para el cuerpo: se
  // inserta al principio del contenido en vez de partir el bloque en dos.
  const pos = Math.max(view.state.selection.main.head, finViejo);

  const cambios: ChangeSpec[] = [];
  let delta = 0;
  if (prefijoNuevo !== prefijoViejo) {
    cambios.push({ from: 0, to: finViejo, insert: prefijoNuevo });
    delta = prefijoNuevo.length - prefijoViejo.length;
  }
  cambios.push({ from: pos, insert: cuerpo });

  view.dispatch({
    changes: cambios,
    selection: { anchor: pos + delta + cuerpo.length },
    // Como cualquier edición del usuario: marca la nota como editada y fija la
    // pestaña de previsualización.
    userEvent: "input",
  });
  view.focus();
  return aviso;
}
