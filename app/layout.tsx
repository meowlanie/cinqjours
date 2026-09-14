import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Petit_Formal_Script } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
const petitFormal = Petit_Formal_Script({ subsets: ["latin"], weight: "400", variable: "--font-petit", display: "swap" });

export const metadata: Metadata = {
  title: "Cinq jours — A five-day language learning routine",
  description: "Turn any YouTube video or text into a structured 5-day curriculum, covering comprehension, pronunciation, vocabulary & grammar, writing, and speaking — plus a language journal for daily practice.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${plexMono.variable} ${petitFormal.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}