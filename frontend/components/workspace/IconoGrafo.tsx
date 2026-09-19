/**
 * Ícono del grafo: el isotipo de Mycelium —tres nodos unidos por hifas— en
 * trazo de línea, con la misma grilla (24) y el mismo grosor que los íconos
 * Lucide del rail. Antes el grafo usaba `Share2`, que es el ícono de
 * «Compartir»: la función insignia del producto se veía igual que una acción
 * genérica (critique del cascarón, 2026-09-19).
 */
export function IconoGrafo({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Las hifas primero, para que los nodos las tapen en los cruces. */}
      <path d="M8.6 8.2 16 6.4M7.4 9.8l3.2 7.6M17.2 8.6l-3.6 8.2" />
      <circle cx="6.5" cy="8" r="2.6" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18.5" r="2.6" />
    </svg>
  );
}
