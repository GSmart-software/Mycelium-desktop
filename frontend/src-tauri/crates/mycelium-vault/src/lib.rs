//! Qué vault es una carpeta para Mycelium, contestado igual que la app
//! (`FUN-L-09`).
//!
//! Lo usa el servidor MCP de control (`mycelium-mcp`) para resolver **su**
//! vault contra el registro de la app y, desde la Parte 1, para nombrar el
//! canal con la ventana de ese vault (`\\.\pipe\mycelium-<hash>`). Ver
//! `docs/features/mcp-control.md` § 2.
//!
//! | Módulo | Contesta |
//! |---|---|
//! | [`registro`] | el formato de `vaults.json` y qué vault contiene una carpeta |
//! | [`rutas`] | si dos rutas son el mismo vault, el hash de su ruta y dónde está la configuración de la app |

pub mod registro;
pub mod rutas;
