/**
 * Render de bloques ```mermaid en el preview (HU-18). Import dinámico para
 * no cargar mermaid hasta que haga falta. Sintaxis inválida → mensaje de
 * error inline sin romper el resto de la nota (CA3).
 */

let seq = 0;

export async function renderMermaidIn(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>(
    "pre > code.language-mermaid",
  );
  if (blocks.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

  for (const code of Array.from(blocks)) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent ?? "";
    const host = document.createElement("div");
    host.className = "mic-mermaid";

    try {
      const { svg } = await mermaid.render(`mic-mermaid-${++seq}`, source);
      host.innerHTML = svg;
      pre.replaceWith(host);
    } catch (error) {
      const message = document.createElement("p");
      message.className = "mic-mermaid-error";
      message.textContent = `Diagrama Mermaid inválido: ${
        error instanceof Error ? error.message.split("\n")[0] : "error de sintaxis"
      }`;
      pre.insertAdjacentElement("afterend", message);
      // mermaid.render deja nodos huérfanos ante error — limpiarlos
      document.getElementById(`mic-mermaid-${seq}`)?.remove();
    }
  }
}
