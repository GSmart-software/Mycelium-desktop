//! Autoactualización asistida (`FUN-L-14`) y selección de versión (`FUN-M-16`).
//!
//! Toda la lógica del updater vive en Rust y NO en el webview, por dos motivos:
//!
//! 1. `UpdaterBuilder::version_comparator` —lo único que permite instalar una
//!    versión ANTERIOR sin salirse del plugin oficial— solo existe del lado
//!    Rust: el comando JS del plugin no lo expone.
//! 2. La petición del manifiesto la hace `reqwest`, no `fetch`, así que no
//!    interviene ninguna política de navegador (no hay CORS que configurar en
//!    el bucket).
//!
//! El estado del updater (última comprobación, versión omitida, versión fijada,
//! endpoint propio, modo avanzado) vive en `actualizador.json` dentro del
//! config-dir de la app, **no** en las preferencias del vault: la comprobación
//! ocurre al arrancar —cuando puede no haber ningún vault abierto— y "omití la
//! 1.4.0" es una decisión de la instalación, no de un vault concreto. Es el
//! mismo criterio y el mismo mecanismo que `vault_config.rs`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const ARCHIVO: &str = "actualizador.json";

/// Marcador de la clave pública en `tauri.conf.json`. Mientras la config siga
/// teniendo este valor, el updater queda **desactivado con un mensaje claro**:
/// sin clave real no se puede verificar nada, y arrancar la descarga para morir
/// al verificar la firma sería peor que no ofrecerla. Se cambia una sola vez,
/// con la salida de `npx tauri signer generate` (ver
/// `docs/procesos/Publicar una version.md`).
const CLAVE_SIN_CONFIGURAR: &str = "SIN-CONFIGURAR-generar-con-npx-tauri-signer-generate";

/// Host del endpoint de ejemplo. `.invalid` es un TLD reservado (RFC 2606) que
/// por definición nunca resuelve: si alguien olvida cambiarlo, el updater no
/// habla con nada de nadie. Se detecta por subcadena para no depender de la URL
/// completa.
const HOST_SIN_CONFIGURAR: &str = ".invalid";

/// Nombre del manifiesto dentro de la carpeta de cada versión publicada. Es el
/// MISMO formato que `latest.json` (el plugin no distingue): publicar una
/// versión es escribir el manifiesto dos veces, en la raíz y en su carpeta.
const MANIFIESTO: &str = "latest.json";

/// Índice de versiones publicadas que lee el modo avanzado (`FUN-M-16`).
const INDICE_VERSIONES: &str = "versions.json";

// ── Configuración persistida ────────────────────────────────────────────────

/// Contenido de `actualizador.json`. Todos los campos son opcionales o tienen
/// default para que una config vieja (o ausente) siga siendo válida.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ConfigUpdater {
    /// Comprobación automática diaria al arrancar. Por defecto activada.
    #[serde(default = "verdadero")]
    auto: bool,
    /// Fecha local (`AAAA-MM-DD`) de la última comprobación. La calcula el
    /// frontend: el huso horario del usuario es del webview, no de Rust.
    #[serde(default)]
    ultima_comprobacion: Option<String>,
    /// Versión que el usuario decidió omitir ("Omitir esta versión").
    #[serde(default)]
    version_omitida: Option<String>,
    /// Versión instalada a mano desde el modo avanzado. Mientras esté puesta,
    /// NO se comprueba nada automáticamente (`FUN-M-16`, criterio 17).
    #[serde(default)]
    version_fijada: Option<String>,
    /// Endpoint propio que sustituye al compilado (bucket de pruebas, cambio de
    /// dominio). `None` → se usa el de `tauri.conf.json`.
    #[serde(default)]
    endpoint: Option<String>,
    /// Modo avanzado (siete clics en el número de versión). Persistente.
    #[serde(default)]
    avanzado: bool,
}

fn verdadero() -> bool {
    true
}

impl Default for ConfigUpdater {
    fn default() -> Self {
        Self {
            auto: true,
            ultima_comprobacion: None,
            version_omitida: None,
            version_fijada: None,
            endpoint: None,
            avanzado: false,
        }
    }
}

fn ruta_config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?;
    Ok(dir.join(ARCHIVO))
}

/// Lee la config (archivo ausente o corrupto → defaults). Pura, testeable.
fn leer_config(archivo: &Path) -> ConfigUpdater {
    std::fs::read_to_string(archivo)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Escribe la config (crea el config-dir si falta). Pura, testeable.
fn escribir_config(archivo: &Path, cfg: &ConfigUpdater) -> Result<(), String> {
    if let Some(padre) = archivo.parent() {
        std::fs::create_dir_all(padre)
            .map_err(|e| format!("No se pudo crear el config-dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(archivo, json)
        .map_err(|e| format!("No se pudo guardar la config del updater: {e}"))
}

/// Aplica una mutación sobre la config y la persiste.
fn mutar(app: &tauri::AppHandle, f: impl FnOnce(&mut ConfigUpdater)) -> Result<(), String> {
    let archivo = ruta_config(app)?;
    let mut cfg = leer_config(&archivo);
    f(&mut cfg);
    escribir_config(&archivo, &cfg)
}

// ── Lectura de la config compilada (tauri.conf.json) ────────────────────────

/// Clave pública y primer endpoint tal como quedaron **compilados** dentro del
/// binario. Devuelve `("", "")` si el bloque `plugins.updater` no existe.
fn config_compilada(app: &tauri::AppHandle) -> (String, String) {
    let Some(updater) = app.config().plugins.0.get("updater") else {
        return (String::new(), String::new());
    };
    let clave = updater
        .get("pubkey")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let endpoint = updater
        .get("endpoints")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    (clave, endpoint)
}

/// Motivo por el que el updater no puede funcionar, o `None` si está listo.
/// Es lo que hace que la app **degrade con elegancia**: sin clave o sin bucket
/// no revienta ni falla en silencio, lo dice en Configuración.
fn motivo_desactivado(clave: &str, endpoint: &str) -> Option<String> {
    if clave.is_empty() || clave == CLAVE_SIN_CONFIGURAR {
        return Some(
            "No hay clave pública de firma configurada, así que no se puede verificar \
             ninguna actualización. Generala con «npx tauri signer generate» y pegá la \
             pública en tauri.conf.json (plugins.updater.pubkey). Ver «Publicar una \
             versión» en la documentación."
                .into(),
        );
    }
    if endpoint.is_empty() || endpoint.contains(HOST_SIN_CONFIGURAR) {
        return Some(
            "No hay servidor de actualizaciones configurado (el endpoint sigue siendo el \
             de ejemplo). Podés fijar uno acá abajo sin recompilar."
                .into(),
        );
    }
    None
}

// ── Tipos que ve el frontend ────────────────────────────────────────────────

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EstadoUpdater {
    /// `true` si hay clave y endpoint reales: solo entonces se comprueba nada.
    pub habilitado: bool,
    /// Por qué NO está habilitado (texto para mostrar en Configuración).
    pub motivo: Option<String>,
    pub version_actual: String,
    /// Endpoint que se usa de verdad (el propio si lo hay, si no el compilado).
    pub endpoint: String,
    /// El compilado, para poder volver a él.
    pub endpoint_defecto: String,
    pub endpoint_personalizado: bool,
    pub auto: bool,
    pub ultima_comprobacion: Option<String>,
    pub version_omitida: Option<String>,
    pub version_fijada: Option<String>,
    pub avanzado: bool,
}

/// Una actualización disponible, tal como la anuncia el manifiesto.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InfoActualizacion {
    pub version: String,
    pub version_actual: String,
    /// Markdown de las notas de la release (lo renderiza el motor de Mycelium).
    pub notas: Option<String>,
    /// Fecha de publicación en ISO-8601, si el manifiesto la trae.
    pub fecha: Option<String>,
}

/// Una versión publicada según `versions.json` (modo avanzado, `FUN-M-16`).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionPublicada {
    pub version: String,
    pub fecha: Option<String>,
    pub notas: Option<String>,
    /// URL absoluta del manifiesto de ESA versión, ya resuelta.
    pub manifiesto: String,
}

/// Forma cruda de `versions.json`. `manifest` es opcional: si falta se asume
/// `<version>/latest.json`, que es lo que produce el proceso de publicación.
#[derive(Deserialize, Debug)]
struct EntradaVersiones {
    version: String,
    #[serde(default, alias = "pub_date", alias = "pubDate")]
    fecha: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    manifest: Option<String>,
}

#[derive(Deserialize, Debug)]
struct IndiceVersiones {
    #[serde(default)]
    versions: Vec<EntradaVersiones>,
}

/// Progreso de descarga que se emite al webview (`updater-progreso`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progreso {
    descargado: u64,
    /// `null` si el servidor no manda `Content-Length`.
    total: Option<u64>,
}

/// Paquete ya descargado y **con la firma verificada**, a la espera de que el
/// usuario confirme la instalación. Se guarda entre comandos porque instalar
/// cierra la app: descargar y decidir tienen que poder ocurrir por separado
/// (mientras baja, el usuario sigue trabajando).
#[derive(Default)]
pub struct DescargaState(pub Mutex<Option<(Update, Vec<u8>)>>);

// ── Utilidades de URL ───────────────────────────────────────────────────────

/// Base del bucket a partir del endpoint: todo menos el último segmento.
/// `https://x/y/latest.json` → `https://x/y/`.
fn base_de(endpoint: &str) -> String {
    match endpoint.rfind('/') {
        Some(i) => endpoint[..=i].to_string(),
        None => format!("{endpoint}/"),
    }
}

/// Resuelve una referencia del índice: absoluta se respeta, relativa se cuelga
/// de la base. Así, cambiar de dominio no obliga a reescribir `versions.json`.
fn resolver(base: &str, referencia: &str) -> String {
    if referencia.starts_with("http://") || referencia.starts_with("https://") {
        referencia.to_string()
    } else {
        format!("{base}{}", referencia.trim_start_matches('/'))
    }
}

/// Endpoint efectivo + comprobación de que el updater está utilizable.
fn endpoint_efectivo(app: &tauri::AppHandle) -> Result<String, String> {
    let (clave, compilado) = config_compilada(app);
    let cfg = leer_config(&ruta_config(app)?);
    let endpoint = cfg.endpoint.clone().unwrap_or(compilado);
    if let Some(motivo) = motivo_desactivado(&clave, &endpoint) {
        return Err(motivo);
    }
    Ok(endpoint)
}

// ── Comandos ────────────────────────────────────────────────────────────────

/// Estado completo del updater. Es lo primero que consulta el frontend: si
/// `habilitado` es `false`, no se hace ninguna petición de red.
#[tauri::command]
pub fn updater_estado(app: tauri::AppHandle) -> Result<EstadoUpdater, String> {
    let (clave, compilado) = config_compilada(&app);
    let cfg = leer_config(&ruta_config(&app)?);
    let endpoint = cfg.endpoint.clone().unwrap_or_else(|| compilado.clone());
    let motivo = motivo_desactivado(&clave, &endpoint);
    Ok(EstadoUpdater {
        habilitado: motivo.is_none(),
        motivo,
        version_actual: app.package_info().version.to_string(),
        endpoint,
        endpoint_defecto: compilado,
        endpoint_personalizado: cfg.endpoint.is_some(),
        auto: cfg.auto,
        ultima_comprobacion: cfg.ultima_comprobacion,
        version_omitida: cfg.version_omitida,
        version_fijada: cfg.version_fijada,
        avanzado: cfg.avanzado,
    })
}

/// Activa/desactiva la comprobación automática diaria.
#[tauri::command]
pub fn updater_set_auto(app: tauri::AppHandle, valor: bool) -> Result<(), String> {
    mutar(&app, |c| c.auto = valor)
}

/// Activa/desactiva el modo avanzado (siete clics en el número de versión).
#[tauri::command]
pub fn updater_set_avanzado(app: tauri::AppHandle, valor: bool) -> Result<(), String> {
    mutar(&app, |c| c.avanzado = valor)
}

/// Fija un endpoint propio (o `null` para volver al compilado). Se valida acá
/// para que un pegado con un espacio no se descubra recién al comprobar.
#[tauri::command]
pub fn updater_set_endpoint(app: tauri::AppHandle, valor: Option<String>) -> Result<(), String> {
    let limpio = match valor {
        Some(v) if !v.trim().is_empty() => {
            let v = v.trim().to_string();
            if !v.starts_with("https://") {
                return Err("El endpoint tiene que empezar por https:// (el updater rechaza \
                            el transporte inseguro en las builds de producción)."
                    .into());
            }
            Some(v)
        }
        _ => None,
    };
    mutar(&app, |c| c.endpoint = limpio)
}

/// Guarda la versión que el usuario decidió omitir (o `null` para olvidarla).
#[tauri::command]
pub fn updater_omitir_version(
    app: tauri::AppHandle,
    version: Option<String>,
) -> Result<(), String> {
    mutar(&app, |c| c.version_omitida = version)
}

/// Fija (o suelta, con `null`) la versión elegida a mano. Con una versión
/// fijada NO se comprueba nada al arrancar.
#[tauri::command]
pub fn updater_fijar_version(
    app: tauri::AppHandle,
    version: Option<String>,
) -> Result<(), String> {
    mutar(&app, |c| c.version_fijada = version)
}

/// Anota que hoy ya se comprobó. La fecha (`AAAA-MM-DD`) la calcula el frontend
/// con el huso del usuario, que es el que importa para "una vez al día".
#[tauri::command]
pub fn updater_marcar_comprobacion(app: tauri::AppHandle, fecha: String) -> Result<(), String> {
    mutar(&app, |c| c.ultima_comprobacion = Some(fecha))
}

/// Consulta el manifiesto y devuelve la actualización si hay una MÁS NUEVA.
/// `Ok(None)` = ya se está en la última. Un fallo de red devuelve `Err`, y es
/// el frontend el que decide callarlo (arranque) o mostrarlo (botón manual).
#[tauri::command]
pub async fn updater_buscar(app: tauri::AppHandle) -> Result<Option<InfoActualizacion>, String> {
    let endpoint = endpoint_efectivo(&app)?;
    let actual = app.package_info().version.to_string();
    let update = construir(&app, &endpoint, None).await?;
    Ok(update.map(|u| InfoActualizacion {
        version: u.version.clone(),
        version_actual: actual,
        notas: u.body.clone(),
        // La fecha sale del JSON crudo y no de `u.date` para no arrastrar el
        // crate `time` solo por formatearla: el manifiesto ya la trae en ISO.
        fecha: u
            .raw_json
            .get("pub_date")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }))
}

/// Lista lo publicado según `versions.json` (modo avanzado, `FUN-M-16`).
#[tauri::command]
pub async fn updater_versiones(app: tauri::AppHandle) -> Result<Vec<VersionPublicada>, String> {
    let endpoint = endpoint_efectivo(&app)?;
    let base = base_de(&endpoint);
    let indice = pedir_json::<IndiceVersiones>(&format!("{base}{INDICE_VERSIONES}")).await?;
    Ok(indice
        .versions
        .into_iter()
        .map(|e| {
            // Sin `manifest`, la convención: `<base>/<version>/latest.json`. Y
            // si lo trae, se resuelve contra la base, así que mudar el bucket
            // no obliga a reescribir el índice entero.
            let manifiesto = match &e.manifest {
                Some(m) => resolver(&base, m),
                None => format!("{base}{}/{MANIFIESTO}", e.version),
            };
            VersionPublicada {
                version: e.version,
                fecha: e.fecha,
                notas: e.notes,
                manifiesto,
            }
        })
        .collect())
}

/// Descarga el paquete y **verifica su firma**, sin instalar nada. Emite
/// `updater-progreso` mientras baja. Con `version`, baja esa versión concreta
/// (aunque sea anterior a la instalada); sin ella, la última.
#[tauri::command]
pub async fn updater_descargar(
    app: tauri::AppHandle,
    version: Option<String>,
    manifiesto: Option<String>,
    estado: tauri::State<'_, DescargaState>,
) -> Result<(), String> {
    let endpoint = endpoint_efectivo(&app)?;
    let objetivo = version.clone().map(|v| (v, manifiesto));
    let update = construir(&app, &endpoint, objetivo)
        .await?
        .ok_or_else(|| match version {
            Some(v) => format!("El manifiesto de la versión {v} no anuncia esa versión."),
            None => "No hay ninguna versión más nueva que la instalada.".to_string(),
        })?;

    let app_evt = app.clone();
    let mut descargado: u64 = 0;
    let bytes = update
        .download(
            move |trozo, total| {
                descargado += trozo as u64;
                let _ = app_evt.emit("updater-progreso", Progreso { descargado, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo descargar la actualización: {e}"))?;

    *estado.0.lock().unwrap() = Some((update, bytes));
    Ok(())
}

/// Instala el paquete ya descargado. **No vuelve**: el plugin lanza el
/// instalador y termina el proceso. El frontend tiene que haber vaciado los
/// guardados pendientes ANTES de llamar acá.
#[tauri::command]
pub fn updater_instalar(estado: tauri::State<'_, DescargaState>) -> Result<(), String> {
    let paquete = estado.0.lock().unwrap().take();
    let (update, bytes) =
        paquete.ok_or_else(|| "No hay ninguna actualización descargada.".to_string())?;
    update
        .install(bytes)
        .map_err(|e| format!("No se pudo instalar la actualización: {e}"))
}

/// Descarta el paquete descargado (el usuario cerró el diálogo sin instalar).
#[tauri::command]
pub fn updater_descartar(estado: tauri::State<'_, DescargaState>) -> Result<(), String> {
    *estado.0.lock().unwrap() = None;
    Ok(())
}

// ── Motor ───────────────────────────────────────────────────────────────────

/// Construye el `Update` a partir del manifiesto que toque.
///
/// - Sin `version`: el manifiesto raíz y la comparación por defecto del plugin
///   (solo instala si la remota es MAYOR que la instalada).
/// - Con `version`: el manifiesto de esa carpeta y un `version_comparator`
///   propio que acepta exactamente esa versión. El comparador **sustituye por
///   completo** al `>` por defecto, que es lo que permite bajar de versión sin
///   salirse del plugin; el instalador NSIS lo admite porque
///   `bundle.windows.allowDowngrades` vale su default (`true`).
async fn construir(
    app: &tauri::AppHandle,
    endpoint: &str,
    objetivo: Option<(String, Option<String>)>,
) -> Result<Option<Update>, String> {
    let (url, pedida) = match objetivo {
        Some((v, manifiesto)) => {
            let url = manifiesto
                .unwrap_or_else(|| format!("{}{v}/{MANIFIESTO}", base_de(endpoint)));
            (url, Some(v))
        }
        None => (endpoint.to_string(), None),
    };
    let url = tauri::Url::parse(&url).map_err(|e| format!("Endpoint inválido ({url}): {e}"))?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| format!("Endpoint rechazado: {e}"))?;

    if let Some(pedida) = pedida {
        builder = builder.version_comparator(move |_actual, remota| {
            remota.version.to_string() == pedida
        });
    }

    builder
        .build()
        .map_err(|e| format!("No se pudo preparar el updater: {e}"))?
        .check()
        .await
        .map_err(|e| format!("No se pudo consultar el servidor de actualizaciones: {e}"))
}

/// GET + JSON con el mismo cliente TLS que usa el plugin. Se usa solo para
/// `versions.json`, que el plugin no conoce.
async fn pedir_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    // `reqwest` viene con `rustls-no-provider` (lo fija el plugin del updater),
    // así que el backend criptográfico NO se autoinstala: hay que fijar el del
    // proceso antes del primer TLS o falla al conectar. El plugin hace lo mismo
    // en su `check()`; acá se repite porque esta petición puede ser la primera.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let respuesta = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("No se pudo leer {url}: {e}"))?;
    if !respuesta.status().is_success() {
        return Err(format!(
            "El servidor respondió {} al pedir {url}",
            respuesta.status()
        ));
    }
    respuesta
        .json::<T>()
        .await
        .map_err(|e| format!("El índice de versiones no tiene el formato esperado: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_persiste_y_tolera_ausencia() {
        let base = std::env::temp_dir().join(format!("mycelium-updater-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let archivo = base.join("sub").join(ARCHIVO); // el padre no existe aún

        // Sin archivo: defaults sensatos (comprobar sí, nada omitido ni fijado).
        let cfg = leer_config(&archivo);
        assert!(cfg.auto);
        assert_eq!(cfg.version_omitida, None);
        assert_eq!(cfg.version_fijada, None);
        assert!(!cfg.avanzado);

        let mut cfg = leer_config(&archivo);
        cfg.auto = false;
        cfg.ultima_comprobacion = Some("2026-08-03".into());
        cfg.version_omitida = Some("1.4.0".into());
        cfg.endpoint = Some("https://pruebas.example/latest.json".into());
        cfg.avanzado = true;
        escribir_config(&archivo, &cfg).unwrap();

        let leida = leer_config(&archivo);
        assert_eq!(leida, cfg);

        // Archivo corrupto: defaults, no pánico.
        std::fs::write(&archivo, "{ esto no es json").unwrap();
        assert!(leer_config(&archivo).auto);

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn desactivado_mientras_la_clave_o_el_endpoint_sean_de_ejemplo() {
        assert!(motivo_desactivado("", "https://x/latest.json").is_some());
        assert!(motivo_desactivado(CLAVE_SIN_CONFIGURAR, "https://x/latest.json").is_some());
        assert!(motivo_desactivado("dW50cnVzdGVk", "https://x.invalid/latest.json").is_some());
        assert!(motivo_desactivado("dW50cnVzdGVk", "").is_some());
        assert!(motivo_desactivado("dW50cnVzdGVk", "https://x/latest.json").is_none());
    }

    #[test]
    fn la_base_es_el_endpoint_sin_su_ultimo_segmento() {
        assert_eq!(base_de("https://x.com/latest.json"), "https://x.com/");
        assert_eq!(base_de("https://x.com/r/latest.json"), "https://x.com/r/");
        assert_eq!(
            resolver("https://x.com/r/", "1.4.0/latest.json"),
            "https://x.com/r/1.4.0/latest.json"
        );
        assert_eq!(
            resolver("https://x.com/r/", "/1.4.0/latest.json"),
            "https://x.com/r/1.4.0/latest.json"
        );
        assert_eq!(
            resolver("https://x.com/r/", "https://otro.com/m.json"),
            "https://otro.com/m.json"
        );
    }
}
