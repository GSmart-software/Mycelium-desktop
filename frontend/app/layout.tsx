import type { Metadata } from "next";
import {
  Fira_Code,
  Geist,
  Inter,
  JetBrains_Mono,
  Lora,
  Source_Code_Pro,
  Source_Serif_4,
} from "next/font/google";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";
import "@excalidraw/excalidraw/index.css";
import "../styles/tokens.css";
import "../styles/editor.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Fuentes adicionales seleccionables en Tipografía (HU-14)
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"] });
const firaCode = Fira_Code({ variable: "--font-fira-code", subsets: ["latin"] });
const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
});

const fontVariables = [
  inter.variable,
  lora.variable,
  firaCode.variable,
  sourceCodePro.variable,
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
      className={`${geistSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${fontVariables}`}
    >
      <body>{children}</body>
    </html>
  );
}
