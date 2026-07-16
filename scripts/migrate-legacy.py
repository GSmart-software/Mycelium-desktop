#!/usr/bin/env python3
"""
Migración de datos del backend .NET (SQLite + blobs en disco) al modelo del
desktop Tauri (SQLite único: contenido/diagramas/css en tablas).

Origen  : backend/src/Micelio.Api/micelio.local.db  +  .local-storage/blobs/
Destino : %APPDATA%/com.mycelium.desktop/mycelium.db  (el que crea `tauri dev`)

Como el escritorio es monousuario (auth latente = usuarios LIMIT 1), se migra
SOLO el usuario dueño del vault con más notas y los vaults donde es miembro.
El resto (usuarios "colega", vaults vacíos compartidos) se descarta: el sharing
está latente y se reconstruye al integrar la nube.

Uso:
  python scripts/migrate-legacy.py --dry-run      # reporta, no escribe
  python scripts/migrate-legacy.py                # migra (hace backup del destino)

IMPORTANTE: cierra la app de escritorio antes de migrar (el .db no debe estar en uso).
"""
import argparse
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OLD_DB = REPO / "backend/src/Micelio.Api/micelio.local.db"
DEFAULT_BLOBS = REPO / "backend/src/Micelio.Api/.local-storage/blobs"
DEFAULT_NEW_DB = Path(os.environ.get("APPDATA", "")) / "com.mycelium.desktop" / "mycelium.db"

# Tablas de la app a resetear antes de importar (hijas → padres). NO se toca
# _sqlx_migrations (control de versiones del plugin tauri-plugin-sql).
RESET_ORDER = [
    "notas_fts", "contenidos", "diagramas", "papelera",
    "notas", "carpetas", "membresias", "vaults", "css_snippets", "usuarios",
]


def read_blob(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Migra datos legacy .NET → mycelium.db (Tauri)")
    ap.add_argument("--old-db", type=Path, default=DEFAULT_OLD_DB)
    ap.add_argument("--blobs", type=Path, default=DEFAULT_BLOBS)
    ap.add_argument("--new-db", type=Path, default=DEFAULT_NEW_DB)
    ap.add_argument("--dry-run", action="store_true", help="solo reporta, no escribe")
    args = ap.parse_args()

    if not args.old_db.exists():
        print(f"ERROR: no existe el db origen: {args.old_db}", file=sys.stderr)
        return 1
    if not args.new_db.exists():
        print(f"ERROR: no existe el db destino: {args.new_db}\n"
              f"       Lanza `npm run tauri dev` una vez para crearlo.", file=sys.stderr)
        return 1

    old = sqlite3.connect(f"file:{args.old_db}?mode=ro", uri=True)
    old.row_factory = sqlite3.Row

    # 1) Usuario principal = dueño del vault con más notas.
    row = old.execute(
        """SELECT v.id AS vault_id, v.propietario_id AS user_id, count(n.id) AS c
           FROM vaults v LEFT JOIN notas n ON n.vault_id = v.id
           GROUP BY v.id ORDER BY c DESC LIMIT 1"""
    ).fetchone()
    primary_user = row["user_id"]
    print(f"Usuario principal: {primary_user}  (vault principal {row['vault_id']}, {row['c']} notas)")

    # 2) Vaults del usuario: propios + donde tiene membresía.
    vault_ids = {r["id"] for r in old.execute(
        "SELECT id FROM vaults WHERE propietario_id = ?", (primary_user,))}
    vault_ids |= {r["recurso_id"] for r in old.execute(
        "SELECT recurso_id FROM membresias WHERE usuario_id = ? AND recurso_tipo = 'vault'",
        (primary_user,))}
    vault_ids = {v for v in vault_ids if v}
    ph = ",".join("?" * len(vault_ids))
    vlist = list(vault_ids)

    usuarios = old.execute("SELECT * FROM usuarios WHERE id = ?", (primary_user,)).fetchall()
    vaults = old.execute(f"SELECT * FROM vaults WHERE id IN ({ph})", vlist).fetchall()
    membresias = old.execute(
        "SELECT * FROM membresias WHERE usuario_id = ?", (primary_user,)).fetchall()
    carpetas = old.execute(f"SELECT * FROM carpetas WHERE vault_id IN ({ph})", vlist).fetchall()
    notas = old.execute(f"SELECT * FROM notas WHERE vault_id IN ({ph})", vlist).fetchall()
    papelera = old.execute(
        f"SELECT p.* FROM papelera p JOIN notas n ON n.id = p.nota_id WHERE n.vault_id IN ({ph})",
        vlist).fetchall()
    css = old.execute("SELECT * FROM css_snippets WHERE usuario_id = ?", (primary_user,)).fetchall()

    # 3) Resolver contenidos (blobs) por nota.
    contenidos = {}   # nota_id -> texto
    for n in notas:
        ext = "excalidraw" if n["tipo"] == "excalidraw" else "md"
        blob = args.blobs / "vaults" / n["vault_id"] / "notas" / f"{n['id']}.{ext}"
        txt = read_blob(blob)
        if txt is not None and txt != "":
            contenidos[n["id"]] = txt

    # 4) Diagramas embebidos (blobs vaults/{v}/diagramas/{notaId}/{diagId}.excalidraw).
    nota_ids = {n["id"] for n in notas}
    diagramas = []  # (nota_id, diag_id, contenido)
    for vid in vault_ids:
        ddir = args.blobs / "vaults" / vid / "diagramas"
        if not ddir.is_dir():
            continue
        for nota_dir in ddir.iterdir():
            if not nota_dir.is_dir() or nota_dir.name not in nota_ids:
                continue
            for f in nota_dir.glob("*.excalidraw"):
                txt = read_blob(f)
                if txt is not None:
                    diagramas.append((nota_dir.name, f.stem, txt))

    # 5) Contenido de css snippets (blob usuarios/{uid}/css/{id}.css).
    css_content = {}
    for s in css:
        txt = read_blob(args.blobs / "usuarios" / primary_user / "css" / f"{s['id']}.css")
        css_content[s["id"]] = txt if txt is not None else ""

    print("\nA migrar:")
    print(f"  usuarios   : {len(usuarios)}")
    print(f"  vaults     : {len(vaults)}  -> {vlist}")
    print(f"  membresias : {len(membresias)}")
    print(f"  carpetas   : {len(carpetas)}")
    print(f"  notas      : {len(notas)}  (con contenido: {len(contenidos)})")
    print(f"  diagramas  : {len(diagramas)}")
    print(f"  papelera   : {len(papelera)}")
    print(f"  css        : {len(css)}")

    if args.dry_run:
        print("\n[dry-run] no se escribió nada.")
        return 0

    # Backup del destino antes de tocar nada.
    bak = args.new_db.with_suffix(f".db.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(args.new_db, bak)
    print(f"\nBackup del destino: {bak}")

    new = sqlite3.connect(str(args.new_db))
    new.execute("PRAGMA foreign_keys = OFF")
    try:
        for t in RESET_ORDER:
            new.execute(f"DELETE FROM {t}")

        new.executemany(
            """INSERT INTO usuarios (id,email,nombre,password_hash,github_id,avatar_url,
               email_verificado,tema,modo_oscuro,preferencias_json,creado_en,actualizado_en)
               VALUES (:id,:email,:nombre,:password_hash,:github_id,:avatar_url,
               :email_verificado,:tema,:modo_oscuro,:preferencias_json,:creado_en,:actualizado_en)""",
            [dict(u) for u in usuarios])
        new.executemany(
            "INSERT INTO vaults (id,nombre,propietario_id,creado_en) VALUES (:id,:nombre,:propietario_id,:creado_en)",
            [dict(v) for v in vaults])
        new.executemany(
            """INSERT INTO membresias (id,usuario_id,recurso_tipo,recurso_id,rol,creado_en)
               VALUES (:id,:usuario_id,:recurso_tipo,:recurso_id,:rol,:creado_en)""",
            [dict(m) for m in membresias])
        new.executemany(
            """INSERT INTO carpetas (id,vault_id,padre_id,nombre,creado_en,actualizado_en)
               VALUES (:id,:vault_id,:padre_id,:nombre,:creado_en,:actualizado_en)""",
            [dict(c) for c in carpetas])
        # notas: se descarta r2_key (ya no hay blobs)
        new.executemany(
            """INSERT INTO notas (id,vault_id,carpeta_id,titulo,tipo,tamano_bytes,creado_en,actualizado_en)
               VALUES (:id,:vault_id,:carpeta_id,:titulo,:tipo,:tamano_bytes,:creado_en,:actualizado_en)""",
            [{k: n[k] for k in ("id","vault_id","carpeta_id","titulo","tipo","tamano_bytes","creado_en","actualizado_en")}
             for n in notas])
        new.executemany(
            """INSERT INTO papelera (id,nota_id,ruta_original,carpeta_original_id,eliminado_en)
               VALUES (:id,:nota_id,:ruta_original,:carpeta_original_id,:eliminado_en)""",
            [dict(p) for p in papelera])

        # contenidos + reindex FTS (titulo del propio registro de nota)
        titulo_por_id = {n["id"]: n["titulo"] for n in notas}
        actualizado_por_id = {n["id"]: n["actualizado_en"] for n in notas}
        for nid, txt in contenidos.items():
            new.execute("INSERT INTO contenidos (nota_id,contenido,actualizado_en) VALUES (?,?,?)",
                        (nid, txt, actualizado_por_id[nid]))
            new.execute("INSERT INTO notas_fts (nota_id,titulo,contenido) VALUES (?,?,?)",
                        (nid, titulo_por_id[nid], txt))

        now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        new.executemany(
            "INSERT INTO diagramas (nota_id,diag_id,contenido,actualizado_en) VALUES (?,?,?,?)",
            [(nid, did, txt, now) for (nid, did, txt) in diagramas])
        new.executemany(
            "INSERT INTO css_snippets (id,usuario_id,nombre,activo,contenido,creado_en) VALUES (?,?,?,?,?,?)",
            [(s["id"], s["usuario_id"], s["nombre"], s["activo"], css_content[s["id"]], s["creado_en"])
             for s in css])

        new.commit()
    except Exception:
        new.rollback()
        raise
    finally:
        new.close()

    # OJO: solo caracteres cp1252 (el ✔ revienta en la consola de Windows).
    print("\nOK - Migración completa. Abre la app: entrará al vault real (auth latente).")
    print(f"  Si algo sale mal, restaura el backup: {bak} -> {args.new_db}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
