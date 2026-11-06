/**
 * El evento con el que los comandos de vista (`editor.vista-*`, Ctrl+1..4) le
 * piden el cambio de vista al editor del panel activo (`FUN-XL-04`, Parte 3).
 * El `detail` es el modo: `live`, `split`, `read` o `raw`.
 */
export const EVENTO_VISTA_NOTA = "micelio:vista-nota";
