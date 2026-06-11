/* Mycelium — aplicación: barra lateral, apertura de notas, edición, guardado y grafo */
(function () {
  "use strict";

  const vault = new window.Vault();
  let workspace;

  /* ---------- utilidades ---------- */

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function titleFor(leaf) {
    if (leaf.view.kind === "graph") return "Grafo de conexiones";
    if (leaf.view.kind === "file") {
      const n = vault.notes.get(leaf.view.path);
      if (!n) return leaf.view.path;
      return n.name + (n.dirty ? " ●" : "");
    }
    return "Nueva pestaña";
  }

  /* ---------- contenido de cada panel ---------- */

  async function renderLeafBody(leaf, body) {
    body.innerHTML = "";
    body.className = "pane-body";

    if (leaf.view.kind === "empty") {
      renderEmpty(body);
      return;
    }

    if (leaf.view.kind === "graph") {
      body.classList.add("graph-body");
      const canvas = document.createElement("canvas");
      body.appendChild(canvas);
      const data = await vault.graphData();
      if (!canvas.isConnected) return;
      if (data.nodes.length === 0) {
        body.innerHTML = '<div class="empty-hint">No hay notas todavía. Abre una carpeta o importa archivos .md para ver el grafo.</div>';
        return;
      }
      new window.GraphView(canvas, data, (path) => openFile(path));
      return;
    }

    // archivo
    const note = vault.notes.get(leaf.view.path);
    if (!note) {
      body.innerHTML = '<div class="empty-hint">Archivo no encontrado.</div>';
      return;
    }
    const content = await vault.read(note.path);
    if (!body.isConnected) return;

    if (leaf.mode === "edit") {
      const ta = document.createElement("textarea");
      ta.className = "editor";
      ta.spellcheck = false;
      ta.value = note.content == null ? content : note.content;
      ta.addEventListener("input", () => {
        note.content = ta.value;
        if (!note.dirty) {
          note.dirty = true;
          workspace.refreshTitles();
        }
      });
      body.appendChild(ta);
      ta.focus();
    } else {
      const view = document.createElement("div");
      view.className = "markdown-view";
      view.innerHTML = window.MD.render(content, (t) => vault.resolve(t));
      view.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-wikilink]");
        if (a) {
          e.preventDefault();
          openWikilink(a.dataset.wikilink);
        }
      });
      body.appendChild(view);
    }
  }

  function renderEmpty(body) {
    const div = document.createElement("div");
    div.className = "empty-pane";
    div.innerHTML =
      '<svg viewBox="0 0 32 32" width="72" height="72" aria-hidden="true">' +
      '<path d="M9 10L23 8M9 10L16 23M23 8L16 23" stroke="#1d4f55" stroke-width="1.5"/>' +
      '<circle cx="9" cy="10" r="4" fill="#155c52"/><circle cx="23" cy="8" r="3" fill="#125666"/><circle cx="16" cy="23" r="4" fill="#123e63"/></svg>' +
      '<p>Ningún archivo abierto</p>' +
      '<div class="empty-actions">' +
      '<button data-act="folder">Abrir carpeta</button>' +
      '<button data-act="import">Importar notas</button>' +
      '<button data-act="graph">Ver grafo</button>' +
      "</div>";
    div.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act === "folder") openFolder();
      if (b.dataset.act === "import") importFiles();
      if (b.dataset.act === "graph") workspace.open({ kind: "graph" });
    });
    body.appendChild(div);
  }

  /* ---------- acciones ---------- */

  function openFile(path) {
    workspace.open({ kind: "file", path });
    highlightTreeItem(path);
  }

  async function openWikilink(target) {
    const path = vault.resolve(target);
    if (path) {
      openFile(path);
    } else {
      const created = await vault.create(target);
      if (created) {
        toast('Nota "' + target + '" creada');
        openFile(created);
      }
    }
  }

  async function openFolder() {
    if (!vault.supported) {
      toast("Tu navegador no soporta abrir carpetas. Usa Chrome o Edge, o importa archivos sueltos.");
      return;
    }
    try {
      const ok = await vault.openFolder();
      if (ok) {
        toast(vault.notes.size + " notas cargadas");
        const first = workspace.leaves()[0];
        workspace.activeId = first.id;
        workspace.open({ kind: "empty" });
      }
    } catch (e) {
      if (e && e.name !== "AbortError") {
        console.error(e);
        toast("No se pudo abrir la carpeta");
      }
    }
  }

  async function importFiles() {
    try {
      const added = await vault.pickFiles();
      if (added === null) {
        document.getElementById("file-input").click(); // navegador sin showOpenFilePicker
        return;
      }
      if (added.length) {
        toast(added.length + " nota(s) importada(s)");
        openFile(added[0]);
      }
    } catch (e) {
      console.error(e);
      toast("No se pudieron importar los archivos");
    }
  }

  async function newNote() {
    const name = prompt("Nombre de la nueva nota:", "Sin título");
    if (!name) return;
    const path = await vault.create(name);
    if (path) {
      openFile(path);
      const leaf = workspace.active;
      leaf.mode = "edit";
      workspace.render();
    }
  }

  async function saveActive() {
    const leaf = workspace.active;
    if (!leaf || leaf.view.kind !== "file") return;
    const note = vault.notes.get(leaf.view.path);
    if (!note) return;
    const res = await vault.save(note.path);
    if (res.ok) {
      toast(res.mode === "disk" ? "Guardado en " + note.path : "Descargado (sin acceso directo al disco)");
      workspace.refreshTitles();
      refreshPreviewsOf(note.path);
    }
  }

  /* vuelve a pintar las vistas previas de un archivo editado en otro panel */
  function refreshPreviewsOf(path) {
    for (const leaf of workspace.leaves()) {
      if (leaf.view.kind === "file" && leaf.view.path === path && leaf.mode === "preview") {
        const body = workspace.bodyOf(leaf.id);
        if (body) renderLeafBody(leaf, body);
      }
    }
  }

  /* ---------- panel de archivos ---------- */

  const ICON_FOLDER =
    '<svg viewBox="0 0 24 24" class="tree-icon"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const ICON_FILE =
    '<svg viewBox="0 0 24 24" class="tree-icon"><path d="M6 3h8l4 4v14H6V3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  function renderTree() {
    const treeEl = document.getElementById("file-tree");
    treeEl.innerHTML = "";
    if (vault.notes.size === 0) {
      treeEl.innerHTML =
        '<div class="tree-empty">Tu bóveda está vacía.<br>Abre una carpeta o arrastra archivos .md a la ventana.</div>';
    } else {
      treeEl.appendChild(buildTreeEl(vault.tree()));
    }
    const info = document.getElementById("vault-info");
    info.textContent =
      vault.notes.size + " nota" + (vault.notes.size === 1 ? "" : "s") + (vault.dirHandle ? " · " + vault.dirHandle.name : "");
  }

  function buildTreeEl(folder) {
    const ul = document.createElement("ul");
    for (const sub of folder.folders.values()) {
      const li = document.createElement("li");
      li.className = "folder";
      const label = document.createElement("div");
      label.className = "tree-item folder-label";
      label.innerHTML = ICON_FOLDER + "<span>" + window.MD.escapeHtml(sub.name) + "</span>";
      label.addEventListener("click", () => li.classList.toggle("collapsed"));
      li.appendChild(label);
      li.appendChild(buildTreeEl(sub));
      ul.appendChild(li);
    }
    for (const f of folder.files) {
      const li = document.createElement("li");
      const item = document.createElement("div");
      item.className = "tree-item file";
      item.dataset.path = f.path;
      item.innerHTML = ICON_FILE + "<span>" + window.MD.escapeHtml(f.name) + "</span>";
      item.addEventListener("click", () => openFile(f.path));
      li.appendChild(item);
      ul.appendChild(li);
    }
    return ul;
  }

  function highlightTreeItem(path) {
    document.querySelectorAll("#file-tree .tree-item.file").forEach((el) => {
      el.classList.toggle("active", el.dataset.path === path);
    });
  }

  /* ---------- notas de bienvenida (en memoria, hasta abrir una carpeta real) ---------- */

  function seedWelcome() {
    const demo = [
      {
        path: "Bienvenido a Mycelium.md",
        content:
          "# Bienvenido a Mycelium 🍄\n\n" +
          "Mycelium es tu red de notas: los archivos **viven en tu PC**, no hay servidores detrás.\n\n" +
          "## Primeros pasos\n\n" +
          "- [ ] Pulsa **Abrir carpeta** para usar una carpeta de tu PC como bóveda\n" +
          "- [ ] O arrastra archivos `.md` directamente a esta ventana\n" +
          "- [x] Explora estas notas de ejemplo\n\n" +
          "## Funciones\n\n" +
          "- Conecta ideas con wikilinks: [[Cómo funcionan los enlaces]]\n" +
          "- Divide la vista en paneles con los botones de la esquina de cada panel\n" +
          "- Visualiza tu red en el [[Grafo de conexiones|grafo]] con el botón **Grafo**\n" +
          "- Edita con el botón del lápiz y guarda con `Ctrl+S`\n\n" +
          "> *\"Como el micelio bajo el bosque, tus notas se conectan en silencio.\"* #bienvenida\n",
      },
      {
        path: "Cómo funcionan los enlaces.md",
        content:
          "# Cómo funcionan los enlaces\n\n" +
          "Escribe `[[nombre de la nota]]` para enlazar otra nota. Si no existe, al hacer clic se crea.\n\n" +
          "- `[[Nota]]` crea un enlace directo\n" +
          "- Con una barra vertical puedes mostrar otro texto: la sintaxis es doble corchete, nombre, barra, alias\n\n" +
          "| Elemento | Color |\n" +
          "| --- | --- |\n" +
          "| Enlace resuelto | verde bioluminiscente |\n" +
          "| Enlace sin crear | gris punteado |\n\n" +
          "Cada enlace se convierte en una arista del grafo. Vuelve a [[Bienvenido a Mycelium]] o mira el [[Grafo de conexiones]]. #ayuda\n",
      },
      {
        path: "Grafo de conexiones.md",
        content:
          "# Grafo de conexiones\n\n" +
          "Pulsa el botón **Grafo** de la barra lateral para ver tus notas como una red bioluminiscente.\n\n" +
          "- Arrastra los nodos para reacomodarlos\n" +
          "- Rueda del ratón para hacer zoom, arrastra el fondo para desplazarte\n" +
          "- Haz clic en un nodo para abrir esa nota\n\n" +
          "Relacionado: [[Bienvenido a Mycelium]] · [[Cómo funcionan los enlaces]] #ayuda\n",
      },
    ];
    for (const d of demo) {
      vault.notes.set(d.path, {
        path: d.path,
        name: d.path.replace(/\.md$/i, ""),
        handle: null,
        content: d.content,
        dirty: false,
      });
    }
  }

  /* ---------- arranque ---------- */

  function init() {
    workspace = new window.Workspace(document.getElementById("workspace"), renderLeafBody, titleFor);
    vault.onChange = renderTree;

    seedWelcome();
    renderTree();
    workspace.render();
    openFile("Bienvenido a Mycelium.md");

    document.getElementById("btn-open-folder").addEventListener("click", openFolder);
    document.getElementById("btn-import").addEventListener("click", importFiles);
    document.getElementById("btn-new-note").addEventListener("click", newNote);
    document.getElementById("btn-graph").addEventListener("click", () => workspace.open({ kind: "graph" }));

    // input de respaldo para navegadores sin File System Access API
    document.getElementById("file-input").addEventListener("change", async (e) => {
      const added = await vault.importFileList(e.target.files);
      if (added.length) {
        toast(added.length + " nota(s) importada(s) (solo lectura: al guardar se descargan)");
        openFile(added[0]);
      }
      e.target.value = "";
    });

    // arrastrar y soltar archivos .md sobre la ventana
    const overlay = document.getElementById("drop-overlay");
    let dragDepth = 0;
    window.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      overlay.classList.add("show");
    });
    window.addEventListener("dragleave", () => {
      if (--dragDepth <= 0) {
        dragDepth = 0;
        overlay.classList.remove("show");
      }
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove("show");
      const added = await vault.importFileList(e.dataTransfer.files);
      if (added.length) {
        toast(added.length + " nota(s) importada(s)");
        openFile(added[0]);
      }
    });

    // atajos: Ctrl+S guarda, Ctrl+E alterna edición/vista previa
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActive();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const leaf = workspace.active;
        if (leaf && leaf.view.kind === "file") {
          leaf.mode = leaf.mode === "preview" ? "edit" : "preview";
          workspace.render();
        }
      }
    });

    if (!vault.supported) {
      toast("Consejo: en Chrome o Edge puedes abrir carpetas y guardar directamente en tu PC.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
