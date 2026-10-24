//! Varios vaults abiertos a la vez, uno por ventana (`FUN-L-16`, solo-desktop).
//!
//! Tauri sabe abrir varias ventanas y cada una es un webview con su propio
//! contexto de JavaScript, así que los stores del frontend no se pisan solos. Lo
//! que había que resolver es todo lo que en Rust era **global a la app** y en
//! realidad pertenece a una ventana: el watcher del vault (`vault_watch`) y las
//! sesiones de terminal (`terminal`). Este módulo añade la pieza que faltaba:
//! saber **qué vault tiene abierto cada ventana**.
//!
//! > [!danger] Un vault no se abre en dos ventanas a la vez
//! > Cada ventana abre el índice SQLite de su vault y lanza su propio watcher
//! > sobre la misma carpeta. Dos ventanas sobre el mismo vault serían dos
//! > indexadores escribiendo el mismo índice y dos watchers reaccionando a los
//! > escritos del otro. En vez de intentar coordinarlos —que es un problema de
//! > concurrencia real, no un detalle de UI— se impide: si el vault ya está
//! > abierto, se levanta esa ventana.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Qué vault tiene abierto cada ventana: etiqueta → ruta de la carpeta.
///
/// Desde `DEF-161` es además **la fuente de verdad de la base** de todos los
/// comandos que tocan el vault: el frontend sigue mandando la ruta, pero Rust la
/// compara con la de esta tabla (ver [`vault_de`]) y usa la suya. La cadena
/// guardada es la **registrada** en `vaults.json`, no la que mandó JS.
#[derive(Default)]
pub struct VentanasState(pub Mutex<HashMap<String, String>>);

/// Comparación de rutas tolerante a mayúsculas y a las barras de Windows: la
/// misma carpeta escrita de dos formas sigue siendo la misma carpeta.
fn misma_ruta(a: &str, b: &str) -> bool {
    mycelium_vault::rutas::misma_ruta(a, b)
}

/// `true` si `a` y `b` son la misma carpeta: misma escritura (normalizada) o,
/// si no, el mismo destino una vez que el sistema resuelve enlaces y `..`.
fn misma_carpeta(a: &str, b: &str) -> bool {
    if misma_ruta(a, b) {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// La carpeta del vault de la ventana `label`, **si** `pedida` es esa carpeta
/// (`DEF-161`).
///
/// Es la defensa que faltaba: `ruta_segura` solo validaba la parte relativa, y
/// la base llegaba de JS con un `is_dir()` como único control, así que un XSS
/// en la webview podía leer y escribir cualquier carpeta del disco pasándola
/// como «vault». Ahora la base es la que esta ventana registró al abrir el
/// vault (`registrar_vault`, que solo acepta carpetas de `vaults.json`).
///
/// Por qué **comparar** y no ignorar lo que manda JS: el frontend tiene
/// escrituras diferidas (las preferencias se guardan 400 ms después) que pueden
/// dispararse después de cambiar de vault en la misma ventana. Si Rust derivara
/// la base sin mirar, esa escritura caería en el vault NUEVO; con la
/// comparación se rechaza, que es lo correcto.
pub fn vault_de(state: &VentanasState, label: &str, pedida: &str) -> Result<String, String> {
    let mapa = state.0.lock().map_err(|_| "Registro de ventanas no disponible".to_string())?;
    validar_base(&mapa, label, pedida)
}

/// Lógica pura de [`vault_de`], para los tests.
fn validar_base(mapa: &HashMap<String, String>, label: &str, pedida: &str) -> Result<String, String> {
    let Some(registrada) = mapa.get(label) else {
        return Err("Esta ventana no tiene ningún vault abierto.".to_string());
    };
    if !misma_carpeta(registrada, pedida) {
        return Err(format!("«{pedida}» no es el vault abierto en esta ventana."));
    }
    Ok(registrada.clone())
}

/// Atajo para los comandos: la carpeta del vault de `ventana`, comprobada
/// contra la que pidió el frontend. Ver [`vault_de`].
pub fn base_de_ventana<R: tauri::Runtime>(ventana: &tauri::Window<R>, pedida: &str) -> Result<String, String> {
    vault_de(&ventana.state::<VentanasState>(), ventana.label(), pedida)
}

/// La carpeta del vault de `ventana`, sin compararla con nada: para los comandos
/// que no reciben la ruta (la terminal, que solo la usa para acotar el cwd).
pub fn vault_de_ventana<R: tauri::Runtime>(ventana: &tauri::Window<R>) -> Option<String> {
    ventana.state::<VentanasState>().0.lock().ok()?.get(ventana.label()).cloned()
}

/// La entrada de `vaults.json` que corresponde a `ruta` (`DEF-161`): solo se
/// puede abrir como vault una carpeta que el usuario vinculó, y vincular pasa
/// por el selector de carpetas nativo abierto desde Rust (`dialogos.rs`).
/// Devuelve la cadena **registrada**, que es la que nombra el índice y el canal
/// del MCP (`mycelium_vault::rutas`).
pub fn vault_conocido(config: &Path, ruta: &str) -> Result<String, String> {
    let reg = mycelium_vault::registro::leer_registro(config);
    let entrada = reg
        .entrada(ruta)
        .ok_or_else(|| format!("«{ruta}» no es un vault vinculado: elegilo con «Abrir carpeta como vault»."))?;
    if !Path::new(&entrada.ruta).is_dir() {
        return Err(format!("La carpeta del vault no existe: {}", entrada.ruta));
    }
    Ok(entrada.ruta.clone())
}

/// Dónde está `vaults.json` para esta app.
pub fn config_vaults<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?
        .join(mycelium_vault::registro::ARCHIVO))
}

/// Etiqueta de la ventana que tiene abierto ese vault, si alguna.
fn ventana_con(state: &VentanasState, ruta: &str) -> Option<String> {
    let mapa = state.0.lock().ok()?;
    mapa.iter()
        .find(|(_, abierta)| misma_ruta(abierta, ruta))
        .map(|(label, _)| label.clone())
}

/// Anota que esta ventana abrió ese vault. Falla si lo tiene **otra**, para que
/// el frontend pueda decirlo en vez de terminar con dos índices sobre la misma
/// carpeta.
///
/// Además **abre el protocolo `asset:` sobre esa carpeta** (`FUN-L-11`): es lo
/// que deja que el visor pinte un PDF o una imagen del vault con una URL, en vez
/// de traerse los bytes por IPC. El ámbito se declara acá y no en
/// `tauri.conf.json` porque la carpeta la elige el usuario en tiempo de
/// ejecución; y se acota a **esa** carpeta a propósito: abrirlo entero
/// equivaldría a dejar que cualquier página del webview lea el disco.
///
/// > [!info] El ámbito es de la app, no de la ventana
/// > Con varios vaults abiertos (`FUN-L-16`) quedan permitidas todas sus
/// > carpetas, no solo la de esta ventana. Es aceptable —siguen siendo carpetas
/// > que el usuario abrió— y la alternativa (revocar al cerrar) no existe: el
/// > `forbid` del scope tiene prioridad sobre el `allow`, así que prohibir una
/// > carpeta al cerrarla impediría volver a abrirla en toda la corrida.
#[tauri::command]
pub fn registrar_vault(
    ventana: tauri::Window,
    state: tauri::State<VentanasState>,
    ruta: String,
) -> Result<(), String> {
    // Solo un vault vinculado (`DEF-161`): abrir el asset scope —recursivo— y
    // dejar operar a todos los comandos sobre una carpeta que eligió JS era
    // entregarle el disco a cualquier XSS.
    let ruta = vault_conocido(&config_vaults(ventana.app_handle())?, &ruta)?;
    let propia = ventana.label().to_string();
    if let Some(otra) = ventana_con(&state, &ruta) {
        if otra != propia {
            return Err("Ese vault ya está abierto en otra ventana.".to_string());
        }
    }
    ventana
        .app_handle()
        .asset_protocol_scope()
        .allow_directory(&ruta, true)
        .map_err(|e| format!("No se pudo habilitar el acceso a la carpeta del vault: {e}"))?;
    state
        .0
        .lock()
        .map_err(|_| "Registro de ventanas no disponible".to_string())?
        .insert(propia.clone(), ruta.clone());
    // Las DevTools de esta ventana, según lo que esta máquina decidió para ESTE
    // vault (`devtools.rs`): encendidas en otro vault no cuentan acá.
    let devtools = crate::config_local::de_ventana(ventana.app_handle(), &propia).devtools;
    crate::devtools::al_registrar_vault(ventana.app_handle(), &propia, devtools);
    Ok(())
}

/// Suelta el vault de esta ventana (al salir del vault). Apaga también su
/// escucha del MCP de control (`FUN-L-09`): sin vault no hay nada que operar,
/// y el canal lleva el nombre del vault que se deja.
#[tauri::command]
pub fn soltar_vault(
    ventana: tauri::Window,
    state: tauri::State<VentanasState>,
    control: tauri::State<crate::control::ControlState>,
) {
    soltar_de(&state, ventana.label());
    crate::control::detener_de(&control, ventana.label());
    // Sin vault, sin DevTools (salvo en desarrollo).
    crate::devtools::al_soltar_vault(ventana.app_handle(), ventana.label());
}

/// Suelta el vault de una ventana por su etiqueta. Lo usa además el cierre de
/// ventana, donde ya no hay un `Window` del que partir.
pub fn soltar_de(state: &VentanasState, label: &str) {
    if let Ok(mut mapa) = state.0.lock() {
        mapa.remove(label);
    }
}

/// Abre `ruta` en una ventana nueva, o levanta la que ya lo tenga.
///
/// El vault viaja en la URL (`?vault=…`) y no en un estado compartido: la
/// ventana nueva arranca con su `sessionStorage` vacío y tiene que saber por sí
/// misma qué abrir. Devuelve `true` si se creó una ventana, `false` si se
/// enfocó una existente — al frontend le sirve para decidir qué contar.
/// > [!danger] Tiene que ser `async`, y no es un detalle de estilo
/// > `WebviewWindowBuilder::build()` **se bloquea en Windows si se lo llama
/// > desde un comando síncrono** — está escrito en la documentación de Tauri
/// > (`webview_window.rs:115`), y es un problema de WebView2, no de Tauri. Los
/// > comandos síncronos corren en el hilo principal, que es el que atiende el
/// > bucle de eventos que la creación de la ventana necesita: se esperan
/// > mutuamente. El síntoma es exactamente el reportado en `DEF-073` — la
/// > ventana original se congela y la nueva queda en blanco. Un comando `async`
/// > corre fuera del hilo principal y no lo bloquea.
#[tauri::command]
pub async fn abrir_vault_en_ventana(
    app: AppHandle,
    state: tauri::State<'_, VentanasState>,
    ruta: String,
) -> Result<bool, String> {
    // Solo vaults vinculados (`DEF-161`): la ventana nueva lo rechazaría al
    // registrarlo, así que no tiene sentido abrirla para que falle.
    let ruta = vault_conocido(&config_vaults(&app)?, &ruta)?;
    if let Some(label) = ventana_con(&state, &ruta) {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.unminimize();
            let _ = win.set_focus();
            return Ok(false);
        }
        // La ventana ya no existe (se cerró sin avisar): se limpia y se sigue.
        soltar_de(&state, &label);
    }

    // La etiqueta empieza por `vault-` a propósito: la capability de
    // `capabilities/default.json` la lista como `vault-*`, y sin eso la ventana
    // nueva nacería sin permisos —ni SQL, ni diálogos— y no podría abrir nada.
    let label = format!("vault-{}", sufijo_unico());
    // La ruta del workspace NO es la misma en desarrollo que empaquetada, y hay
    // que distinguirlas o la ventana abre en blanco justo en uno de los dos:
    //
    //   - **Empaquetado**: `next build --output export` genera `out/workspace.html`
    //     suelto, no `out/workspace/index.html`, así que la ruta con barra no
    //     resuelve contra los assets.
    //   - **Desarrollo**: el servidor de Next sirve la RUTA `/workspace` y no
    //     conoce ningún `.html`, así que ahí pasa lo contrario.
    //
    // Nunca se había notado porque la ventana principal llega al workspace
    // navegando por el cliente, sin pedirle el archivo a nadie.
    let pagina = if tauri::is_dev() { "/workspace" } else { "workspace.html" };
    let destino = format!("{pagina}?vault={}", urlencode(&ruta));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(destino.into()))
        .title("Mycelium")
        // Sin la barra del sistema: el marco lo dibuja la app (FUN-M-31). La
        // sombra se mantiene para que la ventana siga despegada del fondo.
        .decorations(false)
        .shadow(true)
        // Igual que la ventana principal (`dragDropEnabled: false` en
        // tauri.conf.json): sin esto, el arrastre de archivos nativo de Tauri se
        // queda con los eventos de arrastrar y soltar del HTML, y las pestañas no
        // se pueden arrastrar para dividir la pantalla (`DEF-124`).
        .disable_drag_drop_handler()
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 480.0)
        .build()
        .map_err(|e| format!("No se pudo abrir la ventana: {e}"))?;
    Ok(true)
}

fn sufijo_unico() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

/// Codifica la ruta para que quepa en un query string. Se hace a mano —el juego
/// de caracteres es acotado y conocido— para no sumar una dependencia solo por
/// esto.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Limpieza al cerrarse una ventana: su watcher, sus terminales, su canal de
/// control (`FUN-L-09`) y su vault.
///
/// Sin esto, cerrar una ventana dejaría el vault marcado como abierto para
/// siempre —no se podría volver a abrir en ninguna— y sus shells corriendo sin
/// nadie que las lea.
pub fn al_cerrar(app: &AppHandle, label: &str) {
    crate::vault_watch::detener_de(&app.state::<crate::vault_watch::WatcherState>(), label);
    crate::terminal::cerrar_de_ventana(&app.state::<crate::terminal::TerminalesState>(), label);
    crate::control::detener_de(&app.state::<crate::control::ControlState>(), label);
    crate::dialogos::olvidar_de(&app.state::<crate::dialogos::ElegidasState>(), label);
    soltar_de(&app.state::<VentanasState>(), label);
}


/// Abre una ventana nueva en el selector de vaults, sin abrir ninguno.
///
/// Es lo que hace un segundo lanzamiento del ejecutable —doble clic en el
/// acceso directo con Mycelium ya abierto—: antes solo se levantaba la ventana
/// existente, que incumple lo que `FUN-L-16` prometía (`DEF-073`).
///
/// Se despacha al runtime asíncrono por lo mismo que el comando de arriba: el
/// callback de instancia única corre en el hilo principal, y `build()` ahí se
/// cuelga.
pub fn abrir_ventana_de_seleccion(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let label = format!("vault-{}", sufijo_unico());
        let pagina = if tauri::is_dev() { "/vaults" } else { "vaults.html" };
        let _ = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(pagina.into()))
            .title("Mycelium")
            .decorations(false)
            .shadow(true)
            // Mismo motivo que en `abrir_vault_en_ventana` (`DEF-124`).
            .disable_drag_drop_handler()
            .inner_size(1280.0, 800.0)
            .min_inner_size(640.0, 480.0)
            .build();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn misma_ruta_tolera_barras_y_mayusculas() {
        assert!(misma_ruta("C:\\Notas\\Vault", "c:/notas/vault"));
        assert!(misma_ruta("/home/x/vault/", "/home/x/vault"));
        assert!(!misma_ruta("C:/notas/a", "C:/notas/b"));
    }

    #[test]
    fn una_base_que_no_es_el_vault_de_la_ventana_se_rechaza() {
        let dir = std::env::temp_dir().join(format!("mic-ventanas-base-{}", std::process::id()));
        let otra = std::env::temp_dir().join(format!("mic-ventanas-otra-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::create_dir_all(&otra).unwrap();
        let v = dir.to_string_lossy().to_string();
        let mut mapa = HashMap::new();
        mapa.insert("vault-1".to_string(), v.clone());

        // La misma carpeta, escrita igual o de otra forma: vale, y se devuelve
        // la cadena registrada, no la pedida.
        assert_eq!(validar_base(&mapa, "vault-1", &v).unwrap(), v);
        assert_eq!(validar_base(&mapa, "vault-1", &v.to_uppercase()).unwrap(), v);
        assert_eq!(validar_base(&mapa, "vault-1", &format!("{v}/")).unwrap(), v);
        // Otra carpeta que existe: no.
        assert!(validar_base(&mapa, "vault-1", &otra.to_string_lossy()).is_err());
        // La raíz del disco: no.
        assert!(validar_base(&mapa, "vault-1", "C:/").is_err());
        assert!(validar_base(&mapa, "vault-1", "/").is_err());
        // Una subcarpeta del vault como base: no (la base es el vault entero).
        assert!(validar_base(&mapa, "vault-1", &dir.join("sub").to_string_lossy()).is_err());
        // Una ventana sin vault registrado: no, aunque la carpeta sea válida.
        assert!(validar_base(&mapa, "vault-2", &v).is_err());

        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(otra);
    }

    #[test]
    fn solo_se_registra_un_vault_vinculado() {
        let base = std::env::temp_dir().join(format!("mic-ventanas-reg-{}", std::process::id()));
        let vault = base.join("Vault");
        let intrusa = base.join("Intrusa");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&intrusa).unwrap();
        let config = base.join("vaults.json");
        let registro = serde_json::json!({
            "vaults": [{ "ruta": vault.to_string_lossy(), "nombre": "Vault" }],
            "abrirUltimo": false,
        });
        std::fs::write(&config, registro.to_string()).unwrap();

        let registrada = vault.to_string_lossy().to_string();
        assert_eq!(vault_conocido(&config, &registrada).unwrap(), registrada);
        // Otra escritura de la misma carpeta resuelve a la cadena registrada.
        assert_eq!(vault_conocido(&config, &registrada.to_uppercase()).unwrap(), registrada);
        // Una carpeta que existe pero nadie vinculó: no.
        assert!(vault_conocido(&config, &intrusa.to_string_lossy()).is_err());
        // Ni la raíz del disco.
        assert!(vault_conocido(&config, "C:/").is_err());
        assert!(vault_conocido(&config, "/").is_err());
        // Sin registro, nada.
        assert!(vault_conocido(&base.join("no-existe.json"), &registrada).is_err());
        // Vinculado pero borrado del disco: tampoco.
        std::fs::remove_dir_all(&vault).unwrap();
        assert!(vault_conocido(&config, &registrada).is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn urlencode_escapa_lo_que_rompe_una_url() {
        assert_eq!(urlencode("C:/Mis Notas"), "C%3A%2FMis%20Notas");
        assert_eq!(urlencode("simple-1.0_x~"), "simple-1.0_x~");
    }
}
