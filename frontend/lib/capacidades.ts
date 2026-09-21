/**
 * Qué funciones existen en esta versión de Mycelium.
 *
 * **Compartir** necesita cuenta y servidor: es de la versión web. En desktop no
 * hay ni una ni otro, y el backend local era un `noop()` que respondía «Acceso
 * concedido» sin hacer nada: un formulario que pedía el email de otra persona en
 * una app que promete que nada del vault sale de la máquina (critique del
 * cascarón, 2026-09-19). Con esto en `false` desaparecen el botón, la sección
 * «Compartido» y los ítems del menú contextual; el código queda, por si algún
 * día hay sincronización.
 */
export const HAY_COMPARTIR = false;
