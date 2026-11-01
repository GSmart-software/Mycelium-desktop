---
titulo: Avisos en la nota
tema: Escribir notas
solo: desktop
sinonimos: [diagnósticos, linter, subrayado, enlaces rotos, enlace ambiguo, título repetido, verificadores, revisar al guardar, advertencias]
---

Mientras escribes, Mycelium **subraya** en la nota lo que va a dar problemas en la red de
notas: un enlace que no lleva a ninguna parte, uno que duda entre dos notas, un título que ya
usa otra nota o una propiedad que no cumple su esquema. Como el corrector, pero para los
enlaces y las propiedades.

## Para qué sirve

Para ver el problema donde está, en el momento en que lo escribes, sin tener que abrir el
[panel de salud](ayuda:enlazar-y-organizar/salud-del-vault). Es el mismo criterio: lo que
el panel lista del vault entero, acá aparece marcado en la nota abierta.

## Cómo se usa

1. Abre o guarda la nota. Los avisos se calculan **al abrirla y al guardarla**, no en cada
   tecla: un enlace que acabas de escribir se revisa en cuanto la nota se guarda.
2. Lo que tiene un problema queda subrayado con una línea ondulada. **Pasa el mouse** por
   encima para leer el aviso.
3. La **barra de estado** dice cuántos hay, por ejemplo «2 avisos». Haz clic ahí para ir al
   siguiente.

Los avisos no impiden guardar ni cambian nada del archivo.

## Qué se marca

| Aviso | Dónde |
|---|---|
| Enlace roto | Un `[[enlace]]` a una nota que no existe, en cada lugar donde aparece |
| Embed roto | Un `![[…]]` de algo que no está en el vault |
| Enlace ambiguo | Un enlace a un título que tienen varias notas: va a la más cercana a la raíz. Escribe la carpeta para elegir |
| Título duplicado | La primera línea de la nota, si otra nota se llama igual |
| Propiedades | La línea de la propiedad que no cumple su [esquema](ayuda:escribir-notas/esquemas-de-propiedades), o que empieza con `#` sin comillas |

Un enlace dentro de un bloque de código no se marca, igual que en el panel de salud. En la
vista en vivo, los avisos de las propiedades se ven en la tarjeta de propiedades, que tapa
esas líneas.

## Apagarlos

En **Configuración → Editor → Avisos en la nota**. Están encendidos por defecto. Apagados, no
se calcula nada y desaparecen las marcas.

> [!info] Solo revisiones incluidas
> Mycelium revisa lo que se describe arriba y nada más. No ejecuta programas ni comandos
> guardados en el vault: un vault puede venir de otra persona, y un comando que se ejecutara
> al guardar sería una puerta abierta a tu PC.

## Con la IA

Con el [control de la IA](ayuda:ia/control-de-la-ia) encendido, Claude Code puede leer estos
mismos avisos de las notas que tienes abiertas, para ver lo mismo que tú después de editar
una nota.
