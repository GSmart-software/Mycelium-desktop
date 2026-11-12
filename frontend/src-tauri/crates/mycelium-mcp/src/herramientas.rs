//! Las herramientas del MCP de control (`mcp-control` § 1 y § 3).
//!
//! Parte 1: `mycelium_estado` y `mycelium_abrir`. Parte 2: las cinco del
//! calendario (`mycelium_recordatorios` y `mycelium_recordatorio_*`), que acá
//! solo comprueban que los argumentos sean un objeto: fechas, horas, colores y
//! repeticiones los valida la app con las reglas del calendario
//! (`lib/mcpCalendarioLogica.ts`), para no tenerlas dos veces y para que lo que
//! falla quede en su registro de actividad. Parte 3: las de archivos
//! (`mycelium_renombrar`, `_mover`, `_borrar`, `_papelera`), igual de finas,
//! más la **espera de una confirmación** del usuario ([`pedir_con_permiso`]).
//! Parte 4: `mycelium_diccionario`, el diccionario del vault del corrector,
//! igual de fina: qué es una palabra y el tope por llamada los decide la app
//! con la regla del corrector (`lib/mcpDiccionarioLogica.ts`).
//! `FUN-M-45`: las consultas al índice (`mycelium_buscar`, `mycelium_enlaces`,
//! `mycelium_base`), de solo lectura: la búsqueda, los enlaces y las bases los
//! resuelve la app con lo que ya usa (`lib/mcpIndice.ts`), porque el índice
//! vive en su ventana; acá solo se redacta.
//! `FUN-L-31`: la coordinación entre sesiones (`mycelium_sesion`,
//! `mycelium_reservar`, y lo que suma `mycelium_estado`): las sesiones y las
//! reservas viven en la app (`lib/sesionesIa.ts`), que también redacta.
//! `FUN-L-30`: la salud del vault (`mycelium_salud`, `mycelium_validar_nota`),
//! también de solo lectura: el mismo informe que el panel de salud de la app
//! (`lib/saludVault.ts`).
//! `FUN-M-44`: `mycelium_diagnosticos`, lo que el editor de la app tiene marcado
//! en las notas abiertas (o en una), sin recalcular lo ya calculado.
//! `FUN-M-59`: `mycelium_abrir` elige el panel (`panel`) y `mycelium_dividir`
//! divide la pantalla, con las mismas acciones que la división del usuario.
//! Cada herramienta nueva se
//! declara en [`definiciones`] y se atiende en [`llamar`]; la lógica de cada
//! operación vive en la app (`lib/mcpControl.ts`), donde ya existe, y acá solo
//! se valida lo evidente, se habla por el canal y se **redacta la respuesta**:
//! texto corto que dice el efecto, no el eco (spec § 3).
//!
//! Las búsquedas de la fase de memoria (`vault_buscar`, `vault_leer`), con un
//! índice PROPIO del servidor, se evaluaron y no entraron (`docs/arquitectura/
//! MCP de Mycelium - tesina, protocolo.md` § 9). `mycelium_buscar` no es
//! aquello: no indexa nada, le pregunta a la app por SU búsqueda.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use mycelium_vault::canal::{self as protocolo_canal, codigo, ESPERA_CONFIRMACION, INTERVALO_CONFIRMACION};
use mycelium_vault::preferencias::control_encendido;
use serde_json::{json, Value};

use crate::canal::{self, Fallo, ESPERA_CLIENTE};
use crate::protocolo::texto;
use crate::servidor::Estado;
use crate::vault::VaultResuelto;

/// Los nombres de las herramientas que este servidor atiende.
const NOMBRES: [&str; 21] = [
    "mycelium_estado",
    "mycelium_abrir",
    "mycelium_dividir",
    "mycelium_recordatorios",
    "mycelium_recordatorio_crear",
    "mycelium_recordatorio_editar",
    "mycelium_recordatorio_completar",
    "mycelium_recordatorio_borrar",
    "mycelium_renombrar",
    "mycelium_mover",
    "mycelium_borrar",
    "mycelium_papelera",
    "mycelium_diccionario",
    "mycelium_buscar",
    "mycelium_enlaces",
    "mycelium_base",
    "mycelium_salud",
    "mycelium_validar_nota",
    "mycelium_sesion",
    "mycelium_reservar",
    "mycelium_diagnosticos",
];

/// Los nombres de los colores de la paleta del calendario, para las
/// descripciones (la validación es de la app: `lib/recordatorios.ts`).
const PALETA: &str = "Hifa, Musgo, Liquen, Yesca, Amanita, Coral, Espora, Bruma";

/// Dónde enciende el usuario el control: se repite en varios mensajes.
const DONDE_SE_ENCIENDE: &str = "Configuración → Vault → «Asistente IA (Claude Code)» → «Dejar que la IA controle Mycelium»";

/// Lo que se responde a `tools/list`.
pub fn definiciones() -> Vec<Value> {
    vec![
        json!({
            "name": "mycelium_estado",
            "title": "Qué tiene abierto Mycelium",
            "description": "Si Mycelium está abierto con este vault, si el control está encendido y qué está \
                mirando el usuario: las pestañas de cada panel, cuál está activa y cuáles tienen cambios sin \
                guardar. Funciona también con la app cerrada (lo dice). No devuelve el contenido de las notas: \
                para eso lee los archivos. Míralo antes de escribir un archivo que el usuario podría estar \
                editando: si su pestaña tiene cambios sin guardar, avísale, porque lo que guarde después pisa lo tuyo.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_abrir",
            "title": "Mostrar algo en Mycelium",
            "description": "Abre en Mycelium una nota o archivo del vault, el grafo o el calendario, en una \
                pestaña. Por defecto NO le roba el foco al usuario (la pestaña queda en segundo plano); pide \
                `foco: true` solo si tienes algo que mostrarle ahora. Por defecto abre en el panel con el foco; \
                con `panel` (el número que informan mycelium_estado y esta misma respuesta), en ese: si el \
                objetivo ya está abierto en otro panel, queda también en el pedido, como cuando lo hace el \
                usuario. Un panel que no existe es PANEL_INEXISTENTE (no se crea: para eso, mycelium_dividir). \
                En una nota puede saltar a un encabezado, una línea o un texto. Devuelve en qué panel quedó y \
                qué pestañas hay. No crea nada: si el objetivo no existe, contesta NO_ENCONTRADO con las \
                candidatas más parecidas.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": {
                        "type": "string",
                        "description": "Ruta relativa al vault (`docs/Plan.md`), título de una nota (`Plan`, o \
                            `Carpeta/Plan` para desambiguar), `grafo` o `calendario`."
                    },
                    "ir_a": {
                        "type": "object",
                        "description": "Solo para notas markdown: a dónde saltar. Uno solo de los tres.",
                        "properties": {
                            "encabezado": { "type": "string", "description": "Texto del encabezado, sin los `#`." },
                            "linea": { "type": "integer", "minimum": 1, "description": "Número de línea (desde 1)." },
                            "texto": { "type": "string", "description": "Primer lugar donde aparece este texto." }
                        },
                        "additionalProperties": false
                    },
                    "revelar": { "type": "boolean", "description": "Mostrarla también en el explorador (abre su carpeta). Por defecto false." },
                    "foco": { "type": "boolean", "description": "Activar la pestaña y llevar al usuario a ella. Por defecto false." },
                    "panel": { "type": "integer", "minimum": 1, "description": "En qué panel abrirla: su número, desde 1, como lo informa mycelium_estado. Por defecto, el del foco." }
                },
                "required": ["objetivo"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        definicion_dividir(),
        json!({
            "name": "mycelium_recordatorios",
            "title": "Leer el calendario",
            "description": "Las ocurrencias del calendario de recordatorios entre dos fechas (inclusive, tope 366 días), \
                calculadas por la misma lógica que usa Mycelium: repeticiones expandidas, orden de la app (por día, los \
                de todo el día primero), color, si cada ocurrencia está completada, el id y el primer renglón del \
                detalle. Es la forma preferida de leer el calendario. Fechas locales AAAA-MM-DD.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "desde": { "type": "string", "description": "Primer día, AAAA-MM-DD." },
                    "hasta": { "type": "string", "description": "Último día, AAAA-MM-DD (incluido)." }
                },
                "required": ["desde", "hasta"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_recordatorio_crear",
            "title": "Crear un recordatorio",
            "description": format!("Crea un recordatorio en el calendario de Mycelium, como si el usuario lo hubiera \
                creado en el formulario: aparece al instante y avisa a su hora (con Mycelium abierto). Devuelve el id, \
                la próxima ocurrencia y si va a avisar. El usuario lo puede deshacer desde el registro de actividad. \
                Colores: {PALETA}."),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "titulo": { "type": "string", "description": "Una línea, no vacía." },
                    "fecha": { "type": "string", "description": "AAAA-MM-DD local: el día, o el de la primera vez si se repite." },
                    "hora": { "type": ["string", "null"], "description": "HH:MM de 24 h. Omitida o null: todo el día." },
                    "repeticion": {
                        "type": "string",
                        "enum": ["ninguna", "dia", "semana", "mes", "anio"],
                        "description": "Por defecto ninguna. Cada mes el 31 no cae en los meses sin 31; cada año el 29/02 solo en bisiestos."
                    },
                    "color": { "type": "string", "description": format!("Nombre de la paleta (sin distinguir mayúsculas ni tildes): {PALETA}. Por defecto Hifa.") },
                    "detalle": { "type": "string", "description": "Markdown; puede tener [[enlaces]] a notas del vault." }
                },
                "required": ["titulo", "fecha"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_recordatorio_editar",
            "title": "Editar un recordatorio",
            "description": "Cambia los campos que mandes de un recordatorio existente (el resto queda igual). Si cambia \
                cuándo ocurre, no avisa por lo que ya pasó. Devuelve qué cambió y la próxima ocurrencia. Se puede \
                deshacer desde el registro de actividad.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "El id (lo da mycelium_recordatorios o la creación)." },
                    "titulo": { "type": "string" },
                    "fecha": { "type": "string", "description": "AAAA-MM-DD." },
                    "hora": { "type": ["string", "null"], "description": "HH:MM; null pasa a todo el día." },
                    "repeticion": { "type": "string", "enum": ["ninguna", "dia", "semana", "mes", "anio"] },
                    "color": { "type": "string", "description": PALETA },
                    "detalle": { "type": "string" }
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_recordatorio_completar",
            "title": "Completar una ocurrencia",
            "description": "Marca (o desmarca, con completado: false) como completada la ocurrencia de un recordatorio \
                en una fecha. Es por ocurrencia: en uno que se repite, completar el lunes no completa el martes. Una \
                ocurrencia completada no avisa.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "fecha": { "type": "string", "description": "AAAA-MM-DD: un día en que el recordatorio ocurre." },
                    "completado": { "type": "boolean", "description": "Por defecto true." }
                },
                "required": ["id", "fecha"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_recordatorio_borrar",
            "title": "Borrar un recordatorio",
            "description": "Borra un recordatorio; si se repite, la serie entera. No pregunta: el usuario lo puede \
                restaurar con el mismo id desde el registro de actividad de Mycelium (Deshacer).",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_renombrar",
            "title": "Renombrar una nota o carpeta",
            "description": r#"Renombra una nota o una carpeta del vault REPARANDO LOS ENLACES que llegaban a ella, con el mismo código que usa Mycelium cuando el usuario renombra desde el explorador o el título. Úsala en vez de `mv`. Devuelve la ruta nueva y en qué notas se reescribieron enlaces (y si alguna quedó sin reparar). Si reescribiría enlaces en más de 5 notas, Mycelium le pregunta al usuario y esta llamada espera su respuesta (hasta 2 minutos): si dice que no, RECHAZADO, que es una respuesta, no un error para reintentar: no lo pidas de nuevo en partes más chicas ni lo hagas con `mv`. El nombre no puede llevar ? : * | " < > \ /. La Bandeja del vault (`Bandeja.md` o la ruta configurada) no se renombra: INVALIDO. Se deshace desde el registro de actividad de Mycelium."#,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": {
                        "type": "string",
                        "description": "La nota (ruta `docs/Plan.md` o título `Plan`) o la carpeta (`Área/Proyectos`, o con `/` al final para que sea la carpeta)."
                    },
                    "nombre": { "type": "string", "description": "El nombre nuevo, sin carpeta (la extensión de una nota se puede omitir)." },
                    "conservarAlias": {
                        "type": "boolean",
                        "description": "Solo notas .md: agrega el nombre anterior a la propiedad `aliases` de la nota, para que los [[enlaces]] que no se reescriben (texto citado, otros vaults, los que se escriban después) sigan llegando. Los enlaces se reparan igual. Por defecto, false."
                    }
                },
                "required": ["objetivo", "nombre"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_mover",
            "title": "Mover una nota o carpeta",
            "description": "Mueve una nota o una carpeta a otra carpeta que ya exista (no crea carpetas), REPARANDO LOS \
                ENLACES que la nombraban con su carpeta (`[[Carpeta/Nota]]`; los enlaces por título siguen andando solos). \
                Úsala en vez de `mv`. Pregunta al usuario igual que mycelium_renombrar si reescribe enlaces en más de 5 \
                notas. La Bandeja del vault no se mueve (INVALIDO); su carpeta sí, y la Bandeja la sigue. Se deshace \
                desde el registro de actividad.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": { "type": "string", "description": "La nota o la carpeta, como en mycelium_renombrar." },
                    "carpeta": { "type": "string", "description": "Ruta de la carpeta de destino (`Archivo/2026`); vacía es la raíz del vault." }
                },
                "required": ["objetivo", "carpeta"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_borrar",
            "title": "Mandar a la papelera",
            "description": "Manda una nota o una carpeta (con todo lo que tiene) a la PAPELERA DE MYCELIUM: nunca borra \
                para siempre. Úsala en vez de `rm`. Una nota no pregunta (el usuario ve un aviso con Deshacer); una \
                carpeta SIEMPRE le pregunta al usuario y esta llamada espera su respuesta. Devuelve con qué id se \
                restaura (mycelium_papelera) y qué pestañas se cerraron. Una nota con cambios sin guardar no se borra: \
                CAMBIOS_SIN_GUARDAR. La Bandeja del vault (`Bandeja.md` o la ruta configurada) no se borra, ni la \
                carpeta que la contiene: INVALIDO.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": { "type": "string", "description": "La nota o la carpeta, como en mycelium_renombrar." }
                },
                "required": ["objetivo"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_papelera",
            "title": "La papelera de Mycelium",
            "description": "Lista lo que hay en la papelera de Mycelium (`listar`: id, título, carpeta de origen, cuándo se \
                borró) o restaura una entrada en su lugar (`restaurar` con su `id`; la ruta de una carpeta borrada \
                restaura todas sus notas y recrea las carpetas). La papelera se vacía sola a los 30 días.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "accion": { "type": "string", "enum": ["listar", "restaurar"], "description": "Por defecto listar." },
                    "id": { "type": "string", "description": "Para restaurar: el id de la entrada (la ruta original de la nota) o la ruta de una carpeta borrada." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_diccionario",
            "title": "El diccionario del vault",
            "description": "Lista, agrega o quita palabras del DICCIONARIO DEL VAULT del corrector ortográfico de Mycelium \
                (el que viaja con el vault: .mycelium/diccionario.txt, que NO se escribe a mano). Para los términos propios \
                del vault que el corrector subraya: nombres de proyectos y personas, siglas, jerga; una errata no se agrega, \
                se corrige. El diccionario de Mycelium (el de todos los vaults) no se toca: es del usuario. El corrector abierto se \
                entera al instante: lo agregado deja de subrayarse sin recargar. Agregar y quitar aceptan una lista (tope 200 \
                por llamada) y devuelven el efecto: cuáles se agregaron o quitaron, cuáles ya estaban o no estaban, y las \
                rechazadas con el motivo (una entrada es UNA palabra, como la ve el corrector: sin espacios ni guiones, sin \
                dígitos). Se deshace desde el registro de actividad de Mycelium.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "accion": { "type": "string", "enum": ["listar", "agregar", "quitar"], "description": "Por defecto listar." },
                    "palabras": {
                        "type": "array",
                        "items": { "type": "string" },
                        "maxItems": 200,
                        "description": "Para agregar o quitar: las palabras, tal como se escriben (`Mycelium`; en minúscula también vale Capitalizada y EN MAYÚSCULAS)."
                    }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_buscar",
            "title": "Buscar en el vault",
            "description": "La búsqueda de Mycelium, la misma del panel de búsqueda, solo en las NOTAS INDEXADAS (lo que el \
                vault considera memoria: lo ignorado por .mycignore, los PDF, las imágenes o el código suelto no están). \
                Busca por nombre, por contenido o por los dos, sin distinguir tildes ni mayúsculas; acepta \"una frase\" \
                entre comillas, filtros de propiedad `clave:valor` (o `clave:\"valor completo\"`) y de etiqueta `tag:x` \
                (incluye las anidadas `x/…`), combinables entre sí y con texto. Devuelve ruta, título, tipo y un fragmento \
                con la coincidencia entre «», en el orden de la app (primero los títulos que empiezan con lo buscado). \
                Pagina con `limite` y `desde`. Es preferible a grep para saber qué dice la memoria: lo que no devuelve no \
                está en ella.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "consulta": { "type": "string", "description": "Lo que se busca: palabras, \"frase exacta\", clave:valor, tag:x. Al menos 2 caracteres, como en el panel." },
                    "campo": { "type": "string", "enum": ["ambos", "nombre", "contenido"], "description": "Dónde buscar. Por defecto ambos." },
                    "exacto": { "type": "boolean", "description": "Palabra completa en vez de prefijo (`plan` no trae `planta`). Por defecto false." },
                    "limite": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Resultados por página. Por defecto 20." },
                    "desde": { "type": "integer", "minimum": 0, "description": "Cuántos resultados saltar (para la página siguiente, el `desde` que indica la respuesta)." }
                },
                "required": ["consulta"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_enlaces",
            "title": "Enlaces de una nota",
            "description": "Los enlaces de una nota según el índice de Mycelium, con el mismo criterio que el grafo y el \
                panel de conexiones: los SALIENTES (cada [[enlace]] o ![[embed]] tal como está escrito, a qué nota \
                resuelve, si está roto y en qué líneas) y los BACKLINKS (qué notas la enlazan y en qué líneas). Un \
                [[enlace]] dentro de un bloque de código no cuenta; [[X|alias]] y [[X#Encabezado]] cuentan como enlaces a X; \
                un lienzo que la tiene como tarjeta la enlaza. Más fiable que grep para recorrer la memoria por asociación.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "nota": { "type": "string", "description": "Ruta (`docs/Plan.md`) o título (`Plan`, o `Carpeta/Plan` para desambiguar)." }
                },
                "required": ["nota"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_base",
            "title": "Leer una tabla .base",
            "description": "Evalúa una vista de una tabla `.base` con el MISMO motor que Mycelium (filtros, columnas, orden \
                y límite de la vista) y devuelve sus columnas y sus filas en texto plano, cada una con la ruta de su nota. \
                Sirve para leer lo que la tabla deriva en vez de mantener una copia a mano. Tope de 200 filas (lo dice si \
                recorta). Si la vista no existe, NO_ENCONTRADO con los nombres de las que hay; si un filtro está fuera de lo \
                que Mycelium entiende, INVALIDO con el motivo (skill mycelium-base).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ruta": { "type": "string", "description": "La base: ruta (`Tablas/Proyectos.base`) o título (`Proyectos`)." },
                    "vista": { "type": "string", "description": "Nombre de la vista. Por defecto, la primera." }
                },
                "required": ["ruta"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_salud",
            "title": "Salud del vault",
            "description": "Lo que degrada la memoria del vault, calculado con el criterio del índice de Mycelium (el mismo \
                del panel de salud de la app): ENLACES y EMBEDS ROTOS (nota y línea), TÍTULOS DUPLICADOS (con los enlaces \
                que quedan ambiguos entre ellos), notas HUÉRFANAS (ninguna nota las enlaza; un lienzo que las tiene como \
                tarjeta sí cuenta), notas SIN ENLACES SALIENTES y PROPIEDADES que no cumplen los esquemas de \
                `esquemas.yml` (o con un valor que empieza con # sin comillas, que YAML lee como comentario). Un [[enlace]] dentro de un bloque de código no cuenta, \
                y un enlace a un archivo que existe pero no es nota (imagen, PDF) no está roto. Las Esporas (plantillas) y \
                las instrucciones de agentes de la raíz (CLAUDE.md, AGENTS.md) no se juzgan. Alcance: el vault entero, \
                una carpeta o una nota. Hasta 100 ítems por clase, con los totales.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "alcance": {
                        "type": "string",
                        "description": "Vacío u omitido: el vault. Una carpeta (`Proyectos`, o `Proyectos/` para forzar carpeta) o una nota (ruta o título)."
                    }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_validar_nota",
            "title": "Validar una nota",
            "description": "Chequeo de cierre de una nota recién escrita o editada, con el criterio del índice: que su título \
                sea único (si no, sus homónimas), que todos sus enlaces y embeds resuelvan (los rotos y los ambiguos, con su \
                línea), que alguna nota la enlace (si no, está huérfana: hay que enlazarla desde su mapa o nota madre) y \
                que sus PROPIEDADES sean válidas (claves obligatorias, tipos y valores permitidos de los esquemas de \
                `esquemas.yml`, y ningún valor con # sin comillas). \
                Úsala antes de dar por terminado un cambio en la memoria. Mycelium indexa al guardar: si se acaba de \
                escribir el archivo, conviene esperar un instante antes de validarla.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ruta": { "type": "string", "description": "La nota: ruta (`docs/Plan.md`) o título (`Plan`)." }
                },
                "required": ["ruta"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_sesion",
            "title": "Declarar la tarea de esta sesión",
            "description": "Le dice a Mycelium en qué está trabajando esta sesión, en una línea («Reorganizar docs/arquitectura», \
                «Bug DEF-173»). Varias sesiones de IA pueden trabajar a la vez sobre el mismo vault: con la tarea declarada, \
                las demás la ven en su mycelium_estado y el usuario la ve en el panel «Actividad de la IA», que agrupa lo que \
                hizo cada sesión bajo su tarea. Declárala al empezar un trabajo que no sea una consulta suelta, y de nuevo si \
                cambias de tarea. Devuelve las otras sesiones conectadas y lo que tienen reservado.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tarea": { "type": "string", "description": "La tarea, en una línea (hasta 200 caracteres)." }
                },
                "required": ["tarea"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_reservar",
            "title": "Reservar una nota o carpeta",
            "description": "Avisa a las otras sesiones de IA que vas a trabajar sobre una nota o una carpeta del vault, con un \
                motivo y un vencimiento (30 minutos si no se indica otro; hasta 240). Es un AVISO, no un bloqueo: nada impide \
                escribir. Si otra sesión ya tenía reservado eso (o una carpeta que lo contiene, o algo dentro de la carpeta), \
                la reserva se concede de todos modos y la respuesta dice quién lo tiene y por qué: coordina con el usuario antes de \
                tocarlo. Reservar de nuevo lo mismo renueva el vencimiento. Con `liberar: true` se suelta (sin `objetivo`, \
                todas las de esta sesión). Las reservas mueren con la sesión y si se cierra Mycelium. Reserva antes de un \
                trabajo largo sobre algo que otra sesión podría tocar; libera al terminar.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": { "type": "string", "description": "Nota (ruta o título) o carpeta (ruta; con `/` al final para forzar carpeta). Una nota que todavía no existe, por su ruta (`docs/Nueva.md`)." },
                    "motivo": { "type": "string", "description": "Para qué, en una línea. Obligatorio al reservar." },
                    "minutos": { "type": "integer", "minimum": 1, "maximum": 240, "description": "Cuánto dura. Por defecto 30." },
                    "liberar": { "type": "boolean", "description": "true para soltar la reserva de `objetivo` (o todas, sin objetivo)." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
        definicion_diagnosticos(),
    ]
}

/// La definición de `mycelium_dividir` (`FUN-M-59`), aparte para no alargar la
/// lista de arriba.
fn definicion_dividir() -> Value {
    json!({
        "name": "mycelium_dividir",
        "title": "Dividir la pantalla",
        "description": "Divide un panel de Mycelium en dos, hacia la derecha o hacia abajo, como cuando lo hace el \
            usuario (menú de la barra de pestañas o paleta de comandos), y opcionalmente abre algo en el panel nuevo, \
            con las mismas reglas que mycelium_abrir (ruta, título, `grafo`, `calendario`, e `ir_a`). Sin `objetivo`, \
            el panel nuevo muestra lo mismo que el dividido (un lienzo, dibujo, diagrama, visor, consola o vista \
            global no se duplica: pasa al panel nuevo). Por defecto NO le roba el foco al usuario; `foco: true` lo \
            lleva al panel nuevo. Úsala cuando el usuario lo pida o cuando mostrar dos cosas lado a lado sea el \
            objetivo: la disposición de la pantalla es suya. Devuelve el número del panel nuevo y los paneles. No \
            toca archivos ni va al registro de actividad: se deshace cerrando el panel.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "direccion": { "type": "string", "enum": ["derecha", "abajo"], "description": "Dónde queda el panel nuevo respecto del dividido." },
                "panel": { "type": "integer", "minimum": 1, "description": "Qué panel dividir: su número, desde 1, como lo informa mycelium_estado. Por defecto, el del foco." },
                "objetivo": {
                    "type": "string",
                    "description": "Opcional: qué abrir en el panel nuevo. Ruta relativa al vault, título de una nota, `grafo` o `calendario`."
                },
                "ir_a": {
                    "type": "object",
                    "description": "Solo con un `objetivo` que sea nota markdown: a dónde saltar. Uno solo de los tres.",
                    "properties": {
                        "encabezado": { "type": "string" },
                        "linea": { "type": "integer", "minimum": 1 },
                        "texto": { "type": "string" }
                    },
                    "additionalProperties": false
                },
                "foco": { "type": "boolean", "description": "Llevar al usuario al panel nuevo. Por defecto false." }
            },
            "required": ["direccion"],
            "additionalProperties": false
        },
        "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
    })
}

/// La definición de `mycelium_diagnosticos` (`FUN-M-44`), aparte para no
/// alargar la lista de arriba.
fn definicion_diagnosticos() -> Value {
    json!({
        "name": "mycelium_diagnosticos",
        "title": "Avisos del editor",
        "description": "Lo que el editor de Mycelium tiene marcado en una nota, como un linter: ENLACES y EMBEDS ROTOS, \
            ENLACES AMBIGUOS (entre notas homónimas), TÍTULO DUPLICADO y PROPIEDADES que no cumplen los esquemas de \
            `esquemas.yml` (o con un # sin comillas), cada uno con línea y columna. Se calculan al abrir y al guardar la \
            nota en la app; esta herramienta devuelve lo ya calculado, sin recalcular. Sin `nota`: las notas abiertas en \
            algún editor. Con `nota`: esa nota (si no está abierta, se calcula en el momento sobre el índice). Úsala \
            después de editar una nota que el usuario tiene abierta, para ver lo mismo que él.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "nota": { "type": "string", "description": "Opcional: la nota, por ruta (`docs/Plan.md`) o título (`Plan`)." }
            },
            "additionalProperties": false
        },
        "annotations": { "readOnlyHint": true, "openWorldHint": false }
    })
}

/// Atiende un `tools/call`. `None` si la herramienta no existe (error de
/// JSON-RPC); los errores de una herramienta que sí existe van como texto
/// marcado `isError`, para que el agente los lea.
pub fn llamar(estado: &Estado, nombre: &str, args: &Value) -> Option<Value> {
    if !NOMBRES.contains(&nombre) {
        return None;
    }
    // Sin vault no hay ventana a la que hablarle: toda herramienta lo dice
    // igual, con los vaults registrados.
    let vault = match &estado.vault {
        Ok(v) => v,
        Err(msg) => return Some(texto(msg.clone(), true)),
    };
    Some(match nombre {
        "mycelium_estado" => herramienta_estado(estado, vault),
        "mycelium_abrir" => herramienta_abrir(estado, vault, args),
        "mycelium_dividir" => herramienta_dividir(estado, vault, args),
        "mycelium_recordatorios" => herramienta_calendario(estado, vault, "recordatorios", args, redactar_recordatorios),
        "mycelium_recordatorio_crear" => herramienta_calendario(estado, vault, "recordatorio_crear", args, redactar_escritura),
        "mycelium_recordatorio_editar" => herramienta_calendario(estado, vault, "recordatorio_editar", args, redactar_escritura),
        "mycelium_recordatorio_completar" => {
            herramienta_calendario(estado, vault, "recordatorio_completar", args, redactar_escritura)
        }
        "mycelium_recordatorio_borrar" => herramienta_calendario(estado, vault, "recordatorio_borrar", args, redactar_escritura),
        "mycelium_renombrar" => herramienta_archivos(estado, vault, "renombrar", args, redactar_archivo),
        "mycelium_mover" => herramienta_archivos(estado, vault, "mover", args, redactar_archivo),
        "mycelium_borrar" => herramienta_archivos(estado, vault, "borrar", args, redactar_archivo),
        "mycelium_papelera" => herramienta_archivos(estado, vault, "papelera", args, redactar_papelera),
        "mycelium_diccionario" => herramienta_diccionario(estado, vault, args),
        "mycelium_buscar" => herramienta_consulta(estado, vault, "buscar", args, redactar_buscar),
        "mycelium_enlaces" => herramienta_consulta(estado, vault, "enlaces", args, redactar_enlaces),
        "mycelium_base" => herramienta_consulta(estado, vault, "base", args, redactar_base),
        "mycelium_salud" => herramienta_consulta(estado, vault, "salud", args, redactar_salud),
        "mycelium_validar_nota" => herramienta_consulta(estado, vault, "validar_nota", args, redactar_validar_nota),
        "mycelium_sesion" => herramienta_coordinacion(estado, vault, "sesion", args),
        "mycelium_reservar" => herramienta_coordinacion(estado, vault, "reservar", args),
        "mycelium_diagnosticos" => herramienta_consulta(estado, vault, "diagnosticos", args, redactar_diagnosticos),
        _ => unreachable!("nombre validado arriba"),
    })
}

// ── Hablar con la app ──────────────────────────────────────────────────────

/// Por qué no se obtuvo un `resultado`: el texto ya redactado para el agente.
enum SinResultado {
    /// Nadie escucha en el canal (la app decide si es error según la herramienta).
    NadieEscucha,
    /// Cualquier otro error, ya redactado.
    Error(String),
}

fn pedir(estado: &Estado, vault: &VaultResuelto, op: &str, args: Value) -> Result<Value, SinResultado> {
    static ID: AtomicU64 = AtomicU64::new(1);
    let id = json!(ID.fetch_add(1, Ordering::Relaxed));
    let mut pedido = protocolo_canal::pedido(&id, op, args, &vault.registrado.ruta);
    // Quién pide (`FUN-L-31`): la app atribuye la operación a esta sesión.
    pedido["sesion"] = crate::sesion::datos();
    match canal::pedir(&estado.canal, &pedido, estado.espera.unwrap_or(ESPERA_CLIENTE)) {
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(true) => Ok(r.get("resultado").cloned().unwrap_or(Value::Null)),
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(false) => {
            Err(SinResultado::Error(redactar_error(r.get("error").unwrap_or(&Value::Null))))
        }
        Ok(r) => Err(SinResultado::Error(format!("La app respondió algo que no es del protocolo: {r}"))),
        Err(Fallo::NadieEscucha) => Err(SinResultado::NadieEscucha),
        Err(Fallo::SinRespuesta) => Err(SinResultado::Error(format!(
            "{}: Mycelium no contestó a tiempo (quizás un diálogo abierto o la ventana trabada). \
             Prueba de nuevo en unos segundos; si se repite, pregúntale al usuario.",
            codigo::OCUPADA
        ))),
        // Un corte a mitad de la llamada (la ventana se cerró): la operación
        // puede haber ocurrido igual (spec de septiembre § 5.2).
        Err(Fallo::Roto(m)) => Err(SinResultado::Error(format!(
            "{}: se cortó el canal con Mycelium ({m}). La operación pudo haber ocurrido de todos modos: \
             compruébalo con mycelium_estado antes de repetirla.",
            codigo::APP_CERRADA
        ))),
    }
}

/// El error cuando nadie escucha y la herramienta necesita la app: distingue
/// app cerrada de control apagado leyendo las preferencias del vault.
fn sin_ventana(vault: &VaultResuelto) -> String {
    sin_ventana_con(vault, false)
}

/// Lo mismo, y si la herramienta es del calendario, recuerda qué hacer sin la
/// app: leerlo con la skill, y no modificarlo a mano (decisión del usuario,
/// `docs/decisiones/Skill o MCP, segun quien sabe hacerlo.md`).
fn sin_ventana_con(vault: &VaultResuelto, calendario: bool) -> String {
    let mut t = sin_ventana_base(vault);
    if calendario {
        t.push_str(
            "\nEl calendario solo se modifica con estas herramientas: sin ellas, no escribas \
             .mycelium/recordatorios.json (díselo al usuario). Para leerlo, la skill mycelium-calendario trae un script.",
        );
    }
    t
}

fn sin_ventana_base(vault: &VaultResuelto) -> String {
    let nombre = &vault.registrado.nombre;
    if control_encendido(&vault.raiz) {
        format!(
            "{}: Mycelium no está abierto con el vault «{nombre}» (nadie escucha en su canal). Sin la app \
             puedes usar mycelium_estado, leer el calendario con la skill mycelium-calendario y leer o escribir \
             los archivos del vault como siempre. Para mostrarle algo, pídele al usuario que abra Mycelium con \
             este vault.",
            codigo::APP_CERRADA
        )
    } else {
        format!(
            "{}: el control de Mycelium está apagado en el vault «{nombre}». Lo enciende el usuario en \
             {DONDE_SE_ENCIENDE}. Apagado no te impide leer ni escribir los archivos del vault: solo operar la app.",
            codigo::MCP_DESACTIVADO
        )
    }
}

/// `CODIGO: mensaje`, más lo que trae `datos` que sirve para corregir la
/// llamada en la misma vuelta (candidatas, rutas, cuándo reintentar).
pub fn redactar_error(error: &Value) -> String {
    let cod = error.get("codigo").and_then(Value::as_str).unwrap_or("ERROR");
    let msg = error.get("mensaje").and_then(Value::as_str).unwrap_or("sin detalle");
    let mut t = format!("{cod}: {msg}");
    let datos = error.get("datos").unwrap_or(&Value::Null);
    if let Some(cands) = datos.get("candidatas").and_then(Value::as_array) {
        if !cands.is_empty() {
            t.push_str("\nLo más parecido:");
            for c in cands {
                t.push_str(&format!("\n  - {}", describir_ref(c)));
            }
        }
    }
    if let Some(rutas) = datos.get("rutas").and_then(Value::as_array) {
        t.push_str("\nRepite la llamada con una de estas rutas:");
        for r in rutas {
            t.push_str(&format!("\n  - {}", r.as_str().unwrap_or_default()));
        }
    }
    if let Some(etapa) = datos.get("etapa").and_then(Value::as_str) {
        t.push_str(&format!("\nEtapa: {etapa}."));
    }
    if let Some(ms) = datos.get("reintentar_en_ms").and_then(Value::as_u64) {
        t.push_str(&format!(" Reintenta en {:.1} s.", ms as f64 / 1000.0));
    }
    // `PANEL_INEXISTENTE` (`FUN-M-59`): los paneles que sí hay.
    if let Some(paneles) = datos.get("paneles").filter(|p| p.is_array()) {
        t.push_str("\nLos paneles que hay:\n");
        t.push_str(&redactar_paneles(paneles));
    }
    t
}

/// `Título — ruta` (o solo el título si no tiene ruta).
fn describir_ref(v: &Value) -> String {
    let titulo = v.get("titulo").and_then(Value::as_str).unwrap_or("?");
    match v.get("ruta").and_then(Value::as_str) {
        Some(r) if !r.is_empty() => format!("{titulo} — {r}"),
        _ => titulo.to_string(),
    }
}

/// Las pestañas por panel, una línea por pestaña. `*` marca la activa de cada
/// panel; el panel con el foco lleva «(activo)».
pub fn redactar_paneles(paneles: &Value) -> String {
    let Some(lista) = paneles.as_array().filter(|l| !l.is_empty()) else {
        return "No hay pestañas abiertas.".to_string();
    };
    let mut t = String::new();
    for p in lista {
        let n = p.get("panel").and_then(Value::as_u64).unwrap_or(0);
        let activo = p.get("activo").and_then(Value::as_bool).unwrap_or(false);
        t.push_str(&format!("Panel {n}{}:", if activo { " (activo)" } else { "" }));
        let pestanas = p.get("pestanas").and_then(Value::as_array).cloned().unwrap_or_default();
        if pestanas.is_empty() {
            t.push_str(" vacío");
        }
        for pe in pestanas {
            let marca = if pe.get("activa").and_then(Value::as_bool) == Some(true) { "*" } else { "-" };
            let tipo = pe.get("tipo").and_then(Value::as_str).unwrap_or("?");
            let sucia = if pe.get("sin_guardar").and_then(Value::as_bool) == Some(true) { " · SIN GUARDAR" } else { "" };
            t.push_str(&format!("\n  {marca} {} [{tipo}]{sucia}", describir_ref(&pe)));
        }
        t.push('\n');
    }
    t.push_str("(* = pestaña visible de cada panel)");
    t
}

// ── mycelium_estado ────────────────────────────────────────────────────────

fn herramienta_estado(estado: &Estado, vault: &VaultResuelto) -> Value {
    let cabecera = format!("Vault «{}» ({}).", vault.registrado.nombre, vault.registrado.ruta);
    match pedir(estado, vault, "estado", json!({})) {
        Ok(r) => {
            let etapa = r.get("etapa").and_then(Value::as_str).unwrap_or("lista");
            let mut t = format!("app: abierta · control: encendido · {cabecera}");
            if etapa != "lista" {
                t.push_str(&format!("\nLa app está ocupada: {etapa}."));
            }
            t.push('\n');
            t.push_str(&redactar_paneles(r.get("paneles").unwrap_or(&Value::Null)));
            t.push_str(&redactar_coordinacion(&r));
            texto(t, false)
        }
        Err(SinResultado::NadieEscucha) => {
            // Con la app cerrada responde igual, con lo que se sabe del disco.
            let t = if control_encendido(&vault.raiz) {
                format!(
                    "app: cerrada · control: encendido · {cabecera}\nMycelium no está abierto con este vault: \
                     no hay pestañas que mirar. Los archivos se leen y escriben de todos modos."
                )
            } else {
                format!(
                    "app: sin canal · control: apagado · {cabecera}\nCon el control apagado no se puede saber \
                     si Mycelium está abierto ni qué muestra. Lo enciende el usuario en {DONDE_SE_ENCIENDE}."
                )
            };
            texto(t, false)
        }
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

// ── Coordinación entre sesiones (`FUN-L-31`) ──────────────────────────────

/// Lo que la app cuenta de las otras sesiones (y de esta), ya redactado por
/// `lib/sesionesIa.ts`: va al final de `mycelium_estado`, `mycelium_sesion` y
/// `mycelium_reservar`. Vacío si la app no lo mandó (una versión vieja).
pub fn redactar_coordinacion(r: &Value) -> String {
    match r.get("coordinacion").and_then(|c| c.get("texto")).and_then(Value::as_str) {
        Some(t) if !t.trim().is_empty() => format!("\n\n{}", t.trim_end()),
        _ => String::new(),
    }
}

/// `mycelium_sesion` y `mycelium_reservar`: la app valida, resuelve el
/// objetivo y redacta el efecto (con los conflictos); acá se agrega lo demás.
fn herramienta_coordinacion(estado: &Estado, vault: &VaultResuelto, op: &str, args: &Value) -> Value {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return texto(format!("{}: los argumentos van en un objeto.", codigo::INVALIDO), true),
    };
    match pedir(estado, vault, op, args) {
        Ok(r) => {
            let mut t = r.get("efecto").and_then(Value::as_str).unwrap_or("Hecho.").to_string();
            t.push_str(&redactar_coordinacion(&r));
            texto(t, false)
        }
        Err(SinResultado::NadieEscucha) => {
            let mut t = sin_ventana_base(vault);
            t.push_str(
                "\nLas sesiones y las reservas viven en la ventana de Mycelium: sin ella no hay coordinación. \
                 Si sabes que otra sesión trabaja en este vault, pregúntale al usuario antes de tocar lo mismo.",
            );
            texto(t, true)
        }
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

// ── mycelium_abrir ─────────────────────────────────────────────────────────

/// Valida los argumentos de `mycelium_abrir` antes de molestar a la app.
pub fn validar_abrir(args: &Value) -> Result<Value, String> {
    let invalido = |m: &str| Err(format!("{}: {m}", codigo::INVALIDO));
    let Some(objetivo) = args.get("objetivo").and_then(Value::as_str).map(str::trim).filter(|o| !o.is_empty()) else {
        return invalido("falta `objetivo` (una ruta, un título, `grafo` o `calendario`).");
    };
    validar_ir_a(args)?;
    for clave in ["revelar", "foco"] {
        if let Some(v) = args.get(clave).filter(|v| !v.is_null()) {
            if !v.is_boolean() {
                return invalido(&format!("`{clave}` es true o false."));
            }
        }
    }
    Ok(json!({
        "objetivo": objetivo,
        "ir_a": args.get("ir_a").cloned().unwrap_or(Value::Null),
        "revelar": args.get("revelar").and_then(Value::as_bool).unwrap_or(false),
        "foco": args.get("foco").and_then(Value::as_bool).unwrap_or(false),
        "panel": validar_panel(args)?,
    }))
}

/// `panel` (`FUN-M-59`): un entero desde 1, o `null` si no vino. Si existe lo
/// sabe la app (`PANEL_INEXISTENTE`).
fn validar_panel(args: &Value) -> Result<Value, String> {
    match args.get("panel").filter(|v| !v.is_null()) {
        None => Ok(Value::Null),
        Some(v) => match v.as_u64().filter(|n| *n >= 1) {
            Some(n) => Ok(json!(n)),
            None => Err(format!(
                "{}: `panel` es el número de un panel, un entero desde 1 (los informa mycelium_estado).",
                codigo::INVALIDO
            )),
        },
    }
}

/// `ir_a`, si vino: exactamente uno de encabezado, línea o texto.
fn validar_ir_a(args: &Value) -> Result<(), String> {
    let invalido = |m: &str| Err(format!("{}: {m}", codigo::INVALIDO));
    if let Some(ir_a) = args.get("ir_a").filter(|v| !v.is_null()) {
        let Some(o) = ir_a.as_object() else {
            return invalido("`ir_a` tiene que ser un objeto: {encabezado}, {linea} o {texto}.");
        };
        let claves: Vec<&str> = o.keys().map(String::as_str).collect();
        if claves.len() != 1 || !matches!(claves[0], "encabezado" | "linea" | "texto") {
            return invalido("`ir_a` lleva exactamente uno de: encabezado, linea, texto.");
        }
        match claves[0] {
            "linea" if !o["linea"].as_u64().is_some_and(|n| n >= 1) => {
                return invalido("`ir_a.linea` es un entero desde 1.");
            }
            "encabezado" | "texto" if o[claves[0]].as_str().map_or(true, |s| s.trim().is_empty()) => {
                return invalido(&format!("`ir_a.{}` es un texto no vacío.", claves[0]));
            }
            _ => {}
        }
    }
    Ok(())
}

/// El texto de un `abrir` que salió bien: qué se abrió, dónde, con o sin foco,
/// y las pestañas que hay después.
pub fn redactar_abrir(r: &Value) -> String {
    let abierto = r.get("abierto").unwrap_or(&Value::Null);
    let panel = r.get("panel").and_then(Value::as_u64).unwrap_or(0);
    let foco = r.get("foco").and_then(Value::as_bool).unwrap_or(false);
    let ya = r.get("ya_estaba").and_then(Value::as_bool).unwrap_or(false);
    let tipo = abierto.get("tipo").and_then(Value::as_str).unwrap_or("?");
    let mut t = format!(
        "{} «{}» [{tipo}] en el panel {panel}, {}.",
        if ya { "Ya estaba abierta" } else { "Abrí" },
        describir_ref(abierto),
        if foco { "con el foco: el usuario la está viendo" } else { "en segundo plano: no se tocó el foco del usuario" }
    );
    if let Some(s) = r.get("salto").and_then(Value::as_str) {
        t.push_str(&format!(" {s}"));
    }
    if r.get("revelado").and_then(Value::as_bool) == Some(true) {
        t.push_str(" Quedó a la vista en el explorador.");
    }
    for a in r.get("avisos").and_then(Value::as_array).into_iter().flatten() {
        if let Some(a) = a.as_str() {
            t.push_str(&format!("\nAviso: {a}"));
        }
    }
    t.push('\n');
    t.push_str(&redactar_paneles(r.get("paneles").unwrap_or(&Value::Null)));
    t
}

fn herramienta_abrir(estado: &Estado, vault: &VaultResuelto, args: &Value) -> Value {
    let args = match validar_abrir(args) {
        Ok(a) => a,
        Err(e) => return texto(e, true),
    };
    match pedir(estado, vault, "abrir", args) {
        Ok(r) => texto(redactar_abrir(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

// ── mycelium_dividir (`FUN-M-59`) ─────────────────────────────────────────

/// Valida los argumentos de `mycelium_dividir` antes de molestar a la app.
pub fn validar_dividir(args: &Value) -> Result<Value, String> {
    let invalido = |m: &str| Err(format!("{}: {m}", codigo::INVALIDO));
    let direccion = match args.get("direccion").and_then(Value::as_str) {
        Some(d @ ("derecha" | "abajo")) => d,
        _ => return invalido("`direccion` es «derecha» o «abajo»."),
    };
    let objetivo = match args.get("objetivo").filter(|v| !v.is_null()) {
        None => Value::Null,
        Some(v) => match v.as_str().map(str::trim) {
            Some(o) if !o.is_empty() => json!(o),
            _ => return invalido("`objetivo` es una ruta, un título, `grafo` o `calendario` (o se omite)."),
        },
    };
    validar_ir_a(args)?;
    if objetivo.is_null() && args.get("ir_a").is_some_and(|v| !v.is_null()) {
        return invalido("`ir_a` va con un `objetivo`: sin él, el panel nuevo muestra la pestaña del dividido.");
    }
    if let Some(v) = args.get("foco").filter(|v| !v.is_null()) {
        if !v.is_boolean() {
            return invalido("`foco` es true o false.");
        }
    }
    Ok(json!({
        "direccion": direccion,
        "panel": validar_panel(args)?,
        "objetivo": objetivo,
        "ir_a": args.get("ir_a").cloned().unwrap_or(Value::Null),
        "foco": args.get("foco").and_then(Value::as_bool).unwrap_or(false),
    }))
}

/// El texto de una división que salió bien: el panel nuevo, qué muestra, el
/// foco y los paneles que quedaron.
pub fn redactar_dividir(r: &Value) -> String {
    let panel = r.get("panel").and_then(Value::as_u64).unwrap_or(0);
    let dividido = r.get("dividido").and_then(Value::as_u64).unwrap_or(0);
    let lado = if r.get("direccion").and_then(Value::as_str) == Some("abajo") { "abajo" } else { "a la derecha" };
    let foco = r.get("foco").and_then(Value::as_bool).unwrap_or(false);
    let mut t = format!("Dividí el panel {dividido}: el panel nuevo es el {panel}, {lado}");
    match r.get("abierto").filter(|a| a.is_object()) {
        Some(a) => {
            let tipo = a.get("tipo").and_then(Value::as_str).unwrap_or("?");
            t.push_str(&format!(", con «{}» [{tipo}]", describir_ref(a)));
        }
        None => t.push_str(", vacío"),
    }
    t.push_str(if foco { ", con el foco: el usuario lo está viendo." } else { "; el foco quedó donde estaba." });
    if let Some(s) = r.get("salto").and_then(Value::as_str) {
        t.push_str(&format!(" {s}"));
    }
    for a in r.get("avisos").and_then(Value::as_array).into_iter().flatten() {
        if let Some(a) = a.as_str() {
            t.push_str(&format!("\nAviso: {a}"));
        }
    }
    t.push('\n');
    t.push_str(&redactar_paneles(r.get("paneles").unwrap_or(&Value::Null)));
    t
}

fn herramienta_dividir(estado: &Estado, vault: &VaultResuelto, args: &Value) -> Value {
    let args = match validar_dividir(args) {
        Ok(a) => a,
        Err(e) => return texto(e, true),
    };
    match pedir(estado, vault, "dividir", args) {
        Ok(r) => texto(redactar_dividir(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

// ── El calendario (Parte 2) ────────────────────────────────────────────────

/// Las cinco herramientas del calendario: comprueban que los argumentos sean un
/// objeto y los pasan a la app, que valida con las reglas del calendario y
/// atiende sobre su store. `redactar` arma el texto de una respuesta buena.
fn herramienta_calendario(
    estado: &Estado,
    vault: &VaultResuelto,
    op: &str,
    args: &Value,
    redactar: fn(&Value) -> String,
) -> Value {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return texto(format!("{}: los argumentos van en un objeto.", codigo::INVALIDO), true),
    };
    match pedir(estado, vault, op, args) {
        Ok(r) => texto(redactar(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana_con(vault, true), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

fn repeticion_corta(r: &str) -> Option<&'static str> {
    match r {
        "dia" => Some("cada día"),
        "semana" => Some("cada semana"),
        "mes" => Some("cada mes"),
        "anio" => Some("cada año"),
        _ => None,
    }
}

/// Las ocurrencias de un rango, una por renglón, en el orden de la app.
pub fn redactar_recordatorios(r: &Value) -> String {
    let desde = r.get("desde").and_then(Value::as_str).unwrap_or("?");
    let hasta = r.get("hasta").and_then(Value::as_str).unwrap_or("?");
    let lista = r.get("ocurrencias").and_then(Value::as_array).cloned().unwrap_or_default();
    if lista.is_empty() {
        return format!("No hay recordatorios entre el {desde} y el {hasta}.");
    }
    let n = lista.len();
    let mut t = format!(
        "{n} {} entre el {desde} y el {hasta} (por día; los de todo el día primero):",
        if n == 1 { "ocurrencia" } else { "ocurrencias" }
    );
    for o in &lista {
        let s = |k: &str| o.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let hora = o.get("hora").and_then(Value::as_str).unwrap_or("todo el día");
        t.push_str(&format!("\n- {} {} · {hora} · «{}» · {}", s("dia"), s("fecha"), s("titulo"), s("color")));
        if let Some(rep) = repeticion_corta(&s("repeticion")) {
            t.push_str(&format!(" · se repite {rep}"));
        }
        if o.get("completada").and_then(Value::as_bool) == Some(true) {
            t.push_str(" · ✓ completada");
        }
        t.push_str(&format!(" · id {}", s("id")));
        let detalle = s("detalle");
        if !detalle.is_empty() {
            t.push_str(&format!("\n    {detalle}"));
        }
    }
    t
}

/// Crear, editar, completar o borrar: el efecto que redactó la app, y el id
/// para seguir operando sobre el recordatorio.
pub fn redactar_escritura(r: &Value) -> String {
    let mut t = r.get("efecto").and_then(Value::as_str).unwrap_or("Hecho.").to_string();
    if let Some(id) = r.pointer("/recordatorio/id").and_then(Value::as_str) {
        t.push_str(&format!("\nid: {id}"));
    }
    t
}

// ── Archivos (Parte 3) ─────────────────────────────────────────────────────

/// El id de una respuesta «esperando confirmación», si lo es.
fn id_esperando(r: &Value) -> Option<String> {
    r.pointer("/esperando_confirmacion/id").and_then(Value::as_str).map(str::to_string)
}

/// Pide una operación que puede necesitar **el permiso del usuario**. Si la app
/// contesta «esperando confirmación», consulta cada medio segundo hasta tener
/// el resultado; si el usuario no contesta en el plazo, retira la pregunta
/// (cuenta como un «no»). Para el agente es una sola llamada, por larga que sea.
///
/// Por qué no una espera dentro del pedido: el canal corta a los 10 s
/// (`OCUPADA`), y una persona tarda más. Así cada pedido sigue siendo corto y
/// el plazo humano vive acá, donde se ve.
fn pedir_con_permiso(estado: &Estado, vault: &VaultResuelto, op: &str, args: Value) -> Result<Value, SinResultado> {
    let r = pedir(estado, vault, op, args)?;
    let Some(id) = id_esperando(&r) else { return Ok(r) };
    let (espera, intervalo) = estado.confirmacion.unwrap_or((ESPERA_CONFIRMACION, INTERVALO_CONFIRMACION));
    let limite = Instant::now() + espera;
    loop {
        std::thread::sleep(intervalo);
        let retirar = Instant::now() >= limite;
        let consulta = if retirar { "confirmacion_retirar" } else { "confirmacion" };
        match pedir(estado, vault, consulta, json!({ "id": id })) {
            Ok(r) if id_esperando(&r).is_some() => {
                if retirar {
                    return Err(SinResultado::Error(format!(
                        "{}: el usuario no contestó a tiempo; no se hizo nada.",
                        codigo::RECHAZADO
                    )));
                }
            }
            Ok(r) => return Ok(r),
            // Si la ventana se cierra mientras pregunta, la pregunta se va con ella.
            Err(SinResultado::NadieEscucha) => {
                return Err(SinResultado::Error(format!(
                    "{}: Mycelium se cerró mientras esperaba que el usuario contestara. Lo más probable es que \
                     no se haya hecho nada: compruébalo (mycelium_estado, mycelium_papelera) antes de repetirlo.",
                    codigo::APP_CERRADA
                )))
            }
            Err(e) => return Err(e),
        }
    }
}

/// Renombrar, mover, borrar y la papelera: comprueban que los argumentos sean
/// un objeto y los pasan a la app, que resuelve el objetivo, valida el nombre
/// con sus reglas y opera con el código de la UI.
fn herramienta_archivos(
    estado: &Estado,
    vault: &VaultResuelto,
    op: &str,
    args: &Value,
    redactar: fn(&Value) -> String,
) -> Value {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return texto(format!("{}: los argumentos van en un objeto.", codigo::INVALIDO), true),
    };
    match pedir_con_permiso(estado, vault, op, args) {
        Ok(r) => texto(redactar(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana_archivos(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

/// Sin la app no se puede renombrar reparando enlaces: qué hacer entonces.
fn sin_ventana_archivos(vault: &VaultResuelto) -> String {
    let mut t = sin_ventana_base(vault);
    t.push_str(
        "\nSin estas herramientas, renombrar o mover con `mv` deja los [[enlaces]] rotos: si aun así lo haces, \
         arréglalos tú (regla dura 2 del CLAUDE.md; el hook te deja pasar con MYCELIUM_SIN_MCP=1 delante del \
         comando). Para borrar, mejor esperar a que el usuario abra Mycelium: un `rm` no pasa por la papelera.",
    );
    t
}

/// Renombrar, mover, borrar o restaurar: el efecto que redactó la app, y la ruta.
pub fn redactar_archivo(r: &Value) -> String {
    let mut t = r.get("efecto").and_then(Value::as_str).unwrap_or("Hecho.").to_string();
    if let Some(ruta) = r.get("ruta").and_then(Value::as_str) {
        t.push_str(&format!("\nruta: {ruta}"));
    }
    t
}

/// La papelera: el listado, o el efecto de restaurar.
pub fn redactar_papelera(r: &Value) -> String {
    let Some(lista) = r.get("entradas").and_then(Value::as_array) else {
        return redactar_archivo(r);
    };
    if lista.is_empty() {
        return "La papelera de Mycelium está vacía.".to_string();
    }
    let cuantas = if lista.len() == 1 { "1 entrada".to_string() } else { format!("{} entradas", lista.len()) };
    let mut t = format!("{cuantas} en la papelera (se restaura con accion «restaurar» y el id):");
    for e in lista {
        let s = |k: &str| e.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let carpeta = s("carpeta");
        let de = if carpeta.is_empty() { "de la raíz".to_string() } else { format!("de {carpeta}") };
        t.push_str(&format!("\n- «{}» · id {} · {de} · borrada {}", s("titulo"), s("id"), s("eliminada")));
    }
    t
}

// ── El diccionario del vault (Parte 4) ─────────────────────────────────────

/// Comprueba que los argumentos sean un objeto y los pasa a la app, que valida
/// con la regla del corrector y escribe por el mismo camino que el clic derecho.
fn herramienta_diccionario(estado: &Estado, vault: &VaultResuelto, args: &Value) -> Value {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return texto(format!("{}: los argumentos van en un objeto.", codigo::INVALIDO), true),
    };
    match pedir(estado, vault, "diccionario", args) {
        Ok(r) => texto(redactar_diccionario(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana_diccionario(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

/// Sin la app, el diccionario no se toca: decirlo, y que no se escriba a mano.
fn sin_ventana_diccionario(vault: &VaultResuelto) -> String {
    let mut t = sin_ventana_base(vault);
    t.push_str(
        "\nEl diccionario del vault solo se modifica con esta herramienta: sin ella, no escribas \
         .mycelium/diccionario.txt (díselo al usuario; lo puede agregar él con el clic derecho sobre la palabra).",
    );
    t
}

fn strs(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(Value::as_array)
        .map(|l| l.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// El listado, o el efecto de agregar o quitar con el detalle que sirve para
/// corregir en la misma vuelta: por qué se rechazó cada una y, de las que no
/// estaban, cuál se quiso decir.
pub fn redactar_diccionario(r: &Value) -> String {
    if r.get("efecto").is_none() {
        let palabras = strs(r, "palabras");
        let total = r.get("total").and_then(Value::as_u64).unwrap_or(palabras.len() as u64);
        if total == 0 {
            return "El diccionario del vault está vacío.".to_string();
        }
        let mut t = format!("El diccionario del vault tiene {total} {}:", if total == 1 { "palabra" } else { "palabras" });
        t.push('\n');
        t.push_str(&palabras.join(", "));
        if r.get("recortado").and_then(Value::as_bool) == Some(true) {
            t.push_str(&format!("\n(se muestran las primeras {} de {total}, en orden alfabético)", palabras.len()));
        }
        return t;
    }
    let mut t = r.get("efecto").and_then(Value::as_str).unwrap_or("Hecho.").to_string();
    for n in r.get("no_estaban").and_then(Value::as_array).into_iter().flatten() {
        if let (Some(p), Some(par)) = (n.get("palabra").and_then(Value::as_str), n.get("parecida").and_then(Value::as_str)) {
            t.push_str(&format!("\n«{p}» no estaba, pero sí «{par}»: para quitarla, pídela así."));
        }
    }
    let rechazadas = r.get("rechazadas").and_then(Value::as_array).cloned().unwrap_or_default();
    if !rechazadas.is_empty() {
        t.push_str("\nRechazadas:");
        for x in rechazadas {
            let p = x.get("palabra").and_then(Value::as_str).unwrap_or_default();
            let m = x.get("motivo").and_then(Value::as_str).unwrap_or("no es una palabra");
            t.push_str(&format!("\n  - «{p}»: {m}"));
        }
    }
    t
}

// ── Consultar el índice (`FUN-M-45`) ───────────────────────────────────────

/// Buscar, los enlaces de una nota y leer una base: solo leen. Comprueban que
/// los argumentos sean un objeto y los pasan a la app, que valida y consulta
/// su índice (`lib/mcpIndice.ts`); acá se redacta.
fn herramienta_consulta(
    estado: &Estado,
    vault: &VaultResuelto,
    op: &str,
    args: &Value,
    redactar: fn(&Value) -> String,
) -> Value {
    let args = match args {
        Value::Null => json!({}),
        Value::Object(_) => args.clone(),
        _ => return texto(format!("{}: los argumentos van en un objeto.", codigo::INVALIDO), true),
    };
    match pedir(estado, vault, op, args) {
        Ok(r) => texto(redactar(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana_consulta(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

/// Sin la app no hay índice que consultar: qué hacer entonces.
fn sin_ventana_consulta(vault: &VaultResuelto) -> String {
    let mut t = sin_ventana_base(vault);
    t.push_str(
        "\nEl índice vive en la ventana de Mycelium: sin ella, busca en los archivos (grep), sabiendo que no \
         aplica su criterio (cuenta enlaces dentro de bloques de código, no ve .mycignore ni resuelve homónimas).",
    );
    t
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or_default()
}

fn n(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}

/// `línea 3` / `líneas 3, 7`, o nada.
fn lineas(v: &Value) -> String {
    let l: Vec<String> = v
        .get("lineas")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_u64).map(|x| x.to_string()).collect())
        .unwrap_or_default();
    match l.len() {
        0 => String::new(),
        1 => format!(" · línea {}", l[0]),
        _ => format!(" · líneas {}", l.join(", ")),
    }
}

/// Una página de resultados, con cómo pedir la siguiente.
pub fn redactar_buscar(r: &Value) -> String {
    let consulta = s(r, "consulta");
    let desde = n(r, "desde");
    let lista = r.get("resultados").and_then(Value::as_array).cloned().unwrap_or_default();
    if lista.is_empty() {
        return if desde > 0 {
            format!("No hay más resultados para «{consulta}» después del {desde}.")
        } else {
            format!("Ningún resultado para «{consulta}» en las notas indexadas (campo: {}).", s(r, "campo"))
        };
    }
    let mut t = format!(
        "{} {} para «{consulta}» (campo: {}){}:",
        lista.len(),
        if lista.len() == 1 { "resultado" } else { "resultados" },
        s(r, "campo"),
        if desde > 0 { format!(", desde el {}", desde + 1) } else { String::new() }
    );
    for (i, x) in lista.iter().enumerate() {
        let tipo = s(x, "tipo");
        let tipo = if tipo.is_empty() || tipo == "markdown" { String::new() } else { format!(" [{tipo}]") };
        t.push_str(&format!("\n{}. {} — {}{tipo}", desde + i as u64 + 1, s(x, "titulo"), s(x, "ruta")));
        let f = s(x, "fragmento");
        if !f.is_empty() {
            t.push_str(&format!("\n   {f}"));
        }
    }
    if r.get("hay_mas").and_then(Value::as_bool) == Some(true) {
        t.push_str(&format!("\nHay más resultados: repite la llamada con `desde: {}`.", n(r, "siguiente")));
    }
    t
}

/// Los salientes y los backlinks de una nota, una línea por enlace.
pub fn redactar_enlaces(r: &Value) -> String {
    let nota = r.get("nota").unwrap_or(&Value::Null);
    let mut t = format!("«{}» ({})", s(nota, "titulo"), s(nota, "ruta"));
    let salientes = r.get("salientes").and_then(Value::as_array).cloned().unwrap_or_default();
    let total_sal = n(r, "total_salientes");
    let rotos = n(r, "rotos");
    t.push_str(&format!(
        "\nSalientes: {total_sal}{}",
        if rotos > 0 { format!(" ({rotos} {})", if rotos == 1 { "roto" } else { "rotos" }) } else { String::new() }
    ));
    if salientes.is_empty() {
        t.push_str("\n  (ninguno)");
    }
    for x in &salientes {
        let escrito = if s(x, "tipo") == "embed" { format!("![[{}]]", s(x, "texto")) } else { format!("[[{}]]", s(x, "texto")) };
        let destino = x.get("destino").unwrap_or(&Value::Null);
        let a = match s(x, "estado") {
            "nota" => format!("{} — {}", s(destino, "titulo"), s(destino, "ruta")),
            "propia" => "ella misma".to_string(),
            "archivo" => format!("el archivo {} (no es nota)", s(destino, "ruta")),
            _ => "ROTO: no resuelve a ninguna nota".to_string(),
        };
        let origen = match s(x, "tipo") {
            "canvas" => " · en una tarjeta de texto",
            "archivo" => " · tarjeta de nota",
            _ => "",
        };
        t.push_str(&format!("\n  {escrito} → {a}{origen}{}", lineas(x)));
    }
    if (salientes.len() as u64) < total_sal {
        t.push_str(&format!("\n  (se muestran {} de {total_sal})", salientes.len()));
    }
    let back = r.get("backlinks").and_then(Value::as_array).cloned().unwrap_or_default();
    let total_back = n(r, "total_backlinks");
    t.push_str(&format!("\nBacklinks: {total_back}"));
    if back.is_empty() {
        t.push_str("\n  (ninguno: nadie la enlaza)");
    }
    for x in &back {
        let textos: Vec<String> = x
            .get("textos")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(|s| format!("[[{s}]]")).collect())
            .unwrap_or_default();
        let tipo = s(x, "tipo");
        let tipo = if tipo.is_empty() || tipo == "markdown" { String::new() } else { format!(" [{tipo}]") };
        t.push_str(&format!("\n  {} — {}{tipo}{} · como {}", s(x, "titulo"), s(x, "ruta"), lineas(x), textos.join(", ")));
    }
    if (back.len() as u64) < total_back {
        t.push_str(&format!("\n  (se muestran {} de {total_back})", back.len()));
    }
    t
}

/// Una celda para una tabla Markdown: sin saltos de línea ni barras sueltas.
fn celda(v: &str) -> String {
    v.replace(['\r', '\n'], " ").replace('|', "\\|")
}

/// La vista de una base como tabla Markdown, con la ruta de cada fila.
pub fn redactar_base(r: &Value) -> String {
    let base = r.get("base").unwrap_or(&Value::Null);
    let vistas: Vec<String> = r
        .get("vistas")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(|v| format!("«{v}»")).collect())
        .unwrap_or_default();
    let filas = r.get("filas").and_then(Value::as_array).cloned().unwrap_or_default();
    let total = n(r, "total");
    let por_vista = n(r, "recortadas_por_vista");
    let por_tope = n(r, "recortadas_por_tope");
    let mut t = format!(
        "Base «{}» ({}) · vista «{}»{}",
        s(base, "titulo"),
        s(base, "ruta"),
        s(r, "vista"),
        if vistas.len() > 1 { format!(" (vistas: {})", vistas.join(", ")) } else { String::new() }
    );
    t.push_str(&format!("\n{total} {} los filtros", if total == 1 { "nota cumple" } else { "notas cumplen" }));
    if por_vista > 0 {
        t.push_str(&format!("; el límite de la vista deja fuera {por_vista}"));
    }
    if por_tope > 0 {
        t.push_str(&format!("; se muestran {} (tope de esta herramienta)", filas.len()));
    }
    t.push('.');
    for a in r.get("avisos").and_then(Value::as_array).into_iter().flatten() {
        if let Some(a) = a.as_str() {
            t.push_str(&format!("\nAviso: {a}"));
        }
    }
    if filas.is_empty() {
        t.push_str("\nNinguna nota cumple los filtros de esta vista.");
        return t;
    }
    let mut columnas: Vec<String> = r
        .get("columnas")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(celda).collect())
        .unwrap_or_default();
    columnas.push("(archivo)".to_string());
    t.push_str(&format!("\n\n| {} |\n|{}|", columnas.join(" | "), vec!["---"; columnas.len()].join("|")));
    for f in &filas {
        let mut celdas: Vec<String> = f
            .get("celdas")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|c| celda(c.as_str().unwrap_or_default())).collect())
            .unwrap_or_default();
        celdas.push(celda(s(f, "ruta")));
        t.push_str(&format!("\n| {} |", celdas.join(" | ")));
    }
    t
}

#[cfg(test)]
mod tests_consultas {
    use super::*;

    #[test]
    fn la_busqueda_numera_y_dice_como_seguir() {
        let t = redactar_buscar(&json!({
            "consulta": "plan", "campo": "ambos", "desde": 20, "hay_mas": true, "siguiente": 22,
            "resultados": [
                {"ruta": "Plan.md", "titulo": "Plan", "tipo": "markdown", "fragmento": "el «plan» de"},
                {"ruta": "T.base", "titulo": "T", "tipo": "base", "fragmento": ""}
            ]
        }));
        assert!(t.starts_with("2 resultados para «plan» (campo: ambos), desde el 21:"), "{t}");
        assert!(t.contains("\n21. Plan — Plan.md\n   el «plan» de"), "{t}");
        assert!(t.contains("\n22. T — T.base [base]"), "{t}");
        assert!(t.ends_with("repite la llamada con `desde: 22`."), "{t}");
        let vacio = redactar_buscar(&json!({"consulta": "x", "campo": "nombre", "desde": 0, "resultados": []}));
        assert!(vacio.starts_with("Ningún resultado para «x»"), "{vacio}");
    }

    #[test]
    fn los_enlaces_dicen_a_donde_van_y_en_que_linea() {
        let t = redactar_enlaces(&json!({
            "nota": {"ruta": "A.md", "titulo": "A"},
            "total_salientes": 3, "rotos": 1,
            "salientes": [
                {"texto": "B#Sec", "tipo": "enlace", "estado": "nota", "destino": {"ruta": "x/B.md", "titulo": "B"}, "lineas": [3, 7]},
                {"texto": "foto.png", "tipo": "embed", "estado": "archivo", "destino": {"ruta": "img/foto.png"}, "lineas": [9]},
                {"texto": "Nada", "tipo": "enlace", "estado": "roto", "destino": null, "lineas": [12]}
            ],
            "total_backlinks": 1,
            "backlinks": [{"ruta": "C.md", "titulo": "C", "tipo": "markdown", "textos": ["A"], "lineas": [2]}]
        }));
        assert!(t.contains("Salientes: 3 (1 roto)"), "{t}");
        assert!(t.contains("[[B#Sec]] → B — x/B.md · líneas 3, 7"), "{t}");
        assert!(t.contains("![[foto.png]] → el archivo img/foto.png (no es nota) · línea 9"), "{t}");
        assert!(t.contains("[[Nada]] → ROTO"), "{t}");
        assert!(t.contains("C — C.md · línea 2 · como [[A]]"), "{t}");
    }

    #[test]
    fn la_base_sale_como_tabla_y_avisa_el_recorte() {
        let t = redactar_base(&json!({
            "base": {"ruta": "P.base", "titulo": "P"}, "vista": "Activos", "vistas": ["Activos", "Todos"],
            "columnas": ["Nombre", "Estado"], "total": 250, "recortadas_por_vista": 0, "recortadas_por_tope": 249,
            "avisos": ["Mycelium ignora: groupBy."],
            "filas": [{"ruta": "a/X.md", "celdas": ["X", "en curso | casi"]}]
        }));
        assert!(t.starts_with("Base «P» (P.base) · vista «Activos» (vistas: «Activos», «Todos»)"), "{t}");
        assert!(t.contains("250 notas cumplen los filtros; se muestran 1 (tope de esta herramienta)."), "{t}");
        assert!(t.contains("Aviso: Mycelium ignora: groupBy."), "{t}");
        assert!(t.contains("| Nombre | Estado | (archivo) |\n|---|---|---|\n| X | en curso \\| casi | a/X.md |"), "{t}");
    }
}

// ── La salud del vault (`FUN-L-30`) ────────────────────────────────────────

/// Un problema de enlace: la nota, la línea y cómo está escrito.
fn problema_en_linea(p: &Value) -> String {
    let escrito = if s(p, "tipo") == "embed" { format!("![[{}]]", s(p, "texto")) } else { format!("[[{}]]", s(p, "texto")) };
    let veces = n(p, "n");
    let extra = if veces > 1 && lineas(p).is_empty() { format!(" ×{veces}") } else { String::new() };
    format!("{}{} · {escrito}{extra}", s(p, "desde"), lineas(p))
}

/// El informe de salud: cada clase con su conteo y sus ítems, y cómo seguir.
pub fn redactar_salud(r: &Value) -> String {
    let alcance = r.get("alcance").unwrap_or(&Value::Null);
    let donde = match s(alcance, "tipo") {
        "carpeta" => format!("de la carpeta {}/", s(alcance, "ruta")),
        "nota" => format!("de la nota {}", s(alcance, "ruta")),
        _ => "del vault".to_string(),
    };
    let c = r.get("conteos").unwrap_or(&Value::Null);
    let total = n(c, "total");
    let notas = n(r, "notas");
    let mut t = format!(
        "Salud {donde}: {notas} {} {}. Las Esporas y las instrucciones de agentes de la raíz (CLAUDE.md, AGENTS.md) no se juzgan.",
        if notas == 1 { "nota" } else { "notas" },
        if total == 0 { "y ningún problema".to_string() } else { format!("y {total} {}", if total == 1 { "problema" } else { "problemas" }) }
    );
    let tope = n(r, "tope");
    let mut recortado = false;
    let mut seccion = |titulo: &str, clave_conteo: &str, clave: &str, linea: &dyn Fn(&Value) -> String| {
        let total = n(c, clave_conteo);
        if total == 0 {
            return;
        }
        t.push_str(&format!("\n{titulo}: {total}"));
        let lista = r.get(clave).and_then(Value::as_array).cloned().unwrap_or_default();
        for x in &lista {
            t.push_str(&format!("\n  - {}", linea(x)));
        }
        if (lista.len() as u64) < total {
            recortado = true;
        }
    };
    seccion("Enlaces rotos", "rotos", "rotos", &problema_en_linea);
    seccion("Embeds rotos", "embedsRotos", "embeds_rotos", &problema_en_linea);
    seccion("Títulos duplicados (enlaces ambiguos)", "duplicados", "duplicados", &|d: &Value| {
        let rutas: Vec<&str> =
            d.get("rutas").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        let ambiguos = d.get("ambiguos").and_then(Value::as_array).cloned().unwrap_or_default();
        let mut l = format!("«{}» [{}]: {}", s(d, "titulo"), s(d, "tipo"), rutas.join(", "));
        if ambiguos.is_empty() {
            l.push_str(" · ningún enlace duda entre ellas (todos llevan carpeta)");
        } else {
            l.push_str(&format!(" · {} {}:", ambiguos.len(), if ambiguos.len() == 1 { "enlace ambiguo" } else { "enlaces ambiguos" }));
            for a in &ambiguos {
                l.push_str(&format!("\n      {}", problema_en_linea(a)));
            }
        }
        l
    });
    let nota = |x: &Value| format!("{} — {}", s(x, "titulo"), s(x, "ruta"));
    seccion("Huérfanas (ninguna nota las enlaza)", "huerfanas", "huerfanas", &nota);
    seccion("Sin enlaces salientes", "sinSalientes", "sin_salientes", &nota);
    // `FUN-M-46`: propiedades que no cumplen los esquemas de `esquemas.yml` o con un `#` sin comillas.
    seccion("Propiedades que no cumplen (esquemas.yml o # sin comillas)", "propiedades", "propiedades", &|x: &Value| {
        let mut l = format!("{} — {}", s(x, "titulo"), s(x, "ruta"));
        for a in x.get("avisos").and_then(Value::as_array).into_iter().flatten() {
            l.push_str(&format!("\n      línea {} · {}", n(a, "linea"), s(a, "mensaje")));
        }
        l
    });
    let avisos_esquemas = r.get("esquemas_avisos").and_then(Value::as_array).cloned().unwrap_or_default();
    if !avisos_esquemas.is_empty() {
        t.push_str("\nesquemas.yml tiene problemas (lo que no se entiende se ignora):");
        for a in &avisos_esquemas {
            t.push_str(&format!("\n  - {}", s(a, "mensaje")));
        }
    }
    if recortado {
        t.push_str(&format!(
            "\n(Cada lista muestra hasta {tope}. Para ver el resto, pide un alcance más pequeño: una carpeta o una nota.)"
        ));
    }
    t
}

/// Los diagnósticos del editor: por nota, cada uno con su línea y columna.
pub fn redactar_diagnosticos(r: &Value) -> String {
    let notas = r.get("notas").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut t = String::new();
    if r.get("encendidos").and_then(Value::as_bool) == Some(false) {
        t.push_str("Los avisos del editor están apagados (Configuración → Editor → «Avisos en la nota»): el editor no marca nada.\n");
    }
    if notas.is_empty() {
        t.push_str("No hay notas abiertas en ningún editor. Pide una con `nota` para calcularla en el momento.");
        return t;
    }
    for (i, nota) in notas.iter().enumerate() {
        if i > 0 {
            t.push('\n');
        }
        let total = n(nota, "total");
        let origen = s(nota, "origen");
        t.push_str(&format!("«{}» ({}): ", s(nota, "titulo"), s(nota, "ruta")));
        if origen == "pendiente" {
            t.push_str("recién abierta, todavía sin calcular. Repite en un instante.");
            continue;
        }
        t.push_str(&if total == 0 { "sin avisos".to_string() } else { format!("{total} {}", if total == 1 { "aviso" } else { "avisos" }) });
        if origen == "calculado_ahora" {
            t.push_str(" (no está abierta: calculado ahora sobre el índice)");
        }
        t.push('.');
        let lista = nota.get("diagnosticos").and_then(Value::as_array).cloned().unwrap_or_default();
        for d in &lista {
            t.push_str(&format!("\n  - línea {}, col. {} · {}", n(d, "linea"), n(d, "columna"), s(d, "mensaje")));
        }
        if (lista.len() as u64) < total {
            t.push_str(&format!("\n  (y {} más)", total - lista.len() as u64));
        }
    }
    t
}

/// El chequeo de cierre de una nota: cada chequeo con ✓ o ✗ y su detalle.
pub fn redactar_validar_nota(r: &Value) -> String {
    let nota = r.get("nota").unwrap_or(&Value::Null);
    let chequeos = r.get("chequeos").and_then(Value::as_array).cloned().unwrap_or_default();
    let fallan = chequeos.iter().filter(|c| c.get("ok").and_then(Value::as_bool) != Some(true)).count();
    let mut t = format!(
        "«{}» ({}): {}",
        s(nota, "titulo"),
        s(nota, "ruta"),
        if fallan == 0 {
            "pasa todos los chequeos.".to_string()
        } else {
            format!("{fallan} de {} {} con problemas.", chequeos.len(), if chequeos.len() == 1 { "chequeo" } else { "chequeos" })
        }
    );
    for c in &chequeos {
        let ok = c.get("ok").and_then(Value::as_bool) == Some(true);
        t.push_str(&format!("\n{} {}", if ok { "✓" } else { "✗" }, s(c, "titulo")));
        for d in c.get("detalle").and_then(Value::as_array).into_iter().flatten() {
            if let Some(d) = d.as_str() {
                t.push_str(&format!("\n    {d}"));
            }
        }
    }
    t
}

#[cfg(test)]
mod tests_salud {
    use super::*;

    #[test]
    fn el_informe_dice_cada_clase_con_su_linea() {
        let t = redactar_salud(&json!({
            "alcance": {"tipo": "vault"}, "notas": 9, "tope": 1,
            "conteos": {"rotos": 2, "embedsRotos": 0, "duplicados": 1, "huerfanas": 1, "sinSalientes": 0, "total": 4},
            "rotos": [{"desde": "Mapa.md", "texto": "Fantasma", "tipo": "enlace", "n": 2, "lineas": [6, 9]}],
            "embeds_rotos": [],
            "duplicados": [{"titulo": "Plan", "tipo": "markdown", "rutas": ["Plan.md", "p/Plan.md"],
                "ambiguos": [{"desde": "Mapa.md", "texto": "Plan", "tipo": "enlace", "n": 1, "lineas": [8]}]}],
            "huerfanas": [{"ruta": "Suelta.md", "titulo": "Suelta"}],
            "sin_salientes": []
        }));
        assert!(t.starts_with("Salud del vault: 9 notas y 4 problemas."), "{t}");
        assert!(t.contains("\nEnlaces rotos: 2\n  - Mapa.md · líneas 6, 9 · [[Fantasma]]"), "{t}");
        assert!(!t.contains("Embeds rotos"), "{t}");
        assert!(t.contains("«Plan» [markdown]: Plan.md, p/Plan.md · 1 enlace ambiguo:\n      Mapa.md · línea 8 · [[Plan]]"), "{t}");
        assert!(t.contains("Huérfanas (ninguna nota las enlaza): 1\n  - Suelta — Suelta.md"), "{t}");
        assert!(t.ends_with("una carpeta o una nota.)"), "recortó los rotos: {t}");
        let props = redactar_salud(&json!({"alcance": {"tipo": "vault"}, "notas": 3, "tope": 100,
            "conteos": {"propiedades": 1, "total": 1},
            "propiedades": [{"ruta": "P/a.md", "titulo": "a", "avisos": [{"linea": 1, "mensaje": "Falta la propiedad obligatoria «estado»."}]}],
            "esquemas_avisos": [{"mensaje": "Esquema «X»: el tipo «raro» no existe."}]}));
        assert!(props.contains("Propiedades que no cumplen (esquemas.yml o # sin comillas): 1\n  - a — P/a.md\n      línea 1 · Falta"), "{props}");
        assert!(props.contains("esquemas.yml tiene problemas"), "{props}");
        let sano = redactar_salud(&json!({"alcance": {"tipo": "carpeta", "ruta": "docs"}, "notas": 1, "tope": 100,
            "conteos": {"total": 0}}));
        assert!(sano.starts_with("Salud de la carpeta docs/: 1 nota y ningún problema."), "{sano}");
    }

    #[test]
    fn diagnosticos_por_nota_con_linea_y_columna() {
        let t = redactar_diagnosticos(&json!({"encendidos": true, "notas": [
            {"ruta": "Mapa.md", "titulo": "Mapa", "origen": "editor", "total": 1,
             "diagnosticos": [{"linea": 6, "columna": 5, "origen": "enlace_roto", "mensaje": "Enlace roto: no hay ninguna nota «Fantasma»."}]},
            {"ruta": "Nueva.md", "titulo": "Nueva", "origen": "pendiente", "total": 0, "diagnosticos": []},
            {"ruta": "Otra.md", "titulo": "Otra", "origen": "calculado_ahora", "total": 0, "diagnosticos": []}
        ]}));
        assert!(t.contains("«Mapa» (Mapa.md): 1 aviso.\n  - línea 6, col. 5 · Enlace roto"), "{t}");
        assert!(t.contains("«Nueva» (Nueva.md): recién abierta"), "{t}");
        assert!(t.contains("«Otra» (Otra.md): sin avisos (no está abierta"), "{t}");
        let apagados = redactar_diagnosticos(&json!({"encendidos": false, "notas": []}));
        assert!(apagados.starts_with("Los avisos del editor están apagados"), "{apagados}");
    }

    #[test]
    fn validar_nota_marca_cada_chequeo() {
        let t = redactar_validar_nota(&json!({
            "nota": {"ruta": "Mapa.md", "titulo": "Mapa"}, "ok": false,
            "chequeos": [
                {"id": "titulo_unico", "ok": true, "titulo": "Título único", "detalle": []},
                {"id": "enlaces_resuelven", "ok": false, "titulo": "Sus enlaces resuelven", "detalle": ["Roto: [[Fantasma]] (línea 6)"]}
            ]
        }));
        assert_eq!(t, "«Mapa» (Mapa.md): 1 de 2 chequeos con problemas.\n✓ Título único\n✗ Sus enlaces resuelven\n    Roto: [[Fantasma]] (línea 6)");
    }
}

#[cfg(test)]
mod tests_diccionario {
    use super::*;

    #[test]
    fn el_listado_dice_el_total_y_si_se_recorto() {
        assert_eq!(redactar_diccionario(&json!({"palabras": [], "total": 0, "recortado": false})), "El diccionario del vault está vacío.");
        let t = redactar_diccionario(&json!({"palabras": ["Mycelium", "rizoma"], "total": 2, "recortado": false}));
        assert_eq!(t, "El diccionario del vault tiene 2 palabras:\nMycelium, rizoma");
        let t = redactar_diccionario(&json!({"palabras": ["a1"], "total": 900, "recortado": true}));
        assert!(t.ends_with("(se muestran las primeras 1 de 900, en orden alfabético)"), "{t}");
    }

    #[test]
    fn el_efecto_trae_las_rechazadas_y_la_parecida() {
        let t = redactar_diccionario(&json!({
            "efecto": "Quité 1 palabra del diccionario del vault: «rizoma». No estaban: «mycelium».",
            "quitadas": ["rizoma"],
            "no_estaban": [{"palabra": "mycelium", "parecida": "Mycelium"}, {"palabra": "otra", "parecida": null}],
            "rechazadas": [{"palabra": "", "motivo": "está vacía"}],
            "total": 1
        }));
        assert!(t.starts_with("Quité 1 palabra"), "{t}");
        assert!(t.contains("«mycelium» no estaba, pero sí «Mycelium»"), "{t}");
        assert!(!t.contains("«otra» no estaba, pero"), "{t}");
        assert!(t.ends_with("Rechazadas:\n  - «»: está vacía"), "{t}");
    }
}

#[cfg(test)]
mod tests_archivos {
    use super::*;
    use crate::canal::falso::{canal_de_prueba, levantar};
    use mycelium_vault::registro::VaultRef;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::time::Duration;

    fn estado(nombre: &str) -> Estado {
        let raiz = std::env::temp_dir().join(format!("mycelium-mcp-arch-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(raiz.join(".mycelium")).unwrap();
        std::fs::write(raiz.join(".mycelium/preferencias.json"), r#"{"controlIa":true}"#).unwrap();
        let v = VaultResuelto {
            registrado: VaultRef { ruta: raiz.to_string_lossy().to_string(), nombre: "Prueba".into(), ultimo_acceso: None },
            raiz,
            origen: "test",
        };
        Estado {
            vault: Ok(v),
            canal: canal_de_prueba(nombre),
            espera: Some(Duration::from_secs(5)),
            confirmacion: Some((Duration::from_millis(400), Duration::from_millis(50))),
        }
    }

    fn herr(e: &Estado, nombre: &str, args: Value) -> (String, bool) {
        let r = llamar(e, nombre, &args).unwrap();
        (r["content"][0]["text"].as_str().unwrap().to_string(), r["isError"].as_bool().unwrap())
    }

    #[test]
    fn sin_confirmacion_contesta_de_una() {
        let e = estado("directo");
        let _app = levantar(e.canal.clone(), |p| {
            Some(json!({"id": p["id"], "ok": true, "resultado": {"efecto": "Renombré «Plan» a «Plan 2026».", "ruta": "Plan 2026.md"}}))
        });
        let (t, err) = herr(&e, "mycelium_renombrar", json!({"objetivo": "Plan", "nombre": "Plan 2026"}));
        assert!(!err && t.starts_with("Renombré") && t.ends_with("ruta: Plan 2026.md"), "{t}");
    }

    #[test]
    fn espera_la_confirmacion_y_devuelve_el_resultado() {
        let e = estado("espera");
        let consultas = Arc::new(AtomicUsize::new(0));
        let c = consultas.clone();
        let _app = levantar(e.canal.clone(), move |p| {
            let id = p["id"].clone();
            Some(match p["op"].as_str().unwrap_or_default() {
                "borrar" => json!({"id": id, "ok": true, "resultado": {"esperando_confirmacion": {"id": "c1", "pregunta": "?"}}}),
                "confirmacion" if c.fetch_add(1, Ordering::SeqCst) < 2 => {
                    json!({"id": id, "ok": true, "resultado": {"esperando_confirmacion": {"id": "c1"}}})
                }
                "confirmacion" => json!({"id": id, "ok": true, "resultado": {"efecto": "Eliminé la carpeta «Viejo»."}}),
                _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
            })
        });
        let (t, err) = herr(&e, "mycelium_borrar", json!({"objetivo": "Viejo/"}));
        assert!(!err && t.starts_with("Eliminé la carpeta"), "{t}");
        assert_eq!(consultas.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn sin_respuesta_del_usuario_retira_la_pregunta() {
        let e = estado("retira");
        let retiradas = Arc::new(AtomicUsize::new(0));
        let r2 = retiradas.clone();
        let _app = levantar(e.canal.clone(), move |p| {
            let id = p["id"].clone();
            Some(match p["op"].as_str().unwrap_or_default() {
                "renombrar" | "confirmacion" => {
                    json!({"id": id, "ok": true, "resultado": {"esperando_confirmacion": {"id": "c9"}}})
                }
                "confirmacion_retirar" => {
                    r2.fetch_add(1, Ordering::SeqCst);
                    json!({"id": id, "ok": false, "error": {"codigo": "RECHAZADO",
                        "mensaje": "El usuario no contestó a tiempo la pregunta: se retiró y no se hizo nada.", "datos": null}})
                }
                _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
            })
        });
        let inicio = Instant::now();
        let (t, err) = herr(&e, "mycelium_renombrar", json!({"objetivo": "Plan", "nombre": "X"}));
        assert!(err && t.starts_with("RECHAZADO") && t.contains("no contestó"), "{t}");
        assert_eq!(retiradas.load(Ordering::SeqCst), 1, "se retira una sola vez");
        assert!(inicio.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn la_papelera_se_lista_con_su_id() {
        let t = redactar_papelera(&json!({"entradas": [
            {"id": "docs/Plan.md", "titulo": "Plan", "carpeta": "docs", "eliminada": "2026-10-01T10:00:00Z"},
            {"id": "Suelta.md", "titulo": "Suelta", "carpeta": "", "eliminada": "2026-10-01T11:00:00Z"}]}));
        assert!(t.starts_with("2 entradas en la papelera"), "{t}");
        assert!(t.contains("«Plan» · id docs/Plan.md · de docs"), "{t}");
        assert!(t.contains("«Suelta» · id Suelta.md · de la raíz"), "{t}");
        assert_eq!(redactar_papelera(&json!({"entradas": []})), "La papelera de Mycelium está vacía.");
    }
}
