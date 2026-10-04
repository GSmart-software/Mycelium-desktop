//! Acceso nativo al sistema de archivos para recorrer y leer el vault (el
//! indexador, el explorador y el visor de archivos no indexados) y para
//! exportar/importar contra una carpeta real del SO.
//!
//! La E/S se hace aquí (Rust) y NO con `tauri-plugin-fs` desde JS: el scope del
//! plugin fs en Tauri v2 no cubre bien rutas arbitrarias elegidas por el usuario
//! en tiempo de ejecución. Desde Rust el acceso es directo y la superficie queda
//! acotada a los comandos `#[tauri::command]` de este módulo, registrados uno a
//! uno en `lib.rs`. Del lado JS solo se usa el plugin `dialog` para los
//! selectores de carpeta.

use std::path::{Component, Path, PathBuf};

/// Archivo que el frontend quiere escribir dentro de la carpeta destino.
#[derive(serde::Deserialize)]
pub struct ArchivoExport {
    pub ruta_relativa: String,
    pub contenido: String,
}

/// Archivo leído del vault, con su ruta relativa.
///
/// Sin `rename_all`, a diferencia de `ArchivoMeta`: la devuelve `leer_archivos`
/// y el indexador la lee en `snake_case`. Renombrarla obliga a tocar los dos
/// lados. (Hasta `FUN-M-40` también la devolvía el walker de la importación,
/// reemplazado por `copiar_arbol`.)
#[derive(serde::Serialize)]
pub struct ArchivoLeido {
    pub ruta_relativa: String,
    pub contenido: String,
}

/// Archivo del vault con los metadatos que el índice derivado necesita para la
/// validación incremental por `mtime` (fase 2 del "vault en carpeta").
///
/// **Sin `contenido` a propósito** (FUN-M-12): el indexador compara `mtime` y
/// recién entonces pide el texto de lo que cambió, con `leer_archivos`. Antes
/// esta estructura llevaba el contenido de TODOS los archivos y se descartaba
/// casi entero en cada apertura (14 MB por IPC en un vault sobre un repo).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivoMeta {
    pub ruta_relativa: String,
    /// Fecha de modificación en milisegundos epoch (de `metadata().modified()`).
    pub mtime: i64,
    /// `"excalidraw"` para `.excalidraw`, `"base"` para `.base`, `"canvas"` para
    /// `.canvas`, `"drawio"` para `.drawio`, `"markdown"` para el resto.
    pub tipo: String,
}

/// Tipo de nota según la extensión (espeja `notas.tipo` del índice/esquema).
fn tipo_de(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("excalidraw") => "excalidraw".to_string(),
        // Bases (`FUN-L-03`) y canvas (`FUN-L-18`): las extensiones son las de
        // Obsidian, para que el vault siga siendo intercambiable.
        Some(ext) if ext.eq_ignore_ascii_case("base") => "base".to_string(),
        Some(ext) if ext.eq_ignore_ascii_case("canvas") => "canvas".to_string(),
        // Diagramas de draw.io (`FUN-L-20`): XML de mxGraph. La extensión es la
        // nativa de la herramienta, para que el archivo se abra en cualquier
        // draw.io de afuera.
        Some(ext) if ext.eq_ignore_ascii_case("drawio") => "drawio".to_string(),
        _ => "markdown".to_string(),
    }
}

/// `mtime` en milisegundos epoch (0 si el SO no lo expone). `pub(crate)` porque
/// `vault_fs::escribir_nota` devuelve el del archivo recién escrito, y tiene que
/// ser el MISMO cálculo que hace el recorrido del índice para que coincidan.
pub(crate) fn mtime_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Extensiones que se importan como notas del vault.
pub(crate) fn es_importable(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            ext == "md"
                || ext == "excalidraw"
                || ext == "base"
                || ext == "canvas"
                || ext == "drawio"
        }
        None => false,
    }
}

/// ¿El nombre de archivo es un temporal conocido que nadie quiere ver en el
/// explorador (`DEF-127`)? Bloqueos de Office (`~$informe.docx`) y de
/// LibreOffice (`.~lock.planilla.ods#`), `*.tmp`, y las descargas a medias de
/// los navegadores y clientes de sincronización (`*.crdownload`, `*.part`).
///
/// Lo usan el watcher —para que su ida y vuelta no dispare reindexados— y el
/// recorrido del vault, para no listarlos: si el recorrido los mostrara y el
/// watcher no avisara al borrarse, quedarían en el explorador hasta el
/// siguiente reindexado.
pub(crate) fn es_temporal(nombre: &str) -> bool {
    let minus = nombre.to_ascii_lowercase();
    nombre.starts_with("~$")
        || (nombre.starts_with(".~lock.") && nombre.ends_with('#'))
        || minus.ends_with(".tmp")
        || minus.ends_with(".crdownload")
        || minus.ends_with(".part")
}

/// Resuelve `relativa` dentro de `base` rechazando cualquier intento de salirse
/// (`..`, rutas absolutas, prefijos de unidad en Windows). Es la defensa contra
/// path traversal: el frontend arma las rutas a partir de títulos del usuario.
/// `pub(crate)` para reutilizarla desde `vault_fs` (mutaciones a disco, fase 4).
pub(crate) fn ruta_segura(base: &Path, relativa: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relativa);
    let mut destino = base.to_path_buf();

    for comp in rel.components() {
        match comp {
            Component::Normal(seg) => destino.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Ruta no permitida: {relativa}"));
            }
        }
    }

    if !destino.starts_with(base) {
        return Err(format!("Ruta fuera de la carpeta destino: {relativa}"));
    }
    Ok(destino)
}

/// Escribe los archivos del vault dentro de `destino`, creando los subdirectorios
/// necesarios. Devuelve cuántos archivos se escribieron. Los archivos existentes
/// con el mismo nombre se sobrescriben (la confirmación la pide la UI).
#[tauri::command]
pub fn exportar_a_carpeta(destino: String, archivos: Vec<ArchivoExport>) -> Result<usize, String> {
    let base = PathBuf::from(&destino);
    if !base.is_dir() {
        return Err(format!("La carpeta destino no existe: {destino}"));
    }

    let mut escritos = 0usize;
    for archivo in &archivos {
        let ruta = ruta_segura(&base, &archivo.ruta_relativa)?;
        if let Some(padre) = ruta.parent() {
            std::fs::create_dir_all(padre)
                .map_err(|e| format!("No se pudo crear {}: {e}", padre.display()))?;
        }
        std::fs::write(&ruta, archivo.contenido.as_bytes())
            .map_err(|e| format!("No se pudo escribir {}: {e}", ruta.display()))?;
        escritos += 1;
    }
    Ok(escritos)
}

/// Ruta relativa POSIX de `ruta` respecto de `base`.
fn rel_posix(base: &Path, ruta: &Path) -> Result<String, String> {
    Ok(ruta
        .strip_prefix(base)
        .map_err(|_| format!("Ruta inesperada: {}", ruta.display()))?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Todo lo que un recorrido del vault devuelve **de una sola pasada**
/// (`FUN-M-13` ampliado por `FUN-M-38`): las notas para el índice, los demás
/// archivos para el explorador y los directorios (incluidos los vacíos) para
/// que una carpeta sin notas sobreviva al reindexado.
///
/// Antes eran tres comandos con tres walkers gemelos —`listar_archivos_meta`,
/// `listar_otros_archivos`, `listar_directorios`— que recorrían el mismo árbol
/// por separado: dos veces en cada apertura y una más por cada recarga del
/// explorador (medido: 69 + 51 + 100 ms en un vault de 1.300 notas; 6.199
/// «otros» en uno que indexaba `.git/`). Los tres comandos siguen existiendo
/// como envoltorios de este, para quien necesite una sola lista.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecorridoVault {
    /// Notas del vault (importables), con `mtime` y su `tipo` de nota.
    pub archivos_meta: Vec<ArchivoMeta>,
    /// Los archivos que Mycelium no indexa (`FUN-S-03`): `tipo` es su extensión.
    pub otros: Vec<ArchivoMeta>,
    /// Rutas relativas POSIX de TODOS los subdirectorios no ignorados.
    pub directorios: Vec<String>,
}

/// Recorre `dir` recursivamente acumulando notas, otros archivos y directorios.
/// El filtrado lo deciden los patrones del `.mycignore` del vault (FUN-M-11);
/// `.mycelium` queda excluido siempre.
///
/// **No lee el contenido** (FUN-M-12): eso lo hace `leer_archivos`, y solo para
/// las rutas que el indexador decidió reindexar comparando `mtime`.
///
/// Micro-optimizaciones del walker (FUN-M-12): se usa `entrada.file_type()` en
/// vez de `ruta.is_dir()` —el tipo ya viene en la entrada del directorio, así que
/// se ahorra un `stat` por archivo, notorio en Windows— y `rel_posix` se calcula
/// UNA vez por entrada. Contrapartida asumida: `file_type()` no sigue enlaces
/// simbólicos, así que un symlink a una carpeta no se recorre. Es lo deseable:
/// evita ciclos y duplicados en el índice.
fn recorrer_todo(
    dir: &Path,
    base: &Path,
    patrones: &[crate::mycignore::Patron],
    out: &mut RecorridoVault,
) -> Result<(), String> {
    let entradas =
        std::fs::read_dir(dir).map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;

    for entrada in entradas {
        let entrada = entrada.map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
        let ruta = entrada.path();
        let es_dir = entrada.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let relativa = rel_posix(base, &ruta)?;
        if crate::mycignore::ignorada(&relativa, es_dir, patrones) {
            continue;
        }
        if es_dir {
            out.directorios.push(relativa);
            recorrer_todo(&ruta, base, patrones, out)?;
            continue;
        }
        // Los temporales conocidos no se listan (`DEF-127`, ver `es_temporal`).
        if es_temporal(&entrada.file_name().to_string_lossy()) {
            continue;
        }
        let mtime = entrada.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
        if es_importable(&ruta) {
            out.archivos_meta.push(ArchivoMeta { ruta_relativa: relativa, mtime, tipo: tipo_de(&ruta) });
        } else {
            out.otros.push(ArchivoMeta { ruta_relativa: relativa, mtime, tipo: extension_de(&ruta) });
        }
    }
    Ok(())
}

/// Recorre el vault en `base` de una pasada (ver `RecorridoVault`).
fn recorrer_vault_en(origen: &str) -> Result<RecorridoVault, String> {
    let base = PathBuf::from(origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let patrones = crate::mycignore::cargar(&base);
    let mut out = RecorridoVault::default();
    recorrer_todo(&base, &base, &patrones, &mut out)?;
    Ok(out)
}

/// Un solo recorrido del vault para el índice, el explorador y el watcher
/// (`FUN-M-13`, `FUN-M-38`): notas con metadatos, otros archivos y directorios.
#[tauri::command]
pub fn recorrer_vault(origen: String) -> Result<RecorridoVault, String> {
    recorrer_vault_en(&origen)
}

/// Rutas ABSOLUTAS que el vault mira de verdad: las carpetas no ignoradas y los
/// archivos importables que hay dentro.
///
/// Existe para el watcher (`DEF-052`): su caché de ids de archivo se poblaba
/// recorriendo el árbol ENTERO —`node_modules/`, `target/`, `.git/`— porque el
/// recorrido del crate no conoce el `.mycignore`. Lo que el vault ignora no debe
/// costar nada en ningún sitio, así que el poblado usa este listado.
///
/// Best-effort a propósito: un directorio ilegible se salta en vez de abortar. El
/// watcher es best-effort y quedarse sin caché de ids solo degrada el seguimiento
/// de renombrados, mientras que fallar impediría abrir el vault.
pub(crate) fn rutas_observables(base: &Path) -> Vec<PathBuf> {
    let patrones = crate::mycignore::cargar(base);
    let mut out = Vec::new();
    recorrer_observables(base, base, &patrones, &mut out);
    out
}

fn recorrer_observables(
    dir: &Path,
    base: &Path,
    patrones: &[crate::mycignore::Patron],
    out: &mut Vec<PathBuf>,
) {
    let Ok(entradas) = std::fs::read_dir(dir) else {
        return;
    };
    for entrada in entradas.flatten() {
        let ruta = entrada.path();
        let es_dir = entrada.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let Ok(relativa) = rel_posix(base, &ruta) else {
            continue;
        };
        if crate::mycignore::ignorada(&relativa, es_dir, patrones) {
            continue;
        }
        if es_dir {
            out.push(ruta.clone());
            recorrer_observables(&ruta, base, patrones, out);
        } else if es_importable(&ruta) {
            out.push(ruta);
        }
    }
}

/// Lee recursivamente `origen` y devuelve los `.md`/`.excalidraw`/`.base` con su ruta
/// relativa (separador `/`), su `mtime` (ms epoch) y su `tipo` — **sin el
/// contenido**. Con esto el indexador decide qué reindexar, y el texto lo pide
/// después con `leer_archivos`. Qué se ignora lo decide el `.mycignore` del
/// vault (ver el default de `mycignore::DEFAULT`). Envoltorio de
/// `recorrer_vault`: el indexador ya no lo usa (pide las tres listas de una vez).
#[tauri::command]
pub fn listar_archivos_meta(origen: String) -> Result<Vec<ArchivoMeta>, String> {
    Ok(recorrer_vault_en(&origen)?.archivos_meta)
}

/// Extensión en minúsculas, sin el punto. Cadena vacía si no tiene.
fn extension_de(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Los archivos del vault que Mycelium **no** indexa: un PDF, una imagen, un
/// `.txt`, código.
///
/// Hasta ahora no existían para la app —no se indexaban y tampoco se listaban—,
/// así que en el explorador el vault se veía más vacío de lo que está
/// (`FUN-S-03`). Esto los hace **visibles**; abrirlos es otra cosa (`FUN-L-11`).
///
/// Comparte el recorrido con `listar_archivos_meta` a propósito: con dos
/// walkers, el `.mycignore` y las carpetas ocultas se aplicarían distinto en
/// cada uno en cuanto alguien tocara solo uno. El `tipo` de cada entrada es su
/// extensión, que es justo lo que el explorador necesita mostrar. Envoltorio de
/// `recorrer_vault`; el explorador toma esta lista del indexador (`FUN-M-38`).
#[tauri::command]
pub fn listar_otros_archivos(origen: String) -> Result<Vec<ArchivoMeta>, String> {
    Ok(recorrer_vault_en(&origen)?.otros)
}

/// Devuelve el contenido UTF-8 de las `rutas` (relativas POSIX) pedidas dentro
/// de `origen`. Complemento de `listar_archivos_meta` (FUN-M-12): el indexador
/// pide SOLO lo que va a reescribir, en tandas, en vez de recibir el vault
/// entero por IPC en cada apertura.
///
/// Cada ruta se resuelve con `ruta_segura` (defensa contra path traversal: el
/// frontend arma las rutas a partir del listado, pero el comando es invocable
/// desde el webview). Lo que no exista, no se pueda leer o no sea UTF-8 se
/// **omite en silencio**: el resultado puede traer menos entradas que `rutas`
/// —p. ej. si el archivo se borró entre las dos fases— y el llamador debe
/// tolerarlo.
#[tauri::command]
pub fn leer_archivos(origen: String, rutas: Vec<String>) -> Result<Vec<ArchivoLeido>, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let mut out = Vec::with_capacity(rutas.len());
    for relativa in rutas {
        let ruta = ruta_segura(&base, &relativa)?;
        let Ok(contenido) = std::fs::read_to_string(&ruta) else {
            continue; // borrado entre fases, binario o no UTF-8: best-effort
        };
        out.push(ArchivoLeido { ruta_relativa: relativa, contenido });
    }
    Ok(out)
}

/// Lo que el visor de solo lectura (`FUN-L-11`) necesita saber de un archivo de
/// texto: su contenido —o el principio, si es enorme—, cuánto ocupa de verdad y
/// si se pudo decodificar.
///
/// Los tres campos existen porque el visor tiene que **decir** lo que pasa. Sin
/// `binario` volcaría caracteres de reemplazo, que es peor que no abrirlo; sin
/// `truncado`/`bytes` mostraría un fragmento haciéndolo pasar por el archivo
/// entero.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivoVisor {
    /// Texto decodificado. Vacío si `binario`.
    pub contenido: String,
    /// Tamaño real del archivo en disco, en bytes.
    pub bytes: u64,
    /// `true` si `contenido` es solo el principio del archivo.
    pub truncado: bool,
    /// `true` si no es texto UTF-8 (binario, o texto en otra codificación).
    pub binario: bool,
    /// `mtime` al leerlo, en ms epoch (0 si el SO no lo expone).
    ///
    /// Es la foto contra la que se compara al guardar (`FUN-M-26`): estos
    /// archivos no se vigilan ni se respaldan, así que la única defensa contra
    /// pisar lo que otro programa escribió mientras tanto es haber anotado
    /// cómo estaban al abrirlos.
    pub mtime: i64,
}

/// Tope absoluto de lo que este comando llega a leer, pida lo que pida el
/// frontend. El corte por tamaño es la razón de ser del comando: un log de
/// 500 MB no se pinta, y sin tope la lectura sola ya reventaría la memoria.
const TOPE_VISOR: u64 = 8 * 1024 * 1024;

/// Lee un archivo del vault **para mostrarlo**, no para indexarlo (`FUN-L-11`).
///
/// No se reutiliza `leer_archivos` aunque también lea texto por ruta relativa:
/// aquel omite **en silencio** lo que no es UTF-8 —lo correcto para el
/// indexador, que solo quiere lo que sí puede indexar— y no tiene noción de
/// tamaño. El visor necesita justo lo contrario: distinguir «no existe» de «no
/// es texto» de «es demasiado grande», porque cada caso se le cuenta al usuario
/// de una forma distinta.
///
/// `max_bytes` se recorta a `TOPE_VISOR`. Si el archivo lo supera, se devuelve
/// el principio con `truncado = true`, cortado en el último salto de línea para
/// no dejar media línea a la vista.
#[tauri::command]
pub fn leer_archivo_visor(
    origen: String,
    ruta: String,
    max_bytes: u64,
) -> Result<ArchivoVisor, String> {
    use std::io::Read;

    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let destino = ruta_segura(&base, &ruta)?;
    let meta = std::fs::metadata(&destino)
        .map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("No es un archivo: {ruta}"));
    }

    let bytes = meta.len();
    let tope = max_bytes.clamp(1, TOPE_VISOR);
    let truncado = bytes > tope;

    let archivo = std::fs::File::open(&destino)
        .map_err(|e| format!("No se pudo abrir {ruta}: {e}"))?;
    let mut buf = Vec::new();
    archivo
        .take(tope)
        .read_to_end(&mut buf)
        .map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;

    let mtime = mtime_ms(&meta);
    let ilegible = |bytes: u64, truncado: bool| ArchivoVisor {
        contenido: String::new(),
        bytes,
        truncado,
        binario: true,
        mtime,
    };

    // Un byte NUL es la señal más fiable de binario y la más barata: ningún
    // texto UTF-8 válido lo lleva, y se detecta antes de intentar decodificar.
    if buf.contains(&0) {
        return Ok(ilegible(bytes, truncado));
    }

    let texto = match std::str::from_utf8(&buf) {
        Ok(s) => s.to_string(),
        // Cortar por tamaño puede partir un carácter multibyte al final: eso no
        // es "no es UTF-8", es el borde del fragmento. `error_len() == None`
        // señala exactamente ese caso (secuencia incompleta, no inválida).
        Err(e) if truncado && e.error_len().is_none() => {
            String::from_utf8_lossy(&buf[..e.valid_up_to()]).into_owned()
        }
        Err(_) => return Ok(ilegible(bytes, truncado)),
    };

    // BOM: invisible para el usuario pero un carácter real en la primera línea.
    let texto = texto.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(texto);

    // Cortar en el último salto de línea del fragmento, para no mostrar media
    // línea como si el archivo terminara ahí.
    let contenido = match texto.rfind('\n') {
        Some(i) if truncado => texto[..=i].to_string(),
        _ => texto,
    };

    Ok(ArchivoVisor { contenido, bytes, truncado, binario: false, mtime })
}

/// Resultado de guardar desde el visor. No es un `bool` disfrazado: el caso
/// interesante —el archivo cambió desde fuera— **no es un error**, es una
/// decisión que tiene que tomar el usuario, así que viaja como dato y no como
/// `Err` (un `Err` obligaría al frontend a distinguir conflictos leyendo el
/// texto del mensaje).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EscrituraVisor {
    /// `false` si NO se escribió nada porque el archivo cambió desde fuera.
    pub guardado: bool,
    /// `mtime` del archivo en disco al terminar: el nuevo si se guardó, el que
    /// tiene ahora si hubo conflicto (para poder reintentar contra él).
    pub mtime: i64,
}

/// Guarda un archivo de texto editado en el visor (`FUN-M-26`).
///
/// Tres cosas que este comando **no** hace, y son deliberadas:
///
/// - **No crea archivos.** Si `ruta` no existe, falla. El visor solo edita lo
///   que abrió; crear notas es de `escribir_nota`.
/// - **No pisa un archivo que cambió desde fuera.** Estos archivos no se
///   indexan, no se vigilan y no van a la papelera: si otro programa los tocó
///   mientras estaban abiertos, sobrescribirlos borraría ese trabajo sin vuelta
///   atrás. Con `mtime_esperado` se compara contra la foto que tomó
///   `leer_archivo_visor`; si no coincide se devuelve `guardado: false` y decide
///   el usuario. Con `None` se fuerza (es lo que manda el frontend cuando el
///   usuario ya eligió sobrescribir).
/// - **No escribe en el sitio.** Va por `vault_fs::escribir_atomico`: temporal y
///   `rename`, para que un corte no deje el archivo a medias.
///
/// Un `mtime` de 0 significa "el SO no lo expone": ahí no hay nada que comparar
/// y se guarda igual, porque negarse dejaría el archivo inguardable para siempre.
#[tauri::command]
pub fn escribir_archivo_visor(
    origen: String,
    ruta: String,
    contenido: String,
    mtime_esperado: Option<i64>,
) -> Result<EscrituraVisor, String> {
    let base = PathBuf::from(&origen);
    if !base.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let destino = ruta_segura(&base, &ruta)?;
    let meta = std::fs::metadata(&destino)
        .map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("No es un archivo: {ruta}"));
    }

    let actual = mtime_ms(&meta);
    if let Some(esperado) = mtime_esperado {
        if esperado != 0 && actual != 0 && actual != esperado {
            return Ok(EscrituraVisor { guardado: false, mtime: actual });
        }
    }

    crate::vault_fs::escribir_atomico(&destino, &contenido)?;

    let mtime = std::fs::metadata(&destino).map(|m| mtime_ms(&m)).unwrap_or(0);
    Ok(EscrituraVisor { guardado: true, mtime })
}

/// Lista las rutas relativas POSIX de TODOS los subdirectorios de `origen`
/// (incluidos los vacíos), según el `.mycignore` del vault. A diferencia del
/// listado de archivos, aquí importan también los directorios VACÍOS: son la
/// única forma de que una carpeta sin notas sobreviva a un reindex. Envoltorio
/// de `recorrer_vault`.
#[tauri::command]
pub fn listar_directorios(origen: String) -> Result<Vec<String>, String> {
    Ok(recorrer_vault_en(&origen)?.directorios)
}

/// `true` si la carpeta tiene al menos una entrada. La UI lo usa para pedir
/// confirmación antes de exportar sobre una carpeta con contenido.
#[tauri::command]
pub fn carpeta_no_vacia(ruta: String) -> Result<bool, String> {
    let base = PathBuf::from(&ruta);
    if !base.is_dir() {
        return Err(format!("La carpeta no existe: {ruta}"));
    }
    let mut entradas =
        std::fs::read_dir(&base).map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;
    Ok(entradas.next().is_some())
}

// ── Importar una carpeta al vault (`FUN-M-40`, D9) ────────────────────────────
//
// Importar era la tubería de la web: leer TODO el contenido de la carpeta por
// IPC (con un cuarto walker que no aplicaba `.mycignore`), envolver
// cada archivo en un `File` y crearlo nota por nota con `POST` + `PUT`. Solo
// entraban las notas —«adjunto no soportado» para imágenes y PDF, aunque el
// vault ya los muestra y los abre— y «reemplazar» creaba un duplicado. Un vault
// **es** una carpeta: importar es copiar un árbol y reindexar.

/// Qué hacer con un archivo del origen cuyo destino ya existe. Las tres
/// opciones del diálogo de conflicto de la importación.
#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DecisionConflicto {
    /// Pisar el que estaba.
    Reemplazar,
    /// Conservar los dos: el importado entra con sufijo (`nota 1.md`).
    Renombrar,
    /// No importar este archivo.
    Cancelar,
}

/// Lo que devuelve `copiar_arbol`.
#[derive(serde::Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoCopia {
    /// Rutas relativas AL VAULT de lo que quedó copiado (con el nombre final).
    pub copiados: Vec<String>,
    /// Lo que no se copió, con el motivo (`ruta: motivo`), en ruta del origen.
    pub omitidos: Vec<String>,
}

/// Archivos (no directorios) del árbol `origen` que se copian, en rutas
/// relativas POSIX, y los directorios —también los vacíos— que hay que crear.
/// Aplica el `.mycignore` del **origen** (o el default: los directorios ocultos
/// como `.obsidian/` y `.git/` no entran), `.mycelium` siempre fuera. El
/// `.mycignore` de la raíz del origen tampoco se copia: es la configuración de
/// aquel vault, ya aplicada acá, y en la raíz de este reemplazaría la suya.
/// Los enlaces simbólicos no se siguen (igual que el recorrido del vault).
fn arbol_a_copiar(origen: &Path) -> Result<(Vec<String>, Vec<String>), String> {
    fn recorrer(
        dir: &Path,
        base: &Path,
        patrones: &[crate::mycignore::Patron],
        archivos: &mut Vec<String>,
        dirs: &mut Vec<String>,
    ) -> Result<(), String> {
        let entradas = std::fs::read_dir(dir)
            .map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
        for entrada in entradas {
            let entrada =
                entrada.map_err(|e| format!("No se pudo leer {}: {e}", dir.display()))?;
            let Ok(tipo) = entrada.file_type() else { continue };
            let ruta = entrada.path();
            let relativa = rel_posix(base, &ruta)?;
            if crate::mycignore::ignorada(&relativa, tipo.is_dir(), patrones) {
                continue;
            }
            if tipo.is_dir() {
                dirs.push(relativa);
                recorrer(&ruta, base, patrones, archivos, dirs)?;
            } else if tipo.is_file() && relativa != crate::mycignore::ARCHIVO {
                archivos.push(relativa);
            }
        }
        Ok(())
    }

    let patrones = crate::mycignore::cargar(origen);
    let mut archivos = Vec::new();
    let mut dirs = Vec::new();
    recorrer(origen, origen, &patrones, &mut archivos, &mut dirs)?;
    archivos.sort();
    dirs.sort();
    Ok((archivos, dirs))
}

/// Valida origen y destino de una copia: el vault existe, el origen es una
/// carpeta, `destino_rel` no se sale del vault (`ruta_segura`: nada de `..` ni
/// rutas absolutas) y el origen no contiene al destino —copiar una carpeta
/// dentro de sí misma—.
fn preparar_copia(
    vault_ruta: &str,
    origen: &str,
    destino_rel: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let vault = PathBuf::from(vault_ruta);
    if !vault.is_dir() {
        return Err(format!("La carpeta del vault no existe: {vault_ruta}"));
    }
    let origen_dir = PathBuf::from(origen);
    if !origen_dir.is_dir() {
        return Err(format!("La carpeta de origen no existe: {origen}"));
    }
    let destino = ruta_segura(&vault, destino_rel)?;
    if let (Ok(o), Ok(v)) = (origen_dir.canonicalize(), vault.canonicalize()) {
        // El destino todavía puede no existir: se compara con el vault y la
        // ruta relativa, ya validada, por encima.
        let d = v.join(destino.strip_prefix(&vault).unwrap_or(Path::new("")));
        if d.starts_with(&o) {
            return Err("No se puede importar una carpeta dentro de sí misma.".into());
        }
    }
    Ok((origen_dir, destino))
}

/// Qué archivos del origen chocarían con algo que ya está en el vault: su ruta
/// relativa **al origen**. Es la primera mitad de la importación —la UI pregunta
/// qué hacer con cada uno— y comparte el recorrido con `copiar_arbol` para que
/// las dos vean exactamente los mismos archivos.
#[tauri::command(async)]
pub fn conflictos_de_copia(
    vault_ruta: String,
    origen: String,
    destino_rel: String,
) -> Result<Vec<String>, String> {
    let (origen_dir, destino) = preparar_copia(&vault_ruta, &origen, &destino_rel)?;
    let (archivos, _) = arbol_a_copiar(&origen_dir)?;
    Ok(archivos
        .into_iter()
        .filter(|r| destino.join(r).exists())
        .collect())
}

/// Nombre libre para «conservar los dos»: `nota 1.md`, `nota 2.md`… en la misma
/// carpeta (el sufijo de `desambiguar` en `lib/db/nombres.ts`).
fn nombre_libre(ruta: &Path) -> PathBuf {
    let padre = ruta.parent().unwrap_or(Path::new(""));
    let stem = ruta.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = ruta
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut n = 1;
    loop {
        let candidata = padre.join(format!("{stem} {n}{ext}"));
        if !candidata.exists() {
            return candidata;
        }
        n += 1;
    }
}

/// Copia el árbol `origen` —todo: notas, imágenes, PDF, lo que haya— dentro de
/// `destino_rel` del vault, respetando el `.mycignore` del origen (ver
/// `arbol_a_copiar`). Devuelve qué quedó copiado y qué se omitió; el indexado lo
/// hace después el frontend (`indexarVault`), una sola vez.
///
/// Un archivo cuyo destino ya existe sigue `decisiones` (clave = su ruta
/// relativa al origen, la que devolvió `conflictos_de_copia`); si no tiene
/// decisión —apareció entre las dos llamadas— se conservan los dos. **Reemplazar
/// reemplaza**: el archivo que estaba se pisa, no se duplica. Un error en un
/// archivo no aborta la copia: queda en `omitidos` y se sigue.
///
/// `async` (fuera del hilo principal) desde `FUN-S-26`: soltar un archivo de
/// cientos de MB lo copia acá, y en el hilo principal congelaba la ventana.
#[tauri::command(async)]
pub fn copiar_arbol(
    vault_ruta: String,
    origen: String,
    destino_rel: String,
    decisiones: std::collections::HashMap<String, DecisionConflicto>,
) -> Result<ResultadoCopia, String> {
    let (origen_dir, destino) = preparar_copia(&vault_ruta, &origen, &destino_rel)?;
    let (archivos, dirs) = arbol_a_copiar(&origen_dir)?;
    let vault = PathBuf::from(&vault_ruta);
    let mut out = ResultadoCopia::default();

    std::fs::create_dir_all(&destino)
        .map_err(|e| format!("No se pudo crear {}: {e}", destino.display()))?;
    for d in &dirs {
        if let Err(e) = std::fs::create_dir_all(destino.join(d)) {
            out.omitidos.push(format!("{d}/: no se pudo crear la carpeta ({e})"));
        }
    }

    for relativa in archivos {
        let mut objetivo = destino.join(&relativa);
        if objetivo.exists() {
            match decisiones.get(&relativa).copied().unwrap_or(DecisionConflicto::Renombrar) {
                DecisionConflicto::Cancelar => {
                    out.omitidos.push(format!("{relativa}: ya existía"));
                    continue;
                }
                DecisionConflicto::Reemplazar if objetivo.is_dir() => {
                    out.omitidos.push(format!("{relativa}: hay una carpeta con ese nombre"));
                    continue;
                }
                DecisionConflicto::Reemplazar => {}
                DecisionConflicto::Renombrar => objetivo = nombre_libre(&objetivo),
            }
        }
        match std::fs::copy(origen_dir.join(&relativa), &objetivo) {
            Ok(_) => out.copiados.push(rel_posix(&vault, &objetivo)?),
            Err(e) => out.omitidos.push(format!("{relativa}: {e}")),
        }
    }
    Ok(out)
}

/// ── Carpeta temporal de la importación ────────────────────────────────────────
//
// Lo que no llega como carpeta —un `.zip`, archivos soltados o elegidos con el
// selector— se baja primero a una carpeta temporal y sigue el MISMO camino que
// una carpeta: `conflictos_de_copia` + `copiar_arbol`. Así el `.mycignore`, los
// conflictos y los adjuntos se resuelven en un solo lugar.
//
// Los bytes viajan por **IPC binario** (`FUN-S-26`): el cuerpo crudo de la
// llamada (`InvokeBody::Raw`) y los datos en encabezados, un trozo por llamada.
// Antes iban en el JSON como un arreglo de números —cuatro veces su tamaño, 20 MB
// eran 71 MB de JSON y ~2,3 s— y un archivo de cientos de MB no entraba.

/// Prefijo de las carpetas temporales de importación dentro de `temp_dir()`.
const PREFIJO_TEMPORAL: &str = "mycelium-import-";

/// Comprueba que `dir` sea una carpeta temporal de importación: hija directa de
/// `temp_dir()` y con el prefijo. Es lo único que estos comandos escriben o
/// borran, aunque el webview mande otra ruta.
fn temporal_valida(dir: &str) -> Result<PathBuf, String> {
    let ruta = PathBuf::from(dir);
    let nombre = ruta.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let padre = ruta.parent().and_then(|p| p.canonicalize().ok());
    let temp = std::env::temp_dir().canonicalize().ok();
    if !nombre.starts_with(PREFIJO_TEMPORAL) || padre.is_none() || padre != temp {
        return Err(format!("No es una carpeta temporal de importación: {dir}"));
    }
    Ok(ruta)
}

/// Crea una carpeta temporal de importación vacía y devuelve su ruta.
#[tauri::command]
pub fn crear_temporal_importacion() -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ruta =
        std::env::temp_dir().join(format!("{PREFIJO_TEMPORAL}{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&ruta)
        .map_err(|e| format!("No se pudo crear {}: {e}", ruta.display()))?;
    Ok(ruta.to_string_lossy().to_string())
}

/// Escribe un trozo de un archivo en la carpeta temporal `dir`, en `ruta`
/// (relativa a ella, sin salirse: `ruta_segura`). `desde = 0` crea el archivo
/// —o lo vacía—; cualquier otro valor agrega al final y exige que el archivo
/// mida exactamente eso, para que un trozo perdido o repetido no deje un
/// archivo corrupto sin aviso.
fn escribir_trozo(dir: &str, ruta: &str, desde: u64, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let base = temporal_valida(dir)?;
    let destino = ruta_segura(&base, ruta)?;
    if destino == base {
        return Err(format!("Ruta no permitida: {ruta}"));
    }
    if let Some(padre) = destino.parent() {
        std::fs::create_dir_all(padre)
            .map_err(|e| format!("No se pudo crear {}: {e}", padre.display()))?;
    }
    let mut archivo = if desde == 0 {
        std::fs::File::create(&destino)
    } else {
        let actual = std::fs::metadata(&destino).map(|m| m.len()).unwrap_or(0);
        if actual != desde {
            return Err(format!("{ruta}: se esperaba el byte {actual} y llegó el {desde}"));
        }
        std::fs::OpenOptions::new().append(true).open(&destino)
    }
    .map_err(|e| format!("No se pudo escribir {}: {e}", destino.display()))?;
    archivo
        .write_all(bytes)
        .map_err(|e| format!("No se pudo escribir {}: {e}", destino.display()))
}

/// Decodifica un valor `encodeURIComponent`: los encabezados HTTP solo llevan
/// ASCII, y las rutas tienen tildes y eñes. Un `%` mal formado es error.
fn decodificar_uri(valor: &str) -> Result<String, String> {
    let entrada = valor.as_bytes();
    let mut out = Vec::with_capacity(entrada.len());
    let mut i = 0;
    while i < entrada.len() {
        if entrada[i] == b'%' {
            let byte = entrada
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| format!("Encabezado mal codificado: {valor}"))?;
            out.push(byte);
            i += 3;
        } else {
            out.push(entrada[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| format!("Encabezado mal codificado: {valor}"))
}

/// Recibe por IPC binario un trozo de un archivo que se importa: el cuerpo de
/// la llamada son los bytes, y los encabezados dicen dónde van —`x-dir`, la
/// carpeta temporal (de `crear_temporal_importacion`); `x-ruta`, la ruta
/// relativa a ella; `x-desde`, la posición del trozo en el archivo—. Las dos
/// rutas van con `encodeURIComponent`.
///
/// `async` para no correr en el hilo principal: un archivo grande son muchas
/// llamadas seguidas y la ventana no debe congelarse mientras se escriben.
#[tauri::command(async)]
pub fn escribir_trozo_importacion(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaban los bytes del archivo en el cuerpo de la llamada.".into());
    };
    let encabezado = |nombre: &str| -> Result<String, String> {
        let valor = request
            .headers()
            .get(nombre)
            .ok_or_else(|| format!("Falta el encabezado {nombre}"))?
            .to_str()
            .map_err(|_| format!("El encabezado {nombre} no es ASCII"))?;
        decodificar_uri(valor)
    };
    let desde = encabezado("x-desde")?
        .parse::<u64>()
        .map_err(|_| "Encabezado x-desde inválido".to_string())?;
    escribir_trozo(&encabezado("x-dir")?, &encabezado("x-ruta")?, desde, bytes)
}

/// Borra una carpeta temporal de importación (y solo eso: ver `temporal_valida`).
#[tauri::command]
pub fn borrar_temporal_importacion(dir: String) -> Result<(), String> {
    let ruta = temporal_valida(&dir)?;
    std::fs::remove_dir_all(&ruta).map_err(|e| format!("No se pudo borrar {dir}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un árbol de prueba en el temporal, borrado al empezar.
    fn arbol(nombre: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("mycelium-{nombre}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    /// Criterio de D9: `copiar_arbol` no escribe fuera del vault aunque el
    /// destino lo pida con `..` o una ruta absoluta.
    #[test]
    fn copiar_arbol_rechaza_destinos_fuera_del_vault() {
        let raiz = arbol("copia-escape");
        let vault = raiz.join("vault");
        let origen = raiz.join("origen");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("nota.md"), "#").unwrap();
        let v = vault.to_string_lossy().to_string();
        let o = origen.to_string_lossy().to_string();

        for destino in ["..", "../fuera", "sub/../../fuera", "/etc", "C:/Windows"] {
            assert!(
                copiar_arbol(v.clone(), o.clone(), destino.into(), Default::default()).is_err(),
                "{destino} debía rechazarse"
            );
            assert!(conflictos_de_copia(v.clone(), o.clone(), destino.into()).is_err());
        }
        assert!(!raiz.join("fuera").exists());
        assert!(!raiz.join("nota.md").exists(), "nada salió del vault");

        // Tampoco dentro de sí misma: el vault es parte del origen.
        let r = copiar_arbol(v.clone(), raiz.to_string_lossy().to_string(), "".into(), Default::default());
        assert!(r.is_err());

        std::fs::remove_dir_all(&raiz).unwrap();
    }

    /// Criterio de D9: el `.mycignore` del origen decide qué entra; sin él, el
    /// default deja fuera los directorios ocultos (`.obsidian/`). Los adjuntos
    /// entran como cualquier archivo, y las carpetas vacías también.
    #[test]
    fn copiar_arbol_respeta_el_mycignore_del_origen_y_copia_adjuntos() {
        let raiz = arbol("copia-ignore");
        let vault = raiz.join("vault");
        let origen = raiz.join("obsidian");
        std::fs::create_dir_all(vault.join("Importado")).unwrap();
        std::fs::create_dir_all(origen.join(".obsidian/plugins")).unwrap();
        std::fs::create_dir_all(origen.join("Notas/adjuntos")).unwrap();
        std::fs::create_dir_all(origen.join("Vacía")).unwrap();
        std::fs::write(origen.join(".obsidian/app.json"), "{}").unwrap();
        std::fs::write(origen.join("Notas/plan.md"), "![[foto.png]]").unwrap();
        std::fs::write(origen.join("Notas/adjuntos/foto.png"), [0x89u8, b'P', b'N', b'G', 0]).unwrap();
        std::fs::write(origen.join("manual.pdf"), [b'%', b'P', b'D', b'F', 0xFF]).unwrap();
        let v = vault.to_string_lossy().to_string();
        let o = origen.to_string_lossy().to_string();

        // Sin `.mycignore` en el origen: el default.
        let r = copiar_arbol(v.clone(), o.clone(), "Importado".into(), Default::default()).unwrap();
        let mut copiados = r.copiados.clone();
        copiados.sort();
        assert_eq!(
            copiados,
            vec![
                "Importado/Notas/adjuntos/foto.png",
                "Importado/Notas/plan.md",
                "Importado/manual.pdf",
            ]
        );
        assert!(r.omitidos.is_empty());
        assert!(!vault.join("Importado/.obsidian").exists(), ".obsidian/ no entra");
        assert!(vault.join("Importado/Vacía").is_dir(), "la carpeta vacía también");
        assert_eq!(
            std::fs::read(vault.join("Importado/Notas/adjuntos/foto.png")).unwrap(),
            vec![0x89u8, b'P', b'N', b'G', 0],
            "los binarios se copian byte a byte"
        );

        // Con `.mycignore` en el origen: manda el suyo (y él no se copia).
        std::fs::write(origen.join(".mycignore"), "adjuntos/\n*.pdf\n").unwrap();
        let r = copiar_arbol(v.clone(), o.clone(), "Otra".into(), Default::default()).unwrap();
        let mut copiados = r.copiados.clone();
        copiados.sort();
        assert_eq!(
            copiados,
            vec!["Otra/.obsidian/app.json", "Otra/Notas/plan.md"],
            "su .mycignore reemplaza al default: .obsidian/ ya no está ignorado"
        );
        assert!(!vault.join("Otra/.mycignore").exists());

        std::fs::remove_dir_all(&raiz).unwrap();
    }

    /// Las tres decisiones del diálogo de conflicto, y que «reemplazar»
    /// reemplace (antes creaba un duplicado).
    #[test]
    fn copiar_arbol_aplica_las_decisiones_de_conflicto() {
        let raiz = arbol("copia-conflictos");
        let vault = raiz.join("vault");
        let origen = raiz.join("origen");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&origen).unwrap();
        for n in ["a.md", "b.md", "c.md", "d.md"] {
            std::fs::write(vault.join(n), "viejo").unwrap();
            std::fs::write(origen.join(n), "nuevo").unwrap();
        }
        std::fs::write(origen.join("e.md"), "sin conflicto").unwrap();
        let v = vault.to_string_lossy().to_string();
        let o = origen.to_string_lossy().to_string();

        let mut conflictos = conflictos_de_copia(v.clone(), o.clone(), "".into()).unwrap();
        conflictos.sort();
        assert_eq!(conflictos, vec!["a.md", "b.md", "c.md", "d.md"]);

        let decisiones = std::collections::HashMap::from([
            ("a.md".to_string(), DecisionConflicto::Reemplazar),
            ("b.md".to_string(), DecisionConflicto::Renombrar),
            ("c.md".to_string(), DecisionConflicto::Cancelar),
            // `d.md` sin decisión: se conservan los dos.
        ]);
        let r = copiar_arbol(v.clone(), o, "".into(), decisiones).unwrap();

        let leer = |n: &str| std::fs::read_to_string(vault.join(n)).unwrap();
        assert_eq!(leer("a.md"), "nuevo", "reemplazar reemplaza");
        assert!(!vault.join("a 1.md").exists(), "y no deja un duplicado");
        assert_eq!(leer("b.md"), "viejo");
        assert_eq!(leer("b 1.md"), "nuevo");
        assert_eq!(leer("c.md"), "viejo");
        assert!(!vault.join("c 1.md").exists());
        assert_eq!(leer("d 1.md"), "nuevo");
        assert_eq!(leer("e.md"), "sin conflicto");
        assert_eq!(r.omitidos, vec!["c.md: ya existía"]);
        let mut copiados = r.copiados;
        copiados.sort();
        assert_eq!(copiados, vec!["a.md", "b 1.md", "d 1.md", "e.md"]);

        std::fs::remove_dir_all(&raiz).unwrap();
    }

    /// La carpeta temporal: solo se escribe y se borra una del prefijo, dentro
    /// del temporal del sistema; nada de lo que mande el webview fuera de eso.
    #[test]
    fn la_carpeta_temporal_de_importacion_es_la_unica_que_se_toca() {
        let dir = crear_temporal_importacion().unwrap();
        escribir_trozo(&dir, "Vault/nota.md", 0, b"# hola").unwrap();
        escribir_trozo(&dir, "Vault/img.png", 0, &[0, 1, 2]).unwrap();
        assert_eq!(std::fs::read(Path::new(&dir).join("Vault/nota.md")).unwrap(), b"# hola");
        assert_eq!(std::fs::read(Path::new(&dir).join("Vault/img.png")).unwrap(), vec![0, 1, 2]);

        // Una entrada del zip que intenta salirse: error.
        for ruta in ["../fuera.md", "/fuera.md", "C:/fuera.md", "", "."] {
            assert!(escribir_trozo(&dir, ruta, 0, b"x").is_err(), "{ruta:?} debía rechazarse");
        }

        // Otra carpeta, aunque esté en el temporal: no se escribe ni se borra.
        let ajena = arbol("no-es-importacion");
        let a = ajena.to_string_lossy().to_string();
        assert!(borrar_temporal_importacion(a.clone()).is_err());
        assert!(escribir_trozo(&a, "nota.md", 0, b"x").is_err());
        assert!(!ajena.join("nota.md").exists());
        assert!(ajena.exists());
        std::fs::remove_dir_all(&ajena).unwrap();

        borrar_temporal_importacion(dir.clone()).unwrap();
        assert!(!Path::new(&dir).exists());
    }

    /// Un archivo grande llega en trozos (`FUN-S-26`): se agregan en orden, y un
    /// trozo fuera de lugar —perdido o repetido— es error, no un archivo roto.
    #[test]
    fn los_trozos_arman_el_archivo_y_rechazan_los_desordenados() {
        let dir = crear_temporal_importacion().unwrap();
        escribir_trozo(&dir, "Carpeta ñ/video.mp4", 0, &[1, 2, 3]).unwrap();
        escribir_trozo(&dir, "Carpeta ñ/video.mp4", 3, &[4, 5]).unwrap();
        assert!(escribir_trozo(&dir, "Carpeta ñ/video.mp4", 3, &[9]).is_err(), "repetido");
        assert!(escribir_trozo(&dir, "Carpeta ñ/video.mp4", 9, &[9]).is_err(), "salteado");
        escribir_trozo(&dir, "Carpeta ñ/video.mp4", 5, &[6]).unwrap();
        let ruta = Path::new(&dir).join("Carpeta ñ/video.mp4");
        assert_eq!(std::fs::read(&ruta).unwrap(), vec![1, 2, 3, 4, 5, 6]);

        // Volver a empezar (`desde = 0`) lo reescribe desde cero.
        escribir_trozo(&dir, "Carpeta ñ/video.mp4", 0, &[7]).unwrap();
        assert_eq!(std::fs::read(&ruta).unwrap(), vec![7]);

        // Un archivo vacío también existe (un trozo de cero bytes).
        escribir_trozo(&dir, "vacío.txt", 0, &[]).unwrap();
        assert_eq!(std::fs::read(Path::new(&dir).join("vacío.txt")).unwrap(), Vec::<u8>::new());

        borrar_temporal_importacion(dir).unwrap();
    }

    /// Las rutas llegan en encabezados con `encodeURIComponent`.
    #[test]
    fn decodifica_los_encabezados_de_encodeuricomponent() {
        assert_eq!(decodificar_uri("Notas%2Ffoto%20%C3%B1.png").unwrap(), "Notas/foto ñ.png");
        assert_eq!(decodificar_uri("simple.md").unwrap(), "simple.md");
        assert!(decodificar_uri("roto%2").is_err());
        assert!(decodificar_uri("roto%zz").is_err());
        assert!(decodificar_uri("%FF").is_err(), "no es UTF-8");
    }

    /// Un tipo de archivo nuevo entra por dos puertas —el tipo y el filtro de
    /// importables— y olvidar la segunda lo deja fuera del índice y del árbol
    /// sin que nada falle: el archivo existe en el disco y la app no lo ve.
    #[test]
    fn los_diagramas_drawio_entran_al_indice_con_su_tipo() {
        assert_eq!(tipo_de(Path::new("arquitectura.drawio")), "drawio");
        assert_eq!(tipo_de(Path::new("sub/arquitectura.DrawIO")), "drawio");
        assert!(es_importable(Path::new("arquitectura.drawio")));

        // Y no se lleva por delante a los tipos que ya existían.
        assert_eq!(tipo_de(Path::new("nota.md")), "markdown");
        assert_eq!(tipo_de(Path::new("dibujo.excalidraw")), "excalidraw");
        assert_eq!(tipo_de(Path::new("lienzo.canvas")), "canvas");
        assert_eq!(tipo_de(Path::new("tabla.base")), "base");
        assert!(!es_importable(Path::new("foto.png")));
    }

    #[test]
    fn rechaza_escapes_de_la_carpeta_destino() {
        let base = Path::new("/vault");
        assert!(ruta_segura(base, "../fuera.md").is_err());
        assert!(ruta_segura(base, "sub/../../fuera.md").is_err());
        assert!(ruta_segura(base, "/etc/passwd").is_err());
        assert!(ruta_segura(base, "notas/ok.md").is_ok());
    }

    /// Ida y vuelta real contra el disco: exportar un vault a una carpeta y
    /// volver a leerlo debe devolver exactamente lo mismo, con la estructura
    /// de subcarpetas intacta y saltándose lo oculto y lo no importable.
    #[test]
    fn exportar_y_releer_conserva_el_arbol() {
        let base = std::env::temp_dir().join(format!("mycelium-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let destino = base.to_string_lossy().to_string();

        let archivos = vec![
            ArchivoExport {
                ruta_relativa: "raiz.md".into(),
                contenido: "# Raíz con acentos ñ".into(),
            },
            ArchivoExport {
                ruta_relativa: "proyectos/2026/plan.md".into(),
                contenido: "contenido anidado".into(),
            },
            ArchivoExport {
                ruta_relativa: "adjuntos/diagrama.excalidraw".into(),
                contenido: "{\"type\":\"excalidraw\"}".into(),
            },
        ];
        assert_eq!(exportar_a_carpeta(destino.clone(), archivos).unwrap(), 3);
        assert!(base.join("proyectos/2026/plan.md").exists());
        assert!(carpeta_no_vacia(destino.clone()).unwrap());

        // Ruido que el recorrido debe dejar fuera de las notas: un directorio
        // oculto y una extensión ajena.
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::write(base.join(".git/config"), "x").unwrap();
        std::fs::write(base.join("imagen.png"), "x").unwrap();

        let mut rutas: Vec<String> = recorrer_vault(destino.clone())
            .unwrap()
            .archivos_meta
            .into_iter()
            .map(|a| a.ruta_relativa)
            .collect();
        rutas.sort();
        assert_eq!(
            rutas,
            vec!["adjuntos/diagrama.excalidraw", "proyectos/2026/plan.md", "raiz.md"]
        );
        let leidos = leer_archivos(destino, rutas).unwrap();
        assert_eq!(leidos[2].contenido, "# Raíz con acentos ñ");
        assert_eq!(leidos[1].contenido, "contenido anidado");

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// Lo que `.mycignore` excluye no se recorre para NADA: es lo que hace que
    /// poblar la caché del watcher deje de costar lo que costaba (`DEF-052`).
    #[test]
    fn rutas_observables_respeta_mycignore() {
        let base = std::env::temp_dir().join(format!("mycelium-obs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("notas")).unwrap();
        std::fs::create_dir_all(base.join("node_modules/paquete")).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        // OJO: un `.mycignore` presente REEMPLAZA al default, no lo amplía (ver
        // `mycignore::DEFAULT`). Por eso hay que repetir acá el `.*/` que oculta
        // los directorios ocultos: sin él, `.git/` se recorrería.
        std::fs::write(base.join(".mycignore"), "node_modules/
.*/
").unwrap();
        std::fs::write(base.join("notas/uno.md"), "#").unwrap();
        std::fs::write(base.join("tabla.base"), "views:").unwrap();
        std::fs::write(base.join("lienzo.canvas"), "{}").unwrap();
        std::fs::write(base.join("imagen.png"), "x").unwrap();
        std::fs::write(base.join("node_modules/paquete/index.md"), "#").unwrap();
        std::fs::write(base.join(".git/HEAD"), "x").unwrap();

        let rutas = rutas_observables(&base);
        let rel: Vec<String> = rutas
            .iter()
            .map(|r| rel_posix(&base, r).unwrap())
            .collect();

        assert!(rel.contains(&"notas".to_string()), "las carpetas también entran");
        assert!(rel.contains(&"notas/uno.md".to_string()));
        // Los tipos nuevos cuentan: si no, editarlos desde fuera no reindexaría.
        assert!(rel.contains(&"tabla.base".to_string()));
        assert!(rel.contains(&"lienzo.canvas".to_string()));
        assert!(!rel.iter().any(|r| r.starts_with("node_modules")), "lo ignorado no se toca");
        assert!(!rel.iter().any(|r| r.starts_with(".git")), "los ocultos tampoco");
        assert!(!rel.contains(&"imagen.png".to_string()), "no es una nota del vault");

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `listar_archivos_meta` devuelve el tipo correcto por extensión, un
    /// `mtime > 0` para cada archivo y salta directorios ocultos (incl. el
    /// propio `.mycelium`).
    #[test]
    fn listar_meta_devuelve_mtime_y_tipo() {
        let base = std::env::temp_dir().join(format!("mycelium-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::create_dir_all(base.join(".mycelium")).unwrap();
        std::fs::write(base.join("nota.md"), "# hola").unwrap();
        std::fs::write(base.join("sub/diagrama.excalidraw"), "{}").unwrap();
        // Ruido que debe ignorarse: el índice y una extensión ajena.
        std::fs::write(base.join(".mycelium/index-abc.db"), "x").unwrap();
        std::fs::write(base.join("imagen.png"), "x").unwrap();

        let mut metas =
            listar_archivos_meta(base.to_string_lossy().to_string()).unwrap();
        metas.sort_by(|a, b| a.ruta_relativa.cmp(&b.ruta_relativa));

        assert_eq!(metas.len(), 2);
        assert_eq!(metas[0].ruta_relativa, "nota.md");
        assert_eq!(metas[0].tipo, "markdown");
        assert_eq!(metas[1].ruta_relativa, "sub/diagrama.excalidraw");
        assert_eq!(metas[1].tipo, "excalidraw");
        assert!(metas.iter().all(|m| m.mtime > 0), "mtime debe ser > 0");

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `leer_archivos` devuelve el contenido SOLO de las rutas pedidas, omite en
    /// silencio lo que no existe (borrado entre las dos fases del indexado) y
    /// **rechaza** cualquier ruta que intente salirse del vault (FUN-M-12).
    #[test]
    fn leer_archivos_devuelve_lo_pedido_y_rechaza_escapes() {
        let base = std::env::temp_dir().join(format!("mycelium-leer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sub")).unwrap();
        std::fs::write(base.join("nota.md"), "# hola ñ").unwrap();
        std::fs::write(base.join("sub/otra.md"), "contenido anidado").unwrap();
        std::fs::write(base.join("ignorada.md"), "no se pide").unwrap();
        let origen = base.to_string_lossy().to_string();

        // Solo lo pedido, en el orden pedido.
        let leidos = leer_archivos(
            origen.clone(),
            vec!["sub/otra.md".into(), "nota.md".into()],
        )
        .unwrap();
        let rutas: Vec<&str> = leidos.iter().map(|a| a.ruta_relativa.as_str()).collect();
        assert_eq!(rutas, vec!["sub/otra.md", "nota.md"]);
        assert_eq!(leidos[0].contenido, "contenido anidado");
        assert_eq!(leidos[1].contenido, "# hola ñ");

        // Un archivo que ya no está se omite: el llamador recibe menos entradas.
        let leidos = leer_archivos(
            origen.clone(),
            vec!["nota.md".into(), "fantasma.md".into()],
        )
        .unwrap();
        assert_eq!(leidos.len(), 1);
        assert_eq!(leidos[0].ruta_relativa, "nota.md");

        // Path traversal: error, no lectura fuera del vault.
        assert!(leer_archivos(origen.clone(), vec!["../fuera.md".into()]).is_err());
        assert!(leer_archivos(origen.clone(), vec!["sub/../../fuera.md".into()]).is_err());
        assert!(leer_archivos(origen.clone(), vec!["/etc/passwd".into()]).is_err());

        // Lista vacía: no falla y no devuelve nada.
        assert!(leer_archivos(origen, vec![]).unwrap().is_empty());

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// El visor tiene que distinguir tres cosas que el indexador confunde a
    /// propósito: texto legible, texto **cortado** por tamaño y algo que no es
    /// texto. Cada una se le cuenta al usuario distinto (FUN-L-11 § 4).
    #[test]
    fn leer_archivo_visor_distingue_texto_binario_y_fragmento() {
        let base = std::env::temp_dir().join(format!("mycelium-visor-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let origen = base.to_string_lossy().to_string();

        // Texto normal: entero, sin avisos.
        std::fs::write(base.join("notas.txt"), "línea uno\nlínea dos ñ\n").unwrap();
        let v = leer_archivo_visor(origen.clone(), "notas.txt".into(), 1024).unwrap();
        assert_eq!(v.contenido, "línea uno\nlínea dos ñ\n");
        assert!(!v.truncado && !v.binario);
        assert_eq!(v.bytes, std::fs::metadata(base.join("notas.txt")).unwrap().len());

        // Binario con extensión de texto: no se decodifica a la fuerza.
        std::fs::write(base.join("mentiroso.txt"), [0x50u8, 0x00, 0x4b, 0x03]).unwrap();
        let v = leer_archivo_visor(origen.clone(), "mentiroso.txt".into(), 1024).unwrap();
        assert!(v.binario, "un NUL delata al binario");
        assert!(v.contenido.is_empty());

        // Texto en otra codificación (latin-1): tampoco se vuelca con basura.
        std::fs::write(base.join("latin.txt"), [b'a', 0xF1, b'o']).unwrap();
        let v = leer_archivo_visor(origen.clone(), "latin.txt".into(), 1024).unwrap();
        assert!(v.binario, "0xF1 suelto no es UTF-8 válido");

        // Archivo grande: fragmento cortado en un salto de línea, con el
        // tamaño REAL para que el aviso pueda decir cuánto se está omitiendo.
        let grande = "0123456789\n".repeat(200); // 2200 bytes
        std::fs::write(base.join("log.txt"), &grande).unwrap();
        let v = leer_archivo_visor(origen.clone(), "log.txt".into(), 100).unwrap();
        assert!(v.truncado && !v.binario);
        assert_eq!(v.bytes, 2200);
        assert!(v.contenido.len() <= 100);
        assert!(v.contenido.ends_with('\n'), "se corta en línea entera");

        // Cortar en mitad de un carácter multibyte NO es "no es UTF-8".
        std::fs::write(base.join("acentos.txt"), "ñ".repeat(50)).unwrap();
        let v = leer_archivo_visor(origen.clone(), "acentos.txt".into(), 9).unwrap();
        assert!(!v.binario, "una secuencia incompleta al final es el borde del fragmento");
        assert!(v.truncado);
        assert_eq!(v.contenido, "ññññ", "9 bytes = 4 caracteres y medio → 4 enteros");

        // Lo que no existe y lo que intenta salirse: error, no un resultado vacío.
        assert!(leer_archivo_visor(origen.clone(), "fantasma.txt".into(), 1024).is_err());
        assert!(leer_archivo_visor(origen.clone(), "../fuera.txt".into(), 1024).is_err());
        assert!(leer_archivo_visor(origen, "/etc/passwd".into(), 1024).is_err());

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// Un solo recorrido devuelve las tres listas (`FUN-M-38`): las notas van a
    /// `archivos_meta`, lo que no se indexa a `otros` y las carpetas —también
    /// las vacías— a `directorios`; nada aparece en dos listas y lo ignorado
    /// por `.mycignore` no aparece en ninguna.
    #[test]
    fn recorrer_vault_separa_notas_otros_y_directorios_en_una_pasada() {
        let base = std::env::temp_dir().join(format!("mycelium-rec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("Proyectos/2026")).unwrap();
        std::fs::create_dir_all(base.join("Vacía")).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::create_dir_all(base.join("node_modules/x")).unwrap();
        std::fs::write(base.join("Proyectos/2026/plan.md"), "x").unwrap();
        std::fs::write(base.join("Proyectos/foto.PNG"), "x").unwrap();
        std::fs::write(base.join("raiz.excalidraw"), "{}").unwrap();
        std::fs::write(base.join("notas.txt"), "x").unwrap();
        std::fs::write(base.join(".git/HEAD"), "x").unwrap();
        std::fs::write(base.join("node_modules/x/README.md"), "x").unwrap();

        let r = recorrer_vault(base.to_string_lossy().to_string()).unwrap();
        let mut notas: Vec<(&str, &str)> =
            r.archivos_meta.iter().map(|a| (a.ruta_relativa.as_str(), a.tipo.as_str())).collect();
        notas.sort();
        assert_eq!(notas, vec![("Proyectos/2026/plan.md", "markdown"), ("raiz.excalidraw", "excalidraw")]);
        assert!(r.archivos_meta.iter().all(|a| a.mtime > 0));

        let mut otros: Vec<(&str, &str)> =
            r.otros.iter().map(|a| (a.ruta_relativa.as_str(), a.tipo.as_str())).collect();
        otros.sort();
        assert_eq!(otros, vec![("Proyectos/foto.PNG", "png"), ("notas.txt", "txt")]);

        let mut dirs = r.directorios.clone();
        dirs.sort();
        assert_eq!(dirs, vec!["Proyectos", "Proyectos/2026", "Vacía"]);

        // Los envoltorios devuelven lo mismo que la pasada única.
        assert_eq!(listar_archivos_meta(base.to_string_lossy().to_string()).unwrap().len(), 2);
        assert_eq!(listar_otros_archivos(base.to_string_lossy().to_string()).unwrap().len(), 2);

        std::fs::remove_dir_all(&base).unwrap();
    }

    /// `listar_directorios` enumera TODOS los subdirectorios (incluidos los
    /// vacíos) con ruta relativa POSIX, e ignora ocultos y `.mycelium`.
    #[test]
    fn listar_directorios_incluye_vacios_e_ignora_ocultos() {
        let base = std::env::temp_dir().join(format!("mycelium-dirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("Proyectos/2026")).unwrap();
        std::fs::create_dir_all(base.join("Vacía")).unwrap(); // sin archivos
        std::fs::create_dir_all(base.join(".mycelium/.trash")).unwrap();
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::write(base.join("Proyectos/2026/plan.md"), "x").unwrap();

        let mut dirs = listar_directorios(base.to_string_lossy().to_string()).unwrap();
        dirs.sort();
        assert_eq!(dirs, vec!["Proyectos", "Proyectos/2026", "Vacía"]);

        std::fs::remove_dir_all(&base).unwrap();
    }
}
