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
//! Cada herramienta nueva se
//! declara en [`definiciones`] y se atiende en [`llamar`]; la lógica de cada
//! operación vive en la app (`lib/mcpControl.ts`), donde ya existe, y acá solo
//! se valida lo evidente, se habla por el canal y se **redacta la respuesta**:
//! texto corto que dice el efecto, no el eco (spec § 3).
//!
//! Las búsquedas de la fase de memoria (`vault_buscar`, `vault_leer`) se
//! evaluaron y no entraron (`docs/arquitectura/MCP de Mycelium - tesina,
//! protocolo.md` § 9); su código quedó en la historia de `feat/mcp-desktop`.

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
const NOMBRES: [&str; 12] = [
    "mycelium_estado",
    "mycelium_abrir",
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
                para eso leé los archivos. Miralo antes de escribir un archivo que el usuario podría estar \
                editando: si su pestaña tiene cambios sin guardar, avisale, porque lo que guarde después pisa lo tuyo.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_abrir",
            "title": "Mostrar algo en Mycelium",
            "description": "Abre en Mycelium una nota o archivo del vault, el grafo o el calendario, en una \
                pestaña. Por defecto NO le roba el foco al usuario (la pestaña queda en segundo plano); pedí \
                `foco: true` solo si tenés algo que mostrarle ahora. En una nota puede saltar a un encabezado, \
                una línea o un texto. Devuelve en qué panel quedó y qué pestañas hay. No crea nada: si el \
                objetivo no existe, contesta NO_ENCONTRADO con las candidatas más parecidas.",
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
                    "foco": { "type": "boolean", "description": "Activar la pestaña y llevar al usuario a ella. Por defecto false." }
                },
                "required": ["objetivo"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
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
            "description": r#"Renombra una nota o una carpeta del vault REPARANDO LOS ENLACES que llegaban a ella, con el mismo código que usa Mycelium cuando el usuario renombra desde el explorador o el título. Usala en vez de `mv`. Devuelve la ruta nueva y en qué notas se reescribieron enlaces (y si alguna quedó sin reparar). Si reescribiría enlaces en más de 5 notas, Mycelium le pregunta al usuario y esta llamada espera su respuesta (hasta 2 minutos): si dice que no, RECHAZADO, que es una respuesta, no un error para reintentar: no lo pidas de nuevo en partes más chicas ni lo hagas con `mv`. El nombre no puede llevar ? : * | " < > \ /. Se deshace desde el registro de actividad de Mycelium."#,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": {
                        "type": "string",
                        "description": "La nota (ruta `docs/Plan.md` o título `Plan`) o la carpeta (`Área/Proyectos`, o con `/` al final para que sea la carpeta)."
                    },
                    "nombre": { "type": "string", "description": "El nombre nuevo, sin carpeta (la extensión de una nota se puede omitir)." }
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
                Usala en vez de `mv`. Pregunta al usuario igual que mycelium_renombrar si reescribe enlaces en más de 5 \
                notas. Se deshace desde el registro de actividad.",
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
                para siempre. Usala en vez de `rm`. Una nota no pregunta (el usuario ve un aviso con Deshacer); una \
                carpeta SIEMPRE le pregunta al usuario y esta llamada espera su respuesta. Devuelve con qué id se \
                restaura (mycelium_papelera) y qué pestañas se cerraron. Una nota con cambios sin guardar no se borra: \
                CAMBIOS_SIN_GUARDAR.",
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
    ]
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
    let pedido = protocolo_canal::pedido(&id, op, args, &vault.registrado.ruta);
    match canal::pedir(&estado.canal, &pedido, estado.espera.unwrap_or(ESPERA_CLIENTE)) {
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(true) => Ok(r.get("resultado").cloned().unwrap_or(Value::Null)),
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(false) => {
            Err(SinResultado::Error(redactar_error(r.get("error").unwrap_or(&Value::Null))))
        }
        Ok(r) => Err(SinResultado::Error(format!("La app respondió algo que no es del protocolo: {r}"))),
        Err(Fallo::NadieEscucha) => Err(SinResultado::NadieEscucha),
        Err(Fallo::SinRespuesta) => Err(SinResultado::Error(format!(
            "{}: Mycelium no contestó a tiempo (quizás un diálogo abierto o la ventana trabada). \
             Probá de nuevo en unos segundos; si se repite, preguntale al usuario.",
            codigo::OCUPADA
        ))),
        // Un corte a mitad de la llamada (la ventana se cerró): la operación
        // puede haber ocurrido igual (spec de septiembre § 5.2).
        Err(Fallo::Roto(m)) => Err(SinResultado::Error(format!(
            "{}: se cortó el canal con Mycelium ({m}). La operación pudo haber ocurrido igual: \
             comprobalo con mycelium_estado antes de repetirla.",
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
             .mycelium/recordatorios.json (decíselo al usuario). Para leerlo, la skill mycelium-calendario trae un script.",
        );
    }
    t
}

fn sin_ventana_base(vault: &VaultResuelto) -> String {
    let nombre = &vault.registrado.nombre;
    if control_encendido(&vault.raiz) {
        format!(
            "{}: Mycelium no está abierto con el vault «{nombre}» (nadie escucha en su canal). Sin la app \
             podés usar mycelium_estado, leer el calendario con la skill mycelium-calendario y leer o escribir \
             los archivos del vault como siempre. Para mostrarle algo, pedile al usuario que abra Mycelium con \
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
        t.push_str("\nRepetí la llamada con una de estas rutas:");
        for r in rutas {
            t.push_str(&format!("\n  - {}", r.as_str().unwrap_or_default()));
        }
    }
    if let Some(etapa) = datos.get("etapa").and_then(Value::as_str) {
        t.push_str(&format!("\nEtapa: {etapa}."));
    }
    if let Some(ms) = datos.get("reintentar_en_ms").and_then(Value::as_u64) {
        t.push_str(&format!(" Reintentá en {:.1} s.", ms as f64 / 1000.0));
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
            texto(t, false)
        }
        Err(SinResultado::NadieEscucha) => {
            // Con la app cerrada responde igual, con lo que se sabe del disco.
            let t = if control_encendido(&vault.raiz) {
                format!(
                    "app: cerrada · control: encendido · {cabecera}\nMycelium no está abierto con este vault: \
                     no hay pestañas que mirar. Los archivos se leen y escriben igual."
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

// ── mycelium_abrir ─────────────────────────────────────────────────────────

/// Valida los argumentos de `mycelium_abrir` antes de molestar a la app.
pub fn validar_abrir(args: &Value) -> Result<Value, String> {
    let invalido = |m: &str| Err(format!("{}: {m}", codigo::INVALIDO));
    let Some(objetivo) = args.get("objetivo").and_then(Value::as_str).map(str::trim).filter(|o| !o.is_empty()) else {
        return invalido("falta `objetivo` (una ruta, un título, `grafo` o `calendario`).");
    };
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
    }))
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
                     no se haya hecho nada: comprobalo (mycelium_estado, mycelium_papelera) antes de repetirlo.",
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
        "\nSin estas herramientas, renombrar o mover con `mv` deja los [[enlaces]] rotos: si lo hacés igual, \
         arreglalos vos (regla dura 2 del CLAUDE.md; el hook te deja pasar con MYCELIUM_SIN_MCP=1 delante del \
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
         .mycelium/diccionario.txt (decíselo al usuario; lo puede agregar él con el clic derecho sobre la palabra).",
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
            t.push_str(&format!("\n«{p}» no estaba, pero sí «{par}»: para quitarla, pedila así."));
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
