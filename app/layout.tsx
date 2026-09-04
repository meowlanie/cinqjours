import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Petit_Formal_Script } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
const petitFormal = Petit_Formal_Script({ subsets: ["latin"], weight: "400", variable: "--font-petit", display: "swap" });

export const metadata: Metadata = {
  title: "Cinq jours — Un support, cinq jours, pour le maîtriser",
  description: "Routine d'apprentissage en cinq jours à partir d'un support YouTube : résumé, prononciation, grammaire, rédaction et expression orale.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`h-full antialiased ${inter.variable} ${plexMono.variable} ${petitFormal.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}