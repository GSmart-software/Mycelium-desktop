# Política de seguridad

Gracias por ayudar a que Mycelium sea más seguro. Esta política dice qué versiones
reciben correcciones, cómo reportar una vulnerabilidad y qué podés esperar de
nosotros después.

Más información sobre cómo protegemos la app, tus datos y la cadena de suministro:
**<https://mycelium-landing.gabiperero.workers.dev/seguridad>**.

## Versiones soportadas

Solo la **última versión publicada** de Mycelium para escritorio recibe
correcciones de seguridad.

La app se actualiza sola: busca versiones nuevas, descarga el paquete y antes de
instalarlo verifica su firma (minisign) con la clave pública que viene dentro de
la app. Un paquete sin firma válida no se instala. Si desactivaste las
actualizaciones automáticas, instalá la última versión desde la página de
descargas antes de reportar un problema.

| Versión | Soportada |
|---|---|
| La última publicada | Sí |
| Cualquier versión anterior | No |

## Cómo reportar una vulnerabilidad

**No abras un issue público, ni un pull request, ni una discusión.** Reportala de
forma privada con el formulario de avisos de seguridad de GitHub:

**<https://github.com/GSmart-software/Mycelium-desktop/security/advisories/new>**

Es el único canal de reporte. Solo lo ven los mantenedores y vos, y ahí mismo
coordinamos el arreglo y el aviso.

### Qué incluir

- Qué componente afecta (la app, el actualizador, un instalador, la landing) y en
  qué versión y sistema operativo lo comprobaste.
- El tipo de problema y su impacto: qué puede lograr un atacante y en qué
  condiciones (¿necesita que la víctima abra un vault, una nota, un archivo?).
- Los pasos para reproducirlo, idealmente con una prueba de concepto mínima (un
  vault, una nota o un archivo de ejemplo).
- Si lo sabés, la causa y una propuesta de corrección.
- Si querés que te nombremos en el aviso, y cómo.

## Qué podés esperar

| Etapa | Plazo |
|---|---|
| Acuse de recibo | 5 días hábiles |
| Diagnóstico inicial (confirmación, severidad y plan) | 10 días hábiles |
| Corrección de una vulnerabilidad **crítica** | objetivo: 30 días |
| Corrección de una vulnerabilidad **alta** | objetivo: 60 días |
| Corrección de severidad media o baja | con el próximo release |

La severidad la estimamos con CVSS y la acordamos con vos en el aviso. Te vamos a
mantener al tanto del avance, y si un plazo no se puede cumplir te lo decimos
antes de que venza, con el motivo.

## Divulgación coordinada

Te pedimos que no publiques los detalles hasta que haya un arreglo disponible o
hasta que pasen **90 días** desde tu reporte, lo que ocurra primero. Si la
corrección sale antes, publicamos el aviso de seguridad (GitHub Security
Advisory, con CVE cuando corresponda) junto con la versión que la resuelve, y
desde ahí podés publicar el tuyo. Si necesitamos más tiempo por una causa
justificada, lo hablamos con vos antes de que se cumpla el plazo.

## Reconocimiento

Con tu permiso, te nombramos en el aviso de seguridad publicado como quien
descubrió y reportó la vulnerabilidad. No ofrecemos recompensas económicas.

## Puerto seguro

Si investigás de buena fe y respetando esta política, consideramos tu
investigación autorizada: no vamos a iniciar ni apoyar acciones legales contra
vos por ella, y si un tercero lo hiciera, vamos a dejar claro que actuaste de
acuerdo con esta política. Investigar de buena fe significa:

- Probar solo contra tus propias copias de la app y tus propios vaults, o contra
  cuentas y datos que te pertenecen.
- No acceder, modificar ni borrar datos de otras personas, y detenerte y
  avisarnos en cuanto te encuentres con datos que no son tuyos.
- No degradar el servicio para otros (sin denegación de servicio, sin pruebas
  automatizadas de volumen contra la landing ni contra el servidor de
  actualizaciones).
- No usar ingeniería social, phishing ni ataques físicos.
- Darnos un tiempo razonable para corregir antes de divulgar, como dice arriba.

## Alcance

**Dentro del alcance:**

- La aplicación de escritorio Mycelium (este repositorio): la interfaz, el
  backend de Tauri, el servidor MCP que viene con la app, el tratamiento de los
  archivos del vault y todo lo que se muestra dentro de la app.
- El actualizador: la consulta de versiones, la descarga y la verificación de
  firmas de los paquetes.
- Los instaladores de Windows, macOS y Linux que publicamos, y los archivos de la
  versión (manifiesto del actualizador y paquetes).
- La landing de Mycelium (<https://mycelium-landing.gabiperero.workers.dev>).

**Fuera del alcance:**

- Vulnerabilidades en dependencias de terceros que ya tengan un aviso público y
  no sean explotables a través de Mycelium (reportalas al proyecto que
  corresponda; si sí son explotables a través de Mycelium, están dentro).
- Ataques que requieren acceso previo a la computadora de la víctima con sus
  permisos (quien ya puede escribir en su disco o leer su perfil no necesita una
  vulnerabilidad de Mycelium).
- Contenido que el propio usuario escribe o pega en su vault y que solo lo afecta
  a él, cuando no cruza a la ejecución de código ni a otros datos.
- Versiones que no son la última publicada, y compilaciones modificadas por
  terceros.
- Informes de escáneres automáticos sin una prueba de impacto real, ausencia de
  cabeceras de seguridad sin un ataque concreto, y problemas de configuración de
  TLS o DNS de servicios de terceros.
- Los servicios de terceros que la app integra (por ejemplo, los reproductores
  de YouTube y Vimeo): reportalos a quien los mantiene.
