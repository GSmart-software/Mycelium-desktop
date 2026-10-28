---
titulo: Terminal
tema: Herramientas
solo: desktop
sinonimos: [consola, shell, powershell, bash, línea de comandos, git, consola estilada, efectos, crt]
---

La **terminal** es una consola de tu sistema dentro de Mycelium: la misma shell que abrirías
afuera (PowerShell, cmd, Git Bash, WSL, bash, zsh…), con sus colores y sus programas
interactivos, en una pestaña más del área de trabajo.

## Para qué sirve

Para trabajar sobre la carpeta del vault sin salir de la app: usar git, correr un script o
una herramienta de línea de comandos, como un asistente de IA que lee y escribe tus notas.

## Cómo se usa

1. Abrí el panel **Consolas** desde su botón en el rail y tocá **Nueva terminal**. Arranca
   con la shell por defecto en la carpeta del vault. Con la flecha de al lado (o con clic
   derecho en el botón) elegís otra shell.
2. Para abrirla en una carpeta concreta, clic derecho en la carpeta del explorador →
   **Abrir terminal aquí**. También está **Nueva consola** en la paleta (**Ctrl+P**).
3. La pestaña se mueve, se divide y se ancla como cualquier otra, y podés tener varias
   consolas a la vez.

Cerrar la pestaña **no** termina la consola: sigue corriendo y vuelve a abrirse desde el
panel. Para terminarla, **Finalizar** en el panel. Ahí también la renombrás y le das un
color, que marca su pestaña.

## Configuración

En Configuración → **Consolas**: la **Shell por defecto**, **Restaurar terminales al
abrir** (vuelven las consolas que tenías, con su shell y su carpeta inicial, pero con un
proceso nuevo) y **Restaurar el historial** (muestra el texto de la sesión anterior).

## Consola estilada

En Configuración → **Consolas** → **Consola estilada** la consola cambia de aspecto: un fondo
de luz con una red de micelio, partículas, pantalla de tubo y texto que brilla, con los
colores de tu tema. Viene apagada. Al encenderla, debajo elegís cada parte:

| Parte | Qué agrega |
|---|---|
| **Fondo** | Una aurora con los colores del tema y una red de micelio detrás del texto |
| **Pulso del fondo** | El fondo se mueve: la aurora se desplaza y el micelio se acerca y se aleja |
| **Partículas** | Esporas de luz que suben despacio |
| **Borde animado** | Un borde de luz que gira alrededor de la consola |
| **Marca Mycelium** | El rótulo «MYCELIUM // TTY» en la esquina de abajo |
| **Brillo del texto** | El texto y el cursor brillan con su propio color |
| **Pantalla de tubo** | Líneas de barrido, bordes oscurecidos, grano y un haz de luz que baja |
| **Colores del tema** | Los colores de los programas, teñidos con el tema; cursor en barra e interlineado más amplio |

Los cambios se ven al instante en las consolas abiertas.

> [!info] Los programas que eligen sus propios colores los conservan
> **Colores del tema** cambia los colores básicos que usan la mayoría de los programas (el
> rojo de un error, el verde de git). Un programa que pide un color exacto —como un asistente
> de IA con su tema propio— se ve con el suyo. El brillo, el fondo y todo lo demás valen para
> cualquier programa.

> [!tip] Si la PC va lenta
> El fondo que se mueve, las partículas y el borde animado usan la placa de video. Apagá esas
> partes, o la consola estilada entera, y la consola vuelve a su aspecto de siempre.

> [!info] Las consolas son del vault
> Al cambiar de vault, sus consolas se terminan y desaparecen del panel; al volver, están
> otra vez para reabrirlas.

> [!tip] F1 abre la ayuda también desde la terminal
> Aunque la consola tenga el foco, **F1** abre esta ayuda en vez de llegarle al programa
> que corre ahí.
