/**
 * El lado JS del motor WASM del corrector (`FUN-L-12`): `public/ortografia/motor.wasm`,
 * compilado desde `wasm/ortografia` (spellbook).
 *
 * El módulo exporta una API C mínima (ver `wasm/ortografia/src/lib.rs`): acá se
 * escriben los textos en su memoria y se leen las respuestas. Módulo **puro**
 * —sin imports—: lo usa el worker y lo prueba `scripts/test-ortografia.mjs` con
 * el `.wasm` real.
 */

type Exportaciones = {
  memory: WebAssembly.Memory;
  reservar(largo: number): number;
  liberar(p: number, largo: number): void;
  cargar(ap: number, an: number, dp: number, dn: number): number;
  descargar(id: number): void;
  revisar(id: number, p: number, n: number): number;
  sugerir(id: number, p: number, n: number): number;
  salida_largo(): number;
  agregar(id: number, p: number, n: number): number;
};

/** Un diccionario cargado en el motor. */
export type DiccionarioMotor = {
  revisar(palabra: string): boolean;
  sugerir(palabra: string): string[];
  agregar(palabra: string): boolean;
  liberar(): void;
};

export type Motor = {
  /** Carga un diccionario desde los bytes del `.aff` y el `.dic`. Lanza si no se puede leer. */
  cargar(aff: ArrayBuffer | Uint8Array, dic: ArrayBuffer | Uint8Array): DiccionarioMotor;
};

/** Tamaño del búfer para una palabra; una más larga se revisa con uno propio. */
const BUFER_PALABRA = 1024;

export async function crearMotor(wasm: ArrayBuffer | Uint8Array): Promise<Motor> {
  // `instantiate` con los bytes y no `instantiateStreaming`: no depende de que
  // quien sirve el archivo lo mande como `application/wasm` (el protocolo de
  // Tauri, un servidor de desarrollo, una carpeta local).
  const { instance } = await WebAssembly.instantiate(wasm as BufferSource);
  const x = instance.exports as unknown as Exportaciones;
  const codificador = new TextEncoder();
  const decodificador = new TextDecoder();
  const bufer = x.reservar(BUFER_PALABRA);

  /** Copia bytes a la memoria del módulo. La vista se crea cada vez: la memoria puede crecer y cambiar de búfer. */
  const copiar = (bytes: Uint8Array, p: number) => new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);

  /** Escribe una palabra y llama a `f` con su puntero y largo. */
  const conPalabra = <T>(palabra: string, f: (p: number, n: number) => T): T => {
    const bytes = codificador.encode(palabra);
    if (bytes.length <= BUFER_PALABRA) {
      copiar(bytes, bufer);
      return f(bufer, bytes.length);
    }
    const p = x.reservar(bytes.length);
    try {
      copiar(bytes, p);
      return f(p, bytes.length);
    } finally {
      x.liberar(p, bytes.length);
    }
  };

  const aBytes = (b: ArrayBuffer | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(b));

  return {
    cargar(aff, dic) {
      const a = aBytes(aff);
      const d = aBytes(dic);
      const pa = x.reservar(a.length);
      const pd = x.reservar(d.length);
      let id: number;
      try {
        copiar(a, pa);
        copiar(d, pd);
        id = x.cargar(pa, a.length, pd, d.length);
      } finally {
        x.liberar(pa, a.length);
        x.liberar(pd, d.length);
      }
      if (id < 0) throw new Error("El diccionario no se pudo leer (¿archivo dañado?).");
      return {
        revisar: (palabra) => conPalabra(palabra, (p, n) => x.revisar(id, p, n)) === 1,
        sugerir: (palabra) => {
          const p = conPalabra(palabra, (pp, n) => x.sugerir(id, pp, n));
          const largo = x.salida_largo();
          if (largo === 0) return [];
          return decodificador.decode(new Uint8Array(x.memory.buffer, p, largo)).split("\n");
        },
        agregar: (palabra) => conPalabra(palabra, (p, n) => x.agregar(id, p, n)) === 1,
        liberar: () => x.descargar(id),
      };
    },
  };
}
