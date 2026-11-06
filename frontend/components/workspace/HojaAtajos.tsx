"use client";

import { Keyboard, Search, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { textoAtajo } from "@/lib/comandos/atajos";
import { useDistribucion } from "@/lib/comandos/distribucion";
import { gruposDeAtajos } from "@/lib/comandos/registro";
import { useComandos, useVersionAtajos } from "@/lib/comandos/useComandos";
import { useDialogoModal } from "@/lib/useDialogoModal";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { TeclasAtajo } from "./TeclasAtajo";
import styles from "./HojaAtajos.module.css";

/** Sin tildes ni mayúsculas: «navegacion» encuentra «Navegación». */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * La hoja de atajos (`FUN-XL-04`, Parte 3): Ctrl+Shift+/ (o «Ver los atajos de
 * teclado» en la paleta). Todos los comandos que tienen atajo, agrupados por
 * categoría y con un buscador, generada desde el registro: refleja lo que el
 * usuario cambió en Configuración y muestra las teclas como las ve en su
 * teclado. Sin el modo desarrollador, sus comandos no aparecen.
 */
export function HojaAtajos() {
  const abierta = useUiStore((s) => s.hojaAtajos);
  return abierta ? <Hoja /> : null;
}

function Hoja() {
  const cerrar = useCallback(() => useUiStore.getState().setHojaAtajos(false), []);
  const dialogoRef = useRef<HTMLDivElement>(null);
  useDialogoModal({ abierto: true, cerrar, dialogoRef });
  const [consulta, setConsulta] = useState("");
  const comandos = useComandos();
  const version = useVersionAtajos();
  const distribucion = useDistribucion();
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);

  const grupos = useMemo(() => {
    const q = normalizar(consulta.trim());
    return gruposDeAtajos(comandos, dev, { soloConAtajo: true })
      .map((g) => ({
        ...g,
        comandos: g.comandos.filter(
          (c) =>
            !q ||
            normalizar(c.titulo).includes(q) ||
            normalizar(g.nombre).includes(q) ||
            c.atajos.some((a) => normalizar(textoAtajo(a, distribucion)).includes(q)),
        ),
      }))
      .filter((g) => g.comandos.length > 0);
    // `version`: los atajos cambiaron en Configuración (aquí o en otra ventana).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comandos, dev, consulta, distribucion, version]);

  return (
    <div className={styles.velo} onPointerDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div
        ref={dialogoRef}
        className={`${styles.hoja} mic-hoja-atajos`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoja-atajos-titulo"
        data-cede-a-la-ayuda
      >
        <header className={styles.cabecera}>
          <Keyboard size={16} aria-hidden className={styles.icono} />
          <h2 id="hoja-atajos-titulo" className={styles.titulo}>
            Atajos de teclado
          </h2>
          <div className={styles.buscador}>
            <Search size={14} aria-hidden className={styles.lupa} />
            <input
              className={styles.campo}
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && consulta) {
                  e.stopPropagation();
                  setConsulta("");
                }
              }}
              placeholder="Buscar un atajo…"
              aria-label="Buscar un atajo"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button type="button" className={styles.cerrar} aria-label="Cerrar los atajos" onClick={cerrar}>
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className={styles.cuerpo}>
          {grupos.length === 0 ? (
            <p className={styles.vacio}>Ningún atajo coincide con «{consulta.trim()}».</p>
          ) : (
            grupos.map((g) => (
              <section key={g.categoria} className={styles.grupo} aria-labelledby={`hoja-${g.categoria}`}>
                <h3 id={`hoja-${g.categoria}`} className={styles.grupoTitulo}>
                  {g.nombre}
                </h3>
                <dl className={styles.lista}>
                  {g.comandos.map((c) => (
                    <div key={c.comando.id} className={`${styles.fila} mic-hoja-atajos-fila`} data-comando={c.comando.id}>
                      <dt className={styles.nombre}>{c.titulo}</dt>
                      <dd className={styles.teclas}>
                        {c.atajos.map((a, i) => (
                          <TeclasAtajo key={i} atajo={a} />
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          )}
        </div>

        <footer className={styles.pie}>
          <button
            type="button"
            className={styles.enlace}
            onClick={() => useUiStore.getState().abrirAjustes("atajos")}
          >
            Cambiar los atajos en Configuración
          </button>
          <span aria-hidden> · </span>
          <button
            type="button"
            className={styles.enlace}
            onClick={() => useUiStore.getState().abrirAyuda("atajos-de-teclado/atajos-de-teclado")}
          >
            Los atajos del texto de una nota, en la ayuda
          </button>
        </footer>
      </div>
    </div>
  );
}
