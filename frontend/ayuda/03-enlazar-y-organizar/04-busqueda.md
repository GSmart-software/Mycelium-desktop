---
titulo: Búsqueda
tema: Enlazar y organizar
sinonimos: [buscar, paleta, encontrar, filtrar, ir a una nota, comandos, reemplazar]
---

Mycelium tiene tres formas de buscar: la **paleta**, para saltar a una nota por su nombre
o ejecutar un comando; la **búsqueda global**, que mira dentro de todas las notas; y la
**búsqueda en la nota**, para lo que tenés abierto.

## Para qué sirve

Para llegar a lo que buscás sin recorrer carpetas: un título que recordás a medias, una
frase que escribiste hace meses o todas las notas con una etiqueta o una propiedad.

## Cómo se usa

1. **Ctrl+O** abre la paleta: escribí parte del nombre y **Enter** abre la nota. Si no
   existe, la última opción la crea con ese nombre. Sin escribir nada, lista las últimas
   notas que abriste.
2. **Ctrl+P** abre la paleta en modo comandos, con un `>` adelante: nueva nota, grafo,
   calendario, modo oscuro, configuración, ayuda y más.
3. El ícono **Búsqueda global** del rail busca en todo el vault. Un clic en un resultado
   abre la nota en la primera coincidencia.

## La búsqueda global

Escribí al menos dos caracteres. Con varias palabras, aparecen las notas que tienen todas.

| Escribís | Encuentra |
|---|---|
| `reunión cliente` | Las notas que tienen las dos palabras. |
| `"plan de lanzamiento"` | La frase exacta, entre comillas. |
| `tag:proyecto` | Las notas con la etiqueta `#proyecto`. |
| `estado:activo` | Las notas cuya propiedad `estado` tiene la palabra «activo». |
| `bancal:"Bancal 1"` | Las notas cuya propiedad `bancal` vale exactamente «Bancal 1». |

Un filtro **sin comillas** busca una palabra del valor, como el texto: `bancal:bancal`
encuentra «Bancal 1» y «Bancal 10», y `estado:crec` encuentra «creciendo» (con **Búsqueda
exacta**, solo la palabra completa). Mira el principio de las palabras: `estado:activo` no
trae «inactivo». **Entre comillas**, el valor tiene que ser ese entero; así se escribe un
valor con espacios.

Los filtros se combinan con texto: `estado:activo informe` busca «informe» solo entre las
notas activas.

No importan las mayúsculas ni las tildes, tampoco en los filtros: «pulgon» encuentra
«Pulgón», y `familia:solanaceas` encuentra las notas con `familia: Solanáceas`.

- El botón dentro del campo cambia **dónde** se busca: **nombre y contenido**, **solo el
  nombre** o **solo el contenido**.
- El botón de al lado **agrupa los resultados por carpeta** o los vuelve a mostrar como
  lista, por relevancia.
- **Búsqueda exacta** pide la palabra completa. Apagada, «perr» encuentra «perro».

## La búsqueda en la nota

**Ctrl+F** busca dentro de la nota abierta. **Enter** va a la siguiente coincidencia,
**Shift+Enter** a la anterior y **Esc** cierra. El botón **Reemplazar** abre el campo para
cambiar lo encontrado; en la vista de lectura no aparece, porque ahí no se edita.

Más sobre filtrar en [Etiquetas](ayuda:enlazar-y-organizar/etiquetas) y
[Propiedades](ayuda:escribir-notas/propiedades).
