"use client";

import { useEffect, useRef, useState } from "react";
import { CARPETA_ESPORAS_DEFECTO, normalizarCarpetaEsporas } from "@/lib/esporas";
import { exportVaultACarpeta, exportVaultZip } from "@/lib/export";
import {
  FRAMEWORK_IA_VERSION,
  generarFramework,
  versionInstalada,
} from "@/lib/ia/framework";
import { collectFromNativeFolder, collectFromZip } from "@/lib/import";
import { getAbrirUltimo, setAbrirUltimo } from "@/lib/vaultMode";
import { useExportStore } from "@/stores/exportStore";
import { useImportStore } from "@/stores/importStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { ENLACES_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./Settings.module.css";
import { confirmar } from "@/lib/confirmar";

// Títulos de progreso (DEF-018): identifican qué exportación corre para etiquetar
// el botón correcto y la barra global.
const T_ZIP = "Comprimiendo ZIP";
const T_CARPETA = "Exportando a carpeta";

/** Abre el selector de carpeta nativo del SO; `null` si el usuario cancela. */
async function elegirCarpeta(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegida = await open({ directory: true, multiple: false, title });
  return typeof elegida === "string" ? elegida : null;
}

/**
 * Sección Vault: exportar todo el vault (ZIP o carpeta real del SO, HU-09) e
 * importar Obsidian desde carpeta nativa o .zip (HU-11).
 */
export function VaultSection() {
  // Progreso GLOBAL (DEF-018): sobrevive al cierre del menú de opciones.
  const progreso = useExportStore((s) => s.progreso);
  const setProgreso = useExportStore((s) => s.setProgreso);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abrirUltimo, setAbrirUltimoState] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);
  // Framework IA (FUN-L-08): versión instalada en el vault (null = no generado).
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const [versionIa, setVersionIa] = useState<string | null>(null);
  const [generandoIa, setGenerandoIa] = useState(false);
  // .mycignore por vault (FUN-M-11): null = editor cerrado.
  const [ignoreTexto, setIgnoreTexto] = useState<string | null>(null);
  const [guardandoIgnore, setGuardandoIgnore] = useState(false);
  // Carpeta de Esporas (FUN-M-03): borrador local (se teclea libre) + el error
  // de validación, que se confirma al salir del campo.
  const carpetaEsporasPref = usePreferencesStore((s) => s.prefs.carpetaEsporas);
  const [esporasBorrador, setEsporasBorrador] = useState(carpetaEsporasPref);
  const [esporasError, setEsporasError] = useState<string | null>(null);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const ocupado = progreso !== null;

  // La preferencia se hidrata en asíncrono al abrir el vault: el borrador se
  // resetea DURANTE el render (no en un efecto) para no pintar el valor viejo.
  const [esporasVisto, setEsporasVisto] = useState(carpetaEsporasPref);
  if (esporasVisto !== carpetaEsporasPref) {
    setEsporasVisto(carpetaEsporasPref);
    setEsporasBorrador(carpetaEsporasPref);
    setEsporasError(null);
  }

  /** Confirma la carpeta de Esporas: si la ruta no es válida, no se guarda. */
  const confirmarCarpetaEsporas = () => {
    if (esporasBorrador === carpetaEsporasPref) return;
    const limpia = normalizarCarpetaEsporas(esporasBorrador);
    if (limpia === null) {
      setEsporasError(
        "Tiene que ser una carpeta DENTRO del vault: sin rutas absolutas ni «..».",
      );
      return;
    }
    setEsporasError(null);
    setEsporasBorrador(limpia);
    usePreferencesStore.getState().setPref("carpetaEsporas", limpia);
  };

  useEffect(() => {
    void getAbrirUltimo().then(setAbrirUltimoState).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (rutaVault) void versionInstalada(rutaVault).then(setVersionIa);
    else setVersionIa(null);
  }, [rutaVault]);

  const handleGenerarIa = async () => {
    if (!rutaVault) return;
    setMensaje(null);
    setError(null);
    setGenerandoIa(true);
    try {
      const conflictos = await generarFramework(rutaVault);
      setVersionIa(FRAMEWORK_IA_VERSION);
      if (conflictos.length === 0) {
        setMensaje(
          `Instrucciones IA v${FRAMEWORK_IA_VERSION} generadas en el vault (CLAUDE.md + .claude/).`,
        );
      } else {
        setMensaje(
          `Instrucciones IA v${FRAMEWORK_IA_VERSION} generadas. ⚠ ${conflictos.length} archivo(s) ` +
            `ya existían y NO se tocaron — la versión nueva se creó al lado: ` +
            conflictos.map((c) => c.generado).join(" · ") +
            `. Detalle en "Conflictos instrucciones IA.md" (raíz del vault).`,
        );
      }
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setGenerandoIa(false);
    }
  };

  const onToggleAbrirUltimo = async (valor: boolean) => {
    setAbrirUltimoState(valor); // optimista
    try {
      await setAbrirUltimo(valor);
    } catch {
      setAbrirUltimoState(!valor); // revertir si falla
    }
  };

  const handleZip = async () => {
    setProgreso({ done: 0, total: 1, titulo: T_ZIP });
    try {
      await exportVaultZip((done, total) => setProgreso({ done, total, titulo: T_ZIP }));
    } finally {
      setProgreso(null);
    }
  };

  const handleCarpeta = async () => {
    setMensaje(null);
    setError(null);
    try {
      const destino = await elegirCarpeta("Elegí la carpeta donde exportar el vault");
      if (!destino) return;

      const { invoke } = await import("@tauri-apps/api/core");
      const noVacia = await invoke<boolean>("carpeta_no_vacia", { ruta: destino });
      if (
        noVacia &&
        !(await confirmar(
          `La carpeta "${destino}" no está vacía.\n\n` +
            "Los archivos con el mismo nombre se sobrescriben. ¿Continuar?",
        ))
      ) {
        return;
      }

      setProgreso({ done: 0, total: 1, titulo: T_CARPETA });
      const escritos = await exportVaultACarpeta(destino, (done, total) =>
        setProgreso({ done, total, titulo: T_CARPETA }),
      );
      setMensaje(`Se escribieron ${escritos} archivos en ${destino}`);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setProgreso(null);
    }
  };

  const activeFolder = () => useVaultStore.getState().activeFolderId;

  // Plantilla por defecto del .mycignore: DEBE espejar `mycignore::DEFAULT` de
  // `src-tauri/src/mycignore.rs` para que siga siendo "lo mismo que sin archivo".
  const IGNORE_DEFAULT =
    "# .mycignore — qué ignora Mycelium en este vault (uno por línea)\n" +
    "# nombre/ = carpetas con ese nombre en cualquier nivel\n" +
    "# ruta/anidada/ = anclada a la raíz · * y ? comodines · # comentario\n" +
    "# .mycelium/ (índice interno) se ignora siempre.\n" +
    "# Esto es el comportamiento por defecto: borrá la línea que no te sirva\n" +
    "# (p. ej. si tenés notas en una carpeta llamada dist).\n" +
    ".*/\n" +
    "node_modules/\n" +
    "target/\n" +
    "dist/\n" +
    "out/\n";

  const abrirIgnore = async () => {
    if (!rutaVault) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const actual = await invoke<string | null>("leer_archivo_texto", {
      vaultRuta: rutaVault,
      rutaRel: ".mycignore",
    });
    setIgnoreTexto(actual ?? IGNORE_DEFAULT);
  };

  const guardarIgnore = async () => {
    if (!rutaVault || ignoreTexto === null) return;
    setGuardandoIgnore(true);
    setMensaje(null);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("escribir_nota", {
        vaultRuta: rutaVault,
        rutaRel: ".mycignore",
        contenido: ignoreTexto.endsWith("\n") ? ignoreTexto : `${ignoreTexto}\n`,
      });
      // Reindexar con las reglas nuevas y refrescar el árbol.
      const { indexarVault } = await import("@/lib/db/indexer");
      await indexarVault(rutaVault);
      const vaultId = useVaultStore.getState().vaultId;
      if (vaultId) await useVaultStore.getState().loadTree(vaultId);
      setIgnoreTexto(null);
      setMensaje(".mycignore guardado; el vault se reindexó con las reglas nuevas.");
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setGuardandoIgnore(false);
    }
  };

  const handleImportarCarpeta = async () => {
    setMensaje(null);
    setError(null);
    try {
      const origen = await elegirCarpeta("Elegí la carpeta del vault a importar");
      if (!origen) return;
      const archivos = await collectFromNativeFolder(origen);
      if (archivos.length === 0) {
        setError("No se encontraron notas (.md o .excalidraw) en esa carpeta.");
        return;
      }
      await useImportStore.getState().run(archivos, activeFolder(), "Vault de Obsidian");
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  return (
    <div>
      <div className={styles.field}>
        <div className={styles.toggleRow}>
          <span className={styles.label}>Abrir el último vault al iniciar</span>
          <label
            className={styles.switch}
            title={abrirUltimo ? "Activado" : "Desactivado"}
          >
            <input
              type="checkbox"
              checked={abrirUltimo}
              onChange={(e) => void onToggleAbrirUltimo(e.target.checked)}
              aria-label="Abrir automáticamente el último vault al iniciar"
            />
            <span className={styles.switchTrack} aria-hidden />
          </label>
        </div>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Al abrir Mycelium se reabre automáticamente el último vault que usaste. Si
          está desactivado, se muestra el selector de vaults para elegir.
        </p>
      </div>

      {/* Esporas (FUN-M-03): dónde viven las plantillas de notas. */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="mic-carpeta-esporas">
          Carpeta de Esporas (plantillas)
        </label>
        <input
          id="mic-carpeta-esporas"
          className={styles.input}
          value={esporasBorrador}
          spellCheck={false}
          placeholder={CARPETA_ESPORAS_DEFECTO}
          onChange={(e) => setEsporasBorrador(e.target.value)}
          onBlur={confirmarCarpetaEsporas}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setEsporasBorrador(carpetaEsporasPref);
              setEsporasError(null);
            }
          }}
        />
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Las notas de esta carpeta son <strong>Esporas</strong>: plantillas para crear notas
          ya con su estructura, o para insertar una estructura en una nota que ya existe.
          Admiten variables (<code>{"{{titulo}}"}</code>, <code>{"{{fecha}}"}</code>,{" "}
          <code>{"{{hora}}"}</code>, <code>{"{{fecha:DD/MM/AAAA}}"}</code>). Cambiar la
          carpeta <strong>no mueve ningún archivo</strong>: solo cambia dónde se buscan.
        </p>
        {esporasError && (
          <p
            className={styles.cssPreviewNote}
            style={{ color: "var(--mic-callout-error-border)" }}
            role="alert"
          >
            {esporasError}
          </p>
        )}
      </div>

      {/* Auditoría de referencias (FUN-L-17): el caso de entrada de Mycelium
          sobre un proyecto que ya existía. Abre la pantalla como pestaña. */}
      <div className={styles.field}>
        <span className={styles.label}>Referencias del vault</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Si adoptaste Mycelium sobre un proyecto que ya tenías, es probable que tus
          documentos se referencien entre sí desde siempre —con <code>`HU-009`</code> o
          con el nombre suelto— pero con una notación que Mycelium no reconoce, así que el
          grafo se ve vacío. Esta pantalla los <strong>audita</strong> sin tocar nada, y
          después convierte esas referencias en <code>[[enlaces]]</code>, con respaldo y
          deshacer.
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => {
              useTabsStore.getState().openNote(ENLACES_TAB_ID);
              setSettingsOpen(false);
            }}
          >
            Auditar las referencias
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Exportar</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Exportá todas las notas preservando la estructura de carpetas: a una carpeta
          real del equipo (útil para git o Dropbox) o a un ZIP para compartir.
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={ocupado}
            onClick={() => void handleCarpeta()}
          >
            {progreso?.titulo === T_CARPETA
              ? `Exportando… ${progreso.done}/${progreso.total}`
              : "Exportar a carpeta…"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => void handleZip()}
          >
            {progreso?.titulo === T_ZIP
              ? `Comprimiendo… ${progreso.done}/${progreso.total}`
              : "Exportar vault como ZIP"}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Importar vault de Obsidian</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Importá una carpeta del equipo o un .zip. Se preserva la estructura, se ignora
          <code> .obsidian/</code> y los conflictos se resuelven uno a uno.
        </p>
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => void handleImportarCarpeta()}
          >
            Importar desde carpeta…
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={ocupado}
            onClick={() => zipRef.current?.click()}
          >
            Importar .zip
          </button>
        </div>
        <input
          ref={zipRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void collectFromZip(file).then((files) =>
                useImportStore.getState().run(files, activeFolder(), "Vault de Obsidian"),
              );
            }
            e.target.value = "";
          }}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Asistente IA (Claude Code)</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Genera en el vault las instrucciones para asistentes de IA por terminal
          (<code>CLAUDE.md</code> + skill + comandos en <code>.claude/</code>): le
          enseñan a navegar tus notas con los vínculos <code>[[...]]</code>, la
          estructura y las funciones de Mycelium. Solo se crean si lo pedís acá.
          {versionIa && (
            <>
              {" "}Instalado: <strong>v{versionIa}</strong>
              {versionIa !== FRAMEWORK_IA_VERSION && (
                <> · disponible: <strong>v{FRAMEWORK_IA_VERSION}</strong></>
              )}
            </>
          )}
        </p>
        {rutaVault ? (
          <div className={styles.btnRow}>
            <button
              type="button"
              className={versionIa ? styles.secondaryBtn : styles.primaryBtn}
              disabled={generandoIa}
              onClick={() => void handleGenerarIa()}
            >
              {generandoIa
                ? "Generando…"
                : !versionIa
                  ? "Generar instrucciones IA"
                  : versionIa !== FRAMEWORK_IA_VERSION
                    ? `Actualizar a v${FRAMEWORK_IA_VERSION}`
                    : "Regenerar"}
            </button>
          </div>
        ) : (
          <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
            Disponible solo con un vault en carpeta (los archivos se escriben en disco).
          </p>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Archivos ignorados (.mycignore)</span>
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
          Como un <code>.gitignore</code>, propio de cada vault: decide qué carpetas y
          archivos NO se indexan ni aparecen. Por defecto se ignoran los directorios
          ocultos (<code>.*/</code>) y las carpetas de dependencias y compilación
          (<code>node_modules/</code>, <code>target/</code>, <code>dist/</code>,
          <code> out/</code>). Editalo para, p. ej., dejar de ignorar
          <code> .claude/</code> y ver esa documentación en Mycelium. Ojo: si creás el
          archivo, <strong>reemplaza al default por completo</strong>.
        </p>
        {rutaVault ? (
          ignoreTexto === null ? (
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => void abrirIgnore()}
              >
                Editar .mycignore
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={ignoreTexto}
                onChange={(e) => setIgnoreTexto(e.target.value)}
                rows={8}
                spellCheck={false}
                style={{
                  width: "100%",
                  resize: "vertical",
                  padding: "0.5rem",
                  borderRadius: 6,
                  border: "1px solid color-mix(in srgb, var(--mic-text-muted) 30%, transparent)",
                  background: "var(--mic-bg-canvas)",
                  color: "var(--mic-text-primary)",
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                  fontSize: "0.8125rem",
                }}
              />
              <div className={styles.btnRow}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={guardandoIgnore}
                  onClick={() => void guardarIgnore()}
                >
                  {guardandoIgnore ? "Guardando…" : "Guardar y reindexar"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={guardandoIgnore}
                  onClick={() => setIgnoreTexto(null)}
                >
                  Cancelar
                </button>
              </div>
            </>
          )
        ) : (
          <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-muted)" }}>
            Disponible solo con un vault en carpeta.
          </p>
        )}
      </div>

      {mensaje && (
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-text-primary)" }}>
          {mensaje}
        </p>
      )}
      {error && (
        <p
          className={styles.cssPreviewNote}
          style={{ color: "var(--mic-callout-error-border)" }}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
