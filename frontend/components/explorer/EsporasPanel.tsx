"use client";
import { CircleDot, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  asegurarCarpetaEsporas,
  carpetaEsporas,
  crearEsporaVacia,
  crearNotaDesdeEspora,
  listarEsporas,
  type Espora,
} from "@/lib/esporasVault";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./EsporasPanel.module.css";

/**
 * Panel de Esporas (`FUN-M-03`): las plantillas de la carpeta configurada.
 * Un clic en una Espora crea la nota en la carpeta activa del explorador —la
 * misma que usa "Nueva nota"— con las variables ya sustituidas, y la abre. Sin
 * diálogo: crear una nota desde plantilla es un clic, como crear una vacía.
 *
 * Las plantillas son notas normales, así que editar/renombrar/borrar hacen lo
 * mismo que en el explorador (el borrado va a la papelera).
 */
export function EsporasPanel() {
  const router = useRouter();
  // Suscripciones: el panel se refresca solo al cambiar el árbol o la carpeta
  // configurada (criterio 12: cambiarla en Configuración no exige reiniciar).
  const notas = useVaultStore((s) => s.notas);
  const carpetas = useVaultStore((s) => s.carpetas);
  const rutaConfigurada = usePreferencesStore((s) => s.prefs.carpetaEsporas);

  const [renombrando, setRenombrando] = useState<{ id: string; valor: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carpeta = useMemo(() => carpetaEsporas(), [rutaConfigurada]);
  const existe = useMemo(() => carpetas.some((c) => c.id === carpeta), [carpetas, carpeta]);
  const esporas = useMemo(() => listarEsporas(notas), [notas, rutaConfigurada]);

  const abrir = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };

  /** Envuelve una acción asíncrona: bloquea los botones y muestra el fallo. */
  const correr = async (accion: () => Promise<void>) => {
    setOcupado(true);
    setError(null);
    try {
      await accion();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const usar = (espora: Espora) =>
    void correr(async () => {
      const destino = useVaultStore.getState().activeFolderId;
      abrir(await crearNotaDesdeEspora(espora, destino));
    });

  const nuevaEspora = () =>
    void correr(async () => {
      abrir(await crearEsporaVacia());
    });

  const crearCarpeta = () => void correr(async () => void (await asegurarCarpetaEsporas()));

  const borrar = (espora: Espora) => {
    if (!window.confirm(`¿Mandar la Espora "${espora.titulo}" a la papelera?`)) return;
    void correr(async () => {
      useTabsStore.getState().closeNotaEverywhere(espora.id);
      await useVaultStore.getState().deleteNota(espora.id);
    });
  };

  const confirmarRenombre = () => {
    if (!renombrando) return;
    const valor = renombrando.valor.trim();
    const id = renombrando.id;
    setRenombrando(null);
    const actual = esporas.find((e) => e.id === id);
    if (valor === "" || !actual || valor === actual.titulo) return;
    void correr(() => useVaultStore.getState().renameNota(id, valor));
  };

  return (
    <div className={styles.panel}>
      <p className={styles.intro}>
        Una <strong>Espora</strong> es una nota plantilla: al usarla se crea una nota nueva con
        su estructura y sus variables (<code>{"{{titulo}}"}</code>, <code>{"{{fecha}}"}</code>,{" "}
        <code>{"{{hora}}"}</code>) ya resueltas. Viven en <code>{carpeta}</code> y se editan
        como cualquier nota.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!existe ? (
        <div className={styles.vacio}>
          <p>
            La carpeta <code>{carpeta}</code> todavía no existe. Creala para empezar a guardar
            plantillas ahí (podés cambiarla en Configuración → Vault).
          </p>
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.primario}
              disabled={ocupado}
              onClick={crearCarpeta}
            >
              <FolderPlus size={14} aria-hidden /> Crear la carpeta
            </button>
            <button
              type="button"
              className={styles.secundario}
              disabled={ocupado}
              onClick={() => useUiStore.getState().setSettingsOpen(true)}
            >
              Cambiar la carpeta…
            </button>
          </div>
        </div>
      ) : esporas.length === 0 ? (
        <div className={styles.vacio}>
          <p>
            No hay ninguna Espora en <code>{carpeta}</code>. Creá la primera: escribí ahí la
            estructura que repetís (encabezados, propiedades, checklist) y usá las variables
            donde quieras la fecha o el título.
          </p>
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.primario}
              disabled={ocupado}
              onClick={nuevaEspora}
            >
              <Plus size={14} aria-hidden /> Crear la primera Espora
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className={styles.lista}>
            {esporas.map((espora) => (
              <li key={espora.id} className={styles.fila}>
                {renombrando?.id === espora.id ? (
                  <input
                    className={styles.renombrar}
                    value={renombrando.valor}
                    autoFocus
                    aria-label={`Nuevo nombre de ${espora.titulo}`}
                    onChange={(e) =>
                      setRenombrando((r) => (r ? { ...r, valor: e.target.value } : r))
                    }
                    onBlur={confirmarRenombre}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmarRenombre();
                      if (e.key === "Escape") setRenombrando(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.usar}
                      disabled={ocupado}
                      title={`Crear una nota desde «${espora.titulo}»`}
                      onClick={() => usar(espora)}
                    >
                      <CircleDot size={15} className={styles.icono} aria-hidden />
                      <span className={styles.nombre}>{espora.titulo}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.accion}
                      title="Editar la plantilla"
                      aria-label={`Editar ${espora.titulo}`}
                      onClick={() => abrir(espora.id)}
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={styles.accion}
                      title="Renombrar la plantilla"
                      aria-label={`Renombrar ${espora.titulo}`}
                      onClick={() => setRenombrando({ id: espora.id, valor: espora.titulo })}
                    >
                      <span aria-hidden>Aa</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.accion} ${styles.peligro}`}
                      title="Mandar la plantilla a la papelera"
                      aria-label={`Borrar ${espora.titulo}`}
                      onClick={() => borrar(espora)}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={ocupado}
              onClick={nuevaEspora}
            >
              <Plus size={14} aria-hidden /> Nueva Espora
            </button>
          </div>
        </>
      )}
    </div>
  );
}
