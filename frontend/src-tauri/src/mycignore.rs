//! `.mycignore` por vault (estilo `.gitignore`, FUN-M-11).
//!
//! Cada vault puede tener un archivo `.mycignore` en su raíz que decide qué
//! archivos/carpetas IGNORA Mycelium al indexar y al observar cambios. Sin el
//! archivo, el comportamiento por defecto ignora los directorios ocultos (`.*/`)
//! y las carpetas de build/dependencias más habituales (ver `DEFAULT`).
//!
//! Sintaxis (subconjunto de gitignore; con negaciones desde `FUN-S-30`):
//! - Líneas vacías y `# comentarios` se omiten.
//! - `nombre/` — ignora DIRECTORIOS con ese nombre en cualquier nivel.
//! - `nombre` — ignora archivos o carpetas con ese nombre en cualquier nivel.
//! - `ruta/con/barras` o `/nombre` — anclada a la raíz del vault (p. ej.
//!   `docs/tmp/`). Una `/` al principio o en el medio ancla; la del final solo
//!   dice «directorio».
//! - `*` y `?` — comodines dentro de un segmento (`*.tmp.md`, `.*/`).
//! - `**` como segmento entero — cero o más carpetas (`a/**/b`, `**/nombre`);
//!   al final (`a/**`), todo lo que hay DENTRO de `a`, no `a` misma.
//! - `!patrón` — NEGACIÓN: vuelve a incluir lo que una regla anterior ignoró.
//!   `\!` al principio es un `!` literal (un nombre que empieza con `!`).
//! - `.mycelium/` (índice interno + papelera) se ignora SIEMPRE, esté o no, y
//!   ninguna negación lo vuelve a incluir.
//!
//! Evaluación (la de git):
//! 1. Las reglas se leen en orden y **la última que coincide gana**: una `!`
//!    posterior re-incluye; una regla normal posterior vuelve a ignorar.
//! 2. Una regla se compara con la ruta MISMA, no con sus ancestros. Lo que está
//!    dentro de una carpeta ignorada queda ignorado porque su carpeta lo está, y
//!    **no se puede re-incluir un archivo si una carpeta que lo contiene está
//!    ignorada** —salvo re-incluyendo esa carpeta—. Por eso `.*/` + `!.claude/*.md`
//!    no muestra nada: hace falta `!.claude/` (recetas en
//!    `docs/features/mycignore.md`).
//!
//! La regla 2 es la que mantiene correcta la poda de los recorridos
//! (`archivos::recorrer_todo`, `recorrer_observables`, `arbol_a_copiar`): una
//! carpeta ignorada nunca tiene nada visible dentro, así que no entrar en ella
//! no pierde nada. Y una carpeta re-incluida (`!.claude/`) ya no está ignorada,
//! así que el recorrido entra sin ningún caso especial.

use std::path::Path;

/// Nombre del archivo de configuración en la raíz del vault.
pub const ARCHIVO: &str = ".mycignore";

/// Comportamiento cuando el vault no tiene `.mycignore`: directorios ocultos +
/// las carpetas de dependencias/build que hacen que abrir un repo como vault
/// indexe decenas de miles de archivos que no son notas (FUN-M-12).
///
/// `build/` y `vendor/` quedan fuera a propósito: es más probable que sean
/// carpetas legítimas de notas que ruido de compilación.
///
/// OJO: un `.mycignore` presente **reemplaza este default por completo**. Quien
/// tenga notas en una carpeta llamada `dist` escribe su propio archivo sin esa
/// línea; quien quiera ver `.claude/` agrega `!.claude/` DEBAJO de `.*/`.
const DEFAULT: &str = ".*/\nnode_modules/\ntarget/\ndist/\nout/";

/// Cabecera explicativa de la plantilla que ofrece Configuración → Vault.
const CABECERA_PLANTILLA: &str = "\
# .mycignore — qué ignora Mycelium en este vault (uno por línea)
# nombre/ = carpetas con ese nombre en cualquier nivel
# ruta/anidada/ = anclada a la raíz · * y ? comodines · # comentario
# !patrón = vuelve a incluir (gana la última regla que coincide); p. ej.
#   !.claude/ debajo de .*/ muestra .claude/. Lo que está dentro de una
#   carpeta ignorada no vuelve si no re-incluís la carpeta.
# .mycelium/ (índice interno) se ignora siempre.
# Esto es el comportamiento por defecto: borrá la línea que no te sirva
# (p. ej. si tenés notas en una carpeta llamada dist).
";

/// Plantilla que muestra el editor de `.mycignore` cuando el vault no tiene uno:
/// la cabecera comentada + `DEFAULT`, así que guardarla sin tocar es «lo mismo
/// que sin archivo».
///
/// Antes el frontend (`VaultSection.tsx`) tenía su propia copia con un «DEBE
/// espejar `DEFAULT`» en un comentario; ahora la pide acá y hay una sola lista
/// (auditoría del 2026-09-26, H11).
#[tauri::command]
pub fn mycignore_default() -> String {
    format!("{CABECERA_PLANTILLA}{DEFAULT}\n")
}

/// Un patrón parseado del `.mycignore`.
pub struct Patron {
    /// Empieza con `!`: si es la última regla que coincide, la ruta se INCLUYE.
    negado: bool,
    /// Termina en `/`: solo coincide con directorios (su contenido cae porque
    /// cae la carpeta, ver `ignorada`).
    solo_dir: bool,
    /// Tiene `/` al principio o en el medio: se compara desde la raíz del vault.
    anclado: bool,
    segmentos: Vec<Segmento>,
}

/// Un segmento del patrón, **precompilado** al cargar el archivo
/// (`FUN-M-38`, hallazgo H9 de la auditoría de eficiencia).
///
/// Antes cada comparación hacía `chars().collect::<Vec<_>>()` del patrón y de
/// la ruta —dos reservas de memoria por patrón y por segmento— para todas las
/// rutas de todos los recorridos: en un vault chico con 13 patrones era la
/// mitad del tiempo del recorrido. Ahora el patrón se descompone una sola vez
/// y, si no tiene comodines (`node_modules`, `.git`), la comparación es un
/// `==` de cadenas sin reservar nada.
enum Segmento {
    /// Sin `*` ni `?`: se compara por igualdad.
    Literal(String),
    /// Con comodines: se hace glob sobre los caracteres ya separados.
    Glob(Vec<char>),
    /// `**` como segmento entero: cero o más carpetas (`FUN-S-30`).
    Cualquiera,
}

impl Segmento {
    fn compilar(texto: &str) -> Segmento {
        if texto == "**" {
            Segmento::Cualquiera
        } else if texto.contains(['*', '?']) {
            Segmento::Glob(texto.chars().collect())
        } else {
            Segmento::Literal(texto.to_string())
        }
    }
}

/// Carga los patrones del vault (o el default si no hay `.mycignore`).
pub fn cargar(base: &Path) -> Vec<Patron> {
    let texto = std::fs::read_to_string(base.join(ARCHIVO)).unwrap_or_else(|_| DEFAULT.into());
    parsear(&texto)
}

/// Parsea el texto de un `.mycignore`.
pub fn parsear(texto: &str) -> Vec<Patron> {
    texto
        .lines()
        .filter_map(|linea| {
            let linea = linea.trim();
            if linea.is_empty() || linea.starts_with('#') {
                return None;
            }
            // `!` niega; `\!` es un `!` literal (un nombre que empieza con `!`).
            let (negado, linea) = match linea.strip_prefix('!') {
                Some(resto) => (true, resto),
                None => (false, linea.strip_prefix("\\!").map_or(linea, |_| &linea[1..])),
            };
            let solo_dir = linea.ends_with('/');
            let sin_final = linea.trim_end_matches('/');
            // Como en git: una `/` al principio o en el medio ancla a la raíz
            // (`/borradores/`, `docs/tmp/`); la del final solo dice «directorio».
            let anclado = sin_final.contains('/');
            let mut segmentos: Vec<Segmento> = sin_final
                .split('/')
                .filter(|s| !s.is_empty())
                .map(Segmento::compilar)
                .collect();
            if segmentos.is_empty() {
                return None;
            }
            // `**/nombre` es `nombre` en cualquier nivel: se guarda sin anclar,
            // que es más barato de comparar.
            let anclado = if anclado
                && segmentos.len() == 2
                && matches!(segmentos[0], Segmento::Cualquiera)
                && !matches!(segmentos[1], Segmento::Cualquiera)
            {
                segmentos.remove(0);
                false
            } else {
                anclado
            };
            Some(Patron { negado, solo_dir, anclado, segmentos })
        })
        .collect()
}

/// ¿El segmento del patrón coincide con este componente de la ruta?
///
/// El literal es un `==`. El glob (`*` = cualquier tramo sin `/`, `?` = un
/// carácter) avanza sobre la ruta como `&str` —por límites de carácter, sin
/// convertirla a `Vec<char>`—, así que tampoco reserva memoria por llamada.
fn glob_seg(patron: &Segmento, seg: &str) -> bool {
    fn glob(p: &[char], s: &str) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some('*') => {
                // Probar cada corte válido de `s` (incluido el vacío y el total).
                glob(&p[1..], s)
                    || s
                        .char_indices()
                        .any(|(i, c)| glob(&p[1..], &s[i + c.len_utf8()..]))
            }
            Some('?') => match s.chars().next() {
                Some(c) => glob(&p[1..], &s[c.len_utf8()..]),
                None => false,
            },
            Some(c) => match s.chars().next() {
                Some(d) if d == *c => glob(&p[1..], &s[d.len_utf8()..]),
                _ => false,
            },
        }
    }
    match patron {
        Segmento::Literal(texto) => texto == seg,
        Segmento::Glob(chars) => glob(chars, seg),
        // Un `**` solo en la línea coincide con cualquier nombre (git).
        Segmento::Cualquiera => true,
    }
}

/// ¿Los segmentos del patrón coinciden con la ruta ENTERA `segs`?
///
/// `**` absorbe cero o más segmentos; al final del patrón, uno o más (`a/**`
/// es lo que hay dentro de `a`, no `a`).
fn coinciden_segmentos(pat: &[Segmento], segs: &[&str]) -> bool {
    match pat.first() {
        None => segs.is_empty(),
        Some(Segmento::Cualquiera) => {
            let resto = &pat[1..];
            let minimo = usize::from(resto.is_empty());
            (minimo..=segs.len()).any(|k| coinciden_segmentos(resto, &segs[k..]))
        }
        Some(seg) => {
            !segs.is_empty()
                && glob_seg(seg, segs[0])
                && coinciden_segmentos(&pat[1..], &segs[1..])
        }
    }
}

/// ¿Un patrón coincide con la ruta `segs` MISMA? No mira los ancestros: que lo
/// de adentro de una carpeta ignorada caiga con ella lo resuelve `ignorada`,
/// carpeta por carpeta (antes lo hacía cada patrón, y por eso una negación no
/// tenía dónde encajar).
fn coincide(p: &Patron, segs: &[&str], es_dir: bool) -> bool {
    if p.solo_dir && !es_dir {
        return false;
    }
    if p.anclado {
        coinciden_segmentos(&p.segmentos, segs)
    } else {
        // Sin anclar, el patrón es un único segmento y se compara con el nombre.
        segs.last().is_some_and(|nombre| glob_seg(&p.segmentos[0], nombre))
    }
}

/// Veredicto de las reglas sobre la ruta misma: decide la ÚLTIMA que coincide.
fn excluida(segs: &[&str], es_dir: bool, patrones: &[Patron]) -> bool {
    patrones
        .iter()
        .rev()
        .find(|p| coincide(p, segs, es_dir))
        .is_some_and(|p| !p.negado)
}

/// ¿La ruta relativa POSIX está ignorada? `.mycelium` lo está SIEMPRE, antes
/// de mirar ningún patrón: ninguna negación lo re-incluye.
///
/// Como en git, primero se mira cada carpeta que contiene a la ruta, de la raíz
/// hacia abajo: si alguna está ignorada, la ruta también, diga lo que diga una
/// negación sobre ella. Los recorridos ya podan las carpetas ignoradas, así que
/// para ellos esa vuelta siempre da «no»; el watcher, en cambio, pregunta por
/// rutas sueltas y la necesita.
pub fn ignorada(rel: &str, es_dir: bool, patrones: &[Patron]) -> bool {
    let segs: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return false;
    }
    if segs[0] == ".mycelium" {
        return true;
    }
    if patrones.is_empty() {
        return false;
    }
    (1..segs.len()).any(|k| excluida(&segs[..k], true, patrones))
        || excluida(&segs, es_dir, patrones)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ignora_dirs_ocultos_pero_no_archivos_ocultos() {
        let p = parsear(".*/");
        assert!(ignorada(".git", true, &p));
        assert!(ignorada(".claude/commands/x.md", false, &p));
        assert!(!ignorada(".mycignore", false, &p)); // archivo oculto, no dir
        assert!(!ignorada("notas/a.md", false, &p));
    }

    /// Guardar la plantilla sin tocarla no debe cambiar qué se ignora.
    #[test]
    fn la_plantilla_equivale_al_default() {
        let reglas = |t: &str| -> Vec<String> {
            t.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .map(String::from)
                .collect()
        };
        assert_eq!(reglas(&mycignore_default()), reglas(DEFAULT));
    }

    /// El default (sin `.mycignore` en el vault) tiene que cubrir las carpetas
    /// de dependencias/build: es lo que hace que abrir un repo como vault no
    /// indexe los README de `node_modules` (FUN-M-12).
    #[test]
    fn default_ignora_carpetas_de_dependencias_y_build() {
        let p = parsear(DEFAULT);
        assert!(ignorada("node_modules", true, &p));
        assert!(ignorada("node_modules/react/README.md", false, &p));
        assert!(ignorada("frontend/node_modules/x/LEEME.md", false, &p));
        assert!(ignorada("frontend/src-tauri/target/debug/x.md", false, &p));
        assert!(ignorada("dist", true, &p));
        assert!(ignorada("out/index.md", false, &p));
        // Sigue ignorando los ocultos, y NO toca las notas de verdad.
        assert!(ignorada(".git/config", false, &p));
        assert!(!ignorada("docs/BACKLOG.md", false, &p));
        // `build/` y `vendor/` quedan fuera del default a propósito.
        assert!(!ignorada("build/nota.md", false, &p));
        assert!(!ignorada("vendor/nota.md", false, &p));
        // Un archivo (no directorio) llamado `dist` no cae: los patrones son `dir/`.
        assert!(!ignorada("dist", false, &p));
    }

    #[test]
    fn mycelium_siempre_ignorado() {
        let p = parsear(""); // sin patrones
        assert!(ignorada(".mycelium", true, &p));
        assert!(ignorada(".mycelium/.trash/x.md", false, &p));
    }

    #[test]
    fn patrones_anclados_y_por_nombre() {
        let p = parsear("# comentario\nborradores/\ndocs/tmp/\n*.tmp.md\n");
        assert!(ignorada("borradores", true, &p));
        assert!(ignorada("sub/borradores/x.md", false, &p));
        assert!(ignorada("docs/tmp/x.md", false, &p));
        assert!(!ignorada("otra/docs/tmp", true, &p)); // anclado a la raíz
        assert!(ignorada("a/b/c.tmp.md", false, &p));
        assert!(!ignorada("a/b/c.md", false, &p));
    }

    #[test]
    fn sin_default_los_ocultos_se_indexan() {
        let p = parsear(".git/\n.obsidian/\n");
        assert!(ignorada(".git/config", false, &p));
        assert!(!ignorada(".claude/commands/x.md", false, &p)); // ya no ignorado
    }

    /// Los segmentos precompilados (`FUN-M-38`) dan lo mismo que el glob de
    /// antes: `*` vacío, al principio, al medio y al final; `?` como UN carácter
    /// —también uno de varios bytes—; y un literal que solo es prefijo no cae.
    #[test]
    fn comodines_precompilados_con_caracteres_de_varios_bytes() {
        let p = parsear("bor?ador/\n*.log\nñ*/\nfoto-*-final.png\narchivo\n");
        assert!(ignorada("borrador", true, &p));
        assert!(ignorada("borñador/x.md", false, &p)); // `?` = un carácter de 2 bytes
        assert!(!ignorada("borador", true, &p)); // `?` no es opcional
        assert!(ignorada("a/b/.log", false, &p)); // `*` vacío
        assert!(ignorada("error.log", false, &p));
        assert!(!ignorada("error.log.md", false, &p));
        assert!(ignorada("ñandú/x.md", false, &p));
        assert!(ignorada("ñ", true, &p));
        assert!(!ignorada("nandu/x.md", false, &p));
        assert!(ignorada("fotos/foto-2026-final.png", false, &p));
        assert!(ignorada("foto--final.png", false, &p));
        assert!(!ignorada("foto-2026-final.jpg", false, &p));
        assert!(ignorada("archivo", false, &p)); // literal exacto
        assert!(!ignorada("archivos", false, &p)); // no por prefijo
    }

    // ── Negaciones (`FUN-S-30`) ──────────────────────────────────────────────

    /// La última regla que coincide gana: la `!` re-incluye solo si va DESPUÉS.
    #[test]
    fn negacion_la_ultima_regla_que_coincide_gana() {
        let p = parsear("*.log\n!importante.log\n");
        assert!(ignorada("error.log", false, &p));
        assert!(!ignorada("importante.log", false, &p));
        assert!(!ignorada("sub/importante.log", false, &p));

        let p = parsear("!importante.log\n*.log\n");
        assert!(ignorada("importante.log", false, &p), "la ! de antes no vale");

        // Y una regla normal posterior vuelve a ignorar.
        let p = parsear("*.log\n!importante.log\nimportante.log\n");
        assert!(ignorada("importante.log", false, &p));
    }

    /// Re-incluir la carpeta la vuelve a abrir con todo su contenido, salvo lo
    /// que otra regla siga ignorando adentro.
    #[test]
    fn negacion_reincluye_una_carpeta() {
        let p = parsear(".*/\n!.claude/\n");
        assert!(!ignorada(".claude", true, &p));
        assert!(!ignorada(".claude/CLAUDE.md", false, &p));
        assert!(!ignorada(".claude/commands/vault-buscar.md", false, &p));
        assert!(ignorada(".git", true, &p));
        assert!(ignorada(".git/config", false, &p));
        // Una carpeta oculta DENTRO de `.claude/` sigue cayendo por `.*/`.
        assert!(ignorada(".claude/.cache/x.md", false, &p));
        // `!.claude/` es de carpeta: un ARCHIVO llamado `.claude` no lo toca
        // (y además los archivos ocultos nunca estuvieron ignorados).
        assert!(!ignorada(".claude", false, &p));
    }

    /// Como en git: lo de adentro de una carpeta ignorada no se re-incluye
    /// mientras la carpeta siga ignorada. Es lo que deja podar al recorrido.
    #[test]
    fn negacion_no_rescata_un_archivo_de_una_carpeta_ignorada() {
        let p = parsear(".*/\n!.claude/*.md\n");
        assert!(ignorada(".claude", true, &p));
        assert!(ignorada(".claude/CLAUDE.md", false, &p));

        let p = parsear(".*/\n!.claude/**\n"); // `**` final no incluye la carpeta
        assert!(ignorada(".claude/CLAUDE.md", false, &p));

        let p = parsear("borradores/\n!borradores/vale.md\n");
        assert!(ignorada("borradores/vale.md", false, &p));
        // Re-incluir la carpeta y después ignorar su contenido sí funciona.
        let p = parsear("borradores/\n!borradores/\nborradores/*\n!borradores/vale.md\n");
        assert!(!ignorada("borradores", true, &p));
        assert!(!ignorada("borradores/vale.md", false, &p));
        assert!(ignorada("borradores/otra.md", false, &p));
    }

    /// El caso que motivó `FUN-S-30`: ver solo los `.md` de primer nivel de
    /// `.claude/` (las normas del vault), con el resto del default intacto.
    #[test]
    fn negacion_receta_solo_los_md_de_claude() {
        let p = parsear(&format!("{DEFAULT}\n!.claude/\n.claude/*\n!.claude/*.md\n"));
        assert!(!ignorada(".claude", true, &p));
        assert!(!ignorada(".claude/normas.md", false, &p));
        assert!(ignorada(".claude/settings.json", false, &p));
        assert!(ignorada(".claude/skills", true, &p));
        assert!(ignorada(".claude/skills/vault/SKILL.md", false, &p));
        assert!(ignorada(".git/config", false, &p));
        assert!(ignorada("node_modules/x/README.md", false, &p));
        assert!(!ignorada("docs/nota.md", false, &p));

        // Variante recursiva: todos los `.md` de `.claude/`, en cualquier nivel.
        let p = parsear(&format!(
            "{DEFAULT}\n!.claude/\n.claude/**\n!.claude/**/\n!.claude/**/*.md\n"
        ));
        assert!(!ignorada(".claude/normas.md", false, &p));
        assert!(!ignorada(".claude/skills", true, &p));
        assert!(!ignorada(".claude/skills/vault/SKILL.md", false, &p));
        assert!(ignorada(".claude/skills/vault/validar.mjs", false, &p));
        assert!(ignorada(".claude/settings.json", false, &p));
    }

    /// `\!` es un `!` literal al principio: ignora el archivo, no niega.
    #[test]
    fn barra_invertida_escapa_el_signo_de_exclamacion() {
        let p = parsear("*.md\n\\!importante.md\n");
        assert!(ignorada("!importante.md", false, &p));
        assert!(ignorada("importante.md", false, &p), "no es una negación");
        let p = parsear("\\!borrador/\n");
        assert!(ignorada("!borrador/x.md", false, &p));
        assert!(!ignorada("borrador/x.md", false, &p));
    }

    /// `.mycelium/` no se re-incluye con ninguna negación.
    #[test]
    fn negacion_no_reincluye_mycelium() {
        let p = parsear("!.mycelium/\n!.mycelium/**\n!*\n!**/\n");
        assert!(ignorada(".mycelium", true, &p));
        assert!(ignorada(".mycelium/.trash/x.md", false, &p));
        assert!(ignorada(".mycelium/recordatorios.json", false, &p));
        // Solo la raíz: una `.mycelium` anidada sigue las reglas comunes.
        assert!(!ignorada("sub/.mycelium", true, &p));
    }

    /// `/` al principio ancla (como en git) y `**` vale cero o más carpetas.
    #[test]
    fn barra_inicial_ancla_y_doble_asterisco() {
        let p = parsear("/borradores/\n");
        assert!(ignorada("borradores/x.md", false, &p));
        assert!(!ignorada("sub/borradores/x.md", false, &p));

        let p = parsear("**/tmp/\n");
        assert!(ignorada("tmp", true, &p));
        assert!(ignorada("a/b/tmp/x.md", false, &p));

        let p = parsear("docs/**/borrador.md\n");
        assert!(ignorada("docs/borrador.md", false, &p));
        assert!(ignorada("docs/a/b/borrador.md", false, &p));
        assert!(!ignorada("otra/borrador.md", false, &p));

        let p = parsear("adjuntos/**\n");
        assert!(!ignorada("adjuntos", true, &p), "`a/**` no es `a`");
        assert!(ignorada("adjuntos/foto.png", false, &p));
        assert!(ignorada("adjuntos/2026/foto.png", false, &p));
    }
}
