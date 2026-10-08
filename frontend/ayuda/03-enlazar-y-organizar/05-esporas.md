---
titulo: Esporas
tema: Enlazar y organizar
sinonimos: [plantillas, templates, molde, variables, nota desde plantilla]
---

Una **Espora** es una plantilla de nota. No tiene un formato especial: es una nota común
que vive en la carpeta de Esporas del vault (`Esporas/`, si no la cambiaste). Al usarla,
Mycelium copia su contenido y completa sus variables, como la fecha de hoy.

## Para qué sirve

Para las notas que se repiten con la misma forma —una reunión, un diario, un proyecto, una
lectura— y que no querés armar de cero cada vez.

## Cómo se usa

1. En el ícono **Esporas** del rail, **Nueva Espora** crea una plantilla y la abre:
   escribila como cualquier nota.
2. **Clic** en una Espora del panel crea una nota nueva con su contenido, en la carpeta
   seleccionada del explorador, y la abre con el **título seleccionado**, listo para que
   escribas el nombre. Mientras tanto se llama como la Espora con un número
   («Reunión 1», «Reunión 2»…), nunca igual que ella: así no quedan dos notas con el
   mismo título.
3. Para usarla en una nota que ya existe, **Insertar Espora** en la barra del editor pone
   su contenido donde está el cursor.

También podés hacer **clic derecho** en una carpeta del explorador → **Nueva desde
Espora**, que crea la nota en esa carpeta.

## Variables

Se escriben entre llaves dobles y se completan al usar la Espora:

| Variable | Se reemplaza por |
|---|---|
| `{{titulo}}` | El título de la nota que se crea, o de la nota donde se inserta. Se completa una sola vez: si después renombrás la nota, el texto no cambia. |
| `{{fecha}}` | La fecha de hoy: `2026-10-06`. |
| `{{hora}}` | La hora, en 24 h: `15:04`. |
| `{{fecha:DD/MM/AAAA}}` | La fecha con tu formato: `06/10/2026`. |

En el formato propio valen `AAAA` (año), `MM` (mes), `DD` (día), `hh` (hora), `mm`
(minuto) y `ss` (segundo); lo demás se copia tal cual. Una Espora de reunión podría ser:

```md
---
fecha: {{fecha}}
tags: [reunión]
---

# {{titulo}}

Empezó a las {{hora}}.

## Temas

## Próximos pasos
- [ ] 
```

Las variables funcionan también dentro de las [propiedades](ayuda:escribir-notas/propiedades):
`fecha: {{fecha}}` deja la propiedad con la fecha del día.

> [!info] Al insertar, las propiedades se suman
> Si insertás una Espora con propiedades en una nota que ya tiene las suyas, se agregan
> las que faltan y gana el valor que ya tenía la nota. Las `tags` de las dos se juntan.

> [!tip] Una variable mal escrita queda a la vista
> Si escribís una que no existe, como `{{autor}}`, queda tal cual en la nota en vez de
> desaparecer: así te das cuenta.

La carpeta de Esporas se cambia en **Configuración → Vault → Carpeta de Esporas**. Las
subcarpetas que tenga adentro no cuentan como Esporas.
