---
titulo: Esquemas de propiedades
tema: Escribir notas
solo: desktop
sinonimos: [esquemas, esquemas.yml, propiedades obligatorias, valores permitidos, validar propiedades, vocabulario, comentario yaml, almohadilla, numeral]
---

Un **esquema** dice qué [propiedades](ayuda:escribir-notas/propiedades) tienen que tener
ciertas notas, de qué tipo y con qué valores. Mycelium avisa cuando una nota no lo cumple, sin
impedir que se guarde.

## Para qué sirve

Para que un vocabulario cerrado (`estado: activo`, `pausado` o `cerrado`) no viva solo en la
cabeza de alguien, y para que una IA que escribe notas sepa si las dejó bien. También avisa un
error de YAML que pasa en silencio: un valor que empieza con `#` sin comillas.

## Dónde se escriben

En un archivo **`esquemas.yml` en la raíz del vault**. Se abre y se edita desde el explorador,
como cualquier archivo de código. Al guardarlo, Mycelium lo vuelve a leer y actualiza los
avisos de las notas abiertas.

```yaml
Proyecto:                         # el nombre del esquema
  carpeta: Proyectos              # Proyectos/ y todas sus subcarpetas
  obligatorias: [estado, inicio]
  propiedades:
    estado:
      tipo: texto
      valores: [activo, pausado, cerrado]
    inicio: fecha                 # forma corta: solo el tipo
    prioridad: numero

Reunión:
  tipo_de_nota: reunion           # las notas con la propiedad tipo: reunion
  propiedades:
    fecha:
      tipo: fecha
      obligatoria: true
    asistentes: lista
```

| Clave del esquema | Qué hace |
|---|---|
| `carpeta` | A qué carpeta aplica, **con sus subcarpetas**. Una o una lista (`[Proyectos, Archivo]`). `/` es el vault entero |
| `tipo_de_nota` | Aplica a las notas cuya propiedad `tipo` tiene ese valor (o uno de una lista). Sin distinguir mayúsculas |
| `obligatorias` | Claves que la nota tiene que tener, y no vacías |
| `propiedades` | Por clave: su `tipo` (`texto`, `numero`, `casilla`, `fecha`, `fecha_hora` o `lista`), sus `valores` permitidos y `obligatoria: true` |

- Con `carpeta` y `tipo_de_nota` juntas, tienen que cumplirse las dos. Sin ninguna, el esquema
  aplica a **todas** las notas.
- **Si varios esquemas aplican a una nota, se combinan**: la nota tiene que cumplirlos todos.
  Las obligatorias se suman, y si dos esquemas hablan de la misma clave valen las dos reglas.
  Un aviso que piden dos esquemas sale una sola vez, con los dos nombres.
- Un valor de tipo `texto` admite también números y fechas; una `lista` tiene que ser una
  lista. Los valores permitidos se comparan sin distinguir mayúsculas, y en una lista se
  revisa cada elemento.
- No se validan las [Esporas](ayuda:enlazar-y-organizar/esporas) (son plantillas) ni
  `CLAUDE.md` y `AGENTS.md` de la raíz.
- Los mapas en una sola línea (`fecha: { tipo: fecha }`) no se entienden: escribe `tipo` y
  `valores` en líneas con sangría, como en el ejemplo.

## Qué se avisa

En la tarjeta de propiedades de la nota y en la pestaña **PROPIEDADES**, la fila con problemas
lleva una marca y debajo se lista cada aviso:

- una **obligatoria que falta**, o que está vacía;
- un valor de **otro tipo**: «debería ser fecha (AAAA-MM-DD), y es texto»;
- un valor **no permitido**, con los valores que sí se admiten;
- un frontmatter que Mycelium no interpreta, porque así no se puede validar.

Los avisos **no impiden guardar**: son una ayuda, no un candado. El
[panel de salud](ayuda:enlazar-y-organizar/salud-del-vault) lista todas las notas del vault
que no cumplen.

## Un `#` al principio de un valor va entre comillas

En YAML, un `#` precedido de un espacio empieza un **comentario**. Por eso `Issue: #24` deja la
propiedad **vacía** para Obsidian, para un script o para una IA que lea la nota, aunque
Mycelium la muestre como `#24`. Cuando un valor empieza con `#` sin comillas, Mycelium lo
avisa aunque no haya ningún esquema: «se lee como comentario: ponlo entre comillas».

```yaml
Issue: "#24"     # bien: es el texto #24
Issue: #24       # aviso: para YAML, Issue queda vacía
```

No se avisa en `tags` (sus valores se escriben con o sin `#`), dentro de una lista entre
corchetes, ni en un comentario al final de un valor (`estado: activo # revisar`).

> [!info] Un esquema mal escrito no rompe nada
> Si `esquemas.yml` no se puede leer, o un esquema usa un tipo que no existe o una clave
> desconocida, esa parte se ignora y el resto se aplica. El problema se avisa al guardar el
> archivo y queda a la vista en el panel de salud, arriba de los problemas.

## Con la IA

Con el [control de la IA](ayuda:ia/control-de-la-ia) encendido, Claude Code valida una nota
que acaba de escribir —sus propiedades incluidas— antes de darla por terminada, y puede pedir
la lista de las notas del vault que no cumplen.
