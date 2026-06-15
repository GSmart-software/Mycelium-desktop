/**
 * Agrega un botón "Copiar" en la esquina superior derecha de cada bloque de
 * código del preview. Idempotente: no duplica el botón si ya existe.
 */
export function addCodeCopyButtons(container: HTMLElement): void {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".mic-copy-btn")) return;
    const code = pre.querySelector("code");
    if (!code) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mic-copy-btn";
    btn.textContent = "Copiar";
    btn.setAttribute("aria-label", "Copiar código");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard
        .writeText(code.innerText)
        .then(() => {
          btn.textContent = "Copiado";
          setTimeout(() => {
            btn.textContent = "Copiar";
          }, 1200);
        })
        .catch(() => {
          btn.textContent = "Error";
          setTimeout(() => {
            btn.textContent = "Copiar";
          }, 1200);
        });
    });
    pre.appendChild(btn);
  });
}
