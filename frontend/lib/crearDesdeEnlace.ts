import { refreshAllLiveViews } from "@/lib/editor/refrescoVivo";
import { planDeEnlaceRoto } from "@/lib/enlaceRoto";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Carpeta por defecto de una nota creada desde un enlace roto (`FUN-S-31`).
 *
 * Mycelium no tiene (todavía) una preferencia de «carpeta para notas nuevas»:
 * el botón «Nueva nota» usa la carpeta seleccionada en el explorador, que es un
 * estado de la interfaz y no tiene nada que ver con el enlace. Por eso va a la
 * raíz, como el valor por defecto de Obsidian. Si un día existe la preferencia,
 * se lee acá.
 */
const CARPETA_POR_DEFECTO: string | null = null;

/**
 * Crea la nota que nombra un `[[enlace]]` roto (`FUN-S-31`) y devuelve su id
 * para abrirla, o `null` si el enlace no nombra una nota que se pueda crear
 * (`[[foto.png]]`, un nombre que el saneo deja vacío). `base` es la referencia
 * sin el ancla. Qué y dónde lo decide `planDeEnlaceRoto`.
 *
 * Crea con el mismo `createNota` que el botón «Nueva nota» —que repara los
 * enlaces de las homónimas (`DEF-134`)— y sin Espora: «Nueva nota» tampoco
 * aplica ninguna por su cuenta.
 */
export async function crearNotaDeEnlaceRoto(base: string): Promise<string | null> {
  const { carpetas, notas } = useVaultStore.getState();
  const plan = planDeEnlaceRoto(base, carpetas, CARPETA_POR_DEFECTO);
  if (!plan) return null;

  let padre = plan.carpetaId;
  if (plan.crearCarpetas.length === 0) {
    // El saneo puede dejar un nombre que el enlace no resuelve (`[[¿Qué?]]` →
    // «¿Qué-»): si esa nota ya existe —un clic anterior la creó—, se abre en
    // vez de crear otra «¿Qué- 1» en cada clic.
    const titulo = plan.titulo.toLowerCase();
    const ya = notas.find(
      (n) => n.carpetaId === padre && n.tipo === plan.tipo && n.titulo.toLowerCase() === titulo,
    );
    if (ya) return ya.id;
  }
  for (const nombre of plan.crearCarpetas) {
    await useVaultStore.getState().createCarpeta(nombre, padre);
    const creada = useVaultStore
      .getState()
      .carpetas.find((c) => c.padreId === padre && c.nombre.toLowerCase() === nombre.toLowerCase());
    if (!creada) throw new Error(`no apareció la carpeta «${nombre}»`);
    padre = creada.id;
  }
  const id = await useVaultStore.getState().createNota(padre, plan.tipo, plan.titulo);
  // El enlace que se pintaba roto ya resuelve: las vistas en vivo lo redibujan.
  refreshAllLiveViews();
  return id;
}
