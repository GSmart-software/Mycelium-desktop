/* Mycelium — vista de grafo: simulación de fuerzas en canvas con estética bioluminiscente */
(function () {
  "use strict";

  class GraphView {
    /**
     * @param canvas <canvas> ya insertado en el DOM
     * @param data { nodes: [{id,label}], edges: [{source,target}] }
     * @param onOpen (id) => void — clic sobre un nodo
     */
    constructor(canvas, data, onOpen) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onOpen = onOpen;

      const N = data.nodes.length;
      this.nodes = data.nodes.map((n, i) => {
        const a = (i / Math.max(N, 1)) * Math.PI * 2;
        const r = 60 + Math.random() * 160;
        return { id: n.id, label: n.label, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, degree: 0 };
      });
      this.byId = new Map(this.nodes.map((n) => [n.id, n]));
      this.edges = [];
      for (const e of data.edges) {
        const s = this.byId.get(e.source);
        const t = this.byId.get(e.target);
        if (s && t) {
          this.edges.push({ s, t });
          s.degree++;
          t.degree++;
        }
      }

      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.hover = null;
      this.dragNode = null;
      this.panning = false;
      this.alpha = 1; // energía de la simulación, se enfría sola

      this._abort = new AbortController();
      this._bind();
      this._resize();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvas.parentElement || canvas);

      this.running = true;
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
    }

    destroy() {
      this.running = false;
      this._abort.abort();
      if (this._ro) this._ro.disconnect();
    }

    _resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = parent.clientWidth * dpr;
      this.canvas.height = parent.clientHeight * dpr;
      this.canvas.style.width = parent.clientWidth + "px";
      this.canvas.style.height = parent.clientHeight + "px";
      this.dpr = dpr;
      this.alpha = Math.max(this.alpha, 0.3);
    }

    _toWorld(ev) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: (ev.clientX - rect.left - cx - this.ox) / this.scale,
        y: (ev.clientY - rect.top - cy - this.oy) / this.scale,
      };
    }

    _pick(ev) {
      const p = this._toWorld(ev);
      let best = null;
      let bestD = 14 / this.scale;
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bestD + this._radius(n)) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    _radius(n) {
      return Math.min(4 + n.degree * 1.4, 14);
    }

    _bind() {
      const sig = { signal: this._abort.signal };
      const c = this.canvas;

      c.addEventListener("mousedown", (ev) => {
        const n = this._pick(ev);
        this._downAt = { x: ev.clientX, y: ev.clientY };
        if (n) {
          this.dragNode = n;
          this.alpha = Math.max(this.alpha, 0.4);
        } else {
          this.panning = true;
        }
      }, sig);

      window.addEventListener("mousemove", (ev) => {
        if (this.dragNode) {
          const p = this._toWorld(ev);
          this.dragNode.x = p.x;
          this.dragNode.y = p.y;
          this.dragNode.vx = 0;
          this.dragNode.vy = 0;
          this.alpha = Math.max(this.alpha, 0.4);
        } else if (this.panning) {
          this.ox += ev.movementX;
          this.oy += ev.movementY;
        } else {
          const n = this._pick(ev);
          if (n !== this.hover) {
            this.hover = n;
            c.style.cursor = n ? "pointer" : "grab";
          }
        }
      }, sig);

      window.addEventListener("mouseup", (ev) => {
        const moved = this._downAt && Math.hypot(ev.clientX - this._downAt.x, ev.clientY - this._downAt.y) > 4;
        if (this.dragNode && !moved && this.onOpen) this.onOpen(this.dragNode.id);
        this.dragNode = null;
        this.panning = false;
        this._downAt = null;
      }, sig);

      c.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        const rect = c.getBoundingClientRect();
        const mx = ev.clientX - rect.left - rect.width / 2;
        const my = ev.clientY - rect.top - rect.height / 2;
        // mantener el punto bajo el cursor fijo al hacer zoom
        this.ox = mx - (mx - this.ox) * factor;
        this.oy = my - (my - this.oy) * factor;
        this.scale = Math.min(Math.max(this.scale * factor, 0.15), 4);
      }, { passive: false, signal: this._abort.signal });
    }

    _simulate() {
      const k = 90; // distancia ideal
      const nodes = this.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const d = Math.sqrt(d2);
          const f = Math.min((k * k) / d2, 8) * this.alpha;
          dx = (dx / d) * f;
          dy = (dy / d) * f;
          a.vx += dx; a.vy += dy;
          b.vx -= dx; b.vy -= dy;
        }
      }
      for (const e of this.edges) {
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const f = ((d - k) / d) * 0.02 * this.alpha * 10;
        e.s.vx += dx * f * 0.05; e.s.vy += dy * f * 0.05;
        e.t.vx -= dx * f * 0.05; e.t.vy -= dy * f * 0.05;
      }
      for (const n of nodes) {
        // gravedad suave hacia el centro
        n.vx -= n.x * 0.003 * this.alpha;
        n.vy -= n.y * 0.003 * this.alpha;
        if (n === this.dragNode) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
      this.alpha = Math.max(this.alpha * 0.995, 0.02);
    }

    _tick() {
      if (!this.running) return;
      if (!this.canvas.isConnected) { this.destroy(); return; }
      this._simulate();
      this._draw();
      requestAnimationFrame(this._tick);
    }

    _draw() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(w / (2 * this.dpr) + this.ox, h / (2 * this.dpr) + this.oy);
      ctx.scale(this.scale, this.scale);

      const hover = this.hover;

      // aristas: hifas tenues, brillantes si tocan el nodo bajo el cursor
      for (const e of this.edges) {
        const lit = hover && (e.s === hover || e.t === hover);
        ctx.strokeStyle = lit ? "rgba(61,255,196,0.75)" : "rgba(64,200,200,0.18)";
        ctx.lineWidth = (lit ? 1.6 : 1) / this.scale;
        ctx.beginPath();
        ctx.moveTo(e.s.x, e.s.y);
        ctx.lineTo(e.t.x, e.t.y);
        ctx.stroke();
      }

      // nodos: esporas bioluminiscentes (color entre verde y azul según conexiones)
      for (const n of this.nodes) {
        const r = this._radius(n);
        const hue = 165 + Math.min(n.degree * 8, 50); // 165 verde-agua → 215 azul
        const lit = n === hover;
        ctx.shadowColor = "hsl(" + hue + ", 100%, 60%)";
        ctx.shadowBlur = lit ? 26 : 14;
        ctx.fillStyle = "hsl(" + hue + ", 95%, " + (lit ? 70 : 58) + "%)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // etiquetas
      const showAll = this.scale > 0.55;
      ctx.textAlign = "center";
      ctx.font = 12 / this.scale + "px 'Segoe UI', sans-serif";
      for (const n of this.nodes) {
        if (!showAll && n !== hover) continue;
        ctx.fillStyle = n === hover ? "rgba(210,255,244,1)" : "rgba(150,210,205,0.8)";
        ctx.fillText(n.label, n.x, n.y + this._radius(n) + 14 / this.scale);
      }
    }
  }

  window.GraphView = GraphView;
})();
