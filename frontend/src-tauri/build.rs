use std::path::{Path, PathBuf};

fn main() {
    asegurar_sidecar_mcp();
    tauri_build::build()
}

/// El servidor MCP de control (`FUN-L-09`) viaja como *sidecar* de Tauri
/// (`bundle.externalBin` en `tauri.conf.json`), y `tauri-build` **exige** que
/// exista `binaries/mycelium-mcp-<target-triple>[.exe]`: sin él no compila ni
/// un `cargo check`. Lo deja ahí `scripts/preparar-mcp.mjs`, que corre en el
/// `beforeBuildCommand` y el `beforeDevCommand`.
///
/// Para que un `cargo check`/`cargo test` suelto no se rompa sin haberlo
/// preparado, en **debug** se cubre el hueco: con el binario del workspace ya
/// compilado en `target/debug/` si lo hay, o con un archivo vacío como marcador
/// (la app lo detecta y no lo ofrece: `control::mcp_ruta_binario`). En
/// **release** no: un instalador con un marcador vacío sería un MCP roto, así
/// que se corta con la instrucción.
fn asegurar_sidecar_mcp() {
    let triple = std::env::var("TARGET").expect("cargo define TARGET");
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let sidecar = PathBuf::from(format!("binaries/mycelium-mcp-{triple}{ext}"));
    println!("cargo:rerun-if-changed={}", sidecar.display());
    if sidecar.exists() {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "Falta {}: el servidor MCP de control se empaqueta como sidecar. \
             Prepararlo con `cd frontend && npm run preparar-mcp` (lo hace solo `npx tauri build`).",
            sidecar.display()
        );
    }
    let _ = std::fs::create_dir_all("binaries");
    let compilado = dir_target().map(|t| t.join("debug").join(format!("mycelium-mcp{ext}")));
    match compilado.filter(|c| c.is_file()) {
        Some(c) => {
            let _ = std::fs::copy(&c, &sidecar);
        }
        None => {
            let _ = std::fs::write(&sidecar, b"");
            println!(
                "cargo:warning=Sin el servidor MCP compilado: se usa un marcador vacío en {}. \
                 Para probar el control desde Claude Code, `npm run preparar-mcp -- --dev`.",
                sidecar.display()
            );
        }
    }
}

/// `target/` a partir de `OUT_DIR` (`target/<perfil>/build/app-<hash>/out`).
fn dir_target() -> Option<PathBuf> {
    let out = PathBuf::from(std::env::var_os("OUT_DIR")?);
    out.ancestors().nth(4).map(Path::to_path_buf)
}
