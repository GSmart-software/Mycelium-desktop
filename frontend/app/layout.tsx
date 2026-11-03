import type { Metadata } from "next";
import {
  Fira_Code,
  Geist,
  Inter,
  JetBrains_Mono,
  Lora,
  Manrope,
  Michroma,
  Source_Code_Pro,
  Source_Serif_4,
} from "next/font/google";
import { AyudaGlobal } from "@/components/ayuda/AyudaGlobal";
import { BordesRedimensionado } from "@/components/ventana/BordesRedimensionado";
import { ReposoVentana } from "@/components/ventana/ReposoVentana";
import { DevToolsHotkey } from "@/components/workspace/DevToolsHotkey";
// KaTeX y Excalidraw no van acá (`FUN-M-58`): se cargaban en todas las rutas,
// también en el selector de vaults. KaTeX va con el workspace
// (`app/(workspace)/workspace/page.tsx`) y con la ayuda (`VentanaAyuda`);
// Excalidraw, con el paquete (`lib/excalidrawEstilos.ts`).
import "../styles/tokens.css";
import "../styles/atmosferas.css";
import "../styles/arrecife.css";
import "../styles/gsmart.css";
import "../styles/aurora.css";
import "../styles/editor.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Source Serif 4 era la letra de la vista de lectura hasta el 2026-10-09; desde
// entonces el defecto es Geist en edición y en lectura, y ninguna regla usa
// `--mic-font-serif`. Queda como opción de Tipografía, así que va sin precarga,
// como las de abajo (`FUN-M-58`, C-H6).
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Fuentes adicionales seleccionables en Tipografía (HU-14). Sin precarga
// (`FUN-M-58`, C-H6 de la auditoría de eficiencia del 2026-11-01): con ella,
// cada ventana bajaba estas cuatro aunque el vault no eligiera ninguna. El
// @font-face sigue declarado, y el navegador la baja cuando una regla la usa.
// Precargadas quedan solo las que se ven siempre: Geist (interfaz y texto) y
// JetBrains Mono (código).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], preload: false });
const firaCode = Fira_Code({ variable: "--font-fira-code", subsets: ["latin"], preload: false });
const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
  preload: false,
});

// Las letras del tema GSmart (`FUN-M-52`): Manrope en la interfaz y Michroma en
// títulos y etiquetas. Solo las usa styles/gsmart.css, bajo
// `:root[data-theme='gsmart']`. `next/font/google` las descarga AL COMPILAR y
// las sirve con la app: en ejecución no sale ningún pedido a Google, así que
// andan sin red. Sin precarga: el resto de los temas no las pide, y el
// navegador solo baja un @font-face cuando una regla lo usa.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const michroma = Michroma({
  variable: "--font-michroma",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const fontVariables = [
  inter.variable,
  lora.variable,
  firaCode.variable,
  sourceCodePro.variable,
  manrope.variable,
  michroma.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Mycelium",
  description: "Tu red de conocimiento, viva y conectada",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='9' cy='10' r='4' fill='%2325f0c8'/%3E%3Ccircle cx='23' cy='8' r='3' fill='%2319e6ff'/%3E%3Ccircle cx='16' cy='23' r='4' fill='%232f8fff'/%3E%3Cpath d='M9 10L23 8M9 10L16 23M23 8L16 23' stroke='%2325f0c8' stroke-width='1.5' opacity='.6'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-theme="bioluminiscencia"
      data-dark="true"
      data-atmosfera="niebla"
      className={`${geistSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${fontVariables}`}
    >
      <body>
        {/* F12 / Ctrl+Shift+I abren las devtools, también en producción. */}
        <DevToolsHotkey />
        {/* Sin barra del sistema, los bordes de la ventana los repone la app. */}
        <BordesRedimensionado />
        {/* Sin foco o minimizada, la ventana deja de animar (`DEF-174`). */}
        <ReposoVentana />
        {children}
        {/* La ayuda (F1), en toda la app: también en el selector de vaults. */}
        <AyudaGlobal />
      </body>
    </html>
  );
}
