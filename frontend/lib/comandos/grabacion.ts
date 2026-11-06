/**
 * ¿Se está grabando un atajo en Configuración (`FUN-XL-04`, Parte 3)? Mientras
 * tanto, la tecla que se pulsa es la que se quiere asignar, no una orden: el
 * despachador, la ayuda (F1) y la captura rápida no actúan.
 */
let grabando = false;

export const grabandoAtajo = () => grabando;

export function fijarGrabandoAtajo(v: boolean) {
  grabando = v;
}
