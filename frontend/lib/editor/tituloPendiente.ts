/**
 * Edición del título pendiente para una nota recién creada (`DEF-135`).
 *
 * Crear una nota «Sin título» desde un botón dejaba el foco en el botón: lo que
 * se escribía enseguida se perdía, y cada espacio o Enter lo volvía a activar y
 * creaba otra nota. Como en Obsidian, la nota nueva se abre con el **título en
 * edición y seleccionado**, así lo primero que se escribe la nombra.
 *
 * Mismo patrón que `pendingMatch`: quien crea registra el pedido antes de abrir,
 * y el editor lo consume cuando su vista está lista —la creación y la carga del
 * contenido son asíncronas, así que no hay un momento fijo en el que el título
 * ya exista en el DOM—. Consumir lo borra: el pedido vale para la primera vez
 * que la nota se monta, no para cada vez que se vuelve a su pestaña.
 */
const pendientes = new Set<string>();

/** Pide que la próxima vez que se monte `notaId` se abra la edición de su título. */
export function pedirEdicionDeTitulo(notaId: string): void {
  pendientes.add(notaId);
}

/** ¿Hay que abrir la edición del título de `notaId`? Consume el pedido. */
export function tomarEdicionDeTitulo(notaId: string): boolean {
  return pendientes.delete(notaId);
}

/**
 * Suelta el foco del control que disparó una creación (`DEF-135`).
 *
 * Un `<button>` enfocado se activa con espacio y con Enter: si conserva el foco
 * mientras la creación es asíncrona, lo que el usuario empieza a teclear para
 * lo nuevo crea otra cosa. Con el foco en `<body>` esas teclas no hacen nada
 * hasta que lo creado lo toma.
 */
export function soltarFoco(el: EventTarget | null): void {
  if (el && typeof (el as HTMLElement).blur === "function") (el as HTMLElement).blur();
}
