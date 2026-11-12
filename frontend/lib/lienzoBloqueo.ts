/**
 * Lienzos bloqueados para la edición (`FUN-S-39`): la lista de rutas de los
 * `.canvas` que el usuario puso en «Solo lectura».
 *
 * Vive en las preferencias del vault (`prefsVaultStore`, clave
 * `lienzosBloqueados`) y **no en el archivo**: el formato JSON Canvas no tiene
 * ese campo, y agregárselo choca con la regla del módulo de no perder ni
 * inventar nada ajeno (spec `canvas.md` § 9 y § 13). El bloqueo es de la
 * interfaz: un cambio de afuera sobre un lienzo bloqueado se recarga igual.
 *
 * Como la clave es la ruta, al renombrar o mover el lienzo —o la carpeta que
 * lo contiene— la entrada tiene que seguirlo, igual que las pestañas abiertas
 * (`remapNota` / `remapCarpeta` de `tabsStore`). Lo hace `vaultStore` con
 * `seguirRenombre` y `seguirCarpeta`.
 *
 * Puro —sin imports— para que lo pruebe `scripts/test-lienzo-bloqueo.mjs`.
 * Las funciones que cambian la lista devuelven **la misma** si no cambió nada,
 * para que guardar las preferencias no se dispare de más.
 */

/** ¿El lienzo de la ruta `ruta` está bloqueado? */
export function estaBloqueado(lista: readonly string[], ruta: string): boolean {
  return lista.includes(ruta);
}

/** Bloquea el lienzo si estaba editable y lo desbloquea si estaba bloqueado. */
export function alternarBloqueo(lista: readonly string[], ruta: string): string[] {
  return lista.includes(ruta) ? lista.filter((r) => r !== ruta) : [...lista, ruta];
}

/** Fija el estado del lienzo: `bloqueado` o no. */
export function fijarBloqueo(lista: readonly string[], ruta: string, bloqueado: boolean): string[] {
  const esta = lista.includes(ruta);
  if (esta === bloqueado) return lista as string[];
  return bloqueado ? [...lista, ruta] : lista.filter((r) => r !== ruta);
}

/** El lienzo `de` se renombró o se movió a `a`: su entrada lo sigue. */
export function seguirRenombre(lista: readonly string[], de: string, a: string): string[] {
  if (de === a || !lista.includes(de)) return lista as string[];
  // Si `a` ya figuraba (raro: otro lienzo con esa ruta que se borró), no se duplica.
  const sin = lista.filter((r) => r !== de && r !== a);
  return [...sin, a];
}

/**
 * La carpeta `de` se renombró o se movió a `a`: los lienzos que colgaban de
 * ella —a cualquier profundidad— pasan a la ruta nueva.
 */
export function seguirCarpeta(lista: readonly string[], de: string, a: string): string[] {
  if (de === a) return lista as string[];
  const prefijo = `${de}/`;
  if (!lista.some((r) => r.startsWith(prefijo))) return lista as string[];
  const salida: string[] = [];
  for (const r of lista) {
    const nueva = r.startsWith(prefijo) ? `${a}/${r.slice(prefijo.length)}` : r;
    if (!salida.includes(nueva)) salida.push(nueva);
  }
  return salida;
}

/**
 * Lo que se lee del archivo de preferencias: solo textos no vacíos y sin
 * repetir. El archivo se puede editar a mano; cualquier otra cosa se descarta.
 */
export function normalizarLienzosBloqueados(crudo: unknown): string[] {
  if (!Array.isArray(crudo)) return [];
  const salida: string[] = [];
  for (const r of crudo) {
    if (typeof r === "string" && r.trim() !== "" && !salida.includes(r)) salida.push(r);
  }
  return salida;
}
