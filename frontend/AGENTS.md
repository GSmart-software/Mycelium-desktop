<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Desplegables: probalos abiertos y en modo oscuro

Un `<select>` tiene **dos partes y solo una está en el documento**. La caja cerrada se estila
como cualquier otra; **la lista desplegada la dibuja el navegador fuera del DOM** y ningún
`.module.css` la alcanza. Ese defecto reapareció en cada funcionalidad con un desplegable —el
control se veía bien y la lista salía en blanco, ilegible en oscuro— hasta que se arregló
globalmente el 2026-08-16:

- `styles/tokens.css` → `color-scheme` siguiendo a `data-dark`. **Es la pieza imprescindible**:
  es lo único que le dice al navegador con qué luz dibujar lo suyo (la lista, el calendario de
  un `input[type="date"]`, los spinners de un `number`).
- `app/globals.css` → `select option` con los tokens de Mycelium.

Por eso: usá `<select>` a secas y estilá solo la caja cerrada; **no repitas `option { … }`** en
el módulo del componente. Y comprobalo **en modo oscuro y con la lista abierta** — cerrada,
este defecto no se ve, que es justo por lo que pasó tantas veces. Detalle completo en
`docs/DESIGN_SYSTEM.md` § Controles nativos.
