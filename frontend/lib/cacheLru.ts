/**
 * Un caché con tope que suelta lo usado hace más tiempo (LRU).
 *
 * Un `Map` recuerda el orden de inserción: sacar y volver a poner una clave la
 * manda al final, así que la primera es siempre la menos usada. Es el mismo
 * truco de `recordar` en `components/bases/BaseView.tsx`, hecho pieza para los
 * cachés por nota que antes crecían con cada nota visitada (`FUN-M-58`).
 */
export class CacheLru<K, V> {
  private readonly mapa = new Map<K, V>();

  constructor(private readonly tope: number) {}

  /** El valor, y lo marca como el más reciente. */
  get(clave: K): V | undefined {
    const valor = this.mapa.get(clave);
    if (valor === undefined) return undefined;
    this.mapa.delete(clave);
    this.mapa.set(clave, valor);
    return valor;
  }

  /** Guarda el valor como el más reciente y suelta los más viejos que sobren. */
  set(clave: K, valor: V): void {
    this.mapa.delete(clave);
    this.mapa.set(clave, valor);
    while (this.mapa.size > this.tope) {
      const masVieja = this.mapa.keys().next();
      if (masVieja.done) break;
      this.mapa.delete(masVieja.value);
    }
  }

  delete(clave: K): boolean {
    return this.mapa.delete(clave);
  }

  clear(): void {
    this.mapa.clear();
  }

  get size(): number {
    return this.mapa.size;
  }
}
