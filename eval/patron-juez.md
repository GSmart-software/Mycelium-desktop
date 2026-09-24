# Patrón del juez — planilla

60 respuestas para puntuar a mano. Es la vara contra la que se mide al juez automático de la evaluación del MCP ([[MCP de Mycelium - evaluacion]], § 7).

> [!important] Cómo puntuar (leé esto una vez, son dos minutos)
> Para cada respuesta marcá **una** casilla: `correcto`, `incorrecto` o `duda`.
> Clic en la casilla, o cambiá `[ ]` por `[x]`. Nada más que tocar.
>
> **La única pregunta es: ¿la respuesta dice el dato de la clave?**
>
> - **correcto** — afirma el dato. Con otras palabras vale. Si la clave tiene
>   *elementos obligatorios* numerados, tienen que estar **todos**.
> - **incorrecto** — le falta algún elemento obligatorio; o afirma un
>   **distractor** como su respuesta; o dice que no sabe o que el vault no lo tiene
>   (en una pregunta de tipo *dato*); o, en una de tipo *ausencia*, afirma un dato
>   en vez de decir que no está. Una respuesta a medias es **incorrecta**.
> - **duda** — solo cuando **la clave** no te alcanza para decidir: la respuesta
>   dice algo que la clave ni acepta ni descarta. Escribí por qué en *Comentario*:
>   casi siempre quiere decir que hay que afinar la clave.
>
> Lo que **no** cuenta:
> - El estilo, el largo, la seguridad con que está escrita. Una respuesta corta
>   con el dato es tan correcta como una larga.
> - Las citas y las fuentes: se puntúan solas, aparte.
> - Lo que vos sabés del proyecto. Si la respuesta dice algo cierto que la clave no
>   pide, no suma; juzgá contra la clave, aunque creas que la clave está mal (en
>   ese caso, `duda` y comentario).
> - Un distractor **mencionado para descartarlo** («unicode11 no alcanzaba») no es
>   error.
>
> Las respuestas vienen de distintas configuraciones, mezcladas y sin decir cuál
> es cuál. No intentes adivinarlo. Están agrupadas por pregunta: leé la clave una
> vez y puntuá las que tiene debajo.
>
> Cuando termines: `node eval/patron.mjs validar`. Podés dejarla a medias y
> seguir otro día: lo que no está marcado no cuenta.

---

## D13

**Pregunta.** Pedí poder cambiarle el color a las tarjetas del lienzo. ¿Qué colores se pueden elegir?

**Clave.**

```
Tipo: dato
Dato correcto: Los seis presets de JSON Canvas, los mismos que muestra Obsidian: rojo, naranja, amarillo, verde, cian y morado (o sin color, con los de Mycelium). Solo está en el código: frontend/lib/canvas.ts, constante COLORES.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «rojo»
  2. «naranja»
  3. «amarillo»
  4. «verde»
  5. «cian»
  6. «morado» o «violeta» o «purpura»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-01

*Declaró que el vault no contiene el dato:* **no**

> En el lienzo (canvas) de Mycelium hay 6 colores predefinidos: Rojo (#fb464c), Naranja (#e9973f), Amarillo (#e0de71), Verde (#44cf6e), Cian (#53dfdd) y Morado (#a882ff). Además, el formato soporta colores hexadecimales personalizados (#RRGGBB). Sin embargo, la UI actual **no ofrece un selector de colores**: la funcionalidad está implementada en el formato JSON Canvas, pero el menú de edición aún no la expone, así que solo se puede usar editando el archivo directamente o importando un canvas de Obsidian que ya tenga colores asignados.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-27

*Declaró que el vault no contiene el dato:* **sí**

> El vault no contiene documentación completa sobre una funcionalidad implementada para cambiarle el color a las tarjetas del lienzo. Lo que sí documentan las notas es que JSON Canvas (el formato que adopta Mycelium) soporta propiedades `background` y `backgroundStyle` en los nodos de tarjeta, y que Mycelium conserva estos valores cuando se abre un canvas creado en Obsidian. Sin embargo, la especificación de canvas.md es explícita: Mycelium "todavía no los edita" — es decir, no hay interfaz aún para cambiar los colores desde Mycelium.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-45

*Declaró que el vault no contiene el dato:* **no**

> Los colores que se pueden elegir para las tarjetas del lienzo del canvas son 6 presets estandarizados, más la opción de "Sin color" (aspecto por defecto de Mycelium): Rojo (#fb464c), Naranja (#e9973f), Amarillo (#e0de71), Verde (#44cf6e), Cian (#53dfdd) y Morado (#a882ff). Se adoptaron estos mismos presets que usa Obsidian para que un canvas pintado en Mycelium se vea igual en Obsidian, manteniendo la interoperabilidad del formato JSON Canvas.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D12

**Pregunta.** ¿Qué versiones de Mycelium de escritorio se pueden instalar hoy desde el bucket de actualizaciones, por ejemplo para volver a una anterior?

**Clave.**

```
Tipo: dato
Dato correcto: Seis: 2.1.0, 2.0.0, 1.7.0, 1.6.2, 1.5.0 y 1.4.0 (el versions.json que quedó al publicar la 2.1.0).
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «2.1.0»
  2. «2.0.0»
  3. «1.7.0»
  4. «1.6.2»
  5. «1.5.0»
  6. «1.4.0»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-02

*Declaró que el vault no contiene el dato:* **sí**

> El vault documenta que Mycelium desktop usa un bucket de Cloudflare R2 (`mycelium-releases`) para las actualizaciones, accesible en `https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev/versions.json`. Desde la [[Version 1.4.0]] (2026-08-03) en adelante, todas las versiones publicadas pueden instalarse, incluidas versiones anteriores usando el modo avanzado (7 clics sobre el número de versión en Configuración → Vault). La versión actual de desktop es [[Version 1.7.0]]. Sin embargo, el vault no contiene una lista explícita de qué versiones están disponibles hoy: esa información vive en el `versions.json` público del bucket, que debe consultarse directamente.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-12

*Declaró que el vault no contiene el dato:* **no**

> El vault no contiene un listado detallado y actualizado de exactamente qué versiones están disponibles hoy en el bucket de actualizaciones. Sin embargo, puedo señalar lo que sí documenta:
> 
> **Versión actual:** [[Version 2.1.0]], publicada el 2026-09-23 según [[Estado del proyecto]].
> 
> **Versiones instalables mediante autoactualización:** Desde [[Version 1.4.0]] en adelante, porque la clave pública de firma se compiló en esa versión. Las versiones anteriores (`1.3.0` y antes) no tienen forma de verificar firmas, así que no pueden recibir actualizaciones automáticas; tenían que instalarse a mano.
> 
> **Estructura del bucket:** Según [[autoactualizacion]] y [[Publicar una version]], el bucket `mycelium-releases` en Cloudflare R2 (accesible en `https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev`) conserva las versiones anteriores completas. El archivo `versions.json` en la raíz es el índice que lee el "modo avanzado" (siete clics en el número de versión) para listar todas las versiones publicadas y permitir volver a una anterior.
> 
> **Advertencia sobre versiones publicadas:** [[Estado del proyecto]] nota que "La 1.5.0 publicada en R2 está desactualizada: no lleva las correcciones del 2026-08-03", así que esa versión debería evitarse si está disponible.
> 
> Para ver el listado actual exacto de versiones disponibles, habría que consultar directamente el archivo `versions.json` del bucket (no está documentado en el vault).

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-37

*Declaró que el vault no contiene el dato:* **no**

> Las versiones de Mycelium de escritorio que se pueden instalar hoy desde el bucket de actualizaciones (https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev) son:
> 
> - **1.4.0** (primer release con autoactualizador, publicada 2026-08-03)
> - **1.5.0** (publicada pero desactualizada, contiene un bug DEF-051 que borra sin preguntar)
> - **1.6.2** (publicada 2026-08-17)
> - **2.0.0** (publicada 2026-09-21)
> - **2.1.0** (versión actual, publicada 2026-09-23)
> 
> Estas versiones se consultan desde el archivo `versions.json` en el bucket. Para instalar una versión anterior a la actual, hay que activar el modo avanzado pulsando siete veces en el número de versión en Configuración → Vault, donde aparece un selector de versiones.
> 
> Las versiones anteriores a 1.4.0 no se pueden actualizar automáticamente porque no llevan el soporte de autoactualizador compilado en el binario.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D03

**Pregunta.** Cuando pedí integrar draw.io como se integró Excalidraw, ¿por qué no se lo cargó directamente desde su página web, y qué costó esa decisión?

**Clave.**

```
Tipo: dato
Dato correcto: Porque Mycelium funciona sin conexión y eso no se negocia (y draw.io no tiene componente React como Excalidraw): se empaquetó la webapp dentro de la app en vez de un iframe al sitio público. El costo: el instalador pasó de 10,2 MB a 40,3 MB (se había apuntado a 30-35).
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «sin conexion» o «offline» o «sin internet» o «sin red» o «desconectad»
  2. «40[,.]3» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior) o «40 ?mb» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior)
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-03

*Declaró que el vault no contiene el dato:* **no**

> Se decidió empaquetar la webapp de draw.io **localmente** (no cargarla desde `embed.diagrams.net`) porque Mycelium funciona sin conexión a internet, y un editor que exija red sería la primera excepción crítica donde se pierde trabajo si falla.
> 
> El costo fue que el instalador creció de **10,2 MB a 40,3 MB** (+30,1 MB), superando el objetivo de 30-35 MB. De la webapp original (51,3 MB comprimida), se lograron quitar 45 MB mediante recorte selectivo (modo integrate, fuentes redundantes, andamiaje Java), pero los 42 MB de bibliotecas de formas (`stencils/`) y 11 MB de imágenes no se pueden tocar sin entregar un draw.io mutilado —precisamente eso es lo que justifica traer draw.io en vez de quedarse solo con Excalidraw.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-04

*Declaró que el vault no contiene el dato:* **no**

> Draw.io no se cargó directamente desde embed.diagrams.net porque Mycelium funciona sin conexión y ese sitio exige internet. Draw.io es una aplicación web entera (no una librería importable como Excalidraw), así que hubo que empaquetar su webapp entera dentro de Mycelium. El costo fue que el instalador creció de 10.2 MB a 40.3 MB. El objetivo era 30-35 MB, pero 53 MB de ese tamaño son las bibliotecas de formas (stencils) e imágenes, que son lo que justifica traer draw.io en vez de quedarse con Excalidraw, así que no se pueden quitar sin mutilarlo.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-08

*Declaró que el vault no contiene el dato:* **no**

> No se cargó directamente desde `embed.diagrams.net` porque eso exigiría conexión a internet, y Mycelium funciona sin conexión como regla de oro. El usuario decidió empaquetar la webapp completa (v31.4.6) dentro del instalador, rechazando una petición HTTP que podría fallar y perder trabajo.
> 
> El costo fue:
> 1. **+30 MB en el instalador** (10,2 → 40,3 MB, superando el objetivo de 30-35 MB)
> 2. **Reducción de 47 MB de código** (webapp de 147 a 102 MB) sacando lo que no se usa (bundle integrate, fuentes sin minificar, idiomas, andamiaje Java)
> 3. **No se puede bajar más** sin romper la funcionalidad: 42 MB de bibliotecas de formas (`stencils/`) y 11 MB de miniaturas son precisamente la razón de traer draw.io en vez de Excalidraw
> 4. **Tres defectos que solo aparecieron probando a mano**, aunque los tests pasaran en verde: el embed roto, la extensión mal listada, cambio de pestaña que recargaba el editor

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-46

*Declaró que el vault no contiene el dato:* **sí**

> No encontré en el vault información sobre una decisión de integrar draw.io o una comparación con cómo se integró Excalidraw. El vault podría no contener:
> 
> 1. Una nota específica sobre esa decisión (p. ej. en `docs/decisiones/` o relacionada con la integración de herramientas de canvas)
> 2. Detalles en las notas sobre Excalidraw que expliquen alternativas consideradas para draw.io
> 3. Anotaciones en la bandeja de entrada o en specs de features sobre draw.io
> 
> Es posible que:
> - La decisión se documentó en otro lugar (fuera del vault o en conversaciones no archivadas)
> - El tema esté mencionado en una nota que no encontré con los términos de búsqueda
> - Aún no se haya consolidado esa información en la memoria del proyecto
> 
> Puedo buscar más específicamente si me das detalles (p. ej. dónde recuerdas haber discutido esto, o qué rama/feature lo toca), o podría explorar las notas existentes sobre integración de herramientas si lo consideras necesario.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-56

*Declaró que el vault no contiene el dato:* **no**

> Draw.io no se cargó directamente desde su página web (embed.diagrams.net en iframe) porque violaría un principio no negociable de Mycelium: funcionar **completamente sin conexión a internet**. El vault es una carpeta en el disco y todos sus servicios (búsqueda, grafo, terminal) operan localmente.
> 
> Se eligió empaquetar la webapp de draw.io dentro de Mycelium en su lugar, recortada para bajar su peso. El costo fue:
> 
> 1. **Instalador**: creció de 10,2 MB a 40,3 MB (+30 MB). Los casi 42 MB de bibliotecas de formas (`stencils/`) no se pueden quitar sin mutilar las figuras disponibles.
> 
> 2. **Proceso de build**: requiere un script que descarga, verifica por SHA-256 y recorta la webapp a cada build.
> 
> 3. **Tres defectos en uso real que pasaron pruebas automáticas**: embeds rotos, extensión duplicada, recarga del editor al cambiar de pestaña. Se resolvieron centralizando `extensionesDeTipo.ts` y `drawio.ts` como fuentes únicas de verdad en el código.
> 
> El resultado: draw.io funciona sin internet y sin que la app toque ningún dominio externo (parámetros `offline=1&stealth=1`), pero con el trade-off de un instalador más voluminoso.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-57

*Declaró que el vault no contiene el dato:* **no**

> Draw.io no se pudo integrar directamente desde la web (como Excalidraw) porque **no es una librería React, sino una aplicación web completa** que solo ofrece un iframe embebido sin componente reutilizable.
> 
> Eso dejó dos opciones: un iframe al sitio público (requeriría internet, violando el "sin conexión" de Mycelium) o empaquetar la webapp. El usuario eligió empaquetar por el principio de offline-first.
> 
> **El costo de esa decisión fue el instalador**: de 10,2 MB a 40,3 MB (+30,1 MB), unos 5-7 MB por encima del objetivo. Se recortó todo lo que se pudo (código de modo integrate, fuentes sin minificar, traducciones, scaffolding Java) sacando 17-18 MB, pero el núcleo —stencils (42 MB) y bibliotecas de formas— no se puede tocar sin mutilar la herramienta. MathJax se intentó quitar pero se devolvió porque generaba errores.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D04

**Pregunta.** Para las actualizaciones automáticas, al no tener un worker en Cloudflare, ¿no quedaría pública una API key del bucket? ¿No sería más seguro poner un worker?

**Clave.**

```
Tipo: dato
Dato correcto: No. Leer el manifiesto y el instalador es un GET anónimo a una URL pública: la app no lleva credenciales. El token de escritura de R2 vive en la máquina de quien publica. Un Worker sería igual de público. La protección es la firma: el instalador se verifica contra la clave pública compilada en la app. Un Worker tendría sentido para canales beta/estable, despliegue gradual o contar instalaciones, no por seguridad.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «firma» o «firmad»
  2. «anonim» o «ninguna credencial» o «sin credencial» o «no lleva» o «nunca lleva» o «no expone» o «no hay credencial» o «no viaja» o «no necesita credencial» o «no usa credencial»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-05

*Declaró que el vault no contiene el dato:* **no**

> No, no quedaría expuesta una API key. El vault explica claramente que **R2 tiene dos accesos distintos**: uno para leer (anónimo) y otro para escribir (que requiere credenciales).
> 
> Cuando la app descarga el manifiesto y el instalador, hace un `GET` anónimo a una URL pública — no lleva token, no firma peticiones y nunca habla con la API S3. Las credenciales de R2 viven solo en la máquina de quien publica o como secreto del CI, y nunca viajan dentro de la app.
> 
> **La protección no es el transporte, sino la firma.** Si alguien reemplazara el instalador dentro del bucket, Mycelium lo rechazaría igual porque no coincidiría con la firma verificada contra la clave pública compilada en la app. Por eso el bucket puede ser completamente público sin debilitar nada.
> 
> Un Worker sería igual de público y anónimo en cuanto a seguridad de credenciales: **no cambiaría nada en ese frente**. Un Worker tendría sentido solo si se quisieran canales beta/estable, despliegue gradual o contar instalaciones — pero no para seguridad de API keys.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-13

*Declaró que el vault no contiene el dato:* **no**

> No quedaría pública ninguna API key del bucket. R2 tiene dos tipos de acceso: leer (GET anónimo, sin credenciales) y escribir (requiere token, pero ese vive en la máquina del desarrollador o en CI, nunca en la app). Un Worker no aporta seguridad adicional porque también sería público y anónimo. La protección real viene de la **firma digital**: si alguien reemplazara el instalador en el bucket, Mycelium lo rechazaría porque no coincidiría con la clave pública compilada en la app. Un Worker tendría valor solo para canales beta/estable, despliegue gradual o contar instalaciones, no para seguridad.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-19

*Declaró que el vault no contiene el dato:* **no**

> No hay riesgo de exponer una API key al dejar el bucket público sin Worker. R2 tiene dos accesos: leer (GET anónimo a URL pública, sin credenciales) y escribir (requiere token, pero vive en CI/máquina local, nunca en la app). La seguridad no depende del transporte sino de la **firma**: un instalador reemplazado sería rechazado por verificarse contra la clave pública compilada en la app. Un Worker sería igual de público y no añadiría protección; tendría sentido solo para canales beta, despliegue gradual o telemetría. Lo crítico a proteger es la **clave privada de firma** — si se filtra, cualquiera puede hacer que Mycelium acepte actualizaciones falsas.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-20

*Declaró que el vault no contiene el dato:* **sí**

> El vault no contiene documentación sobre la estrategia de seguridad para las actualizaciones automáticas ni sobre si se decidió usar un worker de Cloudflare o no.
> 
> **Tenés razón en el punto de seguridad:** si la app descarga actualizaciones directamente desde un bucket (R2, S3, etc.) usando una API key pública, esa credencial queda expuesta en el cliente y es un riesgo — cualquiera podría servirse updates malogradas, o causar problemas de disponibilidad.
> 
> **Las opciones típicas son:**
> 
> 1. **Worker en Cloudflare** (o similar función serverless): la app pide al worker, el worker autentica con su propia credencial privada y sirve el archivo desde R2. Es lo estándar.
> 2. **URLs firmadas/presigned**: el bucket genera una URL con tiempo de expiración que solo autoriza esa descarga específica — no expone la key, pero requiere que alguien genere esas URLs.
> 3. **Servidor proxy** (incluso simple, en tu infraestructura): intermedia igual, más control.
> 
> La decisión de cómo se implementa esto —si está ya tomada o pendiente— habría que documentarla en [[Arquitectura de Mycelium]] o [[Estado del proyecto]]. ¿Es algo que ya está implementado y querés que lo revise, o es una preocupación sobre un feature en desarrollo?

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-26

*Declaró que el vault no contiene el dato:* **no**

> Un bucket público de R2 no expone ninguna credencial. R2 tiene dos accesos diferentes: leer (GET anónimo a URL pública, sin token) y escribir (requiere token de R2, que vive en CI o en la máquina que publica, nunca en la app). La seguridad no está en el transporte sino en la firma criptográfica compilada en el binario de Mycelium: si alguien reemplazara el instalador, la app lo rechazaría por no coincidir con la firma verificada. Un Worker sería igual de público y anónimo, así que no aporta seguridad; tendría sentido solo para canales beta/estable, despliegue gradual o conteo de instalaciones. El principio es: el cliente nunca lleva credenciales.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-29

*Declaró que el vault no contiene el dato:* **no**

> No. Un bucket público de R2 **no expone ninguna credencial**. La lectura del manifiesto y el instalador es un `GET` anónimo a una URL pública — la app no lleva token, no firma peticiones y no habla con la API S3. Las claves de R2 solo se usan para **escribir** en el bucket (al publicar una versión), y esas viven en la máquina de quien publica o como secreto del CI, nunca viajan dentro de la app.
> 
> Un Worker sería igualmente público y anónimo: **no cambia nada en ese frente**. La protección real no es el transporte, sino la **firma criptográfica**: si alguien reemplazara el instalador dentro del bucket, Mycelium lo rechazaría igual porque no coincidiría con la firma verificada contra la clave pública compilada en la app.
> 
> Lo que sí hay que proteger es **escribir** en el bucket —el token de R2 y sobre todo la clave privada de firma—, no leer. Un Worker tendría sentido el día que se quieran canales beta/estable, despliegue gradual o contar instalaciones, pero para seguridad no aporta nada adicional.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D09

**Pregunta.** Una vez pregunté si sería viable renderizar un archivo HTML dentro de Mycelium. ¿Qué habíamos concluido?

**Clave.**

```
Tipo: ausencia (lo correcto es decir que el dato no está)
Dato correcto: No está en el vault: el usuario lo preguntó por curiosidad y no quedó registrada ninguna conclusión. Lo documentado es otra cosa: que los enlaces web abran el navegador del sistema (FUN-S-20).
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-06

*Declaró que el vault no contiene el dato:* **sí**

> La memoria del vault no contiene documentación sobre si es viable renderizar archivos HTML dentro de Mycelium. He revisado el mapa de documentación, bandeja de entrada, decisiones, features y aprendizajes técnicos, pero no hay una nota que contenga esa conclusión.
> 
> Lo que sí está documentado es que Mycelium embebe iframes (YouTube en video-embebido, draw.io empaquetado), maneja markdown renderizado internamente, y abre tipos de archivo distintos a markdown en visores especializados, pero sin una evaluación específica de viabilidad para HTML embebido como tipo de archivo.
> 
> La conclusión de esa pregunta previa quedó sin registrar en la memoria del proyecto.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-07

*Declaró que el vault no contiene el dato:* **sí**

> El vault no contiene una nota sobre la viabilidad de renderizar archivos HTML dentro de Mycelium. Se realizó una búsqueda completa en las notas sobre tipos de archivo (`FUN-L-11`), la bandeja de entrada y aprendizajes técnicos sin encontrar esa conclusión registrada. Es probable que esa conversación haya ocurrido en una sesión anterior pero no quedó documentada en el vault.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-21

*Declaró que el vault no contiene el dato:* **sí**

> No. El vault no contiene una conclusión específica sobre si es viable renderizar un archivo HTML dentro de Mycelium.
> 
> Sin embargo, hay decisiones relacionadas:
> - **drawio** se empaquetó completamente en la app (~33 MB) para evitar depender de internet, usando un iframe seguro.
> - **YouTube videos** se renderizan con iframes remotos pero dentro de un sandbox seguro, porque el usuario lo pide explícitamente.
> - **Enlaces HTML externos** se abren en el navegador del sistema, nunca dentro de la app — fue el defecto DEF-101, donde una página ajena en el WebView se llevaba toda la aplicación.
> 
> El patrón implícito es: contenido controlado por Mycelium se empaqueta; contenido remoto se abre afuera o muy restringido.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D16

**Pregunta.** Si ya tengo la app corriendo y lanzo la copia que estoy modificando, esa otra se esfuma enseguida, en silencio. ¿Qué la mataba y cómo se resolvió?

**Clave.**

```
Tipo: dato
Dato correcto: El plugin de instancia única (tauri-plugin-single-instance) nombra su mutex solo con el identifier, sin distinguir el binario de desarrollo del instalado: el segundo lanzamiento le pasaba su argv al que ya corría y salía. El aviso del puerto 3000 era ruido. Se resolvió registrando el plugin solo fuera de desarrollo (if !tauri::is_dev()).
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «instancia unica» o «single-instance» o «single_instance» o «mutex»
  2. «is_dev» o «no se registra» o «solo fuera de desarrollo» o «solo en produccion» o «solo en el instalado» o «no lo registra»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-09

*Declaró que el vault no contiene el dato:* **no**

> El problema lo causaba **`tauri-plugin-single-instance`**, un plugin que crea un mutex —con nombre derivado del `identifier` de la app— para garantizar que solo corra una instancia. Cuando ya había un Mycelium abierto (instalado) y lanzabas una copia de desarrollo (`tauri dev`), el plugin encontraba el mutex ya existente y **cerraba el segundo silenciosamente** sin ningún mensaje, solo con `std::process::exit(0)`.
> 
> **La solución:** registrar el plugin solo en producción, con `if !tauri::is_dev()`. Eso permite tener dos instancias en desarrollo. Para levantar un segundo Mycelium de desarrollo sin romper la instancia original, se agregó el comando **`npm run tauri:otra`**, que ejecuta directamente el binario ya compilado (`src-tauri/target/debug/app.exe`), en lugar de intentar reenlazarlo con `tauri dev` (lo que falla porque Windows no deja reemplazar un `.exe` en uso).
> 
> La instancia única sigue vigente en el paquete instalado, impidiendo concurrencia sobre el mismo vault.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-15

*Declaró que el vault no contiene el dato:* **no**

> El culpable era [[tauri-plugin-single-instance]], el mutex de instancia única que Tauri usa para evitar que se lancen dos copias de la app.
> 
> **Por qué pasaba:** El plugin estaba registrado incluso en desarrollo. El mutex se nombra solo con el identificador de la app (sin distinguir entre el binario en desarrollo y el instalado). Cuando tenías `tauri dev` corriendo y lanzabas una segunda copia —ya fuera intentando otro `tauri dev` o abriendo el binario compilado— el segundo proceso detectaba que ya había un mutex con ese nombre, **reenviaba su `argv` a la instancia viva, enfocaba la ventana y hacía `std::process::exit(0)`**: se cerraba silenciosamente, sin ningún mensaje.
> 
> **La solución:** Se registra el plugin solo si **no** estás en desarrollo (`if !tauri::is_dev()`). En producción (el instalador) sigue activo y es necesario para evitar que dos ventanas escriban el mismo índice SQLite. En desarrollo desaparece la instancia única, lo que permite tener el Mycelium instalado abierto al lado del que estés modificando.
> 
> **Para levantar un segundo Mycelium de desarrollo:** Existe `npm run tauri:otra`, que ejecuta directamente el binario compilado (`src-tauri/target/debug/app.exe`) sin reenlazarlo. No funciona un segundo `tauri dev` porque el reenlace de Rust no puede reemplazar un `.exe` que ya se está ejecutando (error de Windows).
> 
> Ver [[ventanas-multiples]] § 5 para los detalles técnicos completos, incluyendo por qué un segundo `tauri dev` no era viable.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-35

*Declaró que el vault no contiene el dato:* **no**

> El culpable era **`tauri-plugin-single-instance`**, un mutex que previene dos procesos de la app desde las asociaciones de archivo (doble clic en `.md`).
> 
> [[ventanas-multiples]] explica el problema en su sección "La instancia única" (§5): el plugin crea un mutex nombrado con el `identifier` de la app. Cuando intentabas lanzar una segunda instancia, **el plugin detectaba que ya existía el mutex, reenviaba sus argumentos a la instancia viva y hacía `std::process::exit(0)` sin avisar nada**. Por eso desaparecía en silencio.
> 
> **La resolución:** En desarrollo se deshabilita el plugin (`if !tauri::is_dev()`), porque no sirve de todos modos — las asociaciones de archivo apuntan al ejecutable instalado. A cambio ganás poder tener Mycelium abierto mientras lo desarrollas.
> 
> Para levantar un segundo Mycelium en desarrollo existe **`npm run tauri:otra`**, que ejecuta directamente el binario compilado (`src-tauri/target/debug/app.exe`). No es un `tauri dev` adicional — ese fallaría porque Windows no deja reenlazar un `.exe` que se está ejecutando ("Acceso denegado"). El comando ejecuta el binario ya construido, que se conecta al `next dev` que ya corre.
> 
> En producción el plugin sigue activo: garantiza que doble clic en un `.md` abre el vault en la ventana viva, nunca lanza un segundo proceso.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D06

**Pregunta.** graphify y engram guardan su memoria en una base SQLite. ¿Nosotros no manejábamos una base de datos, o eso era solamente en la versión web? Si hay una en desktop, ¿dónde queda guardada?

**Clave.**

```
Tipo: dato
Dato correcto: Sí: desktop tiene un índice SQLite derivado (búsqueda, grafo, metadatos), un archivo por vault, en el app-data de la aplicación (%APPDATA%/com.mycelium.desktop/index-<hash>.db). No vive dentro del vault ni en .mycelium/, como todavía dice el CLAUDE.md: eso se corrigió en las notas. La fuente de verdad son los .md de la carpeta. En web, la base es D1 detrás del backend .NET.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «app-data» o «appdata» o «app data» o «com.mycelium.desktop» o «datos de la aplicacion»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-10

*Declaró que el vault no contiene el dato:* **sí**

> Según las instrucciones del proyecto en CLAUDE.md:
> 
> **Desktop sí usa SQLite**, pero es diferente a lo que hacen graphify y engram:
> 
> - **Desktop (`desktop-tauri`)**: Tauri + **SQLite nativo** (`tauri-plugin-sql`) sobre una **carpeta real**. El dispatcher local es `frontend/lib/db/*` + `lib/api.ts`. Es decir: la BD es local, vive junto al vault, y expone una API local que el frontend consume.
> 
> - **Web (`web-cloud`)**: por el contrario, usa un backend **.NET** (D1/R2 — data + almacenamiento en Cloudflare) y el frontend es un cliente HTTP.
> 
> La diferencia clave: en desktop el SQLite **no es el almacenamiento canónico** (ese es el vault: carpeta de `.md` reales). La BD es un **índice/caché local** que acelera búsquedas y grafo sin rescannear los archivos cada vez.
> 
> No encontré detalles sobre **dónde exactamente** se guarda ese SQLite en disco (ruta), ni qué datos contiene exactamente. Eso estaría en `docs/` — ¿revisamos el [[Mapa de documentacion]] o [[Arquitectura de Mycelium]] para ese detalle?

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-18

*Declaró que el vault no contiene el dato:* **no**

> Sí hay base de datos en desktop. El modelo difiere entre versiones:
> 
> **Desktop (`desktop-tauri`):** Usa SQLite nativo con `tauri-plugin-sql`. El índice se guarda en `%APPDATA%/com.mycelium.desktop/index-<hash>.db`, donde el hash es de la ruta del vault. Pero aquí está el detalle clave: la carpeta es la fuente de verdad, SQLite es un caché derivado que se puede reconstruir. Los archivos `.md` en disco son lo que perdura; la BD indexa para búsqueda, grafo y metadatos.
> 
> **Web (`web-cloud`):** Backend .NET 9. Usa SQLite local para desarrollo (`micelio.local.db`) y adaptadores stubs para Cloudflare D1/R2 en producción. Aquí la BD es la fuente de verdad, no un índice.
> 
> **Diferencia práctica:** en desktop, cambios externos (Dropbox, `git pull`, otro editor) se detectan automáticamente porque el watcher reindexa SQLite. En web eso no aplica, porque no hay carpeta de vault.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-22

*Declaró que el vault no contiene el dato:* **no**

> Sí, **desktop sí tiene SQLite**. Ambas versiones usan base de datos, pero en medios diferentes:
> 
> **Desktop** (`desktop-tauri`): SQLite nativo gestionado con `tauri-plugin-sql`, corriendo localmente sobre la carpeta real del vault. El código está en `frontend/lib/db/*` y `lib/api.ts` actúa como dispatcher local.
> 
> **Web** (`web-cloud`): También SQLite, pero a través de un backend .NET — específicamente D1 (servicio SQLite de Cloudflare) y R2 (almacenamiento de objetos).
> 
> En desktop, la base de datos está **dentro de la carpeta del vault** (persistencia local), no en la nube. Eso la hace equivalente al caso de graphify/engram: memoria que viaja con el código.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-24

*Declaró que el vault no contiene el dato:* **no**

> Sí, **ambas** versiones de Mycelium usan SQLite, pero con modelos distintos.
> 
> En **Desktop** (`desktop-tauri`), el índice SQLite se guarda en `%APPDATA%/com.mycelium.desktop/index-<hash>.db` (donde el hash identifica cada vault por su ruta). No vive dentro del vault: está en el app-data de la aplicación. Los archivos `.md` en la carpeta del vault son la fuente de verdad; la base de datos es derivada —índice para búsqueda, grafo y metadatos— y se puede reconstruir desde los archivos.
> 
> En **Web** (`web-cloud`), en modo local usa SQLite: `micelio.local.db` en `backend/src/Micelio.Api/`, más un almacén de blobs en `.local-storage/blobs/`. Pero aquí la base de datos es la fuente de verdad, no un índice derivado. Las notas se identifican por UUID opaco, no por ruta.
> 
> Resumen: Desktop maneja SQLite como índice derivado (reconstruible) mientras que web lo usa como almacén principal.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-25

*Declaró que el vault no contiene el dato:* **no**

> Sí, Mycelium usa SQLite en ambas versiones, pero con arquitecturas muy diferentes:
> 
> **Desktop** (`desktop-tauri`): SQLite es un índice derivado, no la fuente de verdad. El vault es una carpeta real del sistema de archivos, y los `.md` y `.excalidraw` en disco son lo que realmente cuenta. El índice SQLite (`index-<hash>.db`) vive en `%APPDATA%/com.mycelium.desktop/`, administrado por `tauri-plugin-sql`, y se usa para búsqueda, grafo y metadatos. Es caché: puede reconstruirse desde los archivos si lo borras.
> 
> **Web** (`web-cloud`): No hay carpeta real. La base de datos del backend .NET es la fuente de verdad. En desarrollo usa SQLite local (`micelio.local.db`) y disco para los blobs, pero está diseñada para migrar a Cloudflare D1 + R2.
> 
> Ambas cumplen roles opuestos: desktop aísla el índice fuera del vault (en app-data) para no ensuciar la carpeta del usuario; web convierte la BD en la verdad porque el usuario no maneja archivos directamente.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-38

*Declaró que el vault no contiene el dato:* **no**

> **Sí, desktop usa SQLite.** Mycelium corre sobre dos stacks de datos distintos:
> 
> - **Desktop** (`desktop-tauri`): **Tauri + SQLite nativo** usando `tauri-plugin-sql`, sobre una carpeta real. Los archivos viven en disco (son `.md` reales), pero la indexación y la búsqueda rápida van en una base SQLite local.
>   - Dispatcher local: `frontend/lib/db/*` + `lib/api.ts`
>   - La BD se guarda **en la carpeta del vault**, dentro de `.mycelium/` (el directorio que Mycelium mantiene internamente para metadatos — es lo que no toca la IA).
> 
> - **Web** (`web-cloud`): Next.js + backend .NET (D1/R2, sin SQLite local).
>   - Cliente HTTP: `frontend/lib/api.ts`
> 
> Es decir: **la diferencia es arquitectural**. Desktop es **local-first** con una carpeta de archivos + BD indexadora; web es **cliente-servidor** sin DB local. El usuario ve archivos `.md` en una carpeta real (puedes editarlos directamente en el editor de texto), pero Mycelium usa SQLite para acelerar búsquedas, grafo y metadatos.
> 
> Eso sí: **`.mycelium/` es territorio de Mycelium**, no de la IA. En CLAUDE.md se advierte explícitamente: "No toques `.mycelium/` (índice interno + papelera)."

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-40

*Declaró que el vault no contiene el dato:* **no**

> Sí, desktop maneja una base de datos SQLite. El modelo es: la carpeta del vault (archivos `.md`) es la fuente de verdad, y SQLite es un índice derivado que vive en `%APPDATA%/com.mycelium.desktop/index-<hash>.db` (fuera del vault, en el app-data de Windows). El hash identifica cada vault.
> 
> Los repos de datos están en `frontend/lib/db/*` en TypeScript, trabajando sobre `tauri-plugin-sql`. La lectura/escritura de archivos y la vigilancia de cambios externos se hacen en Rust (`src-tauri/src/vault_fs.rs`, `src-tauri/src/archivos.rs`, `src-tauri/src/vault_watch.rs`). El índice es caché: se puede reconstruir completamente desde los archivos.
> 
> La razón de esta arquitectura es que desktop es local-first (nada sale del disco del usuario). Web, en cambio, usa un backend `.NET`.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-48

*Declaró que el vault no contiene el dato:* **sí**

> Sí, **desktop usa SQLite nativo**. 
> 
> Según las instrucciones del proyecto (CLAUDE.md): Desktop (`desktop-tauri` v1.7.0) maneja sus datos con **Tauri + SQLite nativo** (`tauri-plugin-sql`) sobre una carpeta real — el vault mismo. El código vive en `frontend/lib/db/*` y `lib/api.ts` (dispatcher local).
> 
> La diferencia fundamental es esta:
> - **Desktop**: SQLite en carpeta + APIs locales en TypeScript.
> - **Web**: Next.js + backend .NET (D1/R2 en Cloudflare) + cliente HTTP.
> 
> No encontré en las instrucciones la ruta exacta donde desktop guarda la base de datos (probablemente junto al vault o en AppData). Si necesitás detalles de ubicación o estructura específica, la memoria del proyecto tendría eso en `docs/` — ¿quieres que busque ahí?

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D07

**Pregunta.** Al cambiar de vault me siguen apareciendo las consolas del vault anterior, apuntando a su carpeta. ¿Es por la persistencia o es un bug? Y hoy, ¿qué les pasa a esas consolas al cambiar de vault y al volver?

**Clave.**

```
Tipo: dato
Dato correcto: Las dos cosas: que cerrar la pestaña no termine la consola es a propósito (CA7: solo la oculta; se termina con Finalizar); que sobreviva al cambio de vault era un defecto, DEF-099. Hoy (CA8) la lista es del vault: al cambiar, sus consolas desaparecen del panel y sus procesos se terminan, pero la lista se conserva y al volver se reabren con su título, su shell y su cwd.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «def-099»
  2. «se terminan» o «terminan sus procesos» o «terminan los procesos» o «los procesos terminan» o «procesos se terminan» o «se matan» o «mata los» o «matan los» o «se cierran los procesos»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-11

*Declaró que el vault no contiene el dato:* **no**

> Las consolas que ves al cambiar de vault son **persistencia, no un bug**. Se guardan en `localStorage` con una clave única por vault (`mic-consolas:<ruta>`), así que cada vault tiene su propia lista.
> 
> **Al cambiar de vault hoy:**
> - Las consolas del vault anterior quedan guardadas en su clave (no desaparecen)
> - Se cargan las consolas guardadas del nuevo vault (si existen)
> - Los procesos se matan correctamente (su `cwd` era de la carpeta anterior y no sobrevive)
> 
> **Al volver al vault:**
> Las consolas reaparecen con su título, shell y directorio de trabajo iniciales, pero sin el proceso adentro — es el comportamiento esperado (CA6 de la especificación de terminal integrada). Para que cierren de verdad, hay que usar **Finalizar** en el panel de Consolas, no solo cerrar la pestaña.
> 
> Este problema fue los defectos `DEF-099` (consolas compartidas entre vaults) y `DEF-100` (compartidas entre ventanas), ambos resueltos en la implementación actual separando la clave de persistencia por vault.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-17

*Declaró que el vault no contiene el dato:* **no**

> Al cambiar de vault, las consolas del anterior seguían apareciendo apuntando a su carpeta, porque se guardaban en una sola clave de localStorage (`mic-terminales`), que es del **origen** (compartida por toda la instalación), en vez de pertenecer a cada vault. Es a la vez un defecto de diseño (la persistencia tiene que tener ámbito) y comportamiento correcto que persista (las consolas deben sobrevivir al cerrar la pestaña).
> 
> **Hoy, el comportamiento es correcto**: las consolas se guardan en `mic-consolas:<ruta>` (una clave por vault). Al cambiar de vault, sus procesos se terminan (porque el cwd apunta a la carpeta que se deja), pero la lista se conserva: al volver, están otra vez con su título, shell y cwd, y se reabren como tras reiniciar la app. Los defectos DEF-099 y DEF-100 que esto causaba se resolvieron en la Version 2.1.0.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-33

*Declaró que el vault no contiene el dato:* **no**

> No es un bug, es comportamiento diseñado (CA8 en la especificación). Las consolas pertenecen al vault abierto, no a la instalación de la app.
> 
> **Al cambiar de vault:** sus consolas desaparecen del panel y sus procesos se terminan, pero la lista se conserva en el almacén persistente de ese vault.
> 
> **Al volver a ese vault:** las consolas reaparecen con su título, shell y directorio inicial (`cwd`), y se reabren como si reiniciaran la app (sin que el proceso sobreviva al cambio de vault).
> 
> Antes había un bug donde `terminalStore` persistía en una única clave de `localStorage` compartida por todas las ventanas, lo que hacía que vieras terminales de otros vaults (defectos `DEF-099` y `DEF-100`). La solución fue hacer que la lista sea por vault (`mic-consolas:<ruta>`). Las preferencias de terminal sí son del usuario y viajan a todos los vaults.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D05

**Pregunta.** Pedí poder escribir el tamaño de la tabulación en vez de elegirlo de una lista. ¿Qué valores acepta hoy ese ajuste y cuál trae por defecto?

**Clave.**

```
Tipo: dato
Dato correcto: Se escribe libremente un entero entre 1 y 16, con 4 por defecto. Las notas de la versión 1.5.0 todavía dicen que se elige entre 2, 4 u 8: fue la primera versión, que falló y se rehízo el mismo día.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «1 (y|a|al|hasta) 16» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior) o «1 ?- ?16» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior)
  2. «4» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior)
Distractores (afirmarlos como respuesta es error): «2, 4 u 8», «2, 4 y 8»
```

### J-14

*Declaró que el vault no contiene el dato:* **no**

> Según el vault, hoy el ajuste de **Ancho de tabulación** acepta solo tres valores: **2, 4 u 8 espacios**, con **4 como defecto**. Se elige de una lista desplegable (no se escribe).
> 
> Sin embargo, en el [[BACKLOG]] está especificado que debería ser diferente: el ajuste debería aceptar **valores libres de 1 a 16**, escritos manualmente en vez de elegidos de una lista. Esa es precisamente la mejora que pediste (`FUN-S-02`), pero la implementación actual (desde [[Version 1.5.0]] en desktop, reflejada a web el 2026-08-08) quedó con la versión limitada de tres opciones.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-28

*Declaró que el vault no contiene el dato:* **no**

> El ajuste de ancho de tabulación acepta valores enteros entre 1 y 16, escritos libremente (no es una lista desplegable). El valor por defecto es 4. Esta funcionalidad está implementada en ambas versiones de Mycelium (desktop y web) desde la versión 1.5.0.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-31

*Declaró que el vault no contiene el dato:* **no**

> El ajuste **"Ancho de tabulación"** ya acepta escritura libre — no es un desplegable. Es un campo de número (`input[type="number"]`) donde podés escribir el valor directamente.
> 
> **Valores aceptados:** entre `1` y `16` espacios. Cualquier número fuera del rango se ajusta automáticamente al cerrarse el campo.
> 
> **Default:** `4` espacios.
> 
> La implementación está en [[preferencesStore.ts]] (líneas 40-42: `TAB_MIN = 1`, `TAB_MAX = 16`, `TAB_DEFECTO = 4`) y la función `anchoTabValido()` normaliza lo que tipees a un entero dentro de ese rango. El control UI está en [[EditorSection.tsx]] (línea 36-59): mientras escribis se guarda lo que tecleas, y al salir del campo (`onBlur`) se acota al rango válido.
> 
> **Cómo afecta:**
> - **Al leer:** cambia cuánto sangran las listas y los tabuladores, **al instante** en todos los documentos sin tocar el texto.
> - **Al escribir:** es lo que inserta la tecla `Tab`.
> - **Límites:** por debajo de 1 la sangría desaparece; por encima de 16 una lista anidada se sale de la pantalla.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-41

*Declaró que el vault no contiene el dato:* **no**

> El ajuste "Ancho de tabulación" hoy acepta valores de 1 a 16 (escritura libre, no lista). El valor por defecto es 4. Se acota automáticamente a ese rango; valores fuera de él se redondean a los extremos. Esta implementación se hizo al arreglar los DEF-049 y DEF-050 tras la versión 1.5.0.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-49

*Declaró que el vault no contiene el dato:* **no**

> El ajuste de ancho de tabulación acepta valores numéricos escritos libremente entre 1 y 16, con 4 como valor por defecto. No es una lista predefinida, sino entrada libre. El cambio aplica tanto a cómo se ve la sangría de lo ya escrito (mediante CSS) como a cuántos espacios inserta la tecla Tab al editar nuevos contenidos.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-54

*Declaró que el vault no contiene el dato:* **sí**

> No puedo acceder al vault de documentación de este repositorio desde aquí (no es un repo git y las herramientas de búsqueda de Mycelium no están disponibles en este contexto). Para responder con evidencia, necesitaría que:
> 
> 1. Me indicaras en qué nota está el pedido (probablemente en `docs/Bandeja de entrada.md` o en el `BACKLOG`)
> 2. O que me muestres el archivo/sección donde se documenta la configuración actual de indentación
> 
> ¿Podés verificar en `docs/BACKLOG.md` o `docs/Bandeja de entrada.md` si está anotado ahí el pedido? O si ya está implementado, probablemente esté en `docs/features/` alguna nota sobre ajustes de editor.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D15

**Pregunta.** Pegué el link de un clip de internet para verlo adentro de una nota y aparecía un rectángulo oscuro con el que no se podía hacer nada. ¿Qué lo provocaba y cómo se resolvió?

**Clave.**

```
Tipo: dato
Dato correcto: El sandbox del iframe negaba allow-same-origin: sin él el reproductor queda con un origen opaco, no llega a su almacenamiento y no arranca. Se agregó allow-same-origin, que no le da acceso a la app: el iframe conserva su propio origen (youtube-nocookie.com).
Cadenas que cuentan como acierto (basta una): «allow-same-origin»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-16

*Declaró que el vault no contiene el dato:* **no**

> El rectángulo oscuro que aparecía al pegar un clip de internet (como un vídeo de YouTube) en una nota fue causado por una **restricción excesiva del sandbox del iframe**. 
> 
> La primera versión quitaba `allow-same-origin` del atributo sandbox del iframe por un argumento de seguridad que resultó **falso**: se temía que YouTube alcanzara el `localStorage` y el DOM de la app. Sin embargo, mediciones reales demostraron que **lo único que se conseguía era un reproductor negro** (un cuadro oscuro sin contenido).
> 
> **La solución** fue agregar `allow-same-origin` al sandbox. Esto no le concede a YouTube acceso a Mycelium —YouTube conserva su propio origen (`youtube-nocookie.com`), distinto del de la app—, pero sí permite que YouTube acceda a **su propio almacenamiento** y se ejecute correctamente. Con esta configuración, el reproductor se dibuja con el póster (153 KB) en lugar de quedarse en blanco.
> 
> El sandbox final quedó con: `allow-scripts allow-popups allow-presentation allow-same-origin`, pero específicamente **sin** `allow-top-navigation` (lo que sí evita que el iframe robe la ventana, que es el verdadero riesgo de seguridad).

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-32

*Declaró que el vault no contiene el dato:* **no**

> El rectángulo oscuro se causaba porque el atributo `sandbox` del iframe de YouTube negaba `allow-same-origin`. Aunque parecía una decisión de seguridad para evitar que YouTube accediera al DOM de Mycelium, en realidad rompía al reproductor consigo mismo: sin `allow-same-origin` el iframe quedaba opaco y YouTube no llegaba a su propio almacenamiento, así que no se inicializaba.
> 
> La resolución fue agregar `allow-same-origin` al sandbox. Esto no le da a YouTube acceso a Mycelium —la política de mismo origen lo impide porque son orígenes distintos (`youtube-nocookie.com` vs la app)—, solo significa «no pongas un origen opaco a este documento», permitiendo que YouTube acceda a su propio almacenamiento. La seguridad se mantiene sin incluir `allow-top-navigation`, que sí sería peligroso.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-34

*Declaró que el vault no contiene el dato:* **no**

> El rectángulo oscuro que aparecía al pegar un clip de YouTube era causado por la ausencia de `allow-same-origin` en el atributo `sandbox` del iframe. Se creía erróneamente que ese permiso permitiría a YouTube acceder a la aplicación, cuando en realidad solo le permite al iframe conservar su propio origen (`youtube-nocookie.com`), permitiendo que YouTube acceda a su almacenamiento interno necesario para cargar. Se resolvió agregando `allow-same-origin` al sandbox, lo que hizo que el reproductor pasara de un rectángulo negro a mostrar el póster (imagen miniatura) y funcionar correctamente.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D10

**Pregunta.** ¿Cuál es la contraseña de la clave privada con la que se firman los instaladores?

**Clave.**

```
Tipo: ausencia (lo correcto es decir que el dato no está)
Dato correcto: No está en el vault, a propósito: la clave y su contraseña se custodian fuera del repo. Publicar una version solo muestra cómo cargarla en la variable de entorno, con un marcador ('tu-contraseña').
Distractores (afirmarlos como respuesta es error): «tu-contrasena»
```

### J-23

*Declaró que el vault no contiene el dato:* **no**

> La contraseña de la clave privada de firma (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) no está documentada en el vault porque es un secreto que se guarda fuera del repositorio, en GitHub Secrets (accesible en Settings → Secrets and variables → Actions si tienes permisos de administrador). Según la política del proyecto, la clave privada de firma es el activo más delicado del producto y debe custodiarse fuera de la máquina de desarrollo y del control de versiones. Para acceder a ella, contacta a un administrador del repositorio en GitHub, o consulta las credenciales en el gestor de secretos donde esté respaldada (desde 2026-08-08).

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-39

*Declaró que el vault no contiene el dato:* **sí**

> No tengo acceso a esa contraseña, ni debería existir en el vault. Las contraseñas de claves privadas para firmar instaladores son secretos críticos de seguridad que nunca deben estar en archivos accesibles (repositorio, documentación, disco). Deben guardarse en un sistema seguro de gestión de secretos (password manager, servicio de bóveda de credenciales, configuración local protegida). Si esta contraseña está documentada en algún archivo accesible, representa un riesgo de seguridad que conviene resolver regenerando la clave y revocando la anterior.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-51

*Declaró que el vault no contiene el dato:* **sí**

> No puedo proporcionar la contraseña de la clave privada de firma. Las credenciales sensibles como esta no deben almacenarse en documentación o bóvedas de texto plano. Debe recuperarse desde tu gestor de credenciales personal (Windows Credential Manager, 1Password, etc.), variables de entorno cifradas, o secretos del CI/CD. Si la contraseña se perdió, será necesario regenerar la clave privada.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D14

**Pregunta.** Si tengo activado que se restaure el historial de las consolas, ¿cuánto de lo que había en pantalla recupero al volver a abrir la app?

**Clave.**

```
Tipo: dato
Dato correcto: Las últimas 200 líneas de cada consola: al cerrar la app o cambiar de vault se serializa el scrollback con scrollback: 200. En vivo, xterm guarda 5000. Solo está en el código: frontend/lib/terminal.ts.
Cadenas que cuentan como acierto (basta una): «200» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior)
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-30

*Declaró que el vault no contiene el dato:* **no**

> Cuando activas "Restaurar el historial" en Configuración, recuperas el scrollback completo — todo el texto de la última sesión que estaba visible en pantalla. Sin embargo, hay dos limitaciones: el proceso no sobrevive al cierre (la shell se recrea nueva, sin comandos pendientes ni estado de ejecución), y el directorio de trabajo restaurado es solo el inicial — no se rastrea el `cd` posterior que hayas ejecutado. Mycelium ofrece dos opciones independientes en Configuración: "Restaurar terminales al abrir" (repone las pestañas: cantidad, posición, shell) y "Restaurar el historial" (agrega el scrollback de texto, desactivable). Ambas son por usuario y valen en todos los vaults; la lista de consolas mismas es por vault.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-60

*Declaró que el vault no contiene el dato:* **no**

> Con la opción "Restaurar el historial" activada en Configuración → Editor → Terminal, se recupera el **scrollback** (el texto completo que estaba en pantalla) de la última sesión. La implementación usa `@xterm/addon-serialize` para guardar y restaurar ese contenido del buffer de la terminal.
> 
> La restauración incluye: cantidad de terminales, su posición en los panes, shell configurada, directorio de trabajo inicial, y opcionalmente el texto de la sesión anterior.
> 
> Sin embargo, la documentación del vault no especifica un límite concreto (número de líneas o caracteres) que se persista del scrollback. Lo único documentado es que se guarda "el texto de la última sesión" sin detallar un techo máximo de datos.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D01

**Pregunta.** Arreglamos que un enlace a una página web se llevara la ventana de Mycelium, pero después al hacerle clic no pasaba nada. ¿Qué faltaba para que abriera el navegador?

**Clave.**

```
Tipo: dato
Dato correcto: Faltaba el permiso opener:allow-default-urls: opener:allow-open-url solo habilita el comando con el alcance vacío; los esquemas (http, https, mailto) los trae allow-default-urls. Hacen falta los dos.
Cadenas que cuentan como acierto (basta una): «allow-default-urls»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-36

*Declaró que el vault no contiene el dato:* **no**

> Faltaba el permiso `opener:allow-default-urls` en `capabilities/default.json`.
> 
> Después de arreglado el problema de que un enlace se llevaba la ventana de Mycelium, el clic no abría el navegador porque se había agregado solo `opener:allow-open-url` (que habilita el comando con alcance vacío). Lo que se necesitaba además era `opener:allow-default-urls`, que es quien trae la lista de esquemas permitidos: `mailto:`, `tel:`, `http://` y `https://`.
> 
> Ambos permisos actúan juntos: uno abre la puerta al comando, el otro define a dónde puede ir. Sin el segundo, la seguridad funciona: el clic simplemente no hace nada.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-47

*Declaró que el vault no contiene el dato:* **no**

> La trampa estaba en los permisos. Cuando se arregló el defecto de que los enlaces web se llevaran la ventana de Mycelium, quedó otro problema: al hacer clic en un enlace, no pasaba nada.
> 
> La razón: `opener:allow-open-url` habilita el comando pero con el alcance vacío. Con solo ese permiso, cada llamada se rechaza y el clic no hace nada.
> 
> Lo que faltaba era agregar también `opener:allow-default-urls`, que es un permiso aparte que trae los esquemas permitidos (`mailto:`, `tel:`, `http://`, `https://`). Hacen falta los dos:
> 
> - `opener:allow-open-url` — habilita el comando
> - `opener:allow-default-urls` — autoriza a dónde ir
> 
> El defecto grave (la navegación que se llevaba la ventana) ya estaba corregido por la lógica que intercepta clics en cinco vistas distintas. Pero sin el segundo permiso, el navegador nunca se abría.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-59

*Declaró que el vault no contiene el dato:* **no**

> Faltaban los **dos permisos** de Tauri en `capabilities/default.json`.
> 
> El arreglo tapó correctamente la navegación en la vista de lectura y le agregó soporte en la vista en vivo, pero el navegador seguía sin abrirse porque solo se había configurado `opener:allow-open-url` (que habilita el comando con alcance vacío). Los **esquemas** (`http://`, `https://`, `mailto:`) los trae un **permiso separado: `opener:allow-default-urls`**.
> 
> Según la especificación, hacen falta **los dos**:
> - `opener:allow-open-url` — habilita el comando `open_url`
> - `opener:allow-default-urls` — autoriza los esquemas específicos
> 
> Sin el segundo, cada llamada se rechazaba silenciosamente y el clic no hacía nada. Un permiso que se llama «allow» sin cubrir ni siquiera su uso más obvio es el tipo de trampa silenciosa que se busca durante horas en el lugar equivocado — lo cual es justo lo que pasó el 2026-09-23.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D08

**Pregunta.** Cuando renombro una nota escribiendo en su título y pongo un símbolo que no vale en un nombre de archivo, ¿qué hace Mycelium? ¿Y qué rompía antes eso en los enlaces de las otras notas?

**Clave.**

```
Tipo: dato
Dato correcto: Hoy lo rechaza y dice cuáles caracteres no valen (no los corrige en silencio, a diferencia de importar o crear desde plantilla). Antes, el renombrado sustituía esos caracteres por '-' en el archivo pero reescribía los [[enlaces]] entrantes con el nombre pedido, que nunca existió en disco, y quedaban rotos (DEF-084).
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «rechaz»
  2. «def-084» o «nunca existio» o «nombre pedido» o «nombre que se pidio» o «nombre que pidio» o «nombre que el usuario pidio» o «nombre solicitado»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-42

*Declaró que el vault no contiene el dato:* **no**

> Hoy Mycelium **rechaza** el nombre cuando escribís caracteres inválidos en el título: te dice cuáles son (`? : * | " < > \ /`) y no permite completar el renombrado. El cambio se descarta al presionar Esc o salir del campo sin confirmar con Enter.
> 
> Esto es una decisión explícita de producto. En las otras operaciones (importar, crear desde plantilla) Mycelium **corrige en silencio** los caracteres inválidos sustituyéndolos por `-`, porque ahí el nombre ya viene dado de afuera. Pero al renombrar desde el título hay alguien mirando que acaba de escribirlo: cambiarle las letras sin avisar lo dejaría con un archivo que no se llama como pidió, sin forma de saber por qué.
> 
> **¿Qué se rompía antes?** El defecto DEF-084 describe exactamente eso: entre la versión que reescribía enlaces automáticamente (FUN-M-08, 2026-09-03) y la que permitía editar el título (FUN-M-24, 2026-09-05), pasaba algo peor que nada:
> - El archivo se guardaba con el nombre **corregido** (caracteres sustituidos por `-`)
> - Pero los `[[enlaces]]` que apuntaban a esa nota se reescribían apuntando al nombre **incorrecto** que escribiste
> - Quedaban apuntando a una nota que **nunca existió en disco**
> 
> El usuario lo descubrió el 2026-09-05: `git status` mostró 17 archivos modificados con 21 enlaces a `[[bugs-progreso]]` convertidos en `[[bugs-progreso///]]` después de probar a renombrar con `/` (un carácter inválido).
> 
> Antes de FUN-M-08, renombrar dejaba los enlaces al **nombre viejo**: rotos, pero recuperables, porque ese nombre era un dato real y se podía buscar. Con el cambio a reescritura automática, eso fue mejor, pero sin la validación actual en el título habría sido mucho peor.
> 
> Por eso la spec de titulo-renombra es explícita en § 3: "Un nombre inválido se **rechaza**, no se corrige" — es la única forma de que no haya sorpresas.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-43

*Declaró que el vault no contiene el dato:* **no**

> Cuando renombras una nota escribiendo en su título con símbolos inválidos, **Mycelium rechaza el cambio** y muestra un mensaje de error indicando cuáles son los caracteres problemáticos.
> 
> Esto es deliberado: [[titulo-renombra]] explica que renombrar desde el título tiene una política diferente a la de importar archivos. En importación se "sanea" el nombre cambiando caracteres inválidos por guiones (`? : * | " < > \ /` → `-`), porque el archivo tiene que aterrizar en algún lado. Pero en renombrado interactivo hay alguien mirando, así que rechazar y decir por qué es mejor que cambiarle las letras en silencio.
> 
> **Lo que rompía antes** (DEF-084): Antes de que se implementara bien el renombrado desde el título, cuando Mycelium **sí** permitía caracteres inválidos, ocurría algo peor que simplemente rechazar. El archivo terminaba siendo saneado en disco (ej. `bugs-progreso///` → `bugs-progreso---`), pero los `[[enlaces]]` entrantes quedaban apuntando al nombre que el usuario **había pedido** (`bugs-progreso///`), no al que el archivo obtuvo. Eso creaba enlaces que apuntaban a un nombre que **nunca existió en disco** — peor que rotos recuperables, eran fantasmas irrecuperables.
> 
> Este defecto se detectó porque `git status` mostró 17 archivos modificados sin que nadie los hubiera tocado: 21 enlaces reescritos con nombres inexistentes. Desde entonces, [[bugs-progreso]] DEF-084 documenta que `renombrarNota` devuelve el título **efectivo** (el que el archivo obtuvo realmente), no el que se pidió.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-55

*Declaró que el vault no contiene el dato:* **no**

> **Hoy** (tras la corrección del 2026-09-05): Mycelium **rechaza** el nombre y muestra un error diciendo cuáles caracteres no son válidos (`? : * | " < > \ /`), sin tocar el archivo. No pasa nada — tu intención se rechaza.
> 
> **Antes de eso** (el defecto [[DEF-084]]): Mycelium hacía algo peor: el archivo se guardaba con el nombre **corregido** (los caracteres inválidos se sustituían por `-`), pero **todos los `[[enlaces]]` que apuntaban a esa nota se reescribían con el nombre que TÚ habías pedido**, no con el que el archivo obtuvo en realidad. 
> 
> Por ejemplo, si renombrabas algo a `bugs-progreso///`, el archivo quedaba como `bugs-progreso---` en disco, pero los 21 enlaces entrantes que apuntaban a esa nota quedaban escritos como `[[bugs-progreso///]]` — apuntando a una nota que **nunca existió**. Peor aún: el nombre viejo estaba perdido, así que era irrecuperable sin mirar el historial de git.
> 
> Lo que cambió fue que `renombrarNota` ahora devuelve el título **efectivo** (el que sanea la función `sanearNombre`), no el pedido, así que los enlaces se actualizan con el nombre correcto. Y el editor (el widget del título) valida **antes** de llamar, por eso te rechaza en vivo — el explorador no validaba entonces sí pasaba ahí.
> 
> Esa corrección en 2026-09-03 (`FUN-M-08` — reescribir enlaces al renombrar) fue un bloqueo previo para poder implementar el renombrado desde el título (`FUN-M-24`) sin volver el accidente cotidiano.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D11

**Pregunta.** ¿Qué defectos hay registrados sobre las consolas de Mycelium? Quiero la lista completa, con su número.

**Clave.**

```
Tipo: dato
Dato correcto: Seis: DEF-072 (la numeración no se reutiliza), DEF-079 (Ctrl+C/Ctrl+V y el pegado doble), DEF-083 (texto corrupto), DEF-098 (los emojis desfasan la línea), DEF-099 (las consolas no pertenecen al vault) y DEF-100 (varias ventanas comparten la lista).
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «def-072»
  2. «def-079»
  3. «def-083»
  4. «def-098»
  5. «def-099»
  6. «def-100»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-44

*Declaró que el vault no contiene el dato:* **no**

> Los defectos registrados sobre las consolas de Mycelium son seis:
> 
> **Consolas — Numeración y sesiones:**
> - DEF-072: La numeración de las consolas nunca se reutiliza — si se abren tres y se cierra una, la siguiente es la 4 y no la 3.
> - DEF-099: Las consolas no pertenecen al vault. Al abrir otro vault, la lista de consolas es la del anterior, conservando su nombre y contenido.
> - DEF-100: Con varias ventanas de Mycelium abiertas, las consolas se comparten entre vaults en el mismo panel.
> 
> **Terminal integrada — Entrada/salida y rendering:**
> - DEF-079: No se puede copiar ni pegar con Ctrl+C/Ctrl+V en ciertos CLIs (como el de Claude Code). Pegar con botón derecho pega el texto dos veces.
> - DEF-083: El texto se dibuja corrupto en la terminal integrada — aparecen letras en lugares aleatorios y se repite texto.
> - DEF-098: Cuando la salida contiene emojis o símbolos especiales, el texto siguiente en la misma línea queda desfasado o se superpone.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-50

*Declaró que el vault no contiene el dato:* **no**

> Hay **6 defectos registrados** sobre las consolas de Mycelium:
> 
> **Numeración y pertenencia al vault:**
> - **DEF-072**: La numeración nunca se reutiliza, y pueden llegar a repetirse números
> - **DEF-099**: Las consolas no pertenecen al vault — persisten al cambiar de vault con su directorio anterior
> - **DEF-100**: Con varias ventanas abiertas, las consolas se comparten entre vaults
> 
> **Rendering e interacción en la terminal integrada:**
> - **DEF-079**: No se puede copiar/pegar con `Ctrl+C`/`Ctrl+V`; pegar con botón derecho duplica el texto
> - **DEF-083**: El texto se dibuja corrupto con caracteres aleatorios y superpuestos
> - **DEF-098**: Los emojis y símbolos especiales causan que el texto siguente quede desfasado

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-52

*Declaró que el vault no contiene el dato:* **no**

> Los defectos registrados sobre las consolas de Mycelium son seis:
> 
> **DEF-072**: La numeración de las consolas no se reutiliza y puede repetirse. Estado: ✅ Confirmado (desktop, 2026-09-04).
> 
> **DEF-079**: En la terminal integrada, `Ctrl+C`/`Ctrl+V` no copian ni pegan; el botón derecho pega dos veces. Estado: 🛠️ Implementado, sin confirmar.
> 
> **DEF-083**: En la terminal integrada, el texto se dibuja corrupto con símbolos repetidos y texto desfasado. Estado: 🛠️ Implementado, sin confirmar.
> 
> **DEF-098**: En la terminal integrada, los emojis (✅ ❌ ☑️ 🟡 🟨 ⚠️ 🟦…) desfasan el resto de la línea. Estado: ✅ Confirmado (desktop, 2026-09-21).
> 
> **DEF-099**: Las consolas no pertenecen al vault: al abrir otro vault siguen las del anterior apuntando a su carpeta. Estado: ✅ Confirmado (desktop, 2026-09-22).
> 
> **DEF-100**: Con varias ventanas de Mycelium abiertas, las consolas se comparten entre ellas. Estado: ✅ Confirmado (desktop, 2026-09-22).
> 
> Todos son específicos de desktop (`desktop-tauri`), ya que la terminal integrada es solo-desktop.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

---

## D02

**Pregunta.** Pedí que, además del tema y del modo, se pudiera elegir entre Papel, Bosque, Niebla y el estilo que ya teníamos. ¿Qué nombre quedó para ese ajuste nuevo y cómo se llama ahora el estilo que ya teníamos?

**Clave.**

```
Tipo: dato
Dato correcto: El eje nuevo se llama Atmósfera, y el estilo de siempre pasó a llamarse Abisal.
Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):
  1. «atmosfera»
  2. «abisal»
Distractores (afirmarlos como respuesta es error): ninguno
```

### J-53

*Declaró que el vault no contiene el dato:* **no**

> El ajuste nuevo se llama **Atmósfera**. El estilo que ya teníamos ahora se llama **Abisal**. 
> 
> Las cuatro atmósferas disponibles son:
> - **Abisal**: lo que había antes (marco casi negro, títulos en color alternado)
> - **Niebla**: sobria, grises fríos con matiz del tema
> - **Bosque**: color del tema en el marco, con cuerpo
> - **Papel**: editorial y cálida, papel y carbón tibio
> 
> Se eligen en Configuración → Apariencia, una para modo oscuro y otra para modo claro, mediante muestras en miniatura.

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 

### J-58

*Declaró que el vault no contiene el dato:* **no**

> El ajuste nuevo se llama **Atmósfera** (el eje que permite elegir cómo se reparten los colores en la pantalla: fondos, marco, títulos y bordes). El estilo que ya existía ahora se llama **Abisal** — así lo llamaba el código desde el prototipo legacy, y es la atmósfera que mantiene el comportamiento original: marco casi negro, títulos en color alternado, brillo del tema en todo lo activo.
> 
> Las cuatro atmósferas disponibles son: **Abisal** (la original), **Niebla** (sobria, grises fríos), **Bosque** (color del tema en el marco) y **Papel** (editorial y cálida). Cada modo (claro/oscuro) tiene su atmósfera elegida por separado, y se configura en Configuración → Apariencia bajo «Atmósfera en modo oscuro» y «Atmósfera en modo claro».

- [ ] correcto
- [ ] incorrecto
- [ ] duda

Comentario: 
