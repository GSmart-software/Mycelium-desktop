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
  title: "Micelio",
  description: "Tu red de conocimiento, viva y conectada",
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
      className={`${geistSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${fontVariables}`}
    >
      <body>{children}</body>
    </html>
  );
}
