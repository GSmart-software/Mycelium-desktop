// Colocación de los nombres del cúmulo (`DEF-149`).
//
// Antes, con «Nombres: Todos», se escribían por importancia y se SALTABA el que
// caía encima de uno ya escrito: los nodos de pocos enlaces se quedaban sin
// nombre aunque hubiera sitio al lado. Y los nodos no contaban como ocupados,
// así que un nombre podía quedar encima del círculo de otro nodo.
//
// Ahora cada nombre visible se escribe siempre. Se prueba en cuatro lugares
// alrededor de su nodo —abajo (el de siempre), arriba, a la derecha y a la
// izquierda— y gana el primero que no pisa ni un nodo ni otro nombre; si todos
// pisan algo, el que menos estorba (un nombre sobre otro antes que sobre un
// nodo). El dibujo le pone además un halo del color del fondo, para que se lea
// aunque cruce aristas o, en el último caso, otro nombre.
//
// Al alejar el zoom los nombres se desvanecen como en Obsidian (su «text fade
// threshold»): de opacos a invisibles entre dos umbrales, y vuelven al acercar.
// Con «Todos» la opción dice lo que hace: todos los nombres, a partir del zoom
// en que un nombre se puede leer.
//
// Rendimiento: rejilla espacial en píxeles de pantalla; cada caja se compara
// solo con lo que comparte sus celdas, nunca todos contra todos. Se usa solo al
// pintar la capa del reposo (una vez al asentarse o al terminar un gesto de
// zoom), nunca por frame mientras el grafo se mueve.
//
// Módulo PURO (sin DOM), para los tests.

/** Alto de la caja de un nombre, en píxeles de pantalla (fuente de 12 px). */
export const ALTO_NOMBRE = 14;
/** De la parte de arriba de la caja a la línea base del texto. */
export const BASE_NOMBRE = 11;
/** Separación entre el borde del nodo y la caja del nombre. */
const SEPARACION = 2;
/** Por debajo de este zoom no se ve ningún nombre (salvo apuntado y centro). */
export const ZOOM_NOMBRES_MIN = 0.35;
/** A partir de este zoom los nombres se ven opacos. */
export const ZOOM_NOMBRES_PLENO = 0.6;

/**
 * Opacidad de los nombres con «Todos» según el zoom: 0 por debajo de
 * `ZOOM_NOMBRES_MIN`, 1 desde `ZOOM_NOMBRES_PLENO`, lineal en el medio.
 */
export function opacidadNombres(scale: number): number {
  if (!(scale > ZOOM_NOMBRES_MIN)) return 0;
  if (scale >= ZOOM_NOMBRES_PLENO) return 1;
  return (scale - ZOOM_NOMBRES_MIN) / (ZOOM_NOMBRES_PLENO - ZOOM_NOMBRES_MIN);
}

/** Caja de un nombre colocado, en píxeles de pantalla. `lado`: 0 abajo, 1 arriba, 2 derecha, 3 izquierda. */
export type CajaNombre = { x: number; y: number; w: number; h: number; lado: number };

/**
 * Rejilla de ocupación de los nombres. Se vacía antes de cada pintada; se cargan
 * los discos de los nodos visibles y después se colocan los nombres en orden de
 * importancia (el primero elige lugar primero).
 */
export class RejillaNombres {
  private readonly celda: number;
  /** celda → discos `[x, y, r, …]`. */
  private readonly discos = new Map<number, number[]>();
  /** celda → cajas `[x, y, w, h, …]`. */
  private readonly cajas = new Map<number, number[]>();

  constructor(celda = 96) {
    this.celda = celda;
  }

  limpiar() {
    this.discos.clear();
    this.cajas.clear();
  }

  private clave(f: number, k: number) {
    return f * 100003 + k;
  }

  private meter(mapa: Map<number, number[]>, x0: number, y0: number, x1: number, y1: number, datos: number[]) {
    const c0 = Math.floor(x0 / this.celda);
    const c1 = Math.floor(x1 / this.celda);
    const f0 = Math.floor(y0 / this.celda);
    const f1 = Math.floor(y1 / this.celda);
    for (let f = f0; f <= f1; f++) {
      for (let k = c0; k <= c1; k++) {
        const clave = this.clave(f, k);
        const lista = mapa.get(clave);
        if (lista) lista.push(...datos);
        else mapa.set(clave, datos.slice());
      }
    }
  }

  /** Marca el disco de un nodo (centro y radio en píxeles de pantalla). */
  agregarDisco(x: number, y: number, r: number) {
    this.meter(this.discos, x - r, y - r, x + r, y + r, [x, y, r]);
  }

  /** ¿La caja pisa algún disco? (prueba círculo contra rectángulo, exacta). */
  private pisaDisco(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.floor(x / this.celda);
    const c1 = Math.floor((x + w) / this.celda);
    const f0 = Math.floor(y / this.celda);
    const f1 = Math.floor((y + h) / this.celda);
    for (let f = f0; f <= f1; f++) {
      for (let k = c0; k <= c1; k++) {
        const lista = this.discos.get(this.clave(f, k));
        if (!lista) continue;
        for (let j = 0; j < lista.length; j += 3) {
          const cx = lista[j];
          const cy = lista[j + 1];
          const r = lista[j + 2];
          const px = cx < x ? x : cx > x + w ? x + w : cx;
          const py = cy < y ? y : cy > y + h ? y + h : cy;
          const dx = cx - px;
          const dy = cy - py;
          if (dx * dx + dy * dy < r * r) return true;
        }
      }
    }
    return false;
  }

  /** ¿La caja pisa otro nombre ya colocado? */
  private pisaNombre(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.floor(x / this.celda);
    const c1 = Math.floor((x + w) / this.celda);
    const f0 = Math.floor(y / this.celda);
    const f1 = Math.floor((y + h) / this.celda);
    for (let f = f0; f <= f1; f++) {
      for (let k = c0; k <= c1; k++) {
        const lista = this.cajas.get(this.clave(f, k));
        if (!lista) continue;
        for (let j = 0; j < lista.length; j += 4) {
          if (
            x < lista[j] + lista[j + 2] &&
            x + w > lista[j] &&
            y < lista[j + 1] + lista[j + 3] &&
            y + h > lista[j + 1]
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Coloca el nombre de un nodo con centro `(x, y)` y radio `r` (pantalla) y
   * texto de ancho `ancho`. Devuelve SIEMPRE una caja —todo nombre visible se
   * escribe— y la deja ocupada para los que vengan después.
   *
   * `preferido`: el lado que tuvo la vez anterior; se prueba primero, así un
   * nombre no salta de lado a cada repintada mientras el grafo termina de
   * acomodarse (gana si está libre; si no, se sigue el orden de siempre).
   */
  colocar(x: number, y: number, r: number, ancho: number, preferido = 0): CajaNombre {
    const w = ancho + 4;
    const h = ALTO_NOMBRE;
    let mejor: CajaNombre | null = null;
    let mejorCosto = Infinity;
    for (let paso = -1; paso < 4; paso++) {
      const lado = paso < 0 ? preferido : paso;
      if (paso >= 0 && lado === preferido) continue;
      let bx: number;
      let by: number;
      if (lado === 0) {
        bx = x - w / 2;
        by = y + r + SEPARACION;
      } else if (lado === 1) {
        bx = x - w / 2;
        by = y - r - SEPARACION - h;
      } else if (lado === 2) {
        bx = x + r + SEPARACION + 2;
        by = y - h / 2;
      } else {
        bx = x - r - SEPARACION - 2 - w;
        by = y - h / 2;
      }
      // Pisar un nodo es peor que pisar un nombre: el nodo es lo que se apunta
      // y se cliquea, y el halo del nombre lo taparía.
      const costo = (this.pisaDisco(bx, by, w, h) ? 2 : 0) + (this.pisaNombre(bx, by, w, h) ? 1 : 0);
      if (costo < mejorCosto) {
        mejorCosto = costo;
        mejor = { x: bx, y: by, w, h, lado };
        if (costo === 0) break;
      }
    }
    const caja = mejor as CajaNombre;
    this.meter(this.cajas, caja.x, caja.y, caja.x + caja.w, caja.y + caja.h, [caja.x, caja.y, caja.w, caja.h]);
    return caja;
  }
}
