"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CARPETA_ESPORAS_DEFECTO, normalizarCarpetaEsporas } from "@/lib/esporas";
import { CARPETA_INFORMES_DEFECTO } from "@/lib/informeSalud";
import {
  CLAVE_DESTINO_PREFERENCIA,
  RUTA_BANDEJA_DEFECTO,
  leerPreferenciaDestino,
  normalizarRutaBandeja,
  type PreferenciaDestino,
} from "@/lib/bandeja";
import { exportVaultACarpeta, exportVaultZip } from "@/lib/export";
import {
  type AccionClaudeMd,
  FRAMEWORK_IA_VERSION,
  generarFramework,
  versionInstalada,
} from "@/lib/ia/framework";
import { elegirZip } from "@/lib/import";
import { asegurarIntegracion, cambiarControl } from "@/lib/mcpControl";
import { getAbrirUltimo, setAbrirUltimo } from "@/lib/vaultMode";
import { avisar } from "@/stores/avisosStore";
import { useExportStore } from "@/stores/exportStore";
import { useImportStore } from "@/stores/importStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePrefVault, usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { ENLACES_TAB_ID } from "@/lib/pestanas";
import { RUTA_MYCIGNORE, tabIdDeArchivo } from "@/lib/otrosArchivos";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { Interruptor } from "./Interruptor";
import { Explicacion } from "./Explicacion";
import styles from "./Settings.module.css";
import { confirmar } from "@/lib/confirmar";
import { mensajeDeError } from "@/lib/mensajeError";

// Títulos de progreso (DEF-018): identifican qué exportación corre para etiquetar
// el botón correcto y la barra global.
const T_ZIP = "Comprimiendo ZIP";
const T_CARPETA = "Exportando a carpeta";

/**
 * Qué le pasó a `CLAUDE.md` al generar las instrucciones IA (`FUN-L-29`): lo
 * de fuera del bloque de Mycelium es del usuario y nunca se toca.
 */
const QUE_PASO_CON_CLAUDE_MD: Record<AccionClaudeMd, string> = {
  creado: "se creó CLAUDE.md con el bloque de Mycelium.",
  actualizado: "se actualizó el bloque de Mycelium en CLAUDE.md; lo demás del archivo no se tocó.",
  insertado:
    "el bloque de Mycelium quedó al principio de tu CLAUDE.md; lo tuyo sigue debajo, sin cambios.",
  reemplazado: "el CLAUDE.md de la versión anterior se reemplazó por el bloque de Mycelium.",
  "insertado-sobre-anterior":
    "⚠ tu CLAUDE.md tenía las instrucciones de la versión anterior, editadas: el bloque nuevo " +
    "quedó al principio y no se borró nada. Debajo siguen las viejas (empiezan en «# Este vault " +
    "es tu memoria»): bórralas y deja solo lo tuyo.",
};

/**
 * Abre el selector de carpeta nativo del SO; `null` si el usuario cancela. Lo
 * abre Rust (`DEF-161`): exportar e importar solo aceptan una carpeta de fuera
 * del vault si salió de ese selector.
 */
async function elegirCarpeta(title: string): Promise<string | null> {
  const { elegirCarpetaExterna } = await import("@/lib/vaultMode");
  return elegirCarpetaExterna(title);
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

  /**
   * Lo que terminó bien se cuenta con un aviso flotante y no solo con el
   * párrafo del final del panel: exportar deja el resultado a ~900px de scroll
   * del botón que lo disparó (crítica de Configuración, 2026-09-20). El error
   * se queda ADEMÁS en el panel, porque conviene poder releerlo.
   */
  const informar = (texto: string) => {
    setMensaje(texto);
    avisar(texto);
  };
  const fallar = (texto: string) => {
    setError(texto);
    avisar(texto);
  };
  const [abrirUltimo, setAbrirUltimoState] = useState(false);
  // Framework IA (FUN-L-08): versión instalada en el vault (null = no generado).
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  // Reconstrucción del índice (`FUN-S-23`): el avance sale del mismo store.
  const reconstruyendo = useVaultSessionStore((s) => s.reconstruyendo);
  const progresoIndice = useVaultSessionStore((s) => (s.reconstruyendo ? s.progreso : null));
  const [versionIa, setVersionIa] = useState<string | null>(null);
  const [generandoIa, setGenerandoIa] = useState(false);
  // MCP de control (`FUN-L-09`): preferencia del vault, apagada por defecto.
  const controlIa = usePrefVault("controlIa");
  // El vault lo traía encendido de otra máquina (`DEF-169`): acá arranca apagado.
  const controlIaDelVault = usePrefsVaultStore((s) => s.controlIaDelVault);
  const [cambiandoControl, setCambiandoControl] = useState(false);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const ocupado = progreso !== null;

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
      const resultado = await generarFramework(rutaVault);
      setVersionIa(FRAMEWORK_IA_VERSION);
      // Con el control encendido, el framework también registra el servidor
      // en `.mcp.json` y el hook de mv/rm en `.claude/settings.json` (spec
      // § 4): regenerar deja todo lo de la IA al día.
      if (controlIa) await asegurarIntegracion(rutaVault);
      let texto = `Instrucciones IA v${FRAMEWORK_IA_VERSION}: ${QUE_PASO_CON_CLAUDE_MD[resultado.claudeMd]}`;
      if (resultado.conservados.length > 0) {
        texto +=
          ` Quedaron como tuyos ${resultado.conservados.length} comando(s) de la versión anterior que ` +
          `habías editado (${resultado.conservados.join(" · ")}); los de Mycelium están ahora en ` +
          `.claude/commands/mycelium/.`;
      }
      // El aviso de referencias sin enlazar (`FUN-S-10`) no impide lo demás:
      // si no se pudo instalar, se dice por qué.
      if (resultado.avisoHook) texto += ` ${resultado.avisoHook}`;
      informar(texto);
    } catch (e) {
      fallar((e as Error).message ?? String(e));
    } finally {
      setGenerandoIa(false);
    }
  };

  const onToggleControl = async (valor: boolean) => {
    if (!rutaVault) return;
    setMensaje(null);
    setError(null);
    setCambiandoControl(true);
    try {
      informar(await cambiarControl(rutaVault, valor));
    } catch (e) {
      fallar(`No se pudo ${valor ? "encender" : "apagar"} el control: ${(e as Error).message ?? String(e)}`);
    } finally {
      setCambiandoControl(false);
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

  // El destino se elige en «Guardar como»; el avance y el resultado, también en
  // la tarjeta de exportación (`FUN-M-22`). Si se cancela, no pasa nada.
  const handleZip = async () => {
    setMensaje(null);
    setError(null);
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
      const destino = await elegirCarpeta("Elige la carpeta donde exportar el vault");
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
      // El resultado (y «Abrir la carpeta») lo cuenta la tarjeta de exportación
      // (`FUN-M-22`); acá queda la cuenta de archivos.
      const escritos = await exportVaultACarpeta(destino, (done, total) =>
        setProgreso({ done, total, titulo: T_CARPETA }),
      );
      if (escritos !== undefined) informar(`Se escribieron ${escritos} archivos en ${destino}`);
    } catch (e) {
      fallar((e as Error).message ?? String(e));
    } finally {
      setProgreso(null);
    }
  };

  const activeFolder = () => useVaultStore.getState().activeFolderId;

  /**
   * Reconstruir el índice (`FUN-S-23`): lo borra y lo arma de nuevo desde los
   * archivos. Con aviso, porque en un vault grande tarda y mientras tanto la
   * búsqueda y el grafo están incompletos.
   */
  const handleReconstruirIndice = async () => {
    setMensaje(null);
    setError(null);
    const ok = await confirmar(
      "Se borra el índice de este vault y se vuelve a armar leyendo todas las notas de la carpeta.\n\n" +
        "• En un vault grande puede tardar varios minutos. Mientras tanto, la búsqueda, el grafo y " +
        "los enlaces pueden verse incompletos.\n" +
        "• No se pierde ninguna nota: el índice es una copia que se arma a partir de los archivos.\n" +
        "• Los snippets, la apariencia, las preferencias y la papelera viven en la carpeta " +
        ".mycelium/ del vault y no se tocan.\n\n" +
        "Sirve cuando la búsqueda o el grafo muestran algo que no coincide con los archivos.",
      "Reconstruir",
    );
    if (!ok) return;
    try {
      const r = await useVaultSessionStore.getState().reconstruirIndice();
      informar(
        r.borrado
          ? `Índice reconstruido: ${r.notas} notas.`
          : `No se pudo borrar el archivo del índice, así que se volvieron a leer las ${r.notas} notas sobre el existente.`,
      );
    } catch (e) {
      fallar(mensajeDeError(e, "No se pudo reconstruir el índice."));
    }
  };

  /**
   * Abre el `.mycignore` en una **pestaña** del visor de archivos (`FUN-S-25`),
   * con su editor y su guardado explícito, en vez del cuadro de texto de esta
   * ventana: el archivo puede crecer y conviene verlo al lado de lo que filtra.
   * Al guardarlo, el watcher lo ve y el vault se vuelve a filtrar solo
   * (`lib/vaultWatch.ts` reconcilia ante un cambio del `.mycignore`).
   *
   * El visor edita archivos que existen: si el vault no tiene uno, se crea con
   * la plantilla de Rust (`mycignore::DEFAULT`), que es exactamente la lista que
   * ya se aplica sin archivo. Crearlo así no cambia qué se ve.
   */
  const abrirIgnore = async () => {
    if (!rutaVault) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const actual = await invoke<string | null>("leer_archivo_texto", {
        vaultRuta: rutaVault,
        rutaRel: RUTA_MYCIGNORE,
      });
      if (actual === null) {
        await invoke("escribir_nota", {
          vaultRuta: rutaVault,
          rutaRel: RUTA_MYCIGNORE,
          contenido: await invoke<string>("mycignore_default"),
        });
      }
      useTabsStore.getState().openNote(tabIdDeArchivo(RUTA_MYCIGNORE));
      setSettingsOpen(false);
    } catch (e) {
      fallar((e as Error).message ?? String(e));
    }
  };

  const handleImportarCarpeta = async () => {
    setMensaje(null);
    setError(null);
    try {
      const origen = await elegirCarpeta("Elige la carpeta del vault a importar");
      if (!origen) return;
      // Se copia la carpeta entera —adjuntos incluidos— salvo lo oculto y las
      // dependencias (`FUN-M-40`, `DEF-165`); lo omitido se ve en el resumen.
      await useImportStore.getState().run({ carpeta: origen }, activeFolder(), "Vault de Obsidian");
    } catch (e) {
      fallar((e as Error).message ?? String(e));
    }
  };

  /**
   * El `.zip` lo elige el selector nativo y lo extrae Rust (`DEF-165`): así
   * sabe de qué archivo viene y le pasa su marca de la web a lo extraído.
   */
  const handleImportarZip = async () => {
    setMensaje(null);
    setError(null);
    try {
      const zip = await elegirZip("Elige el .zip a importar");
      if (!zip) return;
      await useImportStore.getState().run({ zip }, activeFolder(), "Vault de Obsidian");
    } catch (e) {
      fallar((e as Error).message ?? String(e));
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
        <Explicacion detalle="Si está desactivado, al abrir se muestra el selector de vaults para elegir.">
          Al abrir Mycelium, vuelve al último vault que usaste.
        </Explicacion>
      </div>

      {/* Esporas (FUN-M-03): dónde viven las plantillas de notas. */}
      <CampoCarpeta
        id="mic-carpeta-esporas"
        etiqueta="Carpeta de Esporas (plantillas)"
        clave="carpetaEsporas"
        defecto={CARPETA_ESPORAS_DEFECTO}
        detalle={
          <>
            Sirven para crear notas ya con su estructura o para insertarla en una que ya
            existe. Admiten variables (<code>{"{{titulo}}"}</code>, <code>{"{{fecha}}"}</code>,{" "}
            <code>{"{{hora}}"}</code>, <code>{"{{fecha:DD/MM/AAAA}}"}</code>). Cambiar la
            carpeta <strong>no mueve ningún archivo</strong>: solo cambia dónde se buscan.
          </>
        }
      >
        Las notas de esta carpeta son <strong>Esporas</strong>: plantillas de notas.
      </CampoCarpeta>

      {/* La Bandeja del vault (FUN-L-33): dónde anota la captura rápida. */}
      <CampoCarpeta
        id="mic-ruta-bandeja"
        etiqueta="Bandeja del vault"
        clave="rutaBandeja"
        defecto={RUTA_BANDEJA_DEFECTO}
        normalizar={normalizarRutaBandeja}
        mensajeError={ERROR_BANDEJA}
        detalle={
          <>
            La captura rápida (<kbd>Ctrl+Shift+Espacio</kbd>) agrega cada apunte al final, bajo
            el encabezado del día. Se crea con la primera captura. Cambiar la ruta{" "}
            <strong>no mueve el archivo</strong>: la Bandeja pasa a ser la nota de la ruta nueva.
          </>
        }
      >
        La nota donde anota la <strong>captura rápida</strong>. No se renombra ni se elimina.
      </CampoCarpeta>

      {/* Con qué destino abre la captura rápida (FUN-L-33, Parte B). */}
      <DestinoCaptura />

      {/* Informe de salud (FUN-L-32): dónde se guardan los informes como nota. */}
      <CampoCarpeta
        id="mic-carpeta-informes"
        etiqueta="Carpeta de los informes"
        clave="carpetaInformes"
        defecto={CARPETA_INFORMES_DEFECTO}
        detalle={
          <>
            «Generar informe como nota», en la salud del vault, crea ahí{" "}
            <code>Salud del vault AAAA-MM-DD.md</code> (con la hora, si el del día ya existe).
            Si la carpeta no existe, se crea. Cambiarla <strong>no mueve los informes</strong>{" "}
            que ya se generaron.
          </>
        }
      >
        Donde se guardan los <strong>informes de salud</strong> del vault.
      </CampoCarpeta>

      {/* Auditoría de referencias (FUN-L-17): el caso de entrada de Mycelium
          sobre un proyecto que ya existía. Abre la pantalla como pestaña. */}
      <div className={styles.field}>
        <span className={styles.label}>Referencias del vault</span>
        <Explicacion
          detalle={
            <>
              Si adoptaste Mycelium sobre un proyecto que ya tenías, es probable que tus
              documentos se referencien entre sí desde siempre —con <code>`HU-009`</code> o con
              el nombre suelto— con una notación que Mycelium no reconoce, y el grafo se ve
              vacío. Primero se <strong>auditan</strong> sin tocar nada; la conversión lleva
              respaldo y deshacer.
            </>
          }
        >
          Encuentra las referencias sin enlazar y las convierte en <code>[[enlaces]]</code>.
        </Explicacion>
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
        <Explicacion detalle="A una carpeta del equipo (útil para git o Dropbox) o a un ZIP para compartir.">
          Todas las notas, con su estructura de carpetas.
        </Explicacion>
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
        <Explicacion
          detalle={
            <>
              Se preserva la estructura, se ignora <code>.obsidian/</code> y los conflictos de
              nombre se resuelven uno a uno.
            </>
          }
        >
          Una carpeta del equipo o un .zip, por ejemplo un vault de Obsidian.
        </Explicacion>
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
            onClick={() => void handleImportarZip()}
          >
            Importar .zip
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Asistente IA (Claude Code)</span>
        <Explicacion
          detalle={
            <>
              Escribe un bloque corto al principio de <code>CLAUDE.md</code> y skills y
              comandos con prefijo <code>mycelium</code> en <code>.claude/</code>: le enseñan a
              la IA a navegar tus notas por sus <code>[[enlaces]]</code>, la estructura del
              vault y las funciones de Mycelium. Al regenerar, reescribe solo eso: lo demás de{" "}
              <code>CLAUDE.md</code> y de <code>.claude/</code> es tuyo y no lo toca. Solo se
              crean si lo pides aquí.
            </>
          }
        >
          Instrucciones para que un asistente de IA por terminal entienda tu vault: un bloque
          en <code>CLAUDE.md</code>, sin tocar lo demás.
          {versionIa && (
            <>
              {" "}Instalado: <strong>v{versionIa}</strong>
              {versionIa !== FRAMEWORK_IA_VERSION && (
                <> · disponible: <strong>v{FRAMEWORK_IA_VERSION}</strong></>
              )}
            </>
          )}
        </Explicacion>
        {rutaVault ? (
          <div className={styles.btnRow}>
            <button
              type="button"
              className={versionIa ? styles.secondaryBtn : styles.primaryBtn}
              disabled={generandoIa}
              title="Escribe el bloque de Mycelium en CLAUDE.md y sus archivos en .claude/; lo demás no se toca"
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
          <p className={styles.hint}>
            Disponible solo con un vault en carpeta (los archivos se escriben en disco).
          </p>
        )}
        {rutaVault && (
          <Interruptor
            etiqueta="Dejar que la IA controle Mycelium"
            valor={controlIa}
            disabled={cambiandoControl}
            onChange={(v) => void onToggleControl(v)}
            ayuda={
              <>
                Claude Code puede <strong>operar la app</strong>: mostrarte notas, usar el
                calendario, renombrar y mover.
                {controlIaDelVault && !controlIa && (
                  <> Este vault lo traía encendido de otra computadora; aquí queda apagado hasta que lo enciendas.</>
                )}
              </>
            }
            detalle={
              <>
                Lo hace por el servidor MCP de Mycelium, registrado en <code>.mcp.json</code> en
                la raíz del vault, y todo queda en «Actividad de la IA» con Deshacer. Apagado,
                ningún programa puede pedirle nada a Mycelium — pero{" "}
                <strong>no impide que la IA lea o escriba los archivos del vault</strong>: eso lo
                hace con sus propias herramientas, como siempre. Se decide en esta computadora
                y para este vault: no viaja con la carpeta.
              </>
            }
          />
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Archivos ignorados (.mycignore)</span>
        <Explicacion
          detalle={
            <>
              <p>
                Por defecto se ignoran los directorios ocultos (<code>.*/</code>) y las carpetas
                de dependencias y compilación (<code>node_modules/</code>, <code>target/</code>,{" "}
                <code>dist/</code>, <code>out/</code>). Edítalo para, por ejemplo, dejar de
                ignorar <code>.claude/</code> y ver esa documentación en Mycelium.
              </p>
              <p>
                Se abre en una pestaña; al guardarlo, el vault se vuelve a filtrar solo. El
                archivo <strong>reemplaza al default por completo</strong>.
              </p>
            </>
          }
        >
          Como un <code>.gitignore</code>: qué carpetas y archivos no se indexan ni aparecen.
        </Explicacion>
        {rutaVault ? (
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
          <p className={styles.hint}>
            Disponible solo con un vault en carpeta.
          </p>
        )}
      </div>

      {/* Reconstruir el índice (FUN-S-23): la salida cuando el caché no coincide
          con los archivos, sin buscar el index-<hash>.db a mano. */}
      {rutaVault && (
        <div className={styles.field}>
          <span className={styles.label}>Índice del vault</span>
          <Explicacion
            detalle={
              <>
                El índice es una copia de las notas que Mycelium usa para buscar, dibujar el
                grafo y resolver enlaces. Reconstruirlo lo borra y lo vuelve a armar desde los
                archivos: no se pierde ninguna nota, y los snippets, la apariencia y la
                papelera, que viven en <code>.mycelium/</code>, no se tocan.
              </>
            }
          >
            Si la búsqueda o el grafo no coinciden con los archivos, se puede armar de nuevo.
          </Explicacion>
          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={reconstruyendo}
              onClick={() => void handleReconstruirIndice()}
            >
              {!reconstruyendo
                ? "Reconstruir el índice…"
                : progresoIndice !== null
                  ? `Reconstruyendo… ${progresoIndice.hechas}/${progresoIndice.total}`
                  : "Reconstruyendo…"}
            </button>
          </div>
        </div>
      )}

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

const ERROR_CARPETA = "Tiene que ser una carpeta DENTRO del vault: sin rutas absolutas ni «..».";
const ERROR_BANDEJA =
  "Tiene que ser una nota .md DENTRO del vault: sin rutas absolutas, sin «..» y sin carpetas que empiecen con punto.";

/**
 * Un campo con una carpeta del vault guardada en las preferencias: la de
 * Esporas (`FUN-M-03`) y la de los informes de salud (`FUN-L-32`); con
 * `normalizar`, también la ruta de la Bandeja (`FUN-L-33`). Borrador
 * local (se teclea libre) + el error de validación; se confirma al salir del
 * campo o con Enter, y Escape deshace lo tecleado.
 */
function CampoCarpeta({
  id,
  etiqueta,
  clave,
  defecto,
  detalle,
  children,
  normalizar = normalizarCarpetaEsporas,
  mensajeError = ERROR_CARPETA,
}: {
  id: string;
  etiqueta: string;
  clave: "carpetaEsporas" | "carpetaInformes" | "rutaBandeja";
  defecto: string;
  /** Valida y limpia lo escrito (`null`: no sirve). Por defecto, una carpeta. */
  normalizar?: (valor: string) => string | null;
  mensajeError?: string;
  detalle: ReactNode;
  children: ReactNode;
}) {
  const pref = usePreferencesStore((s) => s.prefs[clave]);
  const [borrador, setBorrador] = useState(pref);
  const [error, setError] = useState<string | null>(null);

  // La preferencia se hidrata en asíncrono al abrir el vault: el borrador se
  // resetea DURANTE el render (no en un efecto) para no pintar el valor viejo.
  const [visto, setVisto] = useState(pref);
  if (visto !== pref) {
    setVisto(pref);
    setBorrador(pref);
    setError(null);
  }

  /**
   * Valida mientras se escribe. Antes el error se fijaba en el `blur`, y salir
   * del campo puede ser el mismo clic que cambia de categoría: la sección se
   * desmontaba con el error recién puesto y el usuario nunca lo veía
   * (crítica de Configuración, 2026-09-20).
   */
  const escribir = (valor: string) => {
    setBorrador(valor);
    setError(normalizar(valor) === null ? mensajeError : null);
  };

  /** Confirma la carpeta: si la ruta no es válida, no se guarda. */
  const confirmar = () => {
    if (borrador === pref) return;
    const limpia = normalizar(borrador);
    if (limpia === null) {
      setError(mensajeError);
      return;
    }
    setError(null);
    setBorrador(limpia);
    usePreferencesStore.getState().setPref(clave, limpia);
  };

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        className={styles.input}
        value={borrador}
        spellCheck={false}
        placeholder={defecto}
        onChange={(e) => escribir(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            // Escape acá deshace lo tecleado y NO cierra la ventana: sin
            // esto, el mismo Escape llegaba al diálogo y se llevaba todo.
            e.stopPropagation();
            setBorrador(pref);
            setError(null);
          }
        }}
      />
      <Explicacion detalle={detalle}>{children}</Explicacion>
      {error && (
        <p className={styles.cssPreviewNote} style={{ color: "var(--mic-callout-error-border)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Con qué destino abre la captura rápida (`FUN-L-33`, Parte B): el último
 * elegido (lo de siempre) o uno fijo. Es del usuario, no del vault
 * (`localStorage`, como los atajos): la Bandeja personal es la misma desde
 * todos los vaults.
 */
function DestinoCaptura() {
  const [valor, setValor] = useState<PreferenciaDestino>(() =>
    leerPreferenciaDestino(typeof window === "undefined" ? null : window.localStorage),
  );
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="mic-captura-destino-preferencia">
        Destino de la captura rápida
      </label>
      <select
        id="mic-captura-destino-preferencia"
        className={styles.select}
        value={valor}
        onChange={(e) => {
          const v = e.target.value as PreferenciaDestino;
          setValor(v);
          if (v === "ultimo") window.localStorage.removeItem(CLAVE_DESTINO_PREFERENCIA);
          else window.localStorage.setItem(CLAVE_DESTINO_PREFERENCIA, v);
        }}
      >
        <option value="ultimo">El último elegido</option>
        <option value="vault">Siempre la Bandeja del vault</option>
        <option value="personal">Siempre la Bandeja personal</option>
      </select>
      <Explicacion
        detalle={
          <>
            La <strong>Bandeja personal</strong> es una sola para todos tus vaults y no es parte de
            ninguno: vive en la carpeta de datos de Mycelium, fuera de las búsquedas, los enlaces,
            el grafo y la IA del vault. En la cajita, <kbd>Tab</kbd> cambia el destino. Esta opción
            vale para todos los vaults.
          </>
        }
      >
        Adónde anota la cajita al abrirse: la Bandeja de este vault o tu Bandeja personal.
      </Explicacion>
    </div>
  );
}
