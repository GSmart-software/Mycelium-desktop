/* Mycelium — espacio de trabajo con paneles divisibles (horizontal y vertical) */
(function () {
  "use strict";

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    splitV: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4v16" stroke="currentColor" stroke-width="1.6"/></svg>',
    splitH: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  let uid = 0;
  function makeLeaf(view) {
    return { type: "leaf", id: "leaf-" + ++uid, view: view || { kind: "empty" }, mode: "preview", size: 1 };
  }

  class Workspace {
    /**
     * @param container elemento contenedor
     * @param renderLeafBody (leaf, bodyEl) => void  — la app pinta el contenido
     * @param titleFor (leaf) => string — título del panel
     */
    constructor(container, renderLeafBody, titleFor) {
      this.container = container;
      this.renderLeafBody = renderLeafBody;
      this.titleFor = titleFor;
      this.root = makeLeaf();
      this.activeId = this.root.id;
    }

    leaves(node, out) {
      node = node || this.root;
      out = out || [];
      if (node.type === "leaf") out.push(node);
      else node.children.forEach((c) => this.leaves(c, out));
      return out;
    }

    find(id, node, parent) {
      node = node || this.root;
      if (node.type === "leaf") return node.id === id ? { node, parent: parent || null } : null;
      for (const c of node.children) {
        const r = this.find(id, c, node);
        if (r) return r;
      }
      return null;
    }

    _parentOf(target, node) {
      node = node || this.root;
      if (node.type === "leaf") return null;
      for (const c of node.children) {
        if (c === target) return node;
        const r = this._parentOf(target, c);
        if (r) return r;
      }
      return null;
    }

    get active() {
      const r = this.find(this.activeId);
      return r ? r.node : this.leaves()[0];
    }

    setActive(id) {
      if (this.activeId === id) return;
      this.activeId = id;
      this._refreshActive();
    }

    /* Abre una vista en el panel activo */
    open(view, mode) {
      const leaf = this.active;
      leaf.view = view;
      leaf.mode = mode || leaf.mode || "preview";
      if (view.kind !== "file") leaf.mode = "preview";
      this.render();
    }

    /* Divide un panel: dir "row" = lado a lado, "col" = uno sobre otro */
    split(id, dir) {
      const r = this.find(id);
      if (!r) return null;
      const { node, parent } = r;
      const twin = makeLeaf(Object.assign({}, node.view));
      twin.mode = node.mode;
      if (parent && parent.dir === dir) {
        const idx = parent.children.indexOf(node);
        parent.children.splice(idx + 1, 0, twin);
      } else {
        const splitNode = { type: "split", dir, children: [node, twin], size: node.size };
        node.size = 1;
        if (!parent) this.root = splitNode;
        else parent.children[parent.children.indexOf(node)] = splitNode;
      }
      this.activeId = twin.id;
      this.render();
      return twin;
    }

    close(id) {
      const r = this.find(id);
      if (!r) return;
      const { node, parent } = r;
      if (!parent) {
        node.view = { kind: "empty" };
        node.mode = "preview";
        this.render();
        return;
      }
      parent.children.splice(parent.children.indexOf(node), 1);
      if (parent.children.length === 1) {
        const only = parent.children[0];
        only.size = parent.size;
        const gp = this._parentOf(parent);
        if (!gp) this.root = only;
        else gp.children[gp.children.indexOf(parent)] = only;
      }
      if (this.activeId === id) this.activeId = this.leaves()[0].id;
      this.render();
    }

    render() {
      this.container.innerHTML = "";
      this.container.appendChild(this._build(this.root));
      this._refreshActive();
    }

    refreshTitles() {
      this.container.querySelectorAll(".pane").forEach((el) => {
        const r = this.find(el.dataset.leafId);
        if (r) el.querySelector(".pane-title").textContent = this.titleFor(r.node);
      });
    }

    bodyOf(id) {
      const el = this.container.querySelector('[data-leaf-id="' + id + '"] .pane-body');
      return el || null;
    }

    _refreshActive() {
      this.container.querySelectorAll(".pane").forEach((el) => {
        el.classList.toggle("active", el.dataset.leafId === this.activeId);
      });
    }

    _build(node) {
      if (node.type === "leaf") return this._buildLeaf(node);
      const el = document.createElement("div");
      el.className = "split " + (node.dir === "row" ? "split-row" : "split-col");
      el.style.flexGrow = node.size || 1;
      node.children.forEach((c, i) => {
        if (i > 0) {
          const div = document.createElement("div");
          div.className = "divider " + (node.dir === "row" ? "divider-v" : "divider-h");
          this._bindDivider(div, node, i);
          el.appendChild(div);
        }
        el.appendChild(this._build(c));
      });
      return el;
    }

    _bindDivider(div, node, idx) {
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const prevEl = div.previousElementSibling;
        const nextEl = div.nextElementSibling;
        const horiz = node.dir === "row";
        const start = horiz ? e.clientX : e.clientY;
        const prevRect = prevEl.getBoundingClientRect();
        const nextRect = nextEl.getBoundingClientRect();
        const prevPx = horiz ? prevRect.width : prevRect.height;
        const nextPx = horiz ? nextRect.width : nextRect.height;
        const totalPx = prevPx + nextPx;
        const totalGrow = (node.children[idx - 1].size || 1) + (node.children[idx].size || 1);
        document.body.classList.add(horiz ? "resizing-h" : "resizing-v");
        const move = (ev) => {
          const delta = (horiz ? ev.clientX : ev.clientY) - start;
          const p = Math.min(Math.max(prevPx + delta, 80), totalPx - 80);
          node.children[idx - 1].size = (totalGrow * p) / totalPx;
          node.children[idx].size = (totalGrow * (totalPx - p)) / totalPx;
          prevEl.style.flexGrow = node.children[idx - 1].size;
          nextEl.style.flexGrow = node.children[idx].size;
        };
        const up = () => {
          document.body.classList.remove("resizing-h", "resizing-v");
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
    }

    _buildLeaf(node) {
      const el = document.createElement("div");
      el.className = "pane";
      el.dataset.leafId = node.id;
      el.style.flexGrow = node.size || 1;
      el.addEventListener("mousedown", () => this.setActive(node.id));

      const header = document.createElement("div");
      header.className = "pane-header";
      const title = document.createElement("span");
      title.className = "pane-title";
      title.textContent = this.titleFor(node);
      header.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "pane-actions";
      const addBtn = (icon, tip, fn) => {
        const b = document.createElement("button");
        b.className = "icon-btn";
        b.innerHTML = icon;
        b.title = tip;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          fn();
        });
        actions.appendChild(b);
      };
      if (node.view.kind === "file") {
        const preview = node.mode === "preview";
        addBtn(preview ? ICONS.edit : ICONS.eye, preview ? "Editar (Ctrl+E)" : "Vista previa (Ctrl+E)", () => {
          node.mode = preview ? "edit" : "preview";
          this.render();
        });
      }
      addBtn(ICONS.splitV, "Dividir a la derecha", () => this.split(node.id, "row"));
      addBtn(ICONS.splitH, "Dividir abajo", () => this.split(node.id, "col"));
      addBtn(ICONS.close, "Cerrar panel", () => this.close(node.id));
      header.appendChild(actions);
      el.appendChild(header);

      const body = document.createElement("div");
      body.className = "pane-body";
      el.appendChild(body);
      this.renderLeafBody(node, body);
      return el;
    }
  }

  window.Workspace = Workspace;
})();
