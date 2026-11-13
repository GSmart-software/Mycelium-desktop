"use client";

/**
 * El menú contextual de un archivo o una carpeta del vault y lo que hacen sus
 * opciones (`DEF-185`).
 *
 * Vivía dentro de `ExplorerPanel`, así que solo el explorador lo tenía: en los
 * resultados de la búsqueda global, el clic derecho sobre una nota o una
 * carpeta no mostraba nada. Ahora lo usan los dos y es **el mismo**: las mismas
 * opciones, en el mismo orden, con la misma lógica. Cada vista pone solo lo
 * que es suyo —dónde se dibuja el campo de renombrar, cómo se revela la fila—
 * y el resto sale de acá.
 *
 * El hook guarda su propio estado (el menú abierto, el renombrado en curso, el
 * diálogo «Mover a…» y el selector de archivos para importar) y devuelve las
 * `capas`: los elementos flotantes que la vista monta una vez, en cualquier
 * lugar de su árbol.
 */
import {
  CircleDot,
  Columns2,
  Copy,
  Eye,
  ExternalLink,
  FileDown,
  FileOutput,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  duplicarOtro,
  eliminarOtro,
  guardarCopiaOtro,
  nombreSinExtension,
  renombrarOtro,
} from "@/lib/accionesOtroArchivo";
import { confirmar } from "@/lib/confirmar";
import { opcionDe } from "@/lib/comandos/nuevo";
import { crearDocumento, pedirYCrearCarpeta, type TipoDocumento } from "@/lib/crear";
import { revelarEnSistema } from "@/lib/db/vaultFs";
import { pedirEdicionDeTitulo } from "@/lib/editor/tituloPendiente";
import { carpetaEsporas, crearNotaDesdeEspora, listarEsporas } from "@/lib/esporasVault";
import { exportNoteMd, exportNotePdfActive } from "@/lib/export";
import { ICONO_CONSOLA, ICONO_POR_TIPO } from "@/lib/iconosDeTipo";
import { collectFromFileList } from "@/lib/import";
import { enlaceANota } from "@/lib/menuNota";
import { abrirConSistema, tabIdDeArchivo, type OtroArchivo } from "@/lib/otrosArchivos";
import { avisar, avisarFallo, avisarSiFallo } from "@/stores/avisosStore";
import { useImportStore } from "@/stores/importStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore, type TreeCarpeta, type TreeNota } from "@/stores/vaultStore";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { DialogoMoverA } from "./DialogoMoverA";
import styles from "./ExplorerPanel.module.css";

/** Lo que se está renombrando, con el texto del campo. */
export type RenameState = { type: "carpeta" | "nota" | "otro"; id: string; valor: string } | null;

type MenuState = { x: number; y: number; items: MenuItem[] } | null;

/** Lo que «Mover a…» está por mover (`FUN-S-32`). */
type MoverAState = {
  tipo: "nota" | "carpeta";
  id: string;
  nombre: string;
  actual: string | null;
  excluir?: ReadonlySet<string>;
} | null;

/**
 * El ícono de una entrada de menú (`FUN-S-28`). Un solo tamaño para todos los
 * menús del explorador, el mismo de los íconos de las filas del árbol.
 */
const ico = (Icono: LucideIcon) => <Icono size={15} aria-hidden />;

const IconoNota = ICONO_POR_TIPO.markdown;

export function useAccionesArchivo() {
  const router = useRouter();
  // Ruta del vault abierto (null mientras no hay ninguno): habilita
  // "Mostrar en el explorador", que abre la carpeta en el sistema.
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  // Los destinos de «Mover a…», al día mientras el diálogo está abierto.
  const carpetas = useVaultStore((s) => s.carpetas);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<RenameState>(null);
  const [moverA, setMoverA] = useState<MoverAState>(null);
  const archivosInputRef = useRef<HTMLInputElement>(null);
  const importTargetRef = useRef<string | null>(null);

  // Las acciones del store se leen en el momento: el menú se arma al abrirse y
  // no necesita que la vista se vuelva a dibujar con cada cambio del índice.
  const vs = () => useVaultStore.getState();

  const openNota = useCallback(
    (id: string) => {
      // Abrir en el pane activo aunque la URL ya apunte a esta nota
      useTabsStore.getState().openNote(id);
      router.replace(`/workspace?note=${id}`);
    },
    [router],
  );

  /**
   * Abre una nota recién creada con el título en edición (`DEF-135`): lo que se
   * escribe enseguida la nombra, en vez de perderse o de volver a activar el
   * botón que la creó.
   */
  const abrirNueva = useCallback(
    (id: string) => {
      pedirEdicionDeTitulo(id);
      openNota(id);
    },
    [openNota],
  );

  /** Abre el menú contextual en el punto del evento. */
  function abrirMenu(e: React.MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    if (items.length > 0) setMenu({ x: e.clientX, y: e.clientY, items });
  }

  /**
   * Mueve una nota a otra carpeta reparando los enlaces que llegaban a ella. Lo
   * usan el arrastre y «Mover a…» (`FUN-S-32`): el mismo `moveNota` que el MCP
   * `mycelium_mover`.
   */
  function moverNota(notaId: string, destinoId: string | null) {
    const nota = vs().notas.find((n) => n.id === notaId);
    if (!nota || nota.carpetaId === destinoId) return;
    void vs()
      .moveNota(notaId, destinoId)
      .then(avisarSiFallo(`mover «${nota.titulo}»`), avisarFallo(`mover «${nota.titulo}»`));
  }

  /** Lo mismo para una carpeta (y todo su subárbol). */
  function moverCarpeta(carpetaId: string, destinoId: string | null) {
    const carpeta = vs().carpetas.find((c) => c.id === carpetaId);
    if (!carpeta || carpeta.padreId === destinoId) return;
    // No mover dentro de sí misma ni de sus hijos (HU-24 CA6)
    if (destinoId !== null && vs().subtreeIds(carpetaId).has(destinoId)) return;
    void vs()
      .moveCarpeta(carpetaId, destinoId)
      .then(avisarSiFallo(`mover «${carpeta.nombre}»`), avisarFallo(`mover «${carpeta.nombre}»`));
  }

  /** «Mover a…» de una nota: abre el diálogo para elegir la carpeta. */
  function pedirMoverNota(nota: TreeNota) {
    setMoverA({ tipo: "nota", id: nota.id, nombre: nota.titulo, actual: nota.carpetaId });
  }

  /** «Mover a…» de una carpeta: sin ella ni su subárbol entre los destinos. */
  function pedirMoverCarpeta(carpeta: TreeCarpeta) {
    setMoverA({
      tipo: "carpeta",
      id: carpeta.id,
      nombre: carpeta.nombre,
      actual: carpeta.padreId,
      excluir: vs().subtreeIds(carpeta.id),
    });
  }

  /**
   * «Abrir al lado» (`FUN-S-32`): en un pane nuevo a la derecha del activo, como
   * soltar la nota en el borde derecho de un pane.
   */
  function abrirAlLado(id: string) {
    const tabs = useTabsStore.getState();
    tabs.splitPaneWithNota(id, tabs.activePaneId, "right");
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  }

  /** «Copiar enlace» (`FUN-S-32`): el `[[enlace]]` que lleva a la nota. */
  function copiarEnlace(nota: TreeNota) {
    const enlace = enlaceANota(nota, vs().notas, vs().carpetas);
    void navigator.clipboard
      .writeText(enlace)
      .then(() => avisar(`Enlace copiado: ${enlace}`), avisarFallo("copiar el enlace"));
  }

  /**
   * Crea un documento (`lib/crear.ts`, la misma lógica que el menú «Nuevo…» y
   * los comandos `crear.*`) y lo abre. Una nota abre con el título en edición.
   */
  function crearYAbrir(tipo: TipoDocumento, carpetaId: string | null, que: string) {
    void crearDocumento(tipo, carpetaId)
      .then(tipo === "nota" ? abrirNueva : openNota)
      .catch(avisarFallo(`crear ${que}`));
  }

  function crearCarpeta(padreId: string | null) {
    void pedirYCrearCarpeta(padreId).catch(avisarFallo("crear la carpeta"));
  }

  /** «Importar archivos…»: el selector del sistema, con destino `carpetaId`. */
  function importarEn(carpetaId: string | null) {
    importTargetRef.current = carpetaId;
    archivosInputRef.current?.click();
  }

  /**
   * Entrada "Nueva desde Espora ▸" del menú de una carpeta (FUN-M-03). Se arma
   * al abrir el menú, con las plantillas del momento; la nota se crea en
   * `carpetaId` (la carpeta del clic derecho), no en la carpeta activa.
   */
  function esporasMenu(carpetaId: string | null): MenuItem {
    const esporas = listarEsporas(vs().notas);
    return {
      label: "Nueva desde Espora",
      // El mismo ícono que la sección de Esporas del rail.
      icono: ico(CircleDot),
      disabled: esporas.length === 0,
      title:
        esporas.length === 0
          ? `No hay plantillas en «${carpetaEsporas()}». Crea la primera desde el panel de Esporas.`
          : "Crear una nota a partir de una plantilla",
      submenu: esporas.map((espora) => ({
        label: espora.titulo,
        icono: ico(IconoNota),
        onClick: () =>
          void crearNotaDesdeEspora(espora, carpetaId)
            .then(abrirNueva)
            .catch(avisarFallo(`crear la nota desde «${espora.titulo}»`)),
      })),
    };
  }

  function carpetaMenu(carpeta: TreeCarpeta): MenuItem[] {
    return [
      {
        label: opcionDe("nota").titulo,
        icono: ico(IconoNota),
        onClick: () => crearYAbrir("nota", carpeta.id, "la nota"),
      },
      {
        label: opcionDe("dibujo").titulo,
        icono: ico(ICONO_POR_TIPO.excalidraw),
        onClick: () => crearYAbrir("dibujo", carpeta.id, "el dibujo"),
      },
      // Base (FUN-L-03): una tabla que agrega notas por sus propiedades. Se crea
      // con una vista mínima ya escrita, para que muestre algo desde el principio.
      {
        label: opcionDe("tabla").titulo,
        icono: ico(ICONO_POR_TIPO.base),
        onClick: () => crearYAbrir("tabla", carpeta.id, "la base"),
      },
      {
        label: opcionDe("lienzo").titulo,
        icono: ico(ICONO_POR_TIPO.canvas),
        onClick: () => crearYAbrir("lienzo", carpeta.id, "el canvas"),
      },
      // draw.io (`FUN-L-20`): el diagrama formal, el que se retoca dentro de seis
      // meses moviendo una caja y que las flechas la sigan.
      {
        label: opcionDe("diagrama").titulo,
        icono: ico(ICONO_POR_TIPO.drawio),
        onClick: () => crearYAbrir("diagrama", carpeta.id, "el diagrama"),
      },
      // Plantillas (FUN-M-03): crea EN ESTA carpeta, no en la activa. Sin
      // Esporas la entrada queda deshabilitada con el motivo, nunca oculta: es
      // la forma de que la funcionalidad se descubra.
      esporasMenu(carpeta.id),
      {
        label: opcionDe("carpeta").titulo,
        icono: ico(FolderPlus),
        onClick: () => crearCarpeta(carpeta.id),
      },
      // Grupos (`FUN-S-28`): crear · traer al vault · organizar · eliminar.
      {
        label: "Importar archivos…",
        icono: ico(Upload),
        separadorAntes: true,
        onClick: () => importarEn(carpeta.id),
      },
      // Terminal integrada (FUN-L-07 CA4): solo en vault de carpeta, donde la
      // carpeta existe en disco (su id ES la ruta relativa).
      ...(rutaVault
        ? [
            {
              label: "Abrir terminal aquí",
              icono: ico(ICONO_CONSOLA),
              // La consola (xterm) se carga recién acá: el explorador está
              // siempre montado y no tiene por qué traerla al arrancar.
              onClick: async () => {
                const { crearTerminal } = await import("@/lib/terminal");
                const tabId = crearTerminal({ cwd: `${rutaVault}/${carpeta.id}` });
                router.replace(`/workspace?note=${encodeURIComponent(tabId)}`);
              },
            },
          ]
        : []),
      {
        label: "Renombrar",
        icono: ico(Pencil),
        separadorAntes: true,
        onClick: () => setRenaming({ type: "carpeta", id: carpeta.id, valor: carpeta.nombre }),
      },
      {
        label: "Mover a…",
        icono: ico(FolderInput),
        onClick: () => pedirMoverCarpeta(carpeta),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              icono: ico(FolderOpen),
              onClick: () =>
                void revelarEnSistema(rutaVault, carpeta.id).catch(avisarFallo("mostrar la carpeta")),
            },
          ]
        : []),
      {
        label: "Eliminar",
        icono: ico(Trash2),
        separadorAntes: true,
        danger: true,
        onClick: () => eliminarCarpeta(carpeta),
      },
    ];
  }

  function notaMenu(nota: TreeNota): MenuItem[] {
    // Grupos (`FUN-S-28`, `FUN-S-32`): abrir · organizar · copiar y exportar ·
    // mostrar · eliminar.
    return [
      {
        label: "Abrir al lado",
        icono: ico(Columns2),
        onClick: () => abrirAlLado(nota.id),
      },
      {
        label: "Renombrar",
        icono: ico(Pencil),
        separadorAntes: true,
        onClick: () => setRenaming({ type: "nota", id: nota.id, valor: nota.titulo }),
      },
      {
        label: "Duplicar",
        icono: ico(Copy),
        onClick: () => void vs().duplicateNota(nota.id).catch(avisarFallo(`duplicar «${nota.titulo}»`)),
      },
      {
        label: "Mover a…",
        icono: ico(FolderInput),
        onClick: () => pedirMoverNota(nota),
      },
      {
        label: "Copiar enlace",
        icono: ico(Link2),
        separadorAntes: true,
        title: "Copia el [[enlace]] a esta nota para pegarlo en otra",
        onClick: () => copiarEnlace(nota),
      },
      {
        label: "Exportar como .md",
        icono: ico(FileDown),
        onClick: () => void exportNoteMd(nota.id, nota.titulo).catch(avisarFallo(`exportar «${nota.titulo}»`)),
      },
      {
        label: "Exportar como PDF…",
        icono: ico(FileOutput),
        onClick: () => exportNotePdfActive(nota.id, nota.titulo),
      },
      ...(rutaVault
        ? [
            {
              label: "Mostrar en el explorador",
              icono: ico(FolderOpen),
              separadorAntes: true,
              onClick: () =>
                void revelarEnSistema(rutaVault, nota.id).catch(avisarFallo("mostrar la nota")),
            },
          ]
        : []),
      {
        label: "Eliminar",
        icono: ico(Trash2),
        separadorAntes: true,
        danger: true,
        // Sin preguntar, pero con vuelta atrás: la nota va a la papelera y el
        // aviso ofrece traerla de nuevo (crítica del cascarón, 2026-09-20).
        // Preguntar antes de cada borrado enseña a decir que sí sin leer.
        onClick: () => eliminarNota(nota),
      },
    ];
  }

  /**
   * Menú de un archivo que no es nota (`FUN-S-27`): antes no tenía ninguno, y
   * una imagen o un PDF no se podían renombrar ni borrar sin salir de la app.
   * Solo existe con vault de carpeta (`rutaVault`), que es donde hay archivos
   * así; en web no se listan.
   */
  function otroMenu(otro: OtroArchivo): MenuItem[] {
    if (!rutaVault) return [];
    const vault = rutaVault;
    const fallo = (que: string) => (e: unknown) =>
      avisar(`No se pudo ${que} «${otro.nombre}»: ${(e as Error)?.message ?? e}`);
    return [
      {
        label: "Abrir",
        icono: ico(Eye),
        onClick: () => abrirOtro(otro),
      },
      {
        label: "Abrir al lado",
        icono: ico(Columns2),
        onClick: () => abrirAlLado(tabIdDeArchivo(otro.ruta)),
      },
      {
        label: "Abrir con la aplicación predeterminada",
        icono: ico(ExternalLink),
        onClick: () => void abrirConSistema(vault, otro.ruta).catch(fallo("abrir")),
      },
      {
        label: "Renombrar",
        icono: ico(Pencil),
        separadorAntes: true,
        onClick: () => setRenaming({ type: "otro", id: otro.ruta, valor: nombreSinExtension(otro) }),
      },
      {
        label: "Duplicar",
        icono: ico(Copy),
        onClick: () => void duplicarOtro(vault, otro).catch(fallo("duplicar")),
      },
      {
        label: "Guardar una copia…",
        icono: ico(FileDown),
        title: "Descargar el archivo tal cual, fuera del vault",
        onClick: () => void guardarCopiaOtro(vault, otro).catch(fallo("guardar una copia de")),
      },
      {
        label: "Mostrar en el explorador",
        icono: ico(FolderOpen),
        separadorAntes: true,
        onClick: () => void revelarEnSistema(vault, otro.ruta).catch(fallo("mostrar")),
      },
      {
        label: "Eliminar",
        icono: ico(Trash2),
        separadorAntes: true,
        danger: true,
        // A la papelera del sistema, no a la de Mycelium (ver `eliminarOtro`):
        // como desde la app no se puede deshacer, se pregunta antes.
        onClick: () => eliminarOtroArchivo(otro),
      },
    ];
  }

  function abrirOtro(otro: OtroArchivo) {
    const tabId = tabIdDeArchivo(otro.ruta);
    useTabsStore.getState().openNote(tabId);
    router.replace(`/workspace?note=${tabId}`);
  }

  function eliminarCarpeta(carpeta: TreeCarpeta) {
    const subtree = vs().subtreeIds(carpeta.id);
    const count = vs().notas.filter((n) => n.carpetaId !== null && subtree.has(n.carpetaId)).length;
    const message =
      count > 0
        ? `Eliminar "${carpeta.nombre}" mandará ${count} nota(s) a la papelera. ¿Continuar?`
        : `¿Eliminar la carpeta "${carpeta.nombre}"?`;
    void confirmar(message, "Eliminar").then((ok) => {
      if (ok) void vs().deleteCarpeta(carpeta.id).catch(avisarFallo(`eliminar «${carpeta.nombre}»`));
    });
  }

  function eliminarNota(nota: TreeNota) {
    const titulo = nota.titulo;
    const id = nota.id;
    useTabsStore.getState().closeNotaEverywhere(id);
    void vs()
      .deleteNota(id)
      .then(() =>
        avisar(`«${titulo}» fue a la papelera`, {
          etiqueta: "Deshacer",
          hacer: () => void useVaultStore.getState().restoreNota(id).catch(avisarFallo(`restaurar «${titulo}»`)),
        }),
      )
      .catch(avisarFallo(`mandar «${titulo}» a la papelera`));
  }

  function eliminarOtroArchivo(otro: OtroArchivo) {
    if (!rutaVault) return;
    const vault = rutaVault;
    void confirmar(
      `¿Mandar «${otro.nombre}» a la papelera de reciclaje del sistema? Se recupera desde ahí.`,
      "Eliminar",
    ).then((ok) => {
      if (ok) {
        void eliminarOtro(vault, otro).catch((e) =>
          avisar(`No se pudo eliminar «${otro.nombre}»: ${(e as Error)?.message ?? e}`),
        );
      }
    });
  }

  /** Cambia el texto del campo de renombrar. */
  function cambiarRenombre(valor: string) {
    setRenaming((r) => (r ? { ...r, valor } : r));
  }

  /**
   * `conservarAlias` (`FUN-M-47`): con Mayús+Enter, el nombre anterior de la
   * nota queda como alias. Solo para notas markdown (las únicas con propiedades).
   */
  function commitRename(conservarAlias = false) {
    if (!renaming) return;
    const valor = renaming.valor.trim();
    const store = vs();
    if (valor) {
      if (renaming.type === "carpeta") {
        void store.renameCarpeta(renaming.id, valor).catch(avisarFallo("renombrar la carpeta"));
      } else if (renaming.type === "otro") {
        const otro = store.otros.find((o) => o.ruta === renaming.id);
        if (otro && rutaVault) {
          void renombrarOtro(rutaVault, otro, valor).catch((e) =>
            avisar(`No se pudo renombrar «${otro.nombre}»: ${(e as Error)?.message ?? e}`),
          );
        }
      } else {
        const anterior = store.notas.find((n) => n.id === renaming.id)?.titulo ?? "";
        void store
          .renameNota(renaming.id, valor, { conservarAlias })
          .then((r) => {
            if (r.aliasConservado) avisar(`«${anterior}» quedó como alias de «${r.titulo}».`);
          })
          .catch(avisarFallo("renombrar la nota"));
      }
    }
    setRenaming(null);
  }

  /**
   * Lo flotante: el menú, el diálogo «Mover a…» y el selector de archivos de
   * «Importar archivos…». La vista lo monta una vez.
   */
  const capas = (
    <>
      <input
        ref={archivosInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void useImportStore
              .getState()
              .run({ archivos: collectFromFileList(e.target.files) }, importTargetRef.current, "Importación");
          }
          e.target.value = "";
        }}
      />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {moverA && (
        <DialogoMoverA
          nombre={moverA.nombre}
          carpetas={carpetas}
          actual={moverA.actual}
          excluir={moverA.excluir}
          onCerrar={() => setMoverA(null)}
          onElegir={(destino) => {
            const { tipo, id } = moverA;
            setMoverA(null);
            if (tipo === "nota") moverNota(id, destino);
            else moverCarpeta(id, destino);
          }}
        />
      )}
    </>
  );

  return {
    rutaVault,
    capas,
    abrirMenu,
    carpetaMenu,
    notaMenu,
    otroMenu,
    openNota,
    abrirNueva,
    abrirOtro,
    abrirAlLado,
    copiarEnlace,
    crearYAbrir,
    crearCarpeta,
    importarEn,
    moverNota,
    moverCarpeta,
    pedirMoverNota,
    pedirMoverCarpeta,
    eliminarNota,
    eliminarCarpeta,
    eliminarOtroArchivo,
    renaming,
    setRenaming,
    cambiarRenombre,
    commitRename,
  };
}

// ── El campo de renombrar ────────────────────────────────────────

export type RowRenameProps = {
  renaming: boolean;
  renameValue: string;
  onRenameChange: (valor: string) => void;
  /** `conservarAlias`: se confirmó con Mayús+Enter (`FUN-M-47`). */
  onRenameCommit: (conservarAlias?: boolean) => void;
  onRenameCancel: () => void;
  /**
   * El nombre actual de una nota markdown (`FUN-M-47`): con él, el campo dice
   * debajo que Mayús+Enter lo conserva como alias. Sin él (carpetas, otros
   * tipos), Mayús+Enter es un Enter.
   */
  pistaAlias?: string;
};

/**
 * El campo de renombrar en el lugar de la fila: en el árbol del explorador y en
 * los resultados de la búsqueda (`DEF-185`).
 */
export function RenameInput({
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  pistaAlias,
}: Omit<RowRenameProps, "renaming">) {
  // Al entrar en renombrado, el nombre queda seleccionado entero, como en
  // Obsidian o en el explorador del sistema: escribir lo reemplaza y una flecha
  // lleva al principio o al final (`DEF-150 e`). El valor que llega ya es el
  // nombre SIN extensión (título de la nota, `nombreSinExtension` de un archivo
  // o el nombre de la carpeta), así que seleccionar todo es seleccionar el
  // nombre. Solo al montar: después, la selección es del usuario.
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  // Mayús+Enter conserva el nombre anterior como alias (`FUN-M-47`). Apagado
  // por defecto —la mayoría de los renombres corrige un nombre, y un alias de
  // más es un nombre viejo que sigue resolviendo—, y visible: la pista aparece
  // debajo del campo mientras se escribe un nombre distinto.
  const conPista = pistaAlias !== undefined && renameValue.trim() !== "" && renameValue.trim() !== pistaAlias;
  const campo = (
    <input
      ref={ref}
      className={styles.renameInput}
      value={renameValue}
      autoFocus
      aria-describedby={conPista ? "mic-pista-alias" : undefined}
      onChange={(e) => onRenameChange(e.target.value)}
      onBlur={() => onRenameCommit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onRenameCommit(e.shiftKey && pistaAlias !== undefined);
        if (e.key === "Escape") onRenameCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
  if (!conPista) return campo;
  return (
    <span className={styles.renameCaja}>
      {campo}
      <span id="mic-pista-alias" className={styles.renamePista}>
        Mayús+Enter: conservar «{pistaAlias}» como alias
      </span>
    </span>
  );
}
