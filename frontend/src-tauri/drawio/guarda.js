// draw.io se usa solo dentro del marco que le arma Mycelium. Si alguna vez se
// abre como página principal de la ventana, no arranca y se vuelve atrás.
(function () {
  if (window.top !== window) return;
  window.stop();
  if (history.length > 1) history.back();
})();

// Salir con el teclado (`FUN-XL-04`): con el foco dentro de este marco, las
// teclas no llegan a Mycelium, que es otro origen. F6 y Shift+F6 le avisan
// para que pase el foco a la zona siguiente o a la anterior. El mensaje no
// lleva datos; Mycelium lo acepta solo de este marco y de este origen.
(function () {
  if (window.top === window) return;
  window.addEventListener(
    "keydown",
    function (e) {
      if (e.key !== "F6" || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage(JSON.stringify({ event: "mycelium-zona", atras: e.shiftKey }), "*");
    },
    true,
  );
})();
