---
titulo: Bandeja y captura rápida
tema: Herramientas
sinonimos: [bandeja, captura, captura rápida, captura global, desde cualquier programa, minimizado, atajo global, anotar, apunte rápido, inbox, bandeja de entrada, notas rápidas, pendientes, Ctrl+Shift+Espacio, bandeja personal, todos los vaults]
---

La **captura rápida** sirve para anotar algo en el momento, sin decidir dónde va: lo que
escribes se agrega a una **Bandeja**, una nota con un apunte por línea y la hora en que lo
anotaste. Después, con tiempo, la repasas y llevas cada cosa a su lugar.

Hay dos bandejas:

| | Bandeja del vault | Bandeja personal |
|---|---|---|
| Qué es | La nota `Bandeja.md` del vault abierto | Un archivo de Mycelium **fuera de todo vault** |
| Se ve desde | Ese vault | **Todos** tus vaults: es la misma, abras el que abras |
| Búsqueda, enlaces, grafo, IA del vault | Sí: es una nota común | **No**: no es parte de ningún vault |

## Para qué sirve

Para no perder una idea, un dato o una tarea por no querer interrumpir lo que estás
haciendo: no hay que crear una nota, ni ponerle nombre, ni elegir carpeta. La Bandeja
personal es para lo que no es de ningún vault en particular, o para cuando estás en uno
que no es donde quieres dejarlo.

## Cómo se usa

1. Pulsa **Ctrl+Shift+Espacio** desde cualquier lugar de la app (o busca **Captura
   rápida** en la paleta de comandos, **Ctrl+P**). Aparece una cajita arriba, sobre lo que
   tengas abierto. También funciona **desde cualquier otro programa**, con Mycelium
   minimizado o detrás: ver más abajo.
2. Escribe lo que quieras anotar. Si empiezas con `[]`, entra como **tarea**; si no, como
   **nota**. La etiqueta de la derecha te dice cuál será.
3. Elige el destino abajo a la derecha: **Vault** (con el nombre del vault) o **Personal**.
   **Tab** lo cambia sin salir de la cajita; también puedes hacer clic en el que quieras.
4. **Enter** lo anota y cierra la cajita; un aviso breve te confirma dónde fue («Tarea
   anotada en tu Bandeja personal»). **Esc** o un clic afuera cierra sin anotar.

La pestaña que tenías abierta no cambia y el cursor vuelve adonde estaba: puedes seguir
escribiendo como si nada.

La cajita **recuerda el último destino** que elegiste, para todos tus vaults. Si prefieres
que abra siempre con el mismo, elígelo en **Configuración → Vault**, **Destino de la
captura rápida**. La primera vez, abre con la Bandeja del vault.

## Desde cualquier programa

Mientras Mycelium esté abierto —aunque esté minimizado o detrás de otras ventanas—,
**Ctrl+Shift+Espacio** funciona desde cualquier programa: el navegador, el correo, una
planilla. Aparece la misma cajita en una ventanita propia, en el centro de la pantalla
donde está el puntero, **sin traer Mycelium al frente**.

- **Vault** es la Bandeja del vault de la **última ventana de Mycelium que usaste**. Si
  ninguna ventana tiene un vault abierto, solo se puede anotar en la **Personal**.
- **Tab** cambia el destino, como siempre, y se recuerda el último que elegiste.
- **Enter** anota y la cajita desaparece: vuelves al programa en el que estabas, con el
  cursor donde lo tenías. **Esc** la cierra sin anotar.
- Si haces clic en otra ventana, la cajita se esconde y **guarda lo que escribiste** para
  la próxima vez que la abras.

El apunte aparece enseguida en el contador del explorador y en la Bandeja, si la tienes
abierta, igual que si lo hubieras anotado desde adentro de Mycelium.

> [!info] Con Mycelium cerrado no funciona
> El atajo lo atiende Mycelium, así que tiene que estar abierto (puede estar minimizado).

> [!warning] Si otro programa ya usa Ctrl+Shift+Espacio
> Al abrir Mycelium te avisa que no pudo tomar el atajo. La captura rápida sigue
> funcionando adentro de Mycelium, pero no desde otros programas. Para usarla desde
> cualquier lado, quítale ese atajo al otro programa (suele estar en su configuración de
> teclado) y vuelve a abrir Mycelium. Por ahora el atajo de la captura rápida no se puede
> cambiar.

## El formato

Las dos bandejas tienen el mismo formato. Cada día abre su encabezado y cada apunte va al
final, con la hora:

```markdown
## 2026-11-05
- 09:40 La panadería prefiere hablar por la tarde
- [ ] 10:05 Renovar el dominio antes del 15
```

Las tareas usan los mismos [estados de tarea](ayuda:escribir-notas/tareas) que cualquier
nota. Puedes marcar las tareas, borrar lo que ya procesaste o reordenarla: la captura
siempre agrega al final y no toca lo que ya había, aunque le hayas dado otro formato.

## La Bandeja del vault

Es la nota `Bandeja.md` en la raíz del vault. Se crea con la primera captura (o al abrirla
desde el explorador). Es una nota común: se busca, se enlaza (`[[Bandeja]]`), aparece en el
grafo y se edita como cualquier otra.

## La Bandeja personal

Es un archivo que Mycelium guarda en su carpeta de datos, fuera de tus vaults:
`%APPDATA%\com.mycelium.desktop\Bandeja personal.md` en Windows,
`~/Library/Application Support/com.mycelium.desktop/` en macOS y
`~/.local/share/com.mycelium.desktop/` en Linux. Para ver la ruta exacta, deja el puntero
sobre su entrada en el explorador.

- Es **la misma desde todos tus vaults**, también con dos ventanas abiertas a la vez: lo
  que anotas en una aparece en la otra, y dos capturas al mismo tiempo no se pisan.
- **No es parte de ningún vault**: no aparece en la búsqueda ni en el grafo, no se puede
  enlazar y la IA del vault no la ve.
- Se abre en su propia pestaña, **Bandeja personal**, con el mismo editor que una nota (vista
  en vivo, lectura, tareas). Lo que depende del vault no está: no hay autocompletado de
  `[[`, ni panel de enlaces, ni diagnósticos, ni se pueden insertar dibujos. Si la dejas
  abierta, vuelve al abrir la app.

## En el explorador

La sección **Bandeja**, arriba de **Archivos**, tiene dos entradas: **Del vault** y
**Personal · todos los vaults**, cada una con un número: cuántas entradas te quedan por
procesar. Cuenta cada apunte (nota o tarea), sin las tareas hechas ni las canceladas; sin
entradas, no muestra número. Como tiene su propia sección, `Bandeja.md` no se repite en el
árbol de **Archivos**. La sección se pliega con un clic en su título, como **Archivos**, y
lo recuerda.

Con el teclado, la Bandeja es un **grupo** del explorador: con el explorador elegido,
**Enter** y después **Ctrl+↑** / **Ctrl+↓** hasta su título; **Enter** entra a sus dos
entradas (y la despliega si estaba plegada), **←** / **→** la pliegan y despliegan, y
**Alt** o **Esc** vuelve al título. Ver [Atajos de
teclado](ayuda:atajos-de-teclado/atajos-de-teclado).

| Acción | Del vault | Personal |
|---|---|---|
| **Clic** | La abre en una pestaña. | La abre en su pestaña. |
| **Doble clic** o **Abrir como nota** | La abre en una pestaña fija. | La abre en su pestaña. |
| **Abrir al lado** | La abre en un panel nuevo a la derecha. | Igual. |
| **Copiar enlace** | Copia el `[[enlace]]` a la Bandeja. | Apagado: no es parte del vault. |

También puedes abrirla desde la paleta (**Ctrl+P**): **Abrir la Bandeja del vault** y
**Abrir la Bandeja personal**. Los dos sirven como paso de una
[macro](ayuda:herramientas/macros).

## No se renombran ni se eliminan

Ninguna de las dos se puede renombrar, mover ni mandar a la papelera: en su menú,
**Renombrar** y **Mover a la papelera** aparecen apagados, y su título no se edita. Tampoco
se elimina una carpeta que contenga la Bandeja del vault. La IA del vault tiene el mismo
límite.

Si el archivo se borra por fuera de Mycelium, se vuelve a crear vacío la próxima vez que
anotas o la abres.

## Cambiar dónde está la del vault

En **Configuración → Vault**, **Bandeja del vault** dice qué nota es la Bandeja
(`Bandeja.md`, si no la cambiaste). Puede estar en una carpeta (`Entrada/Bandeja.md`).
Cambiarla **no mueve el archivo**: la Bandeja pasa a ser la nota de la ruta nueva, y la
anterior queda como una nota más. Si renombras o mueves la carpeta donde está, la Bandeja
la sigue sola. La Bandeja personal no se cambia de lugar.

## Si la tienes abierta

Si una Bandeja está abierta en una pestaña sin cambios, lo que anotas aparece enseguida
(en la personal, también lo que anotas desde otra ventana). Si la estás editando y todavía
no se guardó, Mycelium no pisa lo tuyo: te avisa que el archivo cambió y te deja elegir,
como con cualquier cambio hecho por fuera. Si eliges **Guardar lo mío como copia** en la
Bandeja personal, la copia queda como una nota en la raíz del vault abierto.
