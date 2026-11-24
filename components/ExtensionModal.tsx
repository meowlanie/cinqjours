"use client";

import { useEffect } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  FolderOpen,
  Info,
  MousePointerClick,
  Puzzle,
  X,
} from "lucide-react";
import { t } from "@/lib/settings";
import manifest from "@/extension/manifest.json";

const EXTENSION_VERSION = manifest.version;
const EXTENSION_ZIP = `/cinqjours-extension-${EXTENSION_VERSION}.zip`;

export function ExtensionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const steps = [
    { icon: Download, text: t("v310", "Décompressez le fichier téléchargé.") },
    { icon: FolderOpen, text: t("v311", "Ouvrez chrome://extensions (ou edge://extensions) et activez le mode développeur.") },
    { icon: Check, text: t("v312", "Cliquez sur « Charger l'extension non empaquetée », puis sélectionnez ce dossier.") },
    { icon: MousePointerClick, text: t("v313", "Sur une vidéo YouTube, cliquez sur l'icône de l'extension : la transcription apparaît ici.") },
  ];

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--scrim-strong)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cj-extension-title"
        aria-describedby="cj-extension-desc"
        className="cj-fade-in max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--primary-text)] p-6 shadow-2xl cj-scrollbar md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Puzzle size={20} />
            </span>
            <div>
              <h2 id="cj-extension-title" className="cj-display text-2xl leading-tight text-[var(--text)]">
                {t("v306", "Installer l'extension Cinq jours")}
              </h2>
              <p id="cj-extension-desc" className="mt-1 text-sm leading-snug text-[var(--text-muted)]">
                {t("v307", "Importez les sous-titres depuis votre onglet YouTube connecté, sans les coller manuellement.")}
              </p>
            </div>
          </div>
          <button
            autoFocus
            onClick={onClose}
            aria-label={t("v296", "Fermer")}
            className="-mr-1 -mt-1 rounded-full p-2 text-[var(--text-muted)] transition hover:bg-[var(--fill-muted)] hover:text-[var(--text)]"
          >
            <X size={18} />
          </button>
        </div>

        <a
          href={EXTENSION_ZIP}
          download={`cinqjours-extension-${EXTENSION_VERSION}.zip`}
          className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4 transition hover:border-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--background)] text-[var(--primary-text)]">
              <Download size={17} />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-medium text-[var(--text)]">
                {t("v308", "Télécharger le pack de l'extension")}
              </span>
              <span className="cj-mono block text-[11px] text-[var(--text-muted)]">
                v{EXTENSION_VERSION} · Chrome / Edge · Manifest V3
              </span>
            </span>
          </span>
          <ArrowUpRight size={17} className="shrink-0 text-[var(--text-muted)]" />
        </a>

        <div className="mt-6">
          <p className="cj-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            {t("v309", "Comment installer")}
          </p>
          <ol className="mt-3 space-y-3">
            {steps.map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--background)] text-[11px] font-medium text-[var(--primary-text)]">
                  {i + 1}
                </span>
                <span className="flex items-start gap-2 pt-0.5 text-sm leading-snug text-[var(--text)]">
                  <Icon size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                  {text}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 flex gap-2 rounded-xl bg-[var(--fill-muted)] p-3 text-xs leading-snug text-[var(--text-muted)]">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>{t("v314", "Déjà installée ? Après une mise à jour, rechargez l'extension depuis chrome://extensions.")}</p>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-[var(--background)] py-3 text-sm font-medium text-[var(--primary-text)] shadow-lg transition hover:bg-[var(--background-hover)]"
        >
          {t("settings.done", "Terminé")}
        </button>
      </div>
    </div>
  );
}
