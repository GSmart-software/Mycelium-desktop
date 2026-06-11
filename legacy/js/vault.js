/* Mycelium — bóveda: gestión de notas con la File System Access API (sin backend) */
(function () {
  "use strict";

  const MD_EXT = /\.(md|markdown|txt)$/i;

  class Vault {
    constructor() {
      this.notes = new Map(); // path -> { path, name, handle, content, dirty }
      this.dirHandle = null;
      this.onChange = null;
    }

    get supported() {
      return "showDirectoryPicker" in window;
    }

    _changed() {
      if (this.onChange) this.onChange();
    }

    /* Abre una carpeta de la PC como bóveda (lectura y escritura) */
    async openFolder() {
      let dir;
      try {
        dir = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (e) {
        if (e && e.name === "AbortError") return false;
        // algunos navegadores no aceptan la opción "mode"
        dir = await window.showDirectoryPicker();
      }
      this.dirHandle = dir;
      this.notes.clear();
      await this._scanDir(dir, "");
      this._changed();
      return true;
    }

    async _scanDir(dir, prefix) {
      for await (const entry of dir.values()) {
        if (entry.kind === "directory") {
          if (entry.name.startsWith(".")) continue;
          await this._scanDir(entry, prefix + entry.name + "/");
        } else if (MD_EXT.test(entry.name)) {
          const path = prefix + entry.name;
          this.notes.set(path, {
            path,
            name: entry.name.replace(MD_EXT, ""),
            handle: entry,
            content: null,
            dirty: false,
          });
        }
      }
    }

    /* Importa archivos sueltos con el selector nativo (mantiene el handle para guardar) */
    async pickFiles() {
      if (!("showOpenFilePicker" in window)) return null;
      let handles;
      try {
        handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown", ".txt"] } }],
        });
      } catch (e) {
        if (e && e.name === "AbortError") return [];
        throw e;
      }
      const added = [];
      for (const h of handles) {
        const file = await h.getFile();
        const note = {
          path: file.name,
          name: file.name.replace(MD_EXT, ""),
          handle: h,
          content: await file.text(),
          dirty: false,
        };
        this.notes.set(note.path, note);
        added.push(note.path);
      }
      if (added.length) this._changed();
      return added;
    }

    /* Importa desde un FileList (input file o arrastrar y soltar). Solo lectura. */
    async importFileList(files) {
      const added = [];
      for (const file of files) {
        if (!MD_EXT.test(file.name)) continue;
        const note = {
          path: file.name,
          name: file.name.replace(MD_EXT, ""),
          handle: null,
          content: await file.text(),
          dirty: false,
        };
        this.notes.set(note.path, note);
        added.push(note.path);
      }
      if (added.length) this._changed();
      return added;
    }

    async read(path) {
      const n = this.notes.get(path);
      if (!n) return null;
      if (n.content === null && n.handle) {
        const file = await n.handle.getFile();
        n.content = await file.text();
      }
      return n.content == null ? "" : n.content;
    }

    /* Guarda en disco si hay handle con permiso; si no, descarga el archivo */
    async save(path) {
      const n = this.notes.get(path);
      if (!n) return { ok: false };
      if (n.handle && n.handle.createWritable) {
        try {
          const w = await n.handle.createWritable();
          await w.write(n.content == null ? "" : n.content);
          await w.close();
          n.dirty = false;
          return { ok: true, mode: "disk" };
        } catch (e) {
          console.warn("No se pudo escribir en disco, se descargará:", e);
        }
      }
      const blob = new Blob([n.content == null ? "" : n.content], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = n.path.split("/").pop();
      a.click();
      URL.revokeObjectURL(a.href);
      n.dirty = false;
      return { ok: true, mode: "download" };
    }

    /* Crea una nota nueva (en la carpeta abierta si existe; si no, en memoria) */
    async create(name) {
      const clean = name.trim().replace(/[\\/:*?"<>|]/g, "-");
      if (!clean) return null;
      let path = MD_EXT.test(clean) ? clean : clean + ".md";
      let k = 1;
      while (this.notes.has(path)) {
        path = path.replace(/(\.\w+)$/, "") + " " + ++k + ".md";
      }
      let handle = null;
      if (this.dirHandle) {
        try {
          handle = await this.dirHandle.getFileHandle(path, { create: true });
        } catch (e) {
          console.warn("No se pudo crear el archivo en disco:", e);
        }
      }
      const note = {
        path,
        name: path.replace(MD_EXT, ""),
        handle,
        content: "# " + clean.replace(MD_EXT, "") + "\n\n",
        dirty: !handle,
      };
      this.notes.set(path, note);
      if (handle) await this.save(path);
      this._changed();
      return path;
    }

    /* Resuelve un wikilink al estilo Obsidian: por nombre o por ruta, sin distinguir mayúsculas */
    resolve(target) {
      const t = String(target).toLowerCase();
      for (const n of this.notes.values()) {
        const p = n.path.toLowerCase();
        if (n.name.toLowerCase() === t || p === t || p === t + ".md") return n.path;
      }
      for (const n of this.notes.values()) {
        if (n.path.toLowerCase().endsWith("/" + t + ".md")) return n.path;
      }
      return null;
    }

    /* Árbol de carpetas y archivos para el panel lateral */
    tree() {
      const root = { name: "", folders: new Map(), files: [] };
      const sorted = [...this.notes.values()].sort((a, b) => a.path.localeCompare(b.path));
      for (const n of sorted) {
        const parts = n.path.split("/");
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur.folders.has(parts[i])) {
            cur.folders.set(parts[i], { name: parts[i], folders: new Map(), files: [] });
          }
          cur = cur.folders.get(parts[i]);
        }
        cur.files.push(n);
      }
      return root;
    }

    /* Nodos y aristas para la vista de grafo (carga el contenido pendiente) */
    async graphData() {
      for (const n of this.notes.values()) {
        if (n.content === null && n.handle) {
          try {
            n.content = await (await n.handle.getFile()).text();
          } catch (e) {
            n.content = "";
          }
        }
      }
      const nodes = [...this.notes.values()].map((n) => ({ id: n.path, label: n.name }));
      const edges = [];
      const seen = new Set();
      for (const n of this.notes.values()) {
        for (const t of window.MD.extractWikiLinks(n.content || "")) {
          const target = this.resolve(t);
          if (target && target !== n.path) {
            const key = [n.path, target].sort().join("→");
            if (!seen.has(key)) {
              seen.add(key);
              edges.push({ source: n.path, target });
            }
          }
        }
      }
      return { nodes, edges };
    }
  }

  window.Vault = Vault;
})();
