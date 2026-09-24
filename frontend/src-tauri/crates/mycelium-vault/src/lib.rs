//! Qué es un vault de Mycelium, contestado en **un solo lugar** (`FUN-L-10`).
//!
//! Lo usan dos procesos: la app de escritorio (Tauri) y el servidor MCP de
//! memoria (`mycelium-mcp`, `FUN-L-09`). Cada uno escribe **su propia base**
//! —la app su `index-<hash>.db`, el MCP su `mcp-<hash>.db`—, pero la respuesta a
//! «qué archivos son notas», «qué ignora el `.mycignore`», «es el mismo vault»,
//! «qué es un enlace» o «dónde empieza una sección» sale de este crate. Dos
//! implementaciones de esas preguntas derivan; ver
//! `docs/arquitectura/MCP de Mycelium - plan.md` § 3.
//!
//! | Módulo | Contesta | Lo usa hoy |
//! |---|---|---|
//! | [`mycignore`] | qué se ignora del vault | app + MCP |
//! | [`rutas`] | si dos rutas son el mismo vault; el nombre de su índice | app + MCP |
//! | [`registro`] | el formato de `vaults.json` | app + MCP |
//! | [`tipos`] | qué archivos son notas y de qué tipo | app + MCP |
//! | [`recorrido`] | el walker del vault | app + MCP |
//! | [`wikilinks`], [`frontmatter`], [`markdown`] | enlaces, propiedades, tags y secciones | MCP (la app sigue en TS) |
//! | `indice` (feature) | el índice de recuperación en SQLite | MCP |

pub mod frontmatter;
pub mod markdown;
pub mod mycignore;
pub mod recorrido;
pub mod registro;
pub mod rutas;
pub mod tipos;
pub mod wikilinks;

#[cfg(feature = "indice")]
pub mod indice;
