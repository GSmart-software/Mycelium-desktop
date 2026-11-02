// draw.io se usa solo dentro del marco que le arma Mycelium. Si alguna vez se
// abre como página principal de la ventana, no arranca y se vuelve atrás.
(function () {
  if (window.top !== window) return;
  window.stop();
  if (history.length > 1) history.back();
})();
