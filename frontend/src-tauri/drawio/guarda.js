// draw.io se usa solo dentro del marco que le arma Mycelium. Si alguna vez se
// abre como página principal de la ventana, no arranca y se vuelve atrás.
(function () {
  if (window.top !== window) return;
  window.stop();
  if (history.length > 1) history.back();
})();

// Salir con el teclado (`FUN-XL-04`): con el foco dentro de este marco, las
// teclas no llegan a Mycelium, que es otro origen. F6 y Shift+F6 le avisan
// para que pase el foco a la zona siguiente o a la anterior, y F10 para que
// muestre las pistas. El mensaje no lleva datos; Mycelium lo acepta solo de
// este marco y de este origen.
(function () {
  if (window.top === window) return;
  window.addEventListener(
    "keydown",
    function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "F6") {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage(JSON.stringify({ event: "mycelium-zona", atras: e.shiftKey }), "*");
      } else if (e.key === "F10" && !e.shiftKey) {
        // Las pistas (F10): Mycelium saca el foco del marco y las muestra.
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage(JSON.stringify({ event: "mycelium-pistas" }), "*");
      }
    },
    true,
  );
})();

// draw.io se enfoca solo al arrancar y al cargar un diagrama. Dentro de
// Mycelium eso le robaba el foco a la app: el renderizador oculto de las vistas
// previas y el editor de un panel que no era el activo se lo llevaban al
// terminar de cargar, y el teclado quedaba dentro de un marco invisible o
// ajeno (prueba en vivo de `FUN-XL-04`, 2026-11-06). Regla: un marco que no
// tiene el foco no lo toma por código. El clic del usuario y el `focus()` con
// que Mycelium entra al marco (Enter) se lo dan antes, así que esos siguen.
(function () {
  if (window.top === window) return;
  var enfocar = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    if (document.hasFocus()) return enfocar.apply(this, arguments);
  };
  var enfocarVentana = window.focus;
  window.focus = function () {
    if (document.hasFocus()) return enfocarVentana.apply(this, arguments);
  };
})();
