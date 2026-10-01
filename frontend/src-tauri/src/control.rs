//! La escucha del **MCP de control** en la app (`FUN-L-09`, Parte 1; spec en
//! `docs/features/mcp-control.md` § 2).
//!
//! Cada ventana con el control encendido abre un canal para **su** vault:
//! `\\.\pipe\mycelium-<hash>` en Windows (un socket en la carpeta de
//! configuración en el resto), con `<hash>` = `hashRuta` de la cadena
//! registrada en `vaults.json` — la misma que nombra `index-<hash>.db`. Por
//! ahí llegan los pedidos del servidor `mycelium-mcp`, una línea JSON cada uno.
//!
//! Rust **no** sabe hacer ninguna operación: le pasa el pedido al frontend de
//! esa ventana (evento `mcp-pedido`), espera su respuesta (comando
//! `mcp_responder`) y la devuelve por el canal. La lógica vive en
//! `lib/mcpControl.ts`, donde ya están los stores. Si el frontend no contesta
//! en [`ESPERA_VENTANA`], se responde `OCUPADA`: el servidor nunca se queda
//! esperando.
//!
//! > [!info] Por ventana, como el watcher
//! > El mapa va por etiqueta de ventana y se limpia al soltar el vault y al
//! > cerrar la ventana (`ventanas::al_cerrar`). Un escuchador global sería el
//! > cuarto defecto de «estado global que en realidad es de una ventana»
//! > (`docs/features/ventanas-multiples.md`).
//!
//! > [!warning] Seguridad: el límite, dicho sin adornos
//! > El pipe se crea con un descriptor de seguridad **explícito** que solo
//! > deja entrar al usuario actual (el DACL por defecto de un pipe le da
//! > lectura a Everyone y a los anónimos) y **rechaza clientes remotos**. Es
//! > un límite real entre usuarios de la máquina, y un navegador no lo
//! > alcanza. Pero **cualquier proceso que corra como este usuario puede
//! > hablarle**: es la misma confianza que ya tiene para escribir el vault. Lo
//! > que acota el daño es lo que las herramientas no hacen, no la autenticación.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use mycelium_vault::canal::{self, codigo, ESPERA_VENTANA};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, watch};

/// Evento con el que el pedido llega al frontend de la ventana.
const EVENTO_PEDIDO: &str = "mcp-pedido";

/// Tope de una línea de pedido. Los pedidos reales ocupan unos cientos de
/// bytes; esto solo evita que un cliente sin salto de línea llene la memoria.
const TOPE_LINEA: usize = 64 * 1024;

/// Un pedido esperando la respuesta del frontend.
struct Pendiente {
    /// Etiqueta de la ventana a la que se le pidió: solo ella puede contestar.
    ventana: String,
    respuesta: oneshot::Sender<Value>,
}

/// La escucha de una ventana.
struct Escucha {
    canal: PathBuf,
    /// Al pasar a `true`, se cierran el bucle de aceptación y las conexiones.
    parar: watch::Sender<bool>,
}

#[derive(Default)]
struct Interior {
    escuchas: Mutex<HashMap<String, Escucha>>,
    pendientes: Mutex<HashMap<String, Pendiente>>,
    contador: AtomicU64,
}

/// Estado del control: las escuchas por ventana y los pedidos en vuelo.
#[derive(Default, Clone)]
pub struct ControlState(Arc<Interior>);

/// Lo que necesita una conexión para atender pedidos.
#[derive(Clone)]
struct Contexto {
    app: AppHandle,
    estado: ControlState,
    ventana: String,
    /// La cadena registrada del vault de la ventana.
    vault: String,
    /// Un pedido a la vez por ventana: un agente que abre seis notas en
    /// paralelo no puede dejar el `tabsStore` en un estado que nadie diseñó.
    turno: Arc<tokio::sync::Mutex<()>>,
}

// ── Comandos ────────────────────────────────────────────────────────────────

/// Enciende la escucha de ESTA ventana para el vault `ruta` (reemplaza la que
/// tuviera). Devuelve el nombre del canal.
///
/// Es `async` porque el pipe se registra en el runtime de tokio, que solo
/// está a mano fuera del hilo principal.
#[tauri::command]
pub async fn mcp_control_encender(
    ventana: tauri::Window,
    state: tauri::State<'_, ControlState>,
    ruta: String,
) -> Result<String, String> {
    let app = ventana.app_handle().clone();
    let etiqueta = ventana.label().to_string();
    let dir_app = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver el config-dir: {e}"))?;
    let vault = ruta_registrada(&dir_app, &ruta);
    let canal = canal::nombre_canal(&vault, &dir_app);

    detener_de(&state, &etiqueta);
    let (parar, al_parar) = watch::channel(false);
    // Al reencender (recargar la ventana, cambiar de vault y volver) las
    // instancias de la escucha anterior se sueltan en sus tareas, un instante
    // después: mientras tanto el nombre sigue tomado y `first_pipe_instance`
    // falla. Se reintenta un segundo; si sigue tomado, lo tiene OTRO proceso
    // (la Mycelium de desarrollo y la instalada con el mismo vault, por ejemplo).
    let mut intentos = 0;
    let primera = loop {
        match plataforma::crear(&canal, true) {
            Ok(s) => break s,
            Err(_) if intentos < 20 => {
                intentos += 1;
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(e) => {
                return Err(format!(
                    "No se pudo abrir el canal de control ({}): {e}. ¿Hay otra Mycelium con este vault abierto?",
                    canal.display()
                ))
            }
        }
    };
    let ctx = Contexto {
        app,
        estado: state.inner().clone(),
        ventana: etiqueta.clone(),
        vault,
        turno: Arc::new(tokio::sync::Mutex::new(())),
    };
    tauri::async_runtime::spawn(plataforma::aceptar(primera, canal.clone(), ctx, al_parar));
    state
        .0
        .escuchas
        .lock()
        .map_err(|_| "Estado del control no disponible".to_string())?
        .insert(etiqueta, Escucha { canal: canal.clone(), parar });
    Ok(canal.to_string_lossy().to_string())
}

/// Apaga la escucha de ESTA ventana (no hace nada si no había).
#[tauri::command]
pub fn mcp_control_apagar(ventana: tauri::Window, state: tauri::State<'_, ControlState>) {
    detener_de(&state, ventana.label());
}

/// La respuesta del frontend a un pedido. Solo cuenta si la manda la ventana
/// a la que se le pidió; un id desconocido (el pedido ya venció) se ignora.
#[tauri::command]
pub fn mcp_responder(
    ventana: tauri::Window,
    state: tauri::State<'_, ControlState>,
    id: String,
    respuesta: Value,
) {
    let Ok(mut pendientes) = state.0.pendientes.lock() else { return };
    if pendientes.get(&id).is_some_and(|p| p.ventana == ventana.label()) {
        if let Some(p) = pendientes.remove(&id) {
            let _ = p.respuesta.send(respuesta);
        }
    }
}

/// Dónde está el binario del servidor MCP, para escribirlo en `.mcp.json`.
#[derive(serde::Serialize)]
pub struct BinarioMcp {
    pub ruta: String,
    pub existe: bool,
}

/// El servidor MCP va **junto al ejecutable**: instalado, Tauri copia el
/// sidecar (`bundle.externalBin`) al lado de `Mycelium.exe`; en desarrollo,
/// `tauri-build` lo copia a `target/<perfil>/`, que es donde está `app.exe`.
#[tauri::command]
pub fn mcp_ruta_binario() -> Result<BinarioMcp, String> {
    let exe = std::env::current_exe().map_err(|e| format!("No se pudo ubicar el ejecutable: {e}"))?;
    let dir = exe.parent().ok_or("El ejecutable no tiene carpeta")?;
    let ruta = dir.join(if cfg!(windows) { "mycelium-mcp.exe" } else { "mycelium-mcp" });
    // Un archivo vacío es el marcador que deja `build.rs` cuando se compila sin
    // preparar el sidecar: existe, pero no sirve.
    let existe = std::fs::metadata(&ruta).map(|m| m.is_file() && m.len() > 0).unwrap_or(false);
    Ok(BinarioMcp { ruta: ruta.to_string_lossy().to_string(), existe })
}

/// Borra el `.mcp.json` de la raíz del vault. Solo ese archivo: el frontend
/// lo pide cuando, al apagar el control, quedó vacío y lo había creado
/// Mycelium. Que no exista no es un error.
#[tauri::command]
pub fn mcp_config_borrar(vault_ruta: String) -> Result<(), String> {
    let archivo = Path::new(&vault_ruta).join(".mcp.json");
    match std::fs::remove_file(&archivo) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("No se pudo borrar {}: {e}", archivo.display())),
    }
}

/// Apaga la escucha de una ventana por su etiqueta. La usan el comando de
/// apagar, `soltar_vault` y el cierre de la ventana.
pub fn detener_de(state: &ControlState, etiqueta: &str) {
    let escucha = state.0.escuchas.lock().ok().and_then(|mut m| m.remove(etiqueta));
    if let Some(e) = escucha {
        let _ = e.parar.send(true);
        plataforma::despertar(&e.canal);
    }
    // Lo que esa ventana tenía en vuelo ya no va a contestar.
    if let Ok(mut p) = state.0.pendientes.lock() {
        p.retain(|_, v| v.ventana != etiqueta);
    }
}

/// La cadena **registrada** del vault (`vaults.json`) que corresponde a
/// `ruta`; si no está registrada, `ruta` tal cual. Es lo que se hashea: el
/// servidor resuelve su vault contra el registro y hashea esa cadena, así que
/// si la ventana hasheara otra escritura de la misma carpeta, nunca se
/// encontrarían.
fn ruta_registrada(dir_app: &Path, ruta: &str) -> String {
    let reg = mycelium_vault::registro::leer_registro(&dir_app.join(mycelium_vault::registro::ARCHIVO));
    reg.entrada(ruta).map(|v| v.ruta.clone()).unwrap_or_else(|| ruta.to_string())
}

// ── Atender una conexión ────────────────────────────────────────────────────

/// Lee pedidos de una conexión hasta que se cierra o se apaga el control.
async fn atender<S>(flujo: S, ctx: Contexto, mut al_parar: watch::Receiver<bool>)
where
    S: tokio::io::AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (lectura, mut escritura) = tokio::io::split(flujo);
    let mut lector = BufReader::new(lectura);
    let mut linea = String::new();
    loop {
        linea.clear();
        let mut limitado = (&mut lector).take(TOPE_LINEA as u64);
        let leido = tokio::select! {
            r = limitado.read_line(&mut linea) => r,
            _ = al_parar.changed() => return,
        };
        match leido {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if linea.trim().is_empty() {
            continue;
        }
        let respuesta = procesar(&ctx, linea.trim()).await;
        let mut texto = respuesta.to_string();
        texto.push('\n');
        if escritura.write_all(texto.as_bytes()).await.is_err() || escritura.flush().await.is_err() {
            return;
        }
    }
}

/// Un pedido → su respuesta, con el `id` del pedido.
async fn procesar(ctx: &Contexto, linea: &str) -> Value {
    let pedido: Value = match serde_json::from_str(linea) {
        Ok(v) => v,
        Err(e) => return canal::error(&Value::Null, codigo::INVALIDO, &format!("JSON inválido: {e}"), Value::Null),
    };
    let id = pedido.get("id").cloned().unwrap_or(Value::Null);
    let Some(op) = pedido.get("op").and_then(Value::as_str) else {
        return canal::error(&id, codigo::INVALIDO, "falta `op`", Value::Null);
    };
    // El cliente declara a qué vault cree que le habla: protege contra un pipe
    // viejo o un cliente configurado con otro vault (spec de septiembre § 3.4).
    if let Some(declarado) = pedido.get("vault").and_then(Value::as_str) {
        if !mycelium_vault::rutas::misma_ruta(declarado, &ctx.vault) {
            return canal::error(
                &id,
                codigo::VAULT_DESCONOCIDO,
                "Esta ventana de Mycelium tiene abierto otro vault.",
                json!({ "pedido": declarado, "ventana": ctx.vault }),
            );
        }
    }
    let args = pedido.get("args").cloned().unwrap_or_else(|| json!({}));
    if op == "ping" {
        return canal::ok(&id, json!({ "vault": ctx.vault }));
    }

    let _turno = ctx.turno.lock().await;
    let interno = format!("{}-{}", ctx.ventana, ctx.estado.0.contador.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    if let Ok(mut p) = ctx.estado.0.pendientes.lock() {
        p.insert(interno.clone(), Pendiente { ventana: ctx.ventana.clone(), respuesta: tx });
    }
    let emitido = ctx.app.emit_to(
        ctx.ventana.as_str(),
        EVENTO_PEDIDO,
        json!({ "id": interno, "op": op, "args": args, "vault": ctx.vault }),
    );
    let resultado = if emitido.is_err() {
        None
    } else {
        tokio::time::timeout(ESPERA_VENTANA, rx).await.ok().and_then(Result::ok)
    };
    if let Ok(mut p) = ctx.estado.0.pendientes.lock() {
        p.remove(&interno);
    }
    match resultado {
        Some(r) => armar_respuesta(&id, r),
        None => canal::error(
            &id,
            codigo::OCUPADA,
            "La ventana de Mycelium no contestó a tiempo (puede estar recargándose, con un diálogo abierto o trabada).",
            json!({ "etapa": "sin respuesta de la ventana", "reintentar_en_ms": 2000 }),
        ),
    }
}

/// La respuesta del frontend (`{ok, resultado}` o `{ok: false, error}`) con
/// el `id` del pedido. Lo que no tenga esa forma es un error del frontend, y
/// se dice como tal en vez de reenviarlo.
fn armar_respuesta(id: &Value, r: Value) -> Value {
    match r.get("ok").and_then(Value::as_bool) {
        Some(true) => canal::ok(id, r.get("resultado").cloned().unwrap_or(Value::Null)),
        Some(false) => {
            let e = r.get("error").cloned().unwrap_or(Value::Null);
            canal::error(
                id,
                e.get("codigo").and_then(Value::as_str).unwrap_or(codigo::INVALIDO),
                e.get("mensaje").and_then(Value::as_str).unwrap_or("error sin detalle"),
                e.get("datos").cloned().unwrap_or(Value::Null),
            )
        }
        None => canal::error(id, codigo::INVALIDO, "La ventana respondió algo que no es del protocolo.", r),
    }
}

// ── El canal, por plataforma ────────────────────────────────────────────────

#[cfg(windows)]
mod plataforma {
    use super::*;
    use std::sync::OnceLock;
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// El SID del usuario que corre la app, en texto (`S-1-5-21-…`).
    fn sid_del_usuario() -> std::io::Result<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
            let mut largo = 0u32;
            // La primera llamada solo informa el tamaño (y "falla" por eso).
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut largo);
            let mut buf = vec![0u8; largo as usize];
            let r = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr().cast()), largo, &mut largo);
            let _ = CloseHandle(token);
            r?;
            let usuario = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut texto = PWSTR::null();
            ConvertSidToStringSidW(usuario.User.Sid, &mut texto)?;
            let sid = texto.to_string().map_err(|e| std::io::Error::other(e.to_string()));
            let _ = LocalFree(Some(HLOCAL(texto.0.cast())));
            sid
        }
    }

    /// El DACL del canal en SDDL: **protegido** (no hereda nada) y con una sola
    /// entrada, acceso total para el usuario actual. Sin esto, Windows aplica el
    /// DACL por defecto de un pipe, que da lectura a Everyone y a Anonymous.
    fn sddl() -> std::io::Result<&'static str> {
        static SDDL: OnceLock<String> = OnceLock::new();
        if let Some(s) = SDDL.get() {
            return Ok(s);
        }
        let s = format!("D:P(A;;GA;;;{})", sid_del_usuario()?);
        Ok(SDDL.get_or_init(|| s))
    }

    /// Crea una instancia del pipe. La primera con `first_pipe_instance`: si
    /// otro proceso ya tiene ese nombre (un intruso que se adelantó, u otra
    /// Mycelium), falla en vez de compartirlo.
    pub fn crear(canal: &Path, primera: bool) -> std::io::Result<NamedPipeServer> {
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                &HSTRING::from(sddl()?),
                SDDL_REVISION_1,
                &mut sd,
                None,
            )?;
        }
        let mut atributos = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: false.into(),
        };
        let r = unsafe {
            ServerOptions::new()
                .first_pipe_instance(primera)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(canal, (&mut atributos as *mut SECURITY_ATTRIBUTES).cast())
        };
        unsafe {
            let _ = LocalFree(Some(HLOCAL(sd.0)));
        }
        r
    }

    /// Acepta conexiones hasta que se apague. Cada conexión aceptada se
    /// atiende en su tarea y se deja lista la instancia siguiente **antes**,
    /// para que no haya un instante sin pipe en el que el cliente vea «nadie
    /// escucha».
    pub async fn aceptar(
        mut servidor: NamedPipeServer,
        canal: PathBuf,
        ctx: Contexto,
        mut al_parar: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                r = servidor.connect() => {
                    if *al_parar.borrow() {
                        return;
                    }
                    if r.is_err() {
                        // La instancia quedó inservible: se cambia por otra.
                        match crear(&canal, false) {
                            Ok(s) => { servidor = s; continue; }
                            Err(_) => return,
                        }
                    }
                    let siguiente = match crear(&canal, false) {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    let conectado = std::mem::replace(&mut servidor, siguiente);
                    tauri::async_runtime::spawn(atender(conectado, ctx.clone(), al_parar.clone()));
                }
                _ = al_parar.changed() => return,
            }
        }
    }

    /// Nada que hacer: la tarea sale por `al_parar` y soltar las instancias
    /// borra el nombre.
    pub fn despertar(_canal: &Path) {}

    #[cfg(test)]
    pub fn sddl_para_test() -> String {
        sddl().unwrap().to_string()
    }
}

#[cfg(unix)]
mod plataforma {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;

    /// En Unix el «canal» es un socket en la carpeta de configuración del
    /// usuario, con modo `0600`. Se borra uno viejo (de una corrida que murió)
    /// antes de crearlo.
    pub fn crear(canal: &Path, _primera: bool) -> std::io::Result<UnixListener> {
        if let Some(dir) = canal.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let _ = std::fs::remove_file(canal);
        let oyente = UnixListener::bind(canal)?;
        std::fs::set_permissions(canal, std::fs::Permissions::from_mode(0o600))?;
        Ok(oyente)
    }

    pub async fn aceptar(oyente: UnixListener, canal: PathBuf, ctx: Contexto, mut al_parar: watch::Receiver<bool>) {
        loop {
            tokio::select! {
                r = oyente.accept() => {
                    let Ok((flujo, _)) = r else { continue };
                    tauri::async_runtime::spawn(atender(flujo, ctx.clone(), al_parar.clone()));
                }
                _ = al_parar.changed() => break,
            }
        }
        // El archivo NO se borra acá: lo borra `despertar` al apagar, y para
        // cuando esta tarea termina puede haber ya un socket nuevo con el mismo
        // nombre (reencender), que no hay que llevarse por delante.
        let _ = canal;
    }

    /// Quita el socket al apagar: sin archivo, el cliente ve «nadie escucha».
    pub fn despertar(canal: &Path) {
        let _ = std::fs::remove_file(canal);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_respuesta_del_frontend_lleva_el_id_del_pedido() {
        let id = json!(42);
        let r = armar_respuesta(&id, json!({"ok": true, "resultado": {"panel": 1}}));
        assert_eq!(r, json!({"id": 42, "ok": true, "resultado": {"panel": 1}}));

        let r = armar_respuesta(
            &id,
            json!({"ok": false, "error": {"codigo": "AMBIGUO", "mensaje": "dos", "datos": {"rutas": ["a", "b"]}}}),
        );
        assert_eq!(r["id"], 42);
        assert_eq!(r["error"]["codigo"], "AMBIGUO");
        assert_eq!(r["error"]["datos"]["rutas"][1], "b");
    }

    #[test]
    fn una_respuesta_sin_forma_es_invalida() {
        let r = armar_respuesta(&json!(1), json!("cualquier cosa"));
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"]["codigo"], "INVALIDO");
    }

    #[test]
    fn el_canal_se_nombra_con_la_cadena_registrada() {
        let dir = std::env::temp_dir().join(format!("mic-control-reg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("vaults.json"),
            r#"{"vaults":[{"ruta":"C:\\Notas\\Vault","nombre":"Vault"}],"abrirUltimo":false}"#,
        )
        .unwrap();
        // Otra escritura de la misma carpeta llega a la cadena registrada…
        assert_eq!(ruta_registrada(&dir, "c:/notas/vault/"), "C:\\Notas\\Vault");
        // …y una carpeta sin registrar se usa tal cual.
        assert_eq!(ruta_registrada(&dir, "D:\\Otra"), "D:\\Otra");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn el_descriptor_es_solo_del_usuario_actual() {
        let s = plataforma_sddl();
        assert!(s.starts_with("D:P(A;;GA;;;S-1-5-"), "{s}");
        assert!(!s.contains("WD") && !s.contains("AN"), "ni Everyone ni anónimos: {s}");
    }

    #[cfg(windows)]
    fn plataforma_sddl() -> String {
        // `sddl` es privada del módulo de plataforma; se prueba creando una
        // instancia de verdad dentro de un runtime y leyendo el SDDL cacheado.
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let canal = canal::nombre_canal(&format!("prueba-sddl-{}", std::process::id()), Path::new("."));
        rt.block_on(async {
            let _servidor = plataforma::crear(&canal, true).expect("crear el pipe con el descriptor");
            // El usuario actual tiene que poder entrar: un DACL mal armado
            // dejaría el pipe cerrado para todos, también para el MCP.
            std::fs::OpenOptions::new().read(true).write(true).open(&canal).expect("el usuario actual entra");
            // Y nadie más puede crear otra «primera» instancia con ese nombre.
            assert!(plataforma::crear(&canal, true).is_err(), "first_pipe_instance");
        });
        plataforma::sddl_para_test()
    }
}
