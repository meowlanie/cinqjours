"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Fragment, type Dispatch, type SetStateAction } from "react";
import {
  BookMarked, Mic, Play, Square, Check, X, Plus, Volume2, Settings,
  PenLine, MessageCircle, ChevronRight, Trash2, Link2,
  RotateCcw, Sparkles, ChevronLeft, History, ArrowUpRight, Loader2, Save, CircleCheck, CircleSlash,
  PlayCircle, FileText, Pause, NotebookPen, Eye
} from "lucide-react";
import { extractYouTubeId, fetchTranscriptClient } from "@/lib/transcript";
import { saveVocab } from "@/lib/supabase";
import { putAudio, getAudio, deleteAudio } from "@/lib/journalStore";
import { useSettings, t, getLangCodes, getUiLocale } from "@/lib/settings";
import { type Level } from "@/lib/languages";
import { localeOf, typeLabels } from "@/lib/languages";
import { dictProviderForTarget } from "@/lib/dictProviders";
import { pinyin } from "pinyin-pro";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SettingsModal } from "@/components/SettingsModal";
import { Logo } from "@/components/Logo";

/* ---------------------------------------------------------------
   FONTS
--------------------------------------------------------------- */
const FontImport = () => (
  <style>{`
    .cj-root { font-family: var(--font-inter), sans-serif; }
    .cj-display { font-family: 'Georgia', serif; }
    .cj-formal { font-family: var(--font-petit), cursive; font-weight: 400; font-style: normal; }
    .cj-mono { font-family: var(--font-mono), monospace; }
    .cj-scrollbar::-webkit-scrollbar { width: 6px; }
    .cj-scrollbar::-webkit-scrollbar-thumb { background: #C1974B55; border-radius: 4px; }
    @keyframes cj-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .cj-fade-in { animation: cj-fade-in 0.35s ease-out; }
    @keyframes cj-pulse-rec { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
    .cj-rec-dot { animation: cj-pulse-rec 1.1s ease-in-out infinite; }
    .cj-tab-ribbon {
      clip-path: polygon(0 0, 50% 8px, 100% 0, 100% 100%, 0 100%);
    }
    @media (min-width: 768px) {
      .cj-tab-ribbon {
        clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 16px 50%);
      }
    }
  `}</style>
);

/* ---------------------------------------------------------------
   DEMO FALLBACK DATA  (used only when the API can't be reached)
--------------------------------------------------------------- */
const STATIC_DICTIONARY = {
  "négligeons": { base: "négliger", pos: "verbe", def: "Ne pas accorder assez d'attention à quelque chose.", example: "Ici : un sujet dont on ne s'occupe pas assez." },
  "perturbent": { base: "perturber", pos: "verbe", def: "Troubler, déranger le fonctionnement normal.", example: "Les écrans perturbent la production de mélatonine." },
  "mélatonine": { base: "la mélatonine", pos: "nom, f.", def: "Hormone qui régule le cycle du sommeil.", example: "Sa production est perturbée par la lumière bleue des écrans." },
};

const GENERIC_DEF = (word: string) => ({
  base: word,
  pos: "—",
  translation: "",
  def: t("v0", "Explication indisponible — réessayez."),
  example: null,
});

const DAYS = [
  { id: 1, label: t("v1", "Résumé"), icon: FileText, verb: t("v2", "Résumer") },
  { id: 2, label: t("v242", "Prononciation"), icon: Mic, verb: t("v3", "Répéter") },
  { id: 3, label: t("v4", "Grammaire"), icon: Sparkles, verb: t("v5", "Réviser") },
  { id: 4, label: t("v6", "Rédaction"), icon: PenLine, verb: t("v7", "Écrire") },
  { id: 5, label: t("v8", "Expression"), icon: MessageCircle, verb: "Parler" },
];

const msgQuota = () => t("v223", "Quota IA dépassé — réessayez plus tard.");
const msgAi = () => t("v224", "Service IA indisponible — réessayez plus tard.");
const LS_LAST_SOURCE = "cj-last-source-id";
function isFrdicEnabled(): boolean {
  return true;
}

function rememberSourceId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LS_LAST_SOURCE, id);
    else window.localStorage.removeItem(LS_LAST_SOURCE);
  } catch {
    // ignore
  }
}

function readLastSourceId(): string | null {
  try {
    return window.localStorage.getItem(LS_LAST_SOURCE);
  } catch {
    return null;
  }
}

function aiFailureMessage(res: Response, data?: { quotaExceeded?: boolean; fallback?: boolean; error?: string }): string | null {
  if (res.status === 429 || data?.quotaExceeded) return msgQuota();
  if (data?.error) return data.error;
  if (data?.fallback) return msgAi();
  return null;
}

/* ---------------------------------------------------------------
   HELPERS
--------------------------------------------------------------- */

function stripPunct(token: string) {
  return token.toLowerCase()
    .replace(/^(d|l|n|m|t|s|j|c|qu)['\u2019]/, "")
    .replace(/^[.,!?;:«»"'\u2019()]+/, "")
    .replace(/[.,!?;:«»"'\u2019()]+$/, "");
}

// Strips punctuation without lowercasing — used where the original case must be kept
// (e.g. German nouns are capitalized).
function stripPunctKeepCase(token: string) {
  return token
    .replace(/^(d|l|n|m|t|s|j|c|qu)['\u2019]/, "")
    .replace(/^[.,!?;:«»"'\u2019()]+/, "")
    .replace(/[.,!?;:«»"'\u2019()]+$/, "");
}

// German nouns are capitalized; the dictionary model sometimes returns them lowercased,
// so we restore the capital when the part-of-speech indicates a noun.
function normalizeWordCase(base: string | undefined, pos: string | undefined, target: string): string {
  if (!base || target !== "de") return base || "";
  const p = (pos || "").toLowerCase();
  if (p.includes("substantiv") || p.includes("nomen") || p.includes("noun")) {
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  return base;
}

/** Find word indices (0-based, among non-whitespace tokens) that belong to any saved sentence. */
function getSavedSentenceIndices(lineText: string, savedSentences: string[]): Set<number> {
  const indices = new Set<number>();
  const tokens = lineText.split(/\s+/).filter(Boolean);
  for (const s of savedSentences) {
    const sWords = s.split(/\s+/).filter(Boolean);
    if (sWords.length < 2) continue;
    for (let i = 0; i + sWords.length <= tokens.length; i++) {
      let match = true;
      for (let j = 0; j < sWords.length; j++) {
        if (stripPunct(tokens[i + j]) !== stripPunct(sWords[j])) { match = false; break; }
      }
      if (match) {
        for (let j = 0; j < sWords.length; j++) indices.add(i + j);
      }
    }
  }
  return indices;
}

interface Segment {
  text: string;
  flagged: boolean;
  note: { type: string; label: string; comment: string } | null;
  correction?: string;
  suggestion?: string;
}
interface CorrectResult { segments: Segment[]; fallback?: boolean }

/* ---------------------------------------------------------------
   RECORDER (shared by Day 2 & Day 5)
--------------------------------------------------------------- */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("échec lecture"));
    reader.readAsDataURL(blob);
  });
}

function Recorder({ label, onRecorded, onAudioData, persistKey }: {
  label: string;
  onRecorded?: (url: string | null) => void;
  onAudioData?: (dataUrl: string | null) => void;
  persistKey?: string;
}) {
  const [status, setStatus] = useState<string>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Restore a previously saved recording from IndexedDB (large-quota store),
  // unlike localStorage which silently drops recordings once they grow.
  useEffect(() => {
    if (!persistKey) return;
    let cancelled = false;
    getAudio(persistKey)
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        setAudioUrl(dataUrl);
        setStatus("recorded");
        setSaved(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [persistKey]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setStatus("recorded");
        setSaved(false);
        stream.getTracks().forEach((t) => t.stop());
        if (onRecorded) onRecorded(url);
        blobToDataUrl(blob).then((dataUrl) => { if (onAudioData) onAudioData(dataUrl); }).catch(() => {});
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setStatus("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setStatus("unsupported");
    }
  };

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    setHolding(false);
    mediaRecorderRef.current?.stop();
  };

  const togglePause = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr.state === "recording") {
      mr.pause();
      setStatus("paused");
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (mr.state === "paused") {
      mr.resume();
      setStatus("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
  };

  const onRecordPointerDown = () => {
    setHolding(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      stop();
    }, 2000);
  };

  const onRecordPointerUp = () => {
    setHolding(false);
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      togglePause();
    }
  };

  const cancelHold = () => {
    setHolding(false);
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const reset = () => {
    if (persistKey) deleteAudio(persistKey).catch(() => {});
    if (audioUrl) { try { URL.revokeObjectURL(audioUrl); } catch { /* ignore */ } }
    blobRef.current = null;
    setSaved(false);
    setAudioUrl(null);
    setStatus("idle");
    setSeconds(0);
    setPlaying(false);
    setError(null);
    if (onRecorded) onRecorded(null);
    if (onAudioData) onAudioData(null);
  };

  const save = async () => {
    if (!persistKey || !blobRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await blobToDataUrl(blobRef.current);
      await putAudio(persistKey, dataUrl);
      setSaved(true);
    } catch {
      setError(t("v9", "Enregistrement impossible à sauvegarder (stockage indisponible)."));
    } finally {
      setSaving(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else { audioRef.current.currentTime = 0; audioRef.current.play(); }
  };

  if (status === "unsupported") {
    return (
      <div className="rounded-lg border border-[#B5432E33] bg-[#B5432E0d] p-4 text-sm text-[#8a3626]">
        
        {t("v10", "Le micro n'est pas accessible dans cet aperçu (permissions bloquées).\n        Dans un navigateur classique (Chrome/Firefox), ce bouton enregistre votre voix et permet une réécoute immédiate.")}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "idle" && (
        <button onClick={start} className="flex items-center gap-2 rounded-full bg-[#B08D57] px-5 py-2.5 text-sm font-medium text-[#171B22] transition hover:bg-[#c4a06a]">
          <Mic size={16} /> {label}
        </button>
      )}
      {(status === "recording" || status === "paused") && (
        <div className="flex flex-col items-start gap-1">
          <button
            onPointerDown={onRecordPointerDown}
            onPointerUp={onRecordPointerUp}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition select-none touch-none ${
              status === "recording" ? "bg-[#B5432E] text-white hover:bg-[#9c3a27]" : "bg-[#B08D57] text-[#171B22] hover:bg-[#c4a06a]"
            } ${holding ? "scale-95 opacity-80" : ""}`}
          >
            <span className={`h-2 w-2 rounded-full ${status === "recording" ? "cj-rec-dot bg-white" : "bg-[#171B22]"}`} />
            {status === "recording" ? <Pause size={14} /> : <Play size={14} />}
            {holding ? t("v205", "Finish…") : status === "recording" ? t("v243", "Pause") : t("v206", "Resume")} · {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
          </button>
          <p className="text-[10px] text-[#6b665e]">{t("v11", "Appuyez brièvement pour mettre en pause · maintenez 2 s pour terminer")}</p>
        </div>
      )}
      {status === "recorded" && audioUrl && (
        <div className="flex flex-wrap items-center gap-2 cj-fade-in">
          <audio ref={audioRef} src={audioUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
          <button onClick={togglePlay} className="flex items-center gap-2 rounded-full bg-[#171B22] px-4 py-2 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35]">
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? t("v12", "En lecture…") : t("v13", "Écouter")}
          </button>
          {persistKey && !saved && (
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-full bg-[#5C7A5A] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4a6548] disabled:opacity-50">
              <Save size={14} /> {saving ? "…" : t("v204", "Save")}
            </button>
          )}
          {persistKey && saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-[#5C7A5A]">
              <Check size={13} />  {t("v14", "Enregistré")}
            </span>
          )}
          <button onClick={reset} className="flex items-center gap-1.5 rounded-full border border-[#26222033] px-3 py-2 text-xs text-[#4a453f] hover:bg-[#26222008]">
            <RotateCcw size={13} /> {t("v207", "Redo")}
          </button>
          {error && <span className="text-[11px] text-[#B5432E]">{error}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   MARGINALIA CORRECTION BLOCK (used by Days 1 & 4)
--------------------------------------------------------------- */
type DiffToken = { type: "same" | "removed" | "added"; text: string };

function wordDiff(original: string, corrected: string): DiffToken[] {
  if (original === corrected) return [{ type: "same", text: original }];

  const orig = original.split(/\s+/).filter(Boolean);
  const corr = corrected.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[.,!?;:"'«»()]/g, "");

  const tokens: DiffToken[] = [];
  let i = 0, j = 0;

  while (i < orig.length && j < corr.length) {
    if (norm(orig[i]) === norm(corr[j])) {
      tokens.push({ type: "same", text: orig[i] });
      i++; j++;
    } else if (i + 1 < orig.length && norm(orig[i + 1]) === norm(corr[j])) {
      tokens.push({ type: "removed", text: orig[i] });
      i++;
    } else if (j + 1 < corr.length && norm(orig[i]) === norm(corr[j + 1])) {
      tokens.push({ type: "added", text: corr[j] });
      j++;
    } else {
      tokens.push({ type: "removed", text: orig[i] });
      tokens.push({ type: "added", text: corr[j] });
      i++; j++;
    }
  }
  while (i < orig.length) { tokens.push({ type: "removed", text: orig[i] }); i++; }
  while (j < corr.length) { tokens.push({ type: "added", text: corr[j] }); j++; }

  return tokens;
}

function CorrectedCopy({ result, onAddToCarnet, compact, hideNotes, savedCorrections, removeVocabByWord }: { result: CorrectResult; onAddToCarnet?: (s: Segment) => void; compact?: boolean; hideNotes?: boolean; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const { segments } = result;
  const [view, setView] = useState<"annotated" | "corrected">("annotated");
  const flagged = segments.filter((s) => s.flagged && s.correction && s.correction !== s.text);
  const suggested = segments.filter((s) => s.suggestion && s.suggestion !== s.text);

  return (
    <div className="cj-fade-in space-y-4">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setView("annotated")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${view === "annotated" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
        >
          
          {t("v15", "Texte annoté")}
        </button>
        <button
          onClick={() => setView("corrected")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${view === "corrected" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
        >
          
          {t("v16", "Texte corrigé")}
        </button>
      </div>

      <div className="rounded-lg border border-[#26222014] bg-white/60 p-5 leading-relaxed cj-display text-[17px] text-[#262220]">
        {view === "annotated" ? (
          segments.map((seg, i) => (
            <span key={i}>
              {seg.suggestion && seg.suggestion !== seg.text ? (
                wordDiff(seg.text, seg.suggestion).map((t, k) => (
                  <Fragment key={k}>
                    {t.type === "removed" ? (
                      <s className="text-[#999] line-through decoration-[#999] decoration-1">{t.text}</s>
                    ) : t.type === "added" ? (
                      <span className="font-medium text-[#B08D57]">{t.text}</span>
                    ) : (
                      <span>{t.text}</span>
                    )}
                    {" "}
                  </Fragment>
                ))
              ) : (
                wordDiff(seg.text, seg.correction || seg.text).map((t, k) => (
                  <Fragment key={k}>
                    {t.type === "removed" ? (
                      <s className="text-[#B5432E] line-through decoration-[#B5432E] decoration-1">{t.text}</s>
                    ) : t.type === "added" ? (
                      <span className="font-medium text-[#3f5a3d]">{t.text}</span>
                    ) : (
                      <span>{t.text}</span>
                    )}
                    {" "}
                  </Fragment>
                ))
              )}
            </span>
          ))
        ) : (
          <span>{segments.map((s) => s.suggestion || s.correction || s.text).join(" ")}</span>
        )}
      </div>

      {!hideNotes && (flagged.length > 0 || suggested.length > 0) && (
        <div className={`space-y-2 ${compact ? "max-h-[20vh] overflow-y-auto" : ""}`}>
          <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B5432E]">{t("v221", "Annotations")}</p>
          {flagged.map((s, i) => (
            <div key={`f-${i}`} className={`flex items-start gap-2 text-[#8a3626] ${compact ? "text-[10px]" : "text-sm"}`}>
              <span className="cj-mono mt-0.5 shrink-0 rounded border border-[#B5432E44] bg-[#B5432E0d] px-1.5 py-0.5 text-[10px] uppercase">
                {s.note?.label || t("v220", "Correction")}
              </span>
              <span className="flex-1 italic">"{s.text.length > 46 ? s.text.slice(0, 46) + "…" : s.text}" — {s.note?.comment || t("v17", "Correction effectuée.")}</span>
              {onAddToCarnet && (() => {
                const textToCheck = (s.correction || s.text).toLowerCase();
                const isSaved = savedCorrections?.has(textToCheck);
                return isSaved ? (
                  <button
                    onClick={() => removeVocabByWord?.(textToCheck)}
                    className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[#5C7A5A44] bg-[#5C7A5A14] px-2 py-0.5 text-[11px] font-medium text-[#3f5a3d] transition hover:bg-[#5C7A5A28]"
                    title={t("v106", "Supprimer")}
                  >
                    <Check size={11} />  {t("v19", "Carnet")}
                  </button>
                ) : (
                  <button
                    onClick={() => onAddToCarnet(s)}
                    className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-2 py-0.5 text-[11px] font-medium text-[#7a5f30] transition hover:bg-[#B08D5728]"
                    title={t("v18", "Ajouter au carnet")}
                  >
                    <Plus size={11} />  {t("v19", "Carnet")}
                  </button>
                );
              })()}
            </div>
          ))}
          {suggested.map((s, i) => (
            <div key={`s-${i}`} className={`flex items-start gap-2 text-[#3f5a3d] ${compact ? "text-[10px]" : "text-sm"}`}>
              <span className="cj-mono mt-0.5 shrink-0 rounded border border-[#5C7A5A44] bg-[#5C7A5A0d] px-1.5 py-0.5 text-[10px] uppercase">
                {t("v222", "Style")}
              </span>
              <span className="flex-1 italic">"{s.text.length > 46 ? s.text.slice(0, 46) + "…" : s.text}" → {s.suggestion}</span>
              {onAddToCarnet && (() => {
                const textToCheck = (s.correction || s.text).toLowerCase();
                const isSaved = savedCorrections?.has(textToCheck);
                return isSaved ? (
                  <button
                    onClick={() => removeVocabByWord?.(textToCheck)}
                    className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[#5C7A5A44] bg-[#5C7A5A14] px-2 py-0.5 text-[11px] font-medium text-[#3f5a3d] transition hover:bg-[#5C7A5A28]"
                    title={t("v106", "Supprimer")}
                  >
                    <Check size={11} />  {t("v19", "Carnet")}
                  </button>
                ) : (
                  <button
                    onClick={() => onAddToCarnet(s)}
                    className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-2 py-0.5 text-[11px] font-medium text-[#7a5f30] transition hover:bg-[#B08D5728]"
                    title={t("v18", "Ajouter au carnet")}
                  >
                    <Plus size={11} />  {t("v19", "Carnet")}
                  </button>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function SelfCorrectBox({ segments, onDone }: { segments: Segment[]; onDone: (text: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const mistakeWords = useMemo(() => {
    const set = new Set<string>();
    segments.forEach((s) => {
      wordDiff(s.text, s.correction || s.text).forEach((t) => {
        if (t.type === "removed") {
          set.add(t.text.toLowerCase().replace(/[.,!?;:"'«»()]/g, ""));
        }
      });
    });
    return set;
  }, [segments]);

  const applyMarks = (text: string): string => {
    return text
      .split(/(\s+)/)
      .map((part) => {
        if (part.trim()) {
          const norm = part.toLowerCase().replace(/[.,!?;:"'«»()]/g, "");
          if (mistakeWords.has(norm)) {
            return `<span style="text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: #B5432E; text-underline-offset: 3px;">${escapeHtml(part)}</span>`;
          }
        }
        return escapeHtml(part);
      })
      .join("");
  };

  const saveCaret = (): number | null => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
    const range = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  };

  const restoreCaret = (offset: number) => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let current = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent?.length || 0;
      if (current + len >= offset) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, offset - current));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      current += len;
      node = walker.nextNode();
    }
  };

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = applyMarks(segments.map((s) => s.text).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = () => {
    const el = ref.current;
    if (!el) return;
    const caret = saveCaret();
    el.innerHTML = applyMarks(el.innerText);
    if (caret !== null) restoreCaret(caret);
  };

  return (
    <div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={handleInput}
        className="min-h-[140px] w-full rounded-lg border border-[#26222022] bg-white/70 p-4 text-[15px] leading-relaxed text-[#262220] outline-none focus:border-[#B08D57]"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onDone((ref.current?.innerText || "").trim())}
          className="flex items-center gap-1.5 rounded-full bg-[#5C7A5A] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4a6548]"
        >
          <Check size={14} /> {t("v217", "Terminer")}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   SHARED TEXT CORRECTION HOOK (Days 1 & 4)
--------------------------------------------------------------- */
 function useCorrection(taskName: "summary" | "writing" | "journal", rangeLow: number, rangeHigh: number, sourceText: string) {
  const lc = getLangCodes();
  const ui = getUiLocale();
  const resultKey = `cj-correction-${taskName}-${lc.targetLang}-${ui}`;
  const textKey = `cj-text-${taskName}-${lc.targetLang}-${ui}`;

  const [text, setText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem(textKey) || ""; } catch { return ""; }
  });
  const [result, setResult] = useState<CorrectResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(resultKey);
      return raw ? (JSON.parse(raw) as CorrectResult) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(textKey, text); } catch { /* ignore */ }
  }, [text, textKey]);

  useEffect(() => {
    try {
      if (result) window.localStorage.setItem(resultKey, JSON.stringify(result));
      else window.localStorage.removeItem(resultKey);
    } catch { /* ignore */ }
  }, [result, resultKey]);

  const correct = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setResult(null);
    let noticeText: string | null = msgAi();
    try {
      const res = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskName, text, source: sourceText, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        noticeText = fail;
      } else if (res.ok && Array.isArray(data.segments) && data.segments.length && !data.fallback) {
        setResult(data as CorrectResult);
        noticeText = null;
      }
    } catch {
      noticeText = msgAi();
    }
    if (noticeText) {
      setNotice(noticeText);
      setTimeout(() => setNotice(null), 5000);
    }
    setLoading(false);
  };

  const clear = () => {
    setResult(null);
    setText("");
    try { window.localStorage.removeItem(resultKey); } catch { /* ignore */ }
  };

  return { text, setText, result, loading, correct, clear, notice };
}

/* ---------------------------------------------------------------
   SOURCE / IMPORT VIEW
--------------------------------------------------------------- */
interface SourceViewProps {
  url: string;
  setUrl: (v: string) => void;
  videoId: string | null;
  setVideoId: (v: string | null) => void;
  title: string | null;
  transcript: { t: string; text: string }[];
  onTranscriptChange: (t: { t: string; text: string }[]) => void;
  importing: boolean;
  importError: string | null;
  vocabCount: number;
  addVocab: (e: { word: string; def: string; context?: string; translation?: string; sourceId?: string; surface?: string; type?: "vocab" | "phrase" | "correction" }) => void;
  onImport: (url: string) => Promise<void>;
  onPasteTranscript: (raw: string) => void;
  notes: Record<string, string>;
  setNote: (word: string, note: string) => void;
  savedWords: Set<string>;
  savedSentences: string[];
  removeVocabByWord: (word: string) => void;
  isTextSource: boolean;
  textModeVersion: number;
  onStartReadingMode: () => void;
  videoWidth: number;
  setVideoWidth: React.Dispatch<React.SetStateAction<number>>;
  level: Level;
}





interface PopupEntry {
  word: string;
  base: string;
  pos: string;
  translation?: string;
  def: string;
  example: string | null;
  context?: string;
  note?: string;
  x: number;
  y: number;
  loading?: boolean;
  aiUnavailable?: boolean;
}

function SourceView(props: SourceViewProps) {
  const {
    url, setUrl, videoId, setVideoId, title, transcript, onTranscriptChange,
    importing, importError, vocabCount, addVocab, onImport,
    onPasteTranscript, notes, setNote, savedWords, savedSentences, removeVocabByWord,
    isTextSource, textModeVersion, onStartReadingMode, videoWidth, setVideoWidth,
    level,
  } = props;

  const notedSentences = useMemo(
    () => Object.keys(notes).filter((k) => k.split(/\s+/).length > 1),
    [notes]
  );

  const sourceWordCount = useMemo(
    () => transcript.reduce((n, l) => n + (l.text.trim() ? l.text.trim().split(/\s+/).length : 0), 0),
    [transcript]
  );
  const sourceFits = sourceWordCount < 500;

  const [showPinyin, setShowPinyin] = useState(false);

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);
  const [popup, setPopup] = useState<PopupEntry | null>(null);
  const [popupLoading, setPopupLoading] = useState(false);
  const [sentencePopup, setSentencePopup] = useState<{ text: string; x: number; y: number } | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [sentenceTranslationLoading, setSentenceTranslationLoading] = useState(false);
  const [sentenceAiUnavailable, setSentenceAiUnavailable] = useState(false);
  const [selNoteEditing, setSelNoteEditing] = useState(false);
  const [selNoteDraft, setSelNoteDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dictCache = useRef<Record<string, Omit<PopupEntry, "word" | "x" | "y">>>(STATIC_DICTIONARY);
  const transCache = useRef<Record<string, string>>({});
  const prevTextModeVersion = useRef(textModeVersion);

  useEffect(() => {
    if (textModeVersion > prevTextModeVersion.current) {
      setEditing(true);
      setEditText("");
    }
    prevTextModeVersion.current = textModeVersion;
  }, [textModeVersion]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("cj-dict-cache");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          dictCache.current = { ...STATIC_DICTIONARY, ...saved };
        }
      }
      const rawT = window.localStorage.getItem("cj-trans-cache");
      if (rawT) {
        const savedT = JSON.parse(rawT);
        if (savedT && typeof savedT === "object") {
          transCache.current = savedT;
        }
      }
    } catch { /* ignore */ }
  }, []);

  const persistDictCache = () => {
    try { window.localStorage.setItem("cj-dict-cache", JSON.stringify(dictCache.current)); } catch { /* ignore */ }
  };
  const persistTransCache = () => {
    try { window.localStorage.setItem("cj-trans-cache", JSON.stringify(transCache.current)); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!sentencePopup) {
      setSentenceTranslation(null);
      return;
    }
    const cached = transCache.current[sentencePopup.text];
    if (cached) {
      setSentenceTranslation(cached);
      setSentenceTranslationLoading(false);
      setSentenceAiUnavailable(false);
      return;
    }
    let cancelled = false;
    setSentenceTranslation(null);
    setSentenceTranslationLoading(true);
    setSentenceAiUnavailable(false);
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: sentencePopup.text, source: getLangCodes().targetLang, target: getLangCodes().translationLang }),
    })
      .then((r) => {
        if (r.status === 429 && !cancelled) {
          setSentenceAiUnavailable(true);
          setSentenceTranslation(t("v20", "Traduction indisponible — réessayez."));
        }
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          const tr = typeof data.translation === "string" ? data.translation : null;
          setSentenceTranslation(tr);
          setSentenceTranslationLoading(false);
          if (tr) {
            transCache.current[sentencePopup.text] = tr;
            persistTransCache();
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSentenceAiUnavailable(true);
          setSentenceTranslation(t("v20", "Traduction indisponible — réessayez."));
          setSentenceTranslationLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [sentencePopup]);

  const submitUrl = async () => {
    const id = extractYouTubeId(url);
    if (!id) {
      setError(t("v21", "Lien YouTube non reconnu. Collez une URL du type youtube.com/watch?v=... ou youtu.be/..."));
      setVideoId(null);
      return;
    }
    setError(null);
    await onImport(url);
  };

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel && sel.toString().trim();
    if (text && text.length > 1) {
      const targetLang = getLangCodes().targetLang;
      const isMultiWord = targetLang === "zh"
        ? Array.from(new Intl.Segmenter("zh", { granularity: "word" }).segment(text)).length > 1
        : text.split(/\s+/).length > 1;
      if (isMultiWord) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSentencePopup({ text, x: rect.left + rect.width / 2, y: rect.top });
        setSelNoteEditing(false);
      } else {
        setSentencePopup(null);
      }
    } else {
      setSentencePopup(null);
    }
  }, []);

  const lookupWord = async (word: string, sentence: string, pos: { x: number; y: number }) => {
    const clean = word.replace(/^[.,!?;:«»"'()…]+/, "").replace(/[.,!?;:«»"'()…]+$/, "");
    const target = getLangCodes().targetLang;
    const withCase = (e: Partial<PopupEntry>): PopupEntry => ({ ...e, base: normalizeWordCase(e.base, e.pos, target) } as unknown as PopupEntry);
    const key = stripPunct(clean);
    const note = notes[key.toLowerCase()] ?? undefined;
    const cached = dictCache.current[key];
    if (cached) {
      setPopup({ ...withCase(cached), word: clean, x: pos.x, y: pos.y, context: sentence, note });
    } else {
      setPopupLoading(true);
      setPopup({ ...withCase(GENERIC_DEF(clean)), word: clean, x: pos.x, y: pos.y, loading: true, context: sentence, note });
      try {
        const res = await fetch("/api/dictionary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: stripPunctKeepCase(clean), sentence, target, translation: getLangCodes().translationLang, ui: getUiLocale() }),
        });
        if (res.status === 429) {
          setPopup({ ...withCase({ base: clean, pos: "—", translation: "", def: t("v0", "Explication indisponible — réessayez."), example: null }), word: clean, x: pos.x, y: pos.y, loading: false, context: sentence, note, aiUnavailable: true });
        } else if (res.ok) {
          const data = await res.json();
          const norm = withCase(data);
          dictCache.current[key] = norm;
          persistDictCache();
          setPopup({ ...norm, word: clean, x: pos.x, y: pos.y, loading: false, context: sentence, note });
        } else {
          setPopup({ ...withCase(GENERIC_DEF(clean)), word: clean, x: pos.x, y: pos.y, loading: false, context: sentence, note });
        }
      } catch {
        setPopup({ ...withCase({ base: clean, pos: "—", translation: "", def: t("v0", "Explication indisponible — réessayez."), example: null }), word: clean, x: pos.x, y: pos.y, loading: false, context: sentence, note, aiUnavailable: true });
      } finally {
        setPopupLoading(false);
      }
    }
  };

  const onWordClick = (e: React.MouseEvent, token: string, sentence: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const popupW = 288;
    const popupH = 420;
    const vw = document.documentElement.clientWidth;
    const x = Math.max(8, Math.min(rect.left, vw - popupW - 16));
    let y = rect.bottom + 8;
    if (y + popupH > window.innerHeight) y = Math.max(8, rect.top - popupH);
    setSentencePopup(null);
    setNoteEditing(false);
    lookupWord(token, sentence, { x, y });
  };

  const saveSentenceToCarnet = () => {
    if (!sentencePopup) return;
    const sel = sentencePopup.text.trim();
    const fullText = transcript.map((l) => l.text).join(" ");
    const sentences = fullText.split(/(?<=[.!?])\s+/);
    const found = sentences.find((s) => s.toLowerCase().includes(sel.toLowerCase()));
    const context = found ? found.trim() : sentencePopup.text;
    addVocab({ word: sentencePopup.text, def: sentenceAiUnavailable ? t("v20", "Traduction indisponible — réessayez.") : (sentenceTranslation || ""), translation: sentenceAiUnavailable ? "" : (sentenceTranslation || ""), context, sourceId: videoId ?? undefined, type: "phrase" });
    setToast(`« ${sentencePopup.text.slice(0, 40)}${sentencePopup.text.length > 40 ? "…" : ""} » ${t("v147","ajouté au carnet")}`);
    setSentencePopup(null);
    setTimeout(() => setToast(null), 2200);
  };

  const saveSentenceNote = () => {
    if (!sentencePopup) return;
    const note = selNoteDraft.trim();
    setNote(sentencePopup.text, note);
    setSelNoteEditing(false);
    setToast(note ? t("v22", "Note enregistrée") : t("v23", "Note supprimée"));
    setTimeout(() => setToast(null), 2200);
  };

  const savePopupWord = () => {
    if (!popup) return;
    const target = getLangCodes().targetLang;
    const word = stripPunctKeepCase(normalizeWordCase(popup.base || popup.word, popup.pos, target));
    const surface = stripPunctKeepCase(popup.word);
    addVocab({ word, surface, def: popup.aiUnavailable ? t("v0", "Explication indisponible — réessayez.") : popup.def, translation: popup.translation || "", context: popup.context, sourceId: videoId ?? undefined, type: "vocab" });
    setToast(`« ${word} » ${t("v147","ajouté au carnet")}`);
    setPopup(null);
    setTimeout(() => setToast(null), 2200);
  };

  const saveNote = () => {
    if (!popup) return;
    const note = noteDraft.trim();
    setNote(popup.word, note);
    setPopup({ ...popup, note: note || undefined });
    setNoteEditing(false);
  };

  const enterEditMode = () => {
    const text = transcript.map((l) => l.t ? `${l.t} ${l.text}` : l.text).join("\n");
    setEditText(text);
    setEditing(true);
  };

  const cycleVideoSize = () => {
    setVideoWidth((w) => (w >= 100 ? 50 : w >= 50 ? 33 : 100));
  };

  const saveEdit = () => {
    const lines = editText.split("\n").filter((l) => l.trim());
    const result: { t: string; text: string }[] = [];
    for (const line of lines) {
      const tsMatch = line.trim().match(/^(\d{1,2}:\d{2})\s+(.+)/);
      if (tsMatch) result.push({ t: tsMatch[1], text: tsMatch[2] });
      else result.push({ t: "", text: line.trim() });
    }
    onTranscriptChange(result);
    setEditing(false);
  };

  return (
    <div className="cj-fade-in space-y-6" ref={containerRef}>
      <div>
        <h2 className="cj-display text-3xl text-[#262220]">{t("v24", "La source")}</h2>
        <p className="mt-1 text-sm text-[#6b665e]">
          
          {t("v25", "Collez un lien YouTube. La transcription sert de matière première aux cinq jours.\n          La préférence de sous-titres est le français, sinon la langue disponible.")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex w-full items-center gap-2 rounded-lg border border-[#26222022] bg-white/70 px-3 py-2.5 md:flex-1">
          <Link2 size={15} className="shrink-0 text-[#B08D57]" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full bg-transparent text-sm text-[#262220] outline-none placeholder:text-[#26222055]"
          />
        </div>
        <button
          onClick={submitUrl}
          disabled={importing}
          className="flex items-center gap-2 rounded-lg bg-[#171B22] px-4 py-2.5 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35] disabled:opacity-50"
        >
          {importing && <Loader2 size={15} className="animate-spin" />}
          {t("v200", "Import")}
        </button>
        <button
          onClick={onStartReadingMode}
          className="flex items-center gap-1.5 rounded-lg border border-[#5C7A5A] bg-[#5C7A5A] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4A6B48]"
        >
          <FileText size={14} />  {t("v26", "Lire un texte")}
        </button>
      </div>

      {!videoId && !importing && !isTextSource && (
        <ImportNotice suffix={t("v27", " — collez un lien YouTube ci-dessus et cliquez Importer, ou cliquez Lire un texte pour importer un texte.")} />
      )}

      <div className={videoWidth >= 100 ? "" : "flex items-start gap-4"}>
        <div
          className={videoWidth >= 100 ? "w-full" : "shrink-0"}
          style={videoWidth >= 100 ? undefined : { width: `${videoWidth}%` }}
        >
          {!isTextSource && videoId && (
            <div className="relative">
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-[#26222014] shadow-sm">
                <iframe
                  key={videoId}
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`}
                  title={t("v28", "Vidéo source")}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div className="absolute right-2 top-2 flex items-center gap-1.5">
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1.5 text-xs font-medium text-[#171B22] shadow transition hover:bg-white"
                  title={t("v29", "Ouvrir sur YouTube")}
                >
                  <ArrowUpRight size={11} /> YouTube
                </a>
                <button
                  onClick={cycleVideoSize}
                  className="flex items-center gap-1.5 rounded-full bg-[#171B22]/90 px-3 py-1.5 text-xs font-medium text-[#F4EEE0] shadow transition hover:bg-[#171B22]"
                  title={videoWidth >= 100 ? t("v30", "Réduire la vidéo pour voir la transcription à côté") : videoWidth >= 50 ? t("v31", "Réduire encore") : t("v32", "Revenir en plein écran")}
                >
                  {videoWidth >= 100 ? <><Square size={11} />  {t("v33", "Réduire")}</> : videoWidth >= 50 ? <><Square size={11} /> {t("v202", "Small")}</> : <><ArrowUpRight size={12} /> {t("v203", "Large")}</>}
                </button>
              </div>
            </div>
          )}

        </div>

        <div className={`relative ${videoWidth >= 100 ? "mt-6" : "min-w-0 flex-1"}`}>
        <div className="mb-2 flex items-center justify-between">
          <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">
            {isTextSource ? t("v34", "Texte") : t("v230", "Transcription")}
          </p>
          <div className="flex items-center gap-2">
            {!pasting && !editing && !(isTextSource && transcript.length === 0) && (
              <button
                onClick={() => {
                  if (!isTextSource && transcript.length === 0) { setPasting(true); setPasteText(""); }
                  else { enterEditMode(); }
                }}
                className="flex items-center gap-1 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-2.5 py-1 text-xs text-[#7a5f30] transition hover:bg-[#B08D5728]"
              >
                <PenLine size={12} />
                {!isTextSource && transcript.length === 0 ? t("v35", "Coller une transcription") : t("v201", "Modifier")}
              </button>
            )}
            {getLangCodes().targetLang === "zh" && !pasting && !editing && (
              <button
                onClick={() => setShowPinyin(!showPinyin)}
                className="flex items-center gap-1 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-2.5 py-1 text-xs text-[#7a5f30] transition hover:bg-[#B08D5728]"
              >
                {getUiLocale() === "zh" ? (showPinyin ? "隐藏拼音" : "拼音") : (showPinyin ? t("pinyin.hide", "Hide Pinyin") : t("pinyin.toggle", "Pinyin"))}
              </button>
            )}
          </div>
        </div>

        <div
          onMouseUp={editing ? undefined : handleMouseUp}
          className={`cj-scrollbar cj-display select-text overflow-y-auto rounded-lg border border-[#26222022] bg-white/60 p-5`}
          style={{ minHeight: "370px", maxHeight: "760px" }}
        >
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder={t("v36", "Collez votre texte ici.")}
              className="w-full h-full min-h-[300px] resize-none rounded p-3 text-sm text-[#262220] cj-scrollbar placeholder:text-[#B08D5755] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
            />
          ) : pasting ? (
            <div className="flex h-full flex-col">
              <p className="mb-2 text-xs text-[#7a5f30]">
                
                {t("v37", "Ouvrez la vidéo YouTube, cliquez")} <strong>{t("v38", "… → Afficher la transcription")}</strong>{t("v39", ", copiez tout le texte et collez-le ici.")}
              </p>
              <textarea
                autoFocus
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={t("v40", "0:00\nBonjour à tous...\n0:05\nAujourd'hui on va parler...")}
                className="w-full grow resize-none rounded border border-[#B08D5733] bg-white/80 p-3 text-sm text-[#262220] cj-scrollbar placeholder:text-[#B08D5755] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
                style={{ minHeight: "300px" }}
              />
            </div>
          ) : transcript.length > 0 ? (
            transcript.map((line, i) => {
              const savedIdx = getSavedSentenceIndices(line.text, savedSentences);
              const notedIdx = getSavedSentenceIndices(line.text, notedSentences);
              let wordPos = 0;
              const targetLang = getLangCodes().targetLang;
              return (
                <div key={i} className="flex items-start gap-1">
                  <span className="cj-mono mt-1 w-10 shrink-0 text-[11px] text-[#B08D57]">{line.t}</span>
                  <p className="flex-1 leading-relaxed text-[#262220]">
                    {targetLang === "zh" ? (
                      Array.from(new Intl.Segmenter("zh", { granularity: "word" }).segment(line.text)).map(
                        ({ segment }, j) => {
                          const idx = wordPos++;
                          const isSavedWord = savedWords.has(stripPunct(segment));
                          const hasNote = notes[stripPunct(segment)];
                          const inSavedSentence = savedIdx.has(idx);
                          const inNotedSentence = notedIdx.has(idx);
                          let cls = "";
                          if (isSavedWord) cls = "bg-[#B08D5755]";
                          else if (hasNote) cls = "bg-[#4A90D955]";
                          else if (inSavedSentence) cls = "bg-[#B08D5733]";
                          else if (inNotedSentence) cls = "bg-[#4A90D933]";
                          return (
                            <span key={j} className="inline-flex flex-col items-center">
                              {showPinyin && (
                                <span className="text-[10px] text-[#6b665e] leading-none">
                                  {pinyin(segment, { toneType: "symbol", type: "string" })}
                                </span>
                              )}
                              <span
                                onClick={(e) => onWordClick(e, segment, line.text)}
                                className={`cursor-pointer transition hover:bg-[#C1974B33] ${cls}`}
                              >
                                {segment}
                              </span>
                            </span>
                          );
                        }
                      )
                    ) : (
                      line.text.split(/(\s+)/).map((token, j) => {
                        if (token.trim() === "") {
                          const inSavedRun = savedIdx.has(wordPos - 1) && savedIdx.has(wordPos);
                          const inNotedRun = notedIdx.has(wordPos - 1) && notedIdx.has(wordPos);
                          return (
                            <span key={j} className={inSavedRun ? "bg-[#B08D5733]" : inNotedRun ? "bg-[#4A90D933]" : ""}>
                              {token}
                            </span>
                          );
                        }
                        const idx = wordPos++;
                        const isSavedWord = savedWords.has(stripPunct(token));
                        const hasNote = notes[stripPunct(token)];
                        const inSavedSentence = savedIdx.has(idx);
                        const inNotedSentence = notedIdx.has(idx);
                        let cls = "";
                        if (isSavedWord) cls = "bg-[#B08D5755]";
                        else if (hasNote) cls = "bg-[#4A90D955]";
                        else if (inSavedSentence) cls = "bg-[#B08D5733]";
                        else if (inNotedSentence) cls = "bg-[#4A90D933]";
                        return (
                          <span
                            key={j}
                            onClick={(e) => onWordClick(e, token, line.text)}
                            className={`cursor-pointer transition hover:bg-[#C1974B33] ${cls}`}
                          >
                            {token}
                          </span>
                        );
                      })
                    )}
                  </p>
                </div>
              );
            })
          ) : (
            <p className="select-none text-[15px] text-[#26222055]" style={{ fontFamily: "'Inter', sans-serif" }}>
              {isTextSource ? t("v41", "Cliquer sur « Lire un texte » pour coller votre texte.") : t("v42", "La transcription apparaîtra ici. Sinon, cliquez « Coller une transcription » pour importer manuellement.")}
            </p>
          )}
        </div>
        {(pasting || editing) && (
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => { setPasting(false); setPasteText(""); setEditing(false); }}
              className="rounded px-3 py-1.5 text-xs text-[#6b665e] hover:text-[#262220]"
            >
              {t("v215", "Annuler")}
            </button>
            <button
              onClick={() => {
                if (pasting) {
                  if (pasteText.trim()) {
                    onPasteTranscript(pasteText);
                    setPasting(false);
                    setPasteText("");
                  }
                } else {
                  saveEdit();
                }
              }}
              disabled={pasting && !pasteText.trim()}
              className="rounded bg-[#B08D57] px-4 py-1.5 text-xs font-medium text-[#171B22] transition hover:bg-[#C1974B] disabled:opacity-40"
            >
              {t("v216", "Valider")}
            </button>
          </div>
        )}

        {sentencePopup && (
          <div
            style={{
              left: Math.max(8, Math.min(sentencePopup.x - 160, document.documentElement.clientWidth - 336)),
              top: Math.max(8, Math.min(sentencePopup.y - 8, window.innerHeight - 300)),
              backgroundColor: "#F4EEE0",
            }}
            className="fixed z-30 w-80 overflow-y-auto overflow-x-hidden rounded-lg border border-[#26222018] p-4 text-[#262220] shadow-2xl cj-fade-in"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="cj-display text-[15px] leading-snug">{sentencePopup.text}</p>
              <button onClick={() => setSentencePopup(null)} className="shrink-0 text-[#26222055] hover:text-[#262220]">
                <X size={15} />
              </button>
            </div>
            <p className="mt-2 text-xs italic text-[#6b665e]">
              {sentenceTranslationLoading ? (
                <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" />  {t("v43", "Traduction en cours…")}</span>
              ) : sentenceAiUnavailable ? (
                <span className="not-italic text-sm text-[#4a453f]">{sentenceTranslation || t("v20", "Traduction indisponible — réessayez.")}</span>
              ) : (
                <>{t("v44", "Traduction :")} <span className="text-[#B08D57]">{sentenceTranslation || "indisponible"}</span></>
              )}
            </p>

            <div className="mt-3 border-t border-[#26222014] pt-2">
              {selNoteEditing ? (
                <div>
                  <textarea
                    autoFocus
                    value={selNoteDraft}
                    onChange={(e) => setSelNoteDraft(e.target.value)}
                    rows={2}
                    placeholder={t("v45", "Votre note personnelle…")}
                    className="w-full rounded border border-[#B08D5733] bg-white p-2 text-xs text-[#262220] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
                  />
                  <div className="mt-1 flex justify-end gap-2">
                    <button onClick={() => setSelNoteEditing(false)} className="text-xs text-[#6b665e] hover:text-[#262220]">{t("v215", "Annuler")}</button>
                    <button onClick={saveSentenceNote} className="text-xs font-medium text-[#7a5f30] hover:text-[#262220]">{t("v46", "Enregistrer")}</button>
                  </div>
                </div>
              ) : notes[sentencePopup.text.toLowerCase()] ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs italic leading-relaxed text-[#7a5f30]">{notes[sentencePopup.text.toLowerCase()]}</p>
                  <button
                    onClick={() => { setSelNoteDraft(notes[sentencePopup.text.toLowerCase()] || ""); setSelNoteEditing(true); }}
                    className="shrink-0 text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                  >
                    Modifier
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setSelNoteDraft(""); setSelNoteEditing(true); }}
                  className="flex items-center gap-1 text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                >
                  <PenLine size={11} />  {t("v47", "Ajouter une note")}
                </button>
              )}
            </div>

            {savedSentences.includes(sentencePopup.text.toLowerCase()) ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-[#6b665e]"><Check size={13} />  {t("v48", "Ajouté au carnet")}</span>
                <button
                  onClick={() => removeVocabByWord(sentencePopup.text.toLowerCase())}
                  className="text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                >
                  Retirer
                </button>
              </div>
            ) : (
              <button
                onClick={saveSentenceToCarnet}
                className="mt-3 flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] hover:bg-[#B08D5728]"
              >
                <Plus size={13} />  {t("v18", "Ajouter au carnet")}
              </button>
            )}
          </div>
        )}

        {popup && (
          <div
            style={{
              left: Math.max(8, Math.min(popup.x ?? 200, document.documentElement.clientWidth - 296)),
              top: Math.max(8, Math.min(popup.y ?? 0, window.innerHeight - 440)),
              backgroundColor: "#F4EEE0",
            }}
            className="fixed z-20 max-h-[80vh] w-72 overflow-y-auto overflow-x-hidden rounded-lg border border-[#26222018] p-4 text-[#262220] shadow-2xl cj-fade-in"
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div>
                <p className="cj-display text-lg">{stripPunctKeepCase(normalizeWordCase(popup.base || popup.word, popup.pos, getLangCodes().targetLang))}</p>
                {popup.pos && popup.pos !== "—" && (
                  <p className="cj-mono text-[10px] uppercase tracking-wide text-[#B08D57]">{popup.pos}</p>
                )}
              </div>
              <button onClick={() => setPopup(null)} className="text-[#26222055] hover:text-[#262220]">
                <X size={15} />
              </button>
            </div>
            {popupLoading ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-[#4a453f]">
                <Loader2 size={14} className="animate-spin" />  {t("v49", "Analyse en cours…")}
              </p>
            ) : (
              <>
                {popup.translation && <p className="mt-2 text-sm font-medium text-[#B08D57]">{popup.translation}</p>}
                <p className="mt-1 text-sm text-[#4a453f]">{popup.def}</p>
                {popup.example && <p className="mt-1.5 text-xs italic text-[#6b665e]">{popup.example}</p>}
              </>
            )}

            <div className="mt-3 border-t border-[#26222014] pt-2">
              {noteEditing ? (
                <div>
                  <textarea
                    autoFocus
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder={t("v45", "Votre note personnelle…")}
                    className="w-full rounded border border-[#B08D5733] bg-white p-2 text-xs text-[#262220] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
                  />
                  <div className="mt-1 flex justify-end gap-2">
                    <button onClick={() => setNoteEditing(false)} className="text-xs text-[#6b665e] hover:text-[#262220]">{t("v215", "Annuler")}</button>
                    <button onClick={saveNote} className="text-xs font-medium text-[#7a5f30] hover:text-[#262220]">{t("v46", "Enregistrer")}</button>
                  </div>
                </div>
              ) : popup.note ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs italic leading-relaxed text-[#7a5f30]">{popup.note}</p>
                  <button
                    onClick={() => { setNoteDraft(popup.note || ""); setNoteEditing(true); }}
                    className="shrink-0 text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                  >
                    Modifier
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setNoteDraft(""); setNoteEditing(true); }}
                  className="flex items-center gap-1 text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                >
                  <PenLine size={11} />  {t("v47", "Ajouter une note")}
                </button>
              )}
            </div>

            {savedWords.has(stripPunct(popup.base || popup.word)) ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-[#6b665e]"><Check size={13} />  {t("v48", "Ajouté au carnet")}</span>
                <button
                  onClick={() => removeVocabByWord(stripPunct(popup.base || popup.word))}
                  className="text-[11px] text-[#B08D57] hover:text-[#7a5f30]"
                >
                  Retirer
                </button>
              </div>
            ) : (
              <button
                onClick={savePopupWord}
                disabled={popupLoading}
                className="mt-3 flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] hover:bg-[#B08D5728] disabled:opacity-50"
              >
                <Plus size={13} />  {t("v18", "Ajouter au carnet")}
              </button>
            )}
          </div>
        )}

        {toast && (
          <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
            {toast}
          </div>
        )}
        {(error || importError) && (
          <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
            {error || importError}
          </div>
        )}
        </div>
      </div>

      <p className="text-xs text-[#6b665e]">
        {vocabCount === 0
          ? t("v50", "Votre carnet de vocabulaire est vide — cliquez un mot ou surlignez une expression pour commencer.")
          : t("v247", "Votre carnet contient {n} mots.").replace("{n}", String(vocabCount))}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------
   RESOURCES — PAST IMPORTED SOURCES
--------------------------------------------------------------- */
function ResourcesView({ resources, onSelect, onDelete }: {
  resources: Record<string, unknown>[];
  onSelect: (videoId: string, url: string) => void;
  onDelete: (key: string) => void;
}) {
  return (
    <div className="cj-fade-in space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <History size={18} className="text-[#B08D57]" />
          <h2 className="cj-display text-3xl text-[#262220]">{t("v51", "Ressources précédentes")}</h2>
        </div>
        <p className="mt-1 text-sm text-[#6b665e]">
          
          {t("v52", "Toutes les sources déjà importées. Reprenez-en une pour relancer son cycle de cinq jours.")}
        </p>
      </div>

      {resources.length === 0 ? (
        <div className="rounded-lg border border-[#B08D5744] bg-[#B08D5714] px-4 py-3 text-left text-sm text-[#7a5f30]">
          
          {t("v53", "Aucune source enregistrée pour l'instant. Importez une vidéo depuis l'onglet « Source » — elle apparaîtra ici automatiquement.")}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {resources.map((r) => {
            const isText = r.type === "text" || (typeof r.video_id === "string" && r.video_id.startsWith("text-"));
            const thumbText = isText
              ? (Array.isArray(r.transcript)
                  ? (r.transcript as { t: string; text: string }[]).map((l) => l.text).join(" ").slice(0, 240)
                  : String(r.title || "")).slice(0, 240)
              : "";
            return (
            <button
              key={String(r.key || r.video_id)}
              onClick={() => onSelect(String(r.video_id), String(r.url))}
              style={{ backgroundColor: "#FFFFFF" }}
              className="group flex flex-col overflow-hidden rounded-lg border border-[#26222014] text-left shadow-sm transition hover:border-[#B08D57] hover:shadow-md"
            >
              <div className="aspect-video w-full overflow-hidden bg-[#17182210]">
                {isText ? (
                  <div className="cj-scrollbar h-full w-full overflow-hidden bg-[#F4EEE0] p-3 text-left">
                    <p className="cj-mono mb-1 text-[9px] uppercase tracking-wider text-[#B08D57]">{t("v34", "Texte")}</p>
                    <p className="text-[11px] leading-snug text-[#262220]">{thumbText}</p>
                  </div>
                ) : (
                  <img
                    src={`https://img.youtube.com/vi/${r.video_id}/mqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="flex flex-1 items-start justify-between gap-2 p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#262220]">{String(r.title || (Array.isArray(r.transcript) && r.transcript.length > 0 ? r.transcript.slice(0, 3).map((l: { text: string }) => l.text).join(" ").slice(0, 60) : t("v54", "Vidéo YouTube")))}</p>
                  <p className="cj-mono mt-1 text-[10px] uppercase tracking-wide text-[#6b665e]">
                    {new Date(String(r.date)).toLocaleDateString(localeOf(getUiLocale()), { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-[#26222044] transition group-hover:text-[#B08D57]" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(String(r.key)); }}
                    className="rounded p-0.5 text-[#26222033] transition hover:bg-[#B5432E11] hover:text-[#B5432E]"
                    title={t("v55", "Supprimer de l'historique")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </button>
          );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   DAY 1 — SUMMARY
--------------------------------------------------------------- */
function DayOne({ sourceText, addVocab, savedCorrections, removeVocabByWord }: { sourceText: string; addVocab: (e: { word: string; def: string; context?: string; type?: "vocab" | "phrase" | "correction" }) => void; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const { text, setText, result, loading, correct, clear, notice } = useCorrection("summary", 80, 120, sourceText);

  const [toast, setToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const addToCarnet = (s: Segment) => {
    addVocab({ word: s.correction || s.text, def: s.note?.comment || t("v56", "Correction enregistrée."), context: s.text, type: "correction" });
    setToast(t("v57", "Correction ajoutée au carnet"));
    setTimeout(() => setToast(null), 2200);
  };

  const [selfMode, setSelfMode] = useState(false);
  const [selfSegments, setSelfSegments] = useState<Segment[]>([]);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfKey, setSelfKey] = useState(0);

  const audioResultKey = "cj-correction-audio-v2";
  const [hasRecording, setHasRecording] = useState(false);
  const [audioResult, setAudioResult] = useState<CorrectResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(audioResultKey);
      return raw ? (JSON.parse(raw) as CorrectResult) : null;
    } catch { return null; }
  });
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioData, setAudioData] = useState<string | null>(null);

  useEffect(() => {
    getAudio("cj-recording-day1")
      .then((d) => { if (d) { setAudioData(d); setHasRecording(true); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      if (audioResult) window.localStorage.setItem(audioResultKey, JSON.stringify(audioResult));
      else window.localStorage.removeItem(audioResultKey);
    } catch { /* ignore */ }
  }, [audioResult, audioResultKey]);

  const startSelfCorrect = async () => {
    if (!text.trim()) return;
    setSelfLoading(true);
    let segs: Segment[] | null = null;
    let fail: string | null = msgAi();
    try {
      const res = await fetch("/api/correct-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      fail = aiFailureMessage(res, data) || (res.ok && Array.isArray(data.segments) && !data.fallback ? null : msgAi());
      if (!fail) segs = data.segments as Segment[];
    } catch { /* ignore */ }
    if (!segs) {
      setErrorToast(fail || msgAi());
      setSelfLoading(false);
      return;
    }
    setSelfSegments(segs);
    setSelfKey((k) => k + 1);
    setSelfMode(true);
    setSelfLoading(false);
  };

  const finishSelfCorrect = (edited: string) => {
    setText(edited);
    setSelfMode(false);
  };

  const correctAudio = async () => {
    if (!audioData) return;
    setAudioLoading(true);
    try {
      const audioPayload = audioData;
      const res = await fetch("/api/correct-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioPayload, source: sourceText, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setErrorToast(fail);
        setAudioLoading(false);
        return;
      }
      if (res.ok && Array.isArray(data.segments) && data.segments.length && !data.fallback) {
        setAudioResult({ segments: data.segments as Segment[], fallback: false });
        setAudioLoading(false);
        return;
      }
    } catch { /* ignore */ }
    setErrorToast(msgAi());
    setAudioLoading(false);
  };

  return (
    <div className="cj-fade-in space-y-5">
      <DayHeader n={1} title={t("v1", "Résumé")} subtitle={t("v58", "Résumez le contenu de la source en 80 à 120 mots. L'IA corrige votre résumé par rapport au texte d'origine.")} />

      {selfMode ? (
        <SelfCorrectBox key={selfKey} segments={selfSegments} onDone={finishSelfCorrect} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={t("v59", "Écrivez votre résumé ici…")}
          className="w-full rounded-lg border border-[#26222022] bg-white/70 p-4 text-[15px] leading-relaxed text-[#262220] outline-none placeholder:text-[#26222055] focus:border-[#B08D57]"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <span className="cj-mono text-xs text-[#6b665e]">{text.trim() ? (getLangCodes().targetLang === "zh" ? Array.from(text.trim()).length : text.trim().split(/\s+/).length) : 0} {getLangCodes().targetLang === "zh" ? t("v254", "characters") : t("v210", "words")}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={!text.trim() || selfLoading || loading || selfMode}
            onClick={startSelfCorrect}
            className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-4 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
          >
            {selfLoading ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
            
            {t("v60", "Corriger moi-même")}
          </button>
          <button
            disabled={!text.trim() || loading || selfMode}
            onClick={correct}
            className="flex items-center gap-2 rounded-full bg-[#171B22] px-5 py-2 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35] disabled:opacity-30"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            
            {t("v61", "Corriger mon résumé")}
          </button>
        </div>
      </div>
      {result && (
        <div>
          <div className="mb-1 flex justify-end">
            <button onClick={clear} className="flex items-center gap-1 text-xs text-[#6b665e] transition hover:text-[#B5432E]">
              <RotateCcw size={13} /> {t("v218", "Refaire")}
            </button>
          </div>
          <CorrectedCopy result={result} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
        </div>
      )}

      <div className="rounded-lg border border-[#26222014] bg-[#17182206] p-4">
        <p className="cj-mono mb-1 text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v62", "Résumé oral (optionnel)")}</p>
        <p className="mb-3 text-xs text-[#6b665e]">{t("v63", "Enregistrez votre résumé à voix haute.")}</p>
        <Recorder label={t("v64", "Enregistrer mon résumé")} persistKey="cj-recording-day1" onRecorded={(url) => { setHasRecording(Boolean(url)); setAudioResult(null); }} onAudioData={setAudioData} />

        {hasRecording && (
          <div className="mt-4 border-t border-[#26222014] pt-4">
            {!audioResult ? (
              <button
                onClick={correctAudio}
                disabled={audioLoading}
                className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-5 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-50"
              >
                {audioLoading && <Loader2 size={15} className="animate-spin" />}
                
                {t("v65", "Corriger mon enregistrement")}
              </button>
            ) : (
              <CorrectedCopy result={audioResult} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
            )}
          </div>
        )}
      </div>

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {notice}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
      {errorToast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {errorToast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   DAY 2 — SHADOWING
--------------------------------------------------------------- */
function DayTwo({ transcript, videoId, isTextSource }: { transcript: { t: string; text: string }[]; videoId: string | null; isTextSource: boolean }) {
  const [showVideo, setShowVideo] = useState(true);

  if (transcript.length === 0) {
    return (
      <div className="cj-fade-in space-y-5">
        <DayHeader n={2} title={t("v242", "Prononciation")} subtitle={isTextSource ? t("v66", "Lisez chaque phrase à voix haute, puis enregistrez-vous.") : t("v67", "Lisez chaque phrase à voix haute, puis enregistrez-vous. Utilisez la mini-vidéo (en bas à droite) pour réécouter.")} />
        <ImportNotice suffix={t("v68", " — les phrases à prononcer apparaîtront ici.")} />
      </div>
    );
  }

  return (
    <div className="cj-fade-in space-y-5">
      <DayHeader n={2} title={t("v242", "Prononciation")} subtitle={isTextSource ? t("v66", "Lisez chaque phrase à voix haute, puis enregistrez-vous.") : t("v67", "Lisez chaque phrase à voix haute, puis enregistrez-vous. Utilisez la mini-vidéo (en bas à droite) pour réécouter.")} />

      {videoId && !isTextSource && showVideo && (
        <div className="fixed bottom-4 right-4 z-20 w-64 overflow-hidden rounded-lg border border-[#26222018] bg-[#171B22] shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="cj-mono text-[10px] uppercase tracking-wider text-[#F4EEE0aa]">{t("v69", "Vidéo")}</span>
            <button onClick={() => setShowVideo(false)} className="text-[#F4EEE0aa] transition hover:text-[#F4EEE0]" title={t("v70", "Masquer la vidéo")}>
              <X size={14} />
            </button>
          </div>
          <div className="aspect-video w-full">
            <iframe
              key={videoId}
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&origin=${typeof window !== "undefined" ? window.location.origin : ""}`}
              title={t("v28", "Vidéo source")}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      {videoId && !isTextSource && !showVideo && (
        <button
          onClick={() => setShowVideo(true)}
          className="fixed bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full bg-[#171B22] px-3 py-2 text-xs font-medium text-[#F4EEE0] shadow-lg transition hover:bg-[#262b35]"
        >
          <Volume2 size={14} />  {t("v69", "Vidéo")}
        </button>
      )}

      <div className="space-y-3">
        {transcript.map((l, i) => (
          <div key={i} className="rounded-lg border border-[#26222014] bg-white/60 p-4">
            <div className="mb-3 flex items-start gap-2">
              <span className="cj-mono mt-1 shrink-0 text-[11px] text-[#B08D57]">{l.t}</span>
              <p className="leading-relaxed text-[#262220]">{l.text}</p>
            </div>
            <Recorder label={t("v208", "Record ({n})").replace("{n}", String(i + 1))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   DAY 3 — VOCAB & GRAMMAR
--------------------------------------------------------------- */
interface Question {
  type: string;
  category?: string;
  label: string;
  q: string;
  options: string[];
  answer: string;
  explain: string;
  words?: string[];
}

function Flashcard({ idx, flipped, setFlipped, front, back, frontBg, backBg, pad, flashcardMode }: {
  idx: number;
  flipped: Set<number>;
  setFlipped: React.Dispatch<React.SetStateAction<Set<number>>>;
  front: React.ReactNode;
  back: React.ReactNode;
  frontBg: string;
  backBg: string;
  pad: string;
  flashcardMode: string | null;
}) {
  const frontMeasureRef = useRef<HTMLDivElement>(null);
  const backMeasureRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    if (!frontMeasureRef.current || !backMeasureRef.current) return;
    const measure = () => {
      const frontH = frontMeasureRef.current!.scrollHeight;
      const backH = backMeasureRef.current!.scrollHeight;
      setCardHeight(Math.max(frontH, backH));
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [front, back]);

  const isFlipped = flipped.has(idx);

  return (
    <div
      className="group relative cursor-pointer break-inside-avoid mb-3"
      style={{ height: cardHeight || "auto", transformStyle: "preserve-3d" }}
      onClick={() => setFlipped((prev) => {
        const next = new Set(prev);
        next.has(idx) ? next.delete(idx) : next.add(idx);
        return next;
      })}
    >
      {/* Hidden measurement divs */}
      <div ref={frontMeasureRef} className={`absolute invisible w-full ${pad}`} style={{ height: "auto" }}>{front}</div>
      <div ref={backMeasureRef} className={`absolute invisible w-full ${pad}`} style={{ height: "auto" }}>{back}</div>

      {flashcardMode === "recall" ? (
        <>
          <div
            style={{ backgroundColor: backBg, backfaceVisibility: "hidden", transform: isFlipped ? "rotateX(180deg)" : "rotateX(0deg)" }}
            className={`absolute inset-0 w-full rounded-lg border border-[#26222014] shadow-sm transition-transform duration-300 ${pad}`}
          >
            {back}
          </div>
          <div
            style={{ backgroundColor: frontBg, backfaceVisibility: "hidden", transform: isFlipped ? "rotateX(0deg)" : "rotateX(180deg)" }}
            className={`absolute inset-0 w-full rounded-lg border border-[#26222014] shadow-sm transition-transform duration-300 ${pad}`}
          >
            {front}
          </div>
        </>
      ) : (
        <>
          <div
            style={{ backgroundColor: frontBg, backfaceVisibility: "hidden", transform: isFlipped ? "rotateX(180deg)" : "rotateX(0deg)" }}
            className={`absolute inset-0 w-full rounded-lg border border-[#26222014] shadow-sm transition-transform duration-300 ${pad}`}
          >
            {front}
          </div>
          <div
            style={{ backgroundColor: backBg, backfaceVisibility: "hidden", transform: isFlipped ? "rotateX(0deg)" : "rotateX(180deg)" }}
            className={`absolute inset-0 w-full rounded-lg border border-[#26222014] shadow-sm transition-transform duration-300 ${pad}`}
          >
            {back}
          </div>
        </>
      )}
    </div>
  );
}

function DayThree({ vocab, sourceText, addVocab, currentSourceId, level, savedCorrections, removeVocabByWord }: { vocab: { word: string; def: string; translation?: string; type?: string; sourceId?: string }[]; sourceText: string; addVocab: (e: { word: string; def: string; context?: string; type?: "vocab" | "phrase" | "correction" }) => void; currentSourceId: string | null; level: string; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const shuffledOptions = useMemo(() => {
    const map: Record<number, string[]> = {};
    questions.forEach((q, i) => {
      if (q.options.length > 1) {
        const arr = [...q.options];
        let hash = 0;
        for (const c of q.q) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
        for (let j = arr.length - 1; j > 0; j--) {
          hash = ((hash << 5) - hash + j) | 0;
          const k = Math.abs(hash) % (j + 1);
          [arr[j], arr[k]] = [arr[k], arr[j]];
        }
        map[i] = arr;
      }
    });
    return map;
  }, [questions]);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [evaluations, setEvaluations] = useState<Record<number, { correct: boolean; feedback: string }>>({});
  const [flashcardMode, setFlashcardMode] = useState<"recall" | "recognise">("recall");
  const [flashcardSize, setFlashcardSize] = useState<"sm" | "md" | "lg">("md");
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const loadedSaved = useRef(false);
  const generateId = useRef(0);

  const STORAGE_KEY = "cj-jour3-v2";

  useEffect(() => {
    loadedSaved.current = false;
    if (!sourceText.trim()) {
      setQuestions([]);
      setAnswers({});
      setChecked(false);
      setEvaluations({});
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.sourceText === sourceText && saved.questions?.length) {
          setQuestions(saved.questions);
          setAnswers(saved.answers || {});
          setChecked(saved.checked || false);
          loadedSaved.current = true;
        }
      }
    } catch { /* ignore */ }
  }, [sourceText]);

  useEffect(() => {
    if (!loadedSaved.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sourceText, questions, answers, checked }));
    } catch { /* ignore */ }
  }, [sourceText, questions, answers, checked]);

  const generate = async (manual = false) => {
    if (!sourceText.trim()) return;
    const requestId = ++generateId.current;
    loadedSaved.current = false;
    setQuestions([]);
    setGenerating(true);
    if (manual) setRegenerating(true);
    setAnswers({});
    setChecked(false);
    setEvaluations({});
    setFlipped(new Set());
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceText, previous: questions.map((q) => ({ type: q.type, q: q.q, answer: q.answer })), target: getLangCodes().targetLang, translation: getLangCodes().translationLang, ui: getUiLocale(), level }),
      });
      if (requestId !== generateId.current) return;
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setQuestions([]);
        setErrorToast(fail);
        loadedSaved.current = true;
        setGenerating(false);
        setRegenerating(false);
        return;
      }
      if (res.ok) {
        if (data.questions && data.questions.length) {
          setQuestions(data.questions as Question[]);
          loadedSaved.current = true;
          setGenerating(false);
          setRegenerating(false);
          return;
        }
        setErrorToast(t("v76", "Génération impossible pour ce texte — réessayez."));
      }
    } catch {
      if (requestId !== generateId.current) return;
      setErrorToast(msgAi());
    }
    if (requestId !== generateId.current) return;
    loadedSaved.current = true;
    setGenerating(false);
    setRegenerating(false);
  };

  useEffect(() => {
    if (!sourceText.trim()) return;
    if (loadedSaved.current) return;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText]);

  const pick = (qi: number, opt: string) => {
    if (checked) return;
    setAnswers((a) => ({ ...a, [qi]: opt }));
  };

  const typeAnswer = (qi: number, val: string) => {
    if (checked) return;
    setAnswers((a) => ({ ...a, [qi]: val }));
  };

  const isCorrect = (i: number) => {
    const q = questions[i];
    if (q.options.length === 0) {
      if (evaluations[i]) return evaluations[i].correct;
      const a = answers[i];
      if (typeof a !== "string") return false;
      return a.trim().toLowerCase() === q.answer.trim().toLowerCase();
    }
    return answers[i] === q.answer;
  };

  const verify = async () => {
    setChecking(true);
    const items: { question: string; type: string; reference: string; answer: string }[] = [];
    const indices: number[] = [];
    questions.forEach((q, i) => {
      if (q.options.length === 0 && answers[i] && answers[i].trim()) {
        items.push({ question: q.q, type: q.type, reference: q.answer, answer: answers[i].trim() });
        indices.push(i);
      }
    });
    const evals: Record<number, { correct: boolean; feedback: string }> = {};
    if (items.length) {
      try {
        const res = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, target: getUiLocale(), translation: getUiLocale(), level }),
        });
        if (res.status === 429) {
          setErrorToast(msgQuota());
        } else if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results)) {
            indices.forEach((idx, k) => {
              if (data.results[k]) evals[idx] = { correct: Boolean(data.results[k].correct), feedback: data.results[k].feedback || "" };
            });
          }
        }
      } catch {
        setErrorToast(msgAi());
      }
    }
    setEvaluations(evals);
    setChecked(true);
    setChecking(false);
  };

  const score = questions.filter((q, i) => isCorrect(i)).length;

  const grouped = [
    { key: "vocab", title: t("v77", "Vocabulaire"), items: questions.map((q, i) => ({ q, i })).filter(({ q }) => q.category !== "grammar") },
    { key: "grammar", title: t("v4", "Grammaire"), items: questions.map((q, i) => ({ q, i })).filter(({ q }) => q.category === "grammar") },
  ];

  if (!sourceText.trim()) {
    return (
      <div className="cj-fade-in space-y-6">
        <DayHeader n={3} title={t("v78", "Vocabulaire & grammaire")} subtitle={t("v79", "Exercices de vocabulaire et de grammaire, niveau C1+, générés par l'IA à partir du texte source.")} />
        <ImportNotice suffix={t("v80", " — les exercices apparaîtront ici.")} />
      </div>
    );
  }

  return (
    <div className="cj-fade-in space-y-6">
      <DayHeader n={3} title={t("v78", "Vocabulaire & grammaire")} subtitle={generating ? <>{t("v81", "Génération des exercices")}<LoadingDots /></> : t("v79", "Exercices de vocabulaire et de grammaire, niveau C1+, générés par l'IA à partir du texte source.")} />
      <div className="flex items-center gap-2">
        <button
          onClick={() => generate(true)}
          disabled={generating || !sourceText.trim()}
          className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
        >
          {regenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          
          {t("v82", "Régénérer les exercices")}
        </button>
      </div>
      {grouped.map((section) =>
        section.items.length > 0 ? (
          <div key={section.key}>
            <p className="cj-mono mb-3 text-[10px] uppercase tracking-wider text-[#B08D57]">{section.title}</p>
            <div className="space-y-4">
              {section.items.map(({ q, i }) => (
                <div key={i} className="rounded-lg border border-[#26222014] bg-white/60 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="cj-mono rounded border border-[#B08D5744] bg-[#B08D5714] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#7a5f30]">
                      {typeLabels(getUiLocale())[q.type] || q.label || t("v219", "Question")}
                    </span>
                  </div>
                  <p className="mb-3 text-[15px] text-[#262220]">{q.q}</p>
                  {(shuffledOptions[i] || q.options).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {(shuffledOptions[i] || q.options).map((opt) => {
                        const isChosen = answers[i] === opt;
                        const isCorrectOpt = opt === q.answer;
                        let cls = "border-[#26222022] text-[#4a453f] hover:bg-[#26222008]";
                        if (checked && isChosen && isCorrectOpt) cls = "border-[#5C7A5A] bg-[#5C7A5A14] text-[#3f5a3d]";
                        else if (checked && isChosen && !isCorrectOpt) cls = "border-[#B5432E] bg-[#B5432E0d] text-[#8a3626]";
                        else if (checked && isCorrectOpt) cls = "border-[#5C7A5A55] text-[#3f5a3d]";
                        else if (isChosen) cls = "border-[#B08D57] bg-[#B08D5714] text-[#262220]";
                        return (
                          <button key={opt} onClick={() => pick(i, opt)} className={`rounded-full border px-3.5 py-1.5 text-sm transition ${cls}`}>
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      value={answers[i] || ""}
                      onChange={(e) => typeAnswer(i, e.target.value)}
                      disabled={checked}
                      placeholder={t("v83", "Votre réponse…")}
                      className="w-full rounded border border-[#26222022] bg-white px-3 py-2 text-sm text-[#262220] outline-none placeholder:text-[#26222055] focus:border-[#B08D57] disabled:opacity-60"
                    />
                  )}
                  {checked && (
                    <div className="mt-2.5">
                      <p className="flex items-start gap-1.5 text-xs text-[#6b665e]">
                        {isCorrect(i) ? <Check size={14} className="mt-0.5 shrink-0 text-[#5C7A5A]" /> : <X size={14} className="mt-0.5 shrink-0 text-[#B5432E]" />}
                        {q.options.length === 0 ? (evaluations[i]?.feedback || q.explain) : q.explain}
                      </p>
                      {!isCorrect(i) && (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="text-xs text-[#3f5a3d]">{t("v84", "Réponse :")} {q.answer}</span>
                          {(() => {
                            const answerText = q.answer.toLowerCase();
                            const isSaved = savedCorrections?.has(answerText);
                              return isSaved ? (
                               <button
                                 onClick={() => { removeVocabByWord?.(answerText); setToast(t("v106", "Supprimer")); }}
                                 className="flex items-center gap-1 rounded-full border border-[#5C7A5A44] bg-[#5C7A5A14] px-2 py-0.5 text-[11px] font-medium text-[#3f5a3d] hover:bg-[#5C7A5A28]"
                                 title={t("v106", "Supprimer")}
                               >
                                 <Check size={11} />  {t("v19", "Carnet")}
                               </button>
                             ) : (
                               <button
                                 onClick={() => { addVocab({ word: q.answer, def: q.explain, context: q.q, type: "correction" }); setToast(t("v48", "Ajouté au carnet")); }}
                                 className="flex items-center gap-1 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-2 py-0.5 text-[11px] font-medium text-[#7a5f30] hover:bg-[#B08D5728]"
                                 title={t("v18", "Ajouter au carnet")}
                               >
                                <Plus size={11} />  {t("v19", "Carnet")}
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}
      {!checked && questions.length > 0 && (
        <button
          onClick={verify}
          disabled={checking}
          className="flex items-center gap-2 rounded-full bg-[#171B22] px-5 py-2 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35] disabled:opacity-60"
        >
          {checking && <Loader2 size={14} className="animate-spin" />}
          
          {t("v85", "Vérifier mes réponses")}
        </button>
      )}
      {checked && (
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[#B08D5714] px-4 py-2.5 text-sm text-[#7a5f30]">
             {t("v244", "Score")} : {score} / {questions.length}
          </div>
          <button
            onClick={() => {
              setAnswers({});
              setEvaluations({});
              setChecked(false);
              setFlipped(new Set());
            }}
            className="flex items-center gap-1.5 rounded-full border border-[#26222033] px-3 py-2 text-xs text-[#4a453f] hover:bg-[#26222008]"
          >
            <RotateCcw size={13} /> {t("v207", "Redo")}
          </button>
        </div>
      )}

      {vocab.length > 0 && (() => {
        const filtered = vocab.filter((v) => v.type !== "correction" && (currentSourceId ? v.sourceId === currentSourceId : false));
        const vocabOnly = filtered.filter((v) => v.type !== "phrase");
        const phrasesOnly = filtered.filter((v) => v.type === "phrase");
        const sizeConf = {
          sm: { pad: "p-3", front: "text-base", back: "text-xs" },
          md: { pad: "p-5", front: "text-xl", back: "text-sm" },
          lg: { pad: "p-8", front: "text-2xl", back: "text-base" },
        }[flashcardSize];

        if (vocabOnly.length === 0 && phrasesOnly.length === 0) return null;

        const renderCards = (items: typeof filtered, offset = 0) => (
          <div className={`columns-1 gap-3 ${flashcardSize === "sm" ? "sm:columns-5" : flashcardSize === "md" ? "sm:columns-3" : "sm:columns-2"}`} style={{ perspective: "800px" }}>
            {items.map((v, i) => {
              const idx = offset + i;
              return (
              <Flashcard
                key={i}
                idx={idx}
                flipped={flipped}
                setFlipped={setFlipped}
                front={<p className={`cj-display ${sizeConf.front} text-[#262220] text-center`}>{v.word}</p>}
                back={<p className={`${sizeConf.back} text-[#262220] text-center leading-relaxed`}>{v.translation || v.def || (v.type === "phrase" ? t("v20", "Traduction indisponible — réessayez.") : t("v0", "Explication indisponible — réessayez."))}</p>}
                frontBg="#FFFFFF"
                backBg="#F7F3E8"
                pad={sizeConf.pad}
                flashcardMode={flashcardMode}
              />
              );
            })}
          </div>
        );

        return (
          <div className="mt-6 border-t border-[#26222014] pt-5">
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v86", "Révision de votre carnet")}</p>
              <div className="flex items-center gap-1 rounded-full border border-[#26222014] bg-white/60 p-0.5">
                {(["sm", "md", "lg"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFlashcardSize(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${flashcardSize === s ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
                  >
                    {s === "sm" ? t("v202", "Small") : s === "md" ? t("v213", "Medium") : t("v203", "Large")}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5 mb-4">
              <button
                onClick={() => { setFlashcardMode("recall"); setFlipped(new Set()); }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${flashcardMode === "recall" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                {t("v209", "Memorize")}
              </button>
              <button
                onClick={() => { setFlashcardMode("recognise"); setFlipped(new Set()); }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${flashcardMode === "recognise" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                
                {t("v87", "Reconnaître")}
              </button>
            </div>
            {vocabOnly.length > 0 && (
              <div className="mb-5">
                <p className="cj-mono mb-3 text-[10px] uppercase tracking-wider text-[#7a5f30]">{t("v214", "Words")} ({vocabOnly.length})</p>
                {renderCards(vocabOnly)}
              </div>
            )}
            {phrasesOnly.length > 0 && (
              <div>
                 <p className="cj-mono mb-3 text-[10px] uppercase tracking-wider text-[#7a5f30]">{t("v245", "Phrases")} ({phrasesOnly.length})</p>
                {renderCards(phrasesOnly, vocabOnly.length)}
              </div>
            )}
          </div>
        );
      })()}

      {errorToast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {errorToast}
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#171B22] px-4 py-1.5 text-xs font-medium text-[#F4EEE0] shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   DAY 4 — WRITING
--------------------------------------------------------------- */
function DayFour({ sourceText, sourceTitle, addVocab, level, savedCorrections, removeVocabByWord }: { sourceText: string; sourceTitle: string | null; addVocab: (e: { word: string; def: string; context?: string; type?: "vocab" | "phrase" | "correction" }) => void; level: string; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const { text, setText, result, loading, correct, clear, notice } = useCorrection("writing", 120, 180, sourceText);
  const [toast, setToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);
  const addToCarnet = (s: Segment) => {
    addVocab({ word: s.correction || s.text, def: s.note?.comment || t("v56", "Correction enregistrée."), context: s.text, type: "correction" });
    setToast(t("v57", "Correction ajoutée au carnet"));
    setTimeout(() => setToast(null), 2200);
  };

  const [selfMode, setSelfMode] = useState(false);
  const [selfSegments, setSelfSegments] = useState<Segment[]>([]);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfKey, setSelfKey] = useState(0);

  const startSelfCorrect = async () => {
    if (!text.trim()) return;
    setSelfLoading(true);
    let segs: Segment[] | null = null;
    let fail: string | null = msgAi();
    try {
      const res = await fetch("/api/correct-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      fail = aiFailureMessage(res, data) || (res.ok && Array.isArray(data.segments) && !data.fallback ? null : msgAi());
      if (!fail) segs = data.segments as Segment[];
    } catch { /* ignore */ }
    if (!segs) {
      setErrorToast(fail || msgAi());
      setSelfLoading(false);
      return;
    }
    setSelfSegments(segs);
    setSelfKey((k) => k + 1);
    setSelfMode(true);
    setSelfLoading(false);
  };

  const finishSelfCorrect = (edited: string) => {
    setText(edited);
    setSelfMode(false);
  };

  const [topic, setTopic] = useState<string>("");
  const [topicLoading, setTopicLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const TOPIC_KEY = "cj-topic-writing";

  const fallbackTopic = `${t("v150","En vous inspirant du texte source")}${sourceTitle ? ` (« ${sourceTitle} »)` : ""}${t("v151",", écrivez un texte de 120 à 180 mots où vous donnez votre propre avis sur le sujet. Justifiez avec un exemple personnel ou observé.")}`;

  const generateTopic = async (manual = false) => {
    if (!sourceText.trim()) {
      setTopicLoading(false);
      return;
    }
    setTopicLoading(true);
    if (manual) setRegenerating(true);
    try {
      const res = await fetch("/api/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceText, title: sourceTitle, target: getUiLocale(), level }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setErrorToast(fail);
      } else if (res.ok && data.topic) {
        setTopic(data.topic);
        try { window.localStorage.setItem(TOPIC_KEY, JSON.stringify({ sourceText, topic: data.topic })); } catch { /* ignore */ }
      } else {
        setErrorToast(t("v76", "Génération impossible pour ce texte — réessayez."));
      }
    } catch {
      setErrorToast(msgAi());
    }
    setTopicLoading(false);
    setRegenerating(false);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOPIC_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.sourceText === sourceText && saved.topic) {
          setTopic(saved.topic);
          setTopicLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }
    generateTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText]);

  return (
    <div className="cj-fade-in space-y-5">
      <DayHeader n={4} title={t("v6", "Rédaction")} subtitle={t("v250", "Practise your writing with the generated topic.")} />
      {topicLoading ? (
        <p className="flex items-center gap-1 text-sm text-[#6b665e]">{t("v88", "Génération du sujet")}<LoadingDots /></p>
      ) : (
        <p className="rounded-lg border-l-2 border-[#B08D57] bg-[#B08D5714] px-4 py-3 text-[15px] italic text-[#262220]">{topic || fallbackTopic}</p>
      )}
      {!sourceText.trim() && (
        <ImportNotice suffix={t("v89", " — votre sujet de rédaction apparaîtra ici une fois la source importée.")} />
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => generateTopic(true)}
          disabled={topicLoading || !sourceText.trim()}
          className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
        >
          {regenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          
          {t("v90", "Régénérer le sujet")}
        </button>
      </div>
      {selfMode ? (
        <SelfCorrectBox key={selfKey} segments={selfSegments} onDone={finishSelfCorrect} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={t("v91", "Développez votre avis ici…")}
          className="w-full rounded-lg border border-[#26222022] bg-white/70 p-4 text-[15px] leading-relaxed text-[#262220] outline-none placeholder:text-[#26222055] focus:border-[#B08D57]"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <span className="cj-mono text-xs text-[#6b665e]">{text.trim() ? (getLangCodes().targetLang === "zh" ? Array.from(text.trim()).length : text.trim().split(/\s+/).length) : 0} {getLangCodes().targetLang === "zh" ? t("v254", "characters") : t("v210", "words")}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={!text.trim() || selfLoading || loading || selfMode}
            onClick={startSelfCorrect}
            className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-4 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
          >
            {selfLoading ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
            
            {t("v60", "Corriger moi-même")}
          </button>
          <button
            disabled={!text.trim() || loading || selfMode}
            onClick={correct}
            className="flex items-center gap-2 rounded-full bg-[#171B22] px-5 py-2 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35] disabled:opacity-30"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            
            {t("v92", "Corriger mon texte")}
          </button>
        </div>
      </div>
      {result && (
        <div>
          <div className="mb-1 flex justify-end">
            <button onClick={clear} className="flex items-center gap-1 text-xs text-[#6b665e] transition hover:text-[#B5432E]">
              <RotateCcw size={13} /> {t("v218", "Refaire")}
            </button>
          </div>
          <CorrectedCopy result={result} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
        </div>
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {notice}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
      {errorToast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {errorToast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   DAY 5 — SPEAKING
--------------------------------------------------------------- */
function DayFive({ sourceText, sourceTitle, addVocab, level, savedCorrections, removeVocabByWord }: { sourceText: string; sourceTitle: string | null; addVocab: (e: { word: string; def: string; context?: string; type?: "vocab" | "phrase" | "correction" }) => void; level: string; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const audioResultKey = "cj-correction-day5";
  const [hasRecording, setHasRecording] = useState(false);
  const [audioResult, setAudioResult] = useState<CorrectResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(audioResultKey);
      return raw ? (JSON.parse(raw) as CorrectResult) : null;
    } catch { return null; }
  });
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioData, setAudioData] = useState<string | null>(null);

  useEffect(() => {
    getAudio("cj-recording-day5")
      .then((d) => { if (d) { setAudioData(d); setHasRecording(true); } })
      .catch(() => {});
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const [topic, setTopic] = useState<string>("");
  const [topicLoading, setTopicLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const TOPIC_KEY = "cj-topic-speaking";

  const fallbackTopic = `${t("v152","Enregistrez une mini-présentation d'une à deux minutes sur le sujet")}${sourceTitle ? ` (« ${sourceTitle} »)` : ""}${t("v153"," : présentez-le comme à un ami, puis donnez votre opinion personnelle.")}`;

  const generateTopic = async (manual = false) => {
    if (!sourceText.trim()) {
      setTopicLoading(false);
      return;
    }
    setTopicLoading(true);
    if (manual) setRegenerating(true);
    try {
      const res = await fetch("/api/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceText, title: sourceTitle, mode: "speaking", target: getUiLocale(), level }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setErrorToast(fail);
      } else if (res.ok && data.topic) {
        setTopic(data.topic);
        try { window.localStorage.setItem(TOPIC_KEY, JSON.stringify({ sourceText, topic: data.topic })); } catch { /* ignore */ }
      } else {
        setErrorToast(t("v76", "Génération impossible pour ce texte — réessayez."));
      }
    } catch {
      setErrorToast(msgAi());
    }
    setTopicLoading(false);
    setRegenerating(false);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TOPIC_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.sourceText === sourceText && saved.topic) {
          setTopic(saved.topic);
          setTopicLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }
    generateTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText]);

  useEffect(() => {
    try {
      if (audioResult) window.localStorage.setItem(audioResultKey, JSON.stringify(audioResult));
      else window.localStorage.removeItem(audioResultKey);
    } catch { /* ignore */ }
  }, [audioResult, audioResultKey]);

  const addToCarnet = (s: Segment) => {
    addVocab({ word: s.correction || s.text, def: s.note?.comment || t("v56", "Correction enregistrée."), context: s.text, type: "correction" });
    setToast(t("v57", "Correction ajoutée au carnet"));
    setTimeout(() => setToast(null), 2200);
  };

  const correctAudio = async () => {
    if (!audioData) return;
    setAudioLoading(true);
    try {
      const audioPayload = audioData;
      const res = await fetch("/api/correct-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioPayload, source: sourceText, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setErrorToast(fail);
        setAudioLoading(false);
        return;
      }
      if (res.ok && Array.isArray(data.segments) && data.segments.length && !data.fallback) {
        setAudioResult({ segments: data.segments as Segment[], fallback: false });
        setAudioLoading(false);
        return;
      }
    } catch { /* ignore */ }
    setErrorToast(msgAi());
    setAudioLoading(false);
  };

  return (
    <div className="cj-fade-in space-y-5">
      <DayHeader n={5} title={t("v93", "Expression orale")} subtitle={t("v251", "Practise your speaking with the generated topic.")} />
      {topicLoading ? (
        <p className="flex items-center gap-1 text-sm text-[#6b665e]">{t("v88", "Génération du sujet")}<LoadingDots /></p>
      ) : (
        <p className="rounded-lg border-l-2 border-[#B08D57] bg-[#B08D5714] px-4 py-3 text-[15px] italic text-[#262220]">{topic || fallbackTopic}</p>
      )}
      {!sourceText.trim() && (
        <ImportNotice suffix={t("v94", " — votre sujet d'expression orale apparaîtra ici une fois la source importée.")} />
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => generateTopic(true)}
          disabled={topicLoading || !sourceText.trim()}
          className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
        >
          {regenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          
          {t("v90", "Régénérer le sujet")}
        </button>
      </div>
      <div className="rounded-lg bg-[#17182208] p-5">
        <p className="cj-mono mb-1 text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v95", "Votre présentation")}</p>
        <p className="mb-3 text-xs text-[#6b665e]">{t("v96", "Enregistrez votre présentation à voix haute.")}</p>
        <Recorder label={t("v97", "Enregistrer ma présentation")} persistKey="cj-recording-day5" onRecorded={(url) => { setHasRecording(Boolean(url)); setAudioResult(null); }} onAudioData={setAudioData} />
      </div>

      {hasRecording && (
        <div className="rounded-lg border border-[#26222014] bg-[#17182206] p-4">
          {!audioResult ? (
            <button
              onClick={correctAudio}
              disabled={audioLoading}
              className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-5 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-50"
            >
              {audioLoading && <Loader2 size={15} className="animate-spin" />}
              
              {t("v65", "Corriger mon enregistrement")}
            </button>
          ) : (
            <CorrectedCopy result={audioResult} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
      {errorToast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {errorToast}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   JOURNAL
--------------------------------------------------------------- */
interface JournalEntry {
  id: string;
  date: string;
  text: string;
  prompt?: string;
  audio?: string;
  audioId?: string;
  correction?: CorrectResult;
  createdAt: number;
}

function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  return words.slice(0, max).join(" ") + "…";
}

function firstSentence(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return t("v34", "Texte");
  const m = cleaned.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return m ? m[0].trim() : cleaned;
}

function JournalFlipCard({ entry, audioSrc, showCorrection, setShowCorrection, addToCarnet, savedCorrections, removeVocabByWord }: {
  entry: JournalEntry;
  audioSrc?: string;
  showCorrection: boolean;
  setShowCorrection: (v: boolean) => void;
  addToCarnet: (s: Segment) => void;
  savedCorrections?: Set<string>;
  removeVocabByWord?: (word: string) => void;
}) {
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    if (!frontRef.current || !backRef.current) return;
    const measure = () => {
      const frontH = frontRef.current!.scrollHeight;
      const backH = backRef.current!.scrollHeight;
      setCardHeight(Math.max(frontH, backH));
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [entry]);

  return (
    <div
      className={`relative mt-3 w-full ${entry.correction ? "min-h-[300px]" : ""}`}
      style={{ height: cardHeight || "auto", transformStyle: "preserve-3d", transition: "transform 0.5s ease", transform: showCorrection ? "rotateY(180deg)" : "rotateY(0deg)" }}
    >
      {/* FRONT: original text + audio */}
      <div
        ref={frontRef}
        className="w-full rounded-lg border border-[#26222014] p-4"
        style={{ backfaceVisibility: "hidden" }}
      >
        {entry.prompt && !entry.prompt.startsWith("Écrivez librement") && (
          <p className="mb-2 text-xs italic text-[#6b665e]">{t("v98", "Sujet :")} {entry.prompt}</p>
        )}
        <p className="text-[15px] leading-relaxed text-[#262220]">{entry.text}</p>
        {audioSrc && <audio controls src={audioSrc} className="mt-3 w-full" />}
      </div>

      {/* BACK: corrections */}
      <div
        ref={backRef}
        className="absolute inset-0 w-full rounded-lg border border-[#26222014] pb-6"
        style={{ backfaceVisibility: "hidden", backgroundColor: "#FFFFFF", transform: "rotateY(180deg)" }}
      >
        <div className="p-4" onClick={(e) => e.stopPropagation()}>
          {entry.correction && (
            <div className="text-[12px] leading-relaxed">
              <CorrectedCopy result={entry.correction} onAddToCarnet={addToCarnet} hideNotes savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JournalView({ sourceText, sourceTitle, addVocab, level, savedCorrections, removeVocabByWord }: { sourceText: string; sourceTitle: string | null; addVocab: (e: { word: string; def: string; context?: string; type?: "vocab" | "phrase" | "correction" }) => void; level: string; savedCorrections?: Set<string>; removeVocabByWord?: (word: string) => void; }) {
  const { text, setText, result, loading, correct, clear, notice } = useCorrection("journal", 0, 0, sourceText);
  const [toast, setToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const [prompt, setPrompt] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem("cj-journal-prompt") || ""; } catch { return ""; }
  });
  const [generating, setGenerating] = useState(false);
  const [histView, setHistView] = useState<"cards" | "cal">("cards");

  const [selfMode, setSelfMode] = useState(false);
  const [selfSegments, setSelfSegments] = useState<Segment[]>([]);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfKey, setSelfKey] = useState(0);

  const [hasRecording, setHasRecording] = useState(false);
  const [audioData, setAudioData] = useState<string | null>(null);

  useEffect(() => {
    getAudio("cj-journal-recording")
      .then((d) => { if (d) { setAudioData(d); setHasRecording(true); } })
      .catch(() => {});
  }, []);
  const [audioResult, setAudioResult] = useState<CorrectResult | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [recorderKey, setRecorderKey] = useState(0);

  const [entries, setEntries] = useState<JournalEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(window.localStorage.getItem("cj-journal-entries") || "[]") as JournalEntry[]; } catch { return []; }
  });
  const [audioMap, setAudioMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      for (const e of entries) {
        if (e.audio) { map[e.id] = e.audio; continue; }
        if (e.audioId) {
          try { const a = await getAudio(e.audioId); if (a) map[e.id] = a; } catch { /* ignore */ }
        }
      }
      if (!cancelled) setAudioMap(map);
    })();
    return () => { cancelled = true; };
  }, [entries]);
  const [openEntry, setOpenEntry] = useState<JournalEntry | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);

  const dateStr = useMemo(() => {
    const raw = new Date().toLocaleDateString(localeOf(getUiLocale()), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, []);

  const addToCarnet = (s: Segment) => {
    addVocab({ word: s.correction || s.text, def: s.note?.comment || t("v56", "Correction enregistrée."), context: s.text, type: "correction" });
    setToast(t("v57", "Correction ajoutée au carnet"));
    setTimeout(() => setToast(null), 2200);
  };

  const generatePrompt = async (manual = false) => {
    setGenerating(true);
    try {
      const res = await fetch("/api/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceText, title: sourceTitle, mode: "journal", target: getUiLocale(), level }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.topic) {
          setPrompt(data.topic);
          try { window.localStorage.setItem("cj-journal-prompt", data.topic); } catch { /* ignore */ }
          setGenerating(false);
          return;
        }
      }
      setErrorToast(t("v99", "Quota IA dépassé — réessayez plus tard."));
      setTimeout(() => setErrorToast(null), 4000);
    } catch {
      setErrorToast(t("v99", "Quota IA dépassé — réessayez plus tard."));
      setTimeout(() => setErrorToast(null), 4000);
    }
    setGenerating(false);
  };

  const deletePrompt = () => {
    setPrompt("");
    try { window.localStorage.removeItem("cj-journal-prompt"); } catch { /* ignore */ }
  };

  const startSelfCorrect = async () => {
    if (!text.trim()) return;
    setSelfLoading(true);
    let segs: Segment[] | null = null;
    try {
      const res = await fetch("/api/correct-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.segments)) segs = data.segments as Segment[];
      }
    } catch { /* ignore */ }
    if (!segs) {
      segs = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).map((s) => ({ text: s, flagged: false, note: null, correction: s }));
    }
    setSelfSegments(segs);
    setSelfKey((k) => k + 1);
    setSelfMode(true);
    setSelfLoading(false);
  };

  const finishSelfCorrect = (edited: string) => {
    setText(edited);
    setSelfMode(false);
  };

  const correctAudio = async () => {
    if (!audioData) return;
    setAudioLoading(true);
    try {
      const audioPayload = audioData;
      const res = await fetch("/api/correct-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioPayload, source: sourceText, target: getLangCodes().targetLang, translation: getUiLocale() }),
      });
      const data = await res.json().catch(() => ({}));
      const fail = aiFailureMessage(res, data);
      if (fail) {
        setErrorToast(fail);
        setAudioLoading(false);
        return;
      }
      if (res.ok && Array.isArray(data.segments) && data.segments.length && !data.fallback) {
        setAudioResult({ segments: data.segments as Segment[], fallback: false });
        setAudioLoading(false);
        return;
      }
      setErrorToast(data?.error || msgAi());
      setAudioLoading(false);
    } catch {
      setErrorToast(t("v100", "Erreur réseau lors de la correction audio."));
      setAudioLoading(false);
    }
  };

  const saveEntry = async () => {
    if (!text.trim() && !audioData) return;
    const id = `${Date.now()}`;
    const useAudio = Boolean(audioData && audioResult);
    const storedText = useAudio
      ? audioResult!.segments.map((s) => s.text).join(" ").trim() || text.trim()
      : text.trim();
    const storedCorrection = useAudio ? audioResult! : (result || undefined);
    const entry: JournalEntry = {
      id,
      date: dateStr,
      text: storedText,
      prompt: prompt || undefined,
      audioId: audioData ? id : undefined,
      correction: storedCorrection,
      createdAt: Date.now(),
    };
    if (audioData) {
      try { await putAudio(id, audioData); }
      catch { setErrorToast(t("v101", "Audio non sauvegardé (stockage indisponible).")); }
    }
    const next = [entry, ...entries];
    setEntries(next);
    try { window.localStorage.setItem("cj-journal-entries", JSON.stringify(next)); } catch { /* ignore */ }
    setText("");
    clear();
    setAudioResult(null);
    setAudioData(null);
    setHasRecording(false);
    deleteAudio("cj-journal-recording").catch(() => {});
    setRecorderKey((k) => k + 1);
    setToast(t("v102", "Entrée enregistrée"));
    setTimeout(() => setToast(null), 2200);
  };

  const deleteEntry = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    try { window.localStorage.setItem("cj-journal-entries", JSON.stringify(next)); } catch { /* ignore */ }
    deleteAudio(id).catch(() => {});
  };

  return (
    <div className="cj-fade-in space-y-5">
      <div>
        <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">Journal</p>
        <h2 className="cj-display text-3xl text-[#262220]">{dateStr}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[#6b665e]">{t("v252", "Write a journal entry freely or click 'Generate a topic' for inspiration.")}</p>
        {generating ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-[#6b665e]">
            
            {t("v88", "Génération du sujet")}<LoadingDots />
          </p>
        ) : prompt ? (
          <p className="mt-2 rounded-lg border-l-2 border-[#B08D57] bg-[#B08D5714] px-4 py-3 text-[15px] italic text-[#262220]">{prompt}</p>
        ) : null}
      </div>

      <div>
        {generating ? (
          <button
            disabled
            className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] opacity-40"
          >
            <Loader2 size={13} className="animate-spin" />
            {prompt ? t("v104", "Régénérer un sujet") : t("v105", "Générer un sujet")}
          </button>
        ) : prompt ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => generatePrompt(true)}
              className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-[#B08D5728]"
            >
              <Sparkles size={13} />
              
              {t("v104", "Régénérer un sujet")}
            </button>
            <button onClick={deletePrompt} className="text-[11px] text-[#B08D57] hover:text-[#7a5f30]">{t("v106", "Supprimer")}</button>
          </div>
        ) : (
          <button
            onClick={() => generatePrompt(false)}
            className="flex items-center gap-1.5 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-[#B08D5728]"
          >
            <Sparkles size={13} />
            
            {t("v105", "Générer un sujet")}
          </button>
        )}
      </div>

      {selfMode ? (
        <SelfCorrectBox key={selfKey} segments={selfSegments} onDone={finishSelfCorrect} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={t("v107", "Écrivez votre entrée de journal ici…")}
          className="w-full rounded-lg border border-[#26222022] bg-white/70 p-4 text-[15px] leading-relaxed text-[#262220] outline-none placeholder:text-[#26222055] focus:border-[#B08D57]"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <span className="cj-mono text-xs text-[#6b665e]">{text.trim() ? (getLangCodes().targetLang === "zh" ? Array.from(text.trim()).length : text.trim().split(/\s+/).length) : 0} {getLangCodes().targetLang === "zh" ? t("v254", "characters") : t("v210", "words")}</span>
        <div className="flex items-center gap-2">
          <button
            disabled={!text.trim() || selfLoading || loading || selfMode}
            onClick={startSelfCorrect}
            className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-4 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-40"
          >
            {selfLoading ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
            
            {t("v60", "Corriger moi-même")}
          </button>
          <button
            disabled={!text.trim() || loading || selfMode}
            onClick={correct}
            className="flex items-center gap-2 rounded-full bg-[#171B22] px-5 py-2 text-sm font-medium text-[#F4EEE0] transition hover:bg-[#262b35] disabled:opacity-30"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            
            {t("v253", "Correct my entry")}
          </button>
        </div>
      </div>

      {result && (
        <div>
          <div className="mb-1 flex justify-end">
            <button onClick={clear} className="flex items-center gap-1 text-xs text-[#6b665e] transition hover:text-[#B5432E]">
              <RotateCcw size={13} /> {t("v218", "Refaire")}
            </button>
          </div>
          <CorrectedCopy result={result} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
        </div>
      )}

      <div className="rounded-lg border border-[#26222014] bg-[#17182206] p-4">
        <p className="cj-mono mb-1 text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v108", "Entrée orale (optionnel)")}</p>
        <p className="mb-3 text-xs text-[#6b665e]">{t("v109", "Enregistrez votre entrée de journal à voix haute.")}</p>
        <Recorder key={recorderKey} label={t("v110", "Enregistrer mon entrée")} persistKey="cj-journal-recording" onRecorded={(url) => { setHasRecording(Boolean(url)); setAudioResult(null); }} onAudioData={setAudioData} />
        {hasRecording && (
          <div className="mt-4 border-t border-[#26222014] pt-4">
            {!audioResult ? (
              <button
                onClick={correctAudio}
                disabled={audioLoading}
                className="flex items-center gap-2 rounded-full border border-[#B08D5744] bg-[#B08D5714] px-5 py-2 text-sm font-medium text-[#7a5f30] transition hover:bg-[#B08D5728] disabled:opacity-50"
              >
                {audioLoading && <Loader2 size={15} className="animate-spin" />}
                
                {t("v65", "Corriger mon enregistrement")}
              </button>
            ) : (
              <CorrectedCopy result={audioResult} onAddToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={saveEntry}
          disabled={!text.trim() && !audioData}
          className="flex items-center gap-1.5 rounded-full bg-[#5C7A5A] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#4a6548] disabled:opacity-40"
        >
          <Save size={14} />  {t("v111", "Enregistrer l'entrée")}
        </button>
      </div>

      {entries.length > 0 && (
        <div className="border-t border-[#26222014] pt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v112", "Entrées précédentes")}</p>
            <div className="flex items-center gap-1 rounded-full bg-[#2622200a] p-0.5 text-[11px]">
              <button
                onClick={() => setHistView("cards")}
                className={`rounded-full px-3 py-1 transition ${histView === "cards" ? "bg-[#F4EEE0] text-[#171B22] shadow-sm" : "text-[#6b665e] hover:text-[#262220]"}`}
                >
                  {t("v211", "Cards")}
                </button>
              <button
                onClick={() => setHistView("cal")}
                className={`rounded-full px-3 py-1 transition ${histView === "cal" ? "bg-[#F4EEE0] text-[#171B22] shadow-sm" : "text-[#6b665e] hover:text-[#262220]"}`}
                >
                  {t("v212", "Calendar")}
                </button>
            </div>
          </div>
          {histView === "cards" ? (
            <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
              {entries.map((e) => (
                <div key={e.id} onClick={() => { setOpenEntry(e); setShowCorrection(false); }} style={{ backgroundColor: "#FFFFFF" }} className="cursor-pointer break-inside-avoid mb-3 min-h-[180px] rounded-lg border border-[#26222014] p-4 shadow-sm transition hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <p className="cj-mono text-[10px] uppercase tracking-wide text-[#B08D57]">{e.date}</p>
                    <button onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }} className="text-[#26222044] transition hover:text-[#B5432E]" title={t("v106", "Supprimer")}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {e.prompt && !e.prompt.startsWith("Écrivez librement") ? (
                    <p className="mt-1 text-xs italic leading-relaxed text-[#6b665e]">{truncateWords(e.prompt, 18)}</p>
                  ) : null}
                  {e.text && <p className="mt-2 text-sm leading-relaxed text-[#262220]">{truncateWords(e.text, 80)}</p>}
                  {(audioMap[e.id] || e.audio) && <audio controls src={audioMap[e.id] || e.audio} className="mt-2 w-full" />}
                </div>
              ))}
            </div>
          ) : (
            <JournalCalendar entries={entries} onOpen={(e) => { setOpenEntry(e); setShowCorrection(false); }} />
          )}
        </div>
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {notice}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
      {errorToast && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#B5432E] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {errorToast}
        </div>
      )}

      {openEntry && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenEntry(null)}>
          <div
            className="w-full max-w-2xl rounded-2xl bg-[#F4EEE0] p-6 shadow-2xl"
            style={{ perspective: "1200px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">{openEntry.date}</p>
            </div>

            <JournalFlipCard entry={openEntry} audioSrc={audioMap[openEntry.id] || openEntry.audio} showCorrection={showCorrection} setShowCorrection={setShowCorrection} addToCarnet={addToCarnet} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />

            <div className="mt-4 flex items-center justify-between gap-2">
              {openEntry.correction ? (
                <button
                  onClick={() => setShowCorrection(!showCorrection)}
                  className="text-[11px] text-[#6b665e] italic hover:text-[#262220]"
                >
                  {showCorrection ? t("v113", "← Cliquer pour voir le texte") : t("v114", "Cliquer pour voir les corrections →")}
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => { deleteEntry(openEntry.id); setOpenEntry(null); }}
                className="text-[#26222044] transition hover:text-[#B5432E]"
                title={t("v106", "Supprimer")}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JournalCalendar({ entries, onOpen }: { entries: JournalEntry[]; onOpen: (e: JournalEntry) => void }) {
  const [month, setMonth] = useState<Date>(() => {
    const base = entries.length ? new Date(entries[0].createdAt) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const entriesByDay: Record<number, JournalEntry[]> = {};
  for (const e of entries) {
    const d = new Date(e.createdAt);
    if (d.getFullYear() === year && d.getMonth() === m) {
      const day = d.getDate();
      if (!entriesByDay[day]) entriesByDay[day] = [];
      entriesByDay[day].push(e);
    }
  }

  const monthLabel = month.toLocaleDateString(localeOf(getUiLocale()), { month: "long", year: "numeric" });
  const cap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const weekdays = [
    t("v231", "Lun"),
    t("v232", "Mar"),
    t("v233", "Mer"),
    t("v234", "Jeu"),
    t("v235", "Ven"),
    t("v236", "Sam"),
    t("v237", "Dim"),
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="cj-display text-lg capitalize text-[#262220]">{cap}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(new Date(year, m - 1, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#B08D5744] bg-[#B08D5714] text-[#7a5f30] transition hover:bg-[#B08D5728]"
            title={t("v115", "Mois précédent")}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setMonth(new Date(year, m + 1, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#B08D5744] bg-[#B08D5714] text-[#7a5f30] transition hover:bg-[#B08D5728]"
            title={t("v116", "Mois suivant")}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center cj-mono text-[9px] text-[#6b665e]">
        {weekdays.map((d) => (
          <div key={d} className="truncate px-0.5 pb-1" title={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => (
          <div key={i} className="min-h-[76px] rounded-lg border border-[#26222014] bg-white/60 p-1.5">
            {cell !== null && (
              <>
                <p className="cj-mono text-[10px] text-[#6b665e]">{cell}</p>
                {(entriesByDay[cell] || []).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    title={e.prompt && !e.prompt.startsWith("Écrivez librement") ? e.prompt : t("v117", "entrée de journal")}
                    className="mt-1 block w-full truncate rounded bg-[#B08D5714] px-1.5 py-1 text-left text-[11px] leading-tight text-[#7a5f30] transition hover:bg-[#B08D5728]"
                  >
                    {e.prompt && !e.prompt.startsWith("Écrivez librement") ? truncateWords(e.prompt, 5) : t("v117", "entrée de journal")}
                  </button>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportNotice({ suffix, action }: { suffix: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#B08D5744] bg-[#B08D5714] px-4 py-3 text-left text-sm text-[#7a5f30]">
      
      {t("v118", "Importez d'abord une source")}{suffix}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function DayHeader({ n, title, subtitle }: { n: number; title: string; subtitle: React.ReactNode }) {
  return (
    <div>
      <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v238", "Day {n}").replace("{n}", String(n))}</p>
        <h2 className="cj-display text-3xl text-[#262220]">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#6b665e]">{subtitle}</p>
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="cj-dot">.</span>
      <span className="cj-dot" style={{ animationDelay: "0.2s" }}>.</span>
      <span className="cj-dot" style={{ animationDelay: "0.4s" }}>.</span>
    </span>
  );
}

/* ---------------------------------------------------------------
   VOCAB DRAWER
--------------------------------------------------------------- */
function VocabDrawer({ open, onClose, vocab, currentSourceId, removeVocab, notes, setNote, frdicConnected }: {
  open: boolean;
  onClose: () => void;
  vocab: { word: string; def: string; context?: string; translation?: string; sourceId?: string; type?: string }[];
  currentSourceId: string | null;
  removeVocab: (i: number) => void;
  notes: Record<string, string>;
  setNote: (word: string, note: string) => void;
  frdicConnected: boolean;
}) {
  const [mastered, setMastered] = useState<Set<string>>(new Set());
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const visible = vocab
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.type !== "correction" && (currentSourceId ? v.sourceId === currentSourceId : false));

  useEffect(() => {
    if (!open || !frdicConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/frdic/mastered");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.words) && !cancelled) {
            setMastered(new Set(data.words as string[]));
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [open, frdicConnected]);

  const saveNote = (word: string) => {
    const note = noteText.trim();
    setNote(word, note);
    setEditingWord(null);
  };

  return (
    <div className={`fixed inset-0 z-30 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div onClick={onClose} className={`absolute inset-0 bg-black/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
      <div
        style={{ backgroundColor: "#F4EEE0" }}
        className={`absolute right-0 top-0 h-full w-[320px] shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-[#26222014] px-5 py-4">
          <h3 className="cj-display text-xl text-[#262220]">{t("v120", "Carnet d'apprentissage")}</h3>
          <button onClick={onClose} className="text-[#4a453f] hover:text-[#262220]"><X size={18} /></button>
        </div>
        <div className="cj-scrollbar h-[calc(100%-64px)] overflow-y-auto p-5">
          {visible.length === 0 ? (
            <div className="rounded-lg border border-[#B08D5744] bg-[#B08D5714] px-4 py-3 text-left text-sm text-[#7a5f30]">
              
              {t("v121", "Rien pour l'instant. Cliquez un mot ou surlignez une expression dans la source pour l'ajouter ici.")}
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map(({ v, i }) => {
                const note = notes[v.word.toLowerCase()];
                const isMastered = mastered.has(v.word.toLowerCase());
                return (
                  <div key={i} style={{ backgroundColor: "#FFFFFF" }} className="group rounded-lg border border-[#26222014] p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <p className="cj-display text-[16px] text-[#262220]">{v.word}</p>
                        {isMastered && (
                          <span className="flex items-center gap-0.5 rounded-full bg-[#5C7A5A22] px-1.5 py-0.5 text-[10px] text-[#3f5a3d]">
                            <Check size={10} />  {t("v122", "maîtrisé")}
                          </span>
                        )}
                      </div>
                      <button onClick={() => removeVocab(i)} className="text-[#26222055] opacity-0 transition group-hover:opacity-100 hover:text-[#B5432E]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {v.translation && <p className="mt-1 text-xs font-medium text-[#B08D57]">{v.translation}</p>}
                    {v.type !== "phrase" && v.def && <p className="mt-1 text-xs leading-relaxed text-[#6b665e]">{v.def}</p>}
                    {v.context && v.context.trim().toLowerCase() !== v.word.trim().toLowerCase() && (
                      <p className="mt-1 text-[11px] italic leading-relaxed text-[#26222055]">{v.context}</p>
                    )}
                    {note && editingWord !== v.word && (
                      <p className="mt-1.5 rounded bg-[#B08D5714] px-2 py-1 text-xs italic leading-relaxed text-[#7a5f30]">{note}</p>
                    )}
                    {editingWord === v.word ? (
                      <div className="mt-2">
                        <textarea
                          autoFocus
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          rows={2}
                          placeholder={t("v123", "Votre note…")}
                          className="w-full rounded border border-[#B08D5733] bg-white p-2 text-xs text-[#262220] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
                        />
                        <div className="mt-1 flex justify-end gap-2">
                          <button onClick={() => setEditingWord(null)} className="text-xs text-[#6b665e] hover:text-[#262220]">{t("v215", "Annuler")}</button>
                          <button onClick={() => saveNote(v.word)} className="text-xs font-medium text-[#7a5f30] hover:text-[#262220]">{t("v46", "Enregistrer")}</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingWord(v.word); setNoteText(note || ""); }}
                        className="mt-1.5 flex items-center gap-1 text-[11px] text-[#B08D57] opacity-0 transition group-hover:opacity-100 hover:text-[#7a5f30]"
                      >
                        <PenLine size={11} /> {note ? t("v124", "Modifier la note") : t("v47", "Ajouter une note")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   CARNET (all saved vocab, grouped by category)
--------------------------------------------------------------- */
function CarnetView({ vocab, notes, setNote, removeVocab, frdic }: {
  vocab: { word: string; def: string; context?: string; translation?: string; type?: string }[];
  notes: Record<string, string>;
  setNote: (word: string, note: string) => void;
  removeVocab: (i: number) => void;
  frdic: {
    connected: boolean;
    enabled: boolean;
    name: string;
    authUrl: string;
    mode: "push" | "two-way";
    busy: boolean;
    onConnect: (token: string, mode: "push" | "two-way") => Promise<{ ok: boolean; error?: string }>;
    onSave: (token: string, mode: "push" | "two-way") => Promise<{ ok: boolean; error?: string }>;
    onDisconnect: () => void;
    onSync: () => void;
  };
}) {
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [size, setSize] = useState<"sm" | "md" | "lg">("md");
  const [flashcardMode, setFlashcardMode] = useState<"recall" | "recognise" | null>(null);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<"chrono" | "random">("chrono");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [showFrdicModal, setShowFrdicModal] = useState(false);
  const [frdicEditing, setFrdicEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [modeInput, setModeInput] = useState<"push" | "two-way">(frdic.mode);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const sizeConf = {
    sm: { pad: "p-2", word: "text-sm", def: "text-[11px]" },
    md: { pad: "p-3", word: "text-[16px]", def: "text-xs" },
    lg: { pad: "p-4", word: "text-lg", def: "text-sm" },
  }[size];

  const gridCols: Record<string, Record<string, string>> = {
    vocab: { sm: "sm:grid-cols-5", md: "sm:grid-cols-3", lg: "sm:grid-cols-2" },
    phrase: { sm: "sm:grid-cols-5", md: "sm:grid-cols-3", lg: "sm:grid-cols-2" },
    correction: { sm: "sm:grid-cols-2", md: "sm:grid-cols-2", lg: "sm:grid-cols-1" },
  };

  const categorize = (v: { word: string; type?: string }): "vocab" | "phrase" | "correction" => {
    if (v.type === "correction") return "correction";
    if (v.type === "phrase") return "phrase";
    if (v.type === "vocab") return "vocab";
    return v.word.split(/\s+/).filter(Boolean).length > 1 ? "phrase" : "vocab";
  };

  const extractSentence = (text: string, word: string): string => {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const found = sentences.find((s) => s.toLowerCase().includes(word.toLowerCase()));
    return found || sentences[0] || text;
  };

  const mulberry32 = (a: number): (() => number) => {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const seededShuffle = <T,>(arr: T[], rng: () => number): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const uiLocale = getUiLocale();
  const sections = useMemo(() => {
    const secs: { key: string; title: string; items: { v: typeof vocab[number]; idx: number }[] }[] = [
      { key: "vocab", title: t("v77", "Vocabulaire"), items: [] },
      { key: "phrase", title: t("v245", "Phrases"), items: [] },
      { key: "correction", title: t("v246", "Corrections"), items: [] },
    ];
    vocab.forEach((v, idx) => {
      const section = secs.find((s) => s.key === categorize(v));
      if (section) section.items.push({ v, idx });
    });
    if (order === "random") {
      const rng = mulberry32(shuffleSeed);
      for (const s of secs) s.items = seededShuffle(s.items, rng);
    }
    return secs;
  }, [vocab, order, shuffleSeed, uiLocale]);

  const saveNote = (word: string) => {
    const note = noteText.trim();
    setNote(word, note);
    setEditingWord(null);
  };

  return (
    <div className="cj-fade-in space-y-6">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="cj-mono text-[10px] uppercase tracking-wider text-[#B08D57]">{t("v19", "Carnet")}</p>
            <h2 className="cj-display text-3xl text-[#262220]">{t("v120", "Carnet d'apprentissage")}</h2>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 rounded-full border border-[#26222014] bg-white/60 p-0.5">
              {(["sm", "md", "lg"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${size === s ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
                >
                  {s === "sm" ? t("v202", "Small") : s === "md" ? t("v213", "Medium") : t("v203", "Large")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#26222014] bg-white/60 p-0.5">
              <button
                onClick={() => { setFlashcardMode(flashcardMode === "recall" ? null : "recall"); setFlipped(new Set()); }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${flashcardMode === "recall" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                {t("v209", "Memorize")}
              </button>
              <button
                onClick={() => { setFlashcardMode(flashcardMode === "recognise" ? null : "recognise"); setFlipped(new Set()); }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${flashcardMode === "recognise" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                
                {t("v87", "Reconnaître")}
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#26222014] bg-white/60 p-0.5">
              <button
                onClick={() => setOrder("chrono")}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${order === "chrono" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                
                {t("v125", "Récent")}
              </button>
              <button
                onClick={() => { setOrder("random"); setShuffleSeed(Math.floor(Math.random() * 2147483647)); }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${order === "random" ? "bg-[#171B22] text-[#F4EEE0]" : "text-[#6b665e] hover:text-[#262220]"}`}
              >
                
                {t("v126", "Aléatoire")}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm leading-relaxed text-[#6b665e] flex-1 min-w-0">{t("v127", "Tous vos mots, phrases et corrections enregistrés, regroupés par catégorie.")}</p>
          {frdic.enabled && (<div className="w-fit flex items-center justify-between gap-3 rounded-xl border border-[#B08D5744] bg-[#B08D5714] px-4 py-3">
            <div className="flex items-center gap-3">
              {frdic.connected
                ? <CircleCheck size={18} className="shrink-0 text-[#5C7A5A]" />
                : <CircleSlash size={18} className="shrink-0 text-[#B08D57]" />}
              <div>
                <p className="text-sm font-medium text-[#262220]">{frdic.name}</p>
                <p className="text-xs text-[#7a5f30]">
                  {frdic.connected
                    ? `已连接 · ${frdic.mode === "two-way" ? "双向同步" : "仅上传"}`
                    : "未连接——连接账号，同步生词本"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {frdic.connected ? (
                <>
                  <button
                    onClick={() => { setFrdicEditing(true); setModeInput(frdic.mode); setTokenInput(""); setConnectError(null); setShowFrdicModal(true); }}
                    className="rounded-lg border border-[#B08D5744] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#7a5f30] transition hover:bg-white disabled:opacity-50"
                  >
                    设置
                  </button>
                  <button
                    onClick={() => { setFrdicEditing(false); frdic.onDisconnect(); }}
                    className="text-xs font-medium text-[#B5432E] transition hover:underline"
                  >
                    取消连接
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setFrdicEditing(false); setModeInput(frdic.mode); setConnectError(null); setShowFrdicModal(true); }}
                  className="rounded-lg bg-[#B08D57] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#9c7a44]"
                >
                  连接账号
                </button>
              )}
            </div>
          </div>)}
        </div>
      </div>

      {showFrdicModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFrdicModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-[#F4EEE0] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="cj-display text-xl text-[#262220]">{frdicEditing ? `${frdic.name} 设置` : `连接 ${frdic.name} 账号`}</h3>
              <button onClick={() => setShowFrdicModal(false)} className="text-[#4a453f] transition hover:text-[#262220]"><X size={18} /></button>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-[#6b665e]">
              {frdicEditing ? (
                <>修改同步模式，或粘贴新的令牌以切换账号。</>
              ) : (
                 <>
                  登录 {frdic.name} 后，进入{" "}
                  <a href={frdic.authUrl} target="_blank" rel="noreferrer" className="text-[#B08D57] underline">
                    获取授权页面
                  </a>
                  {" "}，点击获取授权并复制授权信息中的字符（NIS 令牌），粘贴到下方。
                </>
              )}
            </p>
              <label className="mb-1 block text-xs font-medium text-[#6b665e]">{frdic.name} API 令牌{frdicEditing && "（可选）"}</label>
            <div className={`mb-4 flex items-center gap-2 rounded-lg border border-[#26222022] bg-white px-3 py-2 ${frdicEditing ? "mb-1" : ""}`}>
              <input
                type={showToken ? "text" : "password"}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="NIS xxxx…"
                className="w-full bg-transparent text-sm text-[#262220] outline-none placeholder:text-[#26222055]"
              />
              <button onClick={() => setShowToken((s) => !s)} className="shrink-0 whitespace-nowrap text-xs text-[#6b665e] transition hover:text-[#262220]">
                {showToken ? "隐藏" : "显示"}
              </button>
            </div>
            {frdicEditing && <p className="mb-3 text-xs text-[#6b665e]">留空保留当前账号。</p>}
            <p className="mb-1 block text-xs font-medium text-[#6b665e]">同步模式</p>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setModeInput("push")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${modeInput === "push" ? "border-[#B08D57] bg-[#B08D5714] text-[#7a5f30]" : "border-[#26222022] text-[#6b665e] hover:text-[#262220]"}`}
              >
                 仅上传<br /><span className="font-normal opacity-70">Cinq jours → {frdic.name}</span>
              </button>
              <button
                onClick={() => setModeInput("two-way")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${modeInput === "two-way" ? "border-[#B08D57] bg-[#B08D5714] text-[#7a5f30]" : "border-[#26222022] text-[#6b665e] hover:text-[#262220]"}`}
              >
                 双向同步<br /><span className="font-normal opacity-70">Cinq jours ↔ {frdic.name}</span>
              </button>
            </div>
            {connectError && <p className="mb-3 text-xs text-[#B5432E]">{connectError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowFrdicModal(false)} className="rounded-lg px-3 py-2 text-xs font-medium text-[#6b665e] transition hover:text-[#262220]">取消</button>
              <button
                onClick={async () => {
                  const t = tokenInput.trim();
                  if (!t && !frdicEditing) { setConnectError("请先粘贴令牌。"); return; }
                  setConnectError(null);
                  const r = frdicEditing ? await frdic.onSave(t, modeInput) : await frdic.onConnect(t, modeInput);
                  if (r.ok) { setShowFrdicModal(false); setTokenInput(""); setFrdicEditing(false); }
                  else if (r.error) setConnectError(r.error);
                }}
                disabled={frdic.busy}
                className="rounded-lg bg-[#B08D57] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#9c7a44] disabled:opacity-50"
              >
                {frdic.busy ? (frdicEditing ? "保存中…" : "连接中…") : (frdicEditing ? "保存" : "连接")}
              </button>
            </div>
          </div>
        </div>
      )}

      {vocab.length === 0 ? (
        <div className="rounded-lg border border-[#B08D5744] bg-[#B08D5714] px-4 py-3 text-left text-sm text-[#7a5f30]">
          
          {t("v128", "Rien pour l'instant. Cliquez un mot ou surlignez une expression dans la source, ou enregistrez une correction, pour l'ajouter ici.")}
        </div>
      ) : (
        sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.key}>
              <p className="cj-mono mb-3 text-[10px] uppercase tracking-wider text-[#B08D57]">
                {section.title} · {section.items.length}
              </p>
              {flashcardMode && section.key !== "correction" ? (
                <div className={`${size === "sm" ? "columns-1 sm:columns-5" : size === "md" ? "columns-1 sm:columns-3" : "columns-1 sm:columns-2"} gap-3`} style={{ perspective: "800px" }}>
                  {section.items.map(({ v, idx }) => (
                    <Flashcard
                      key={idx}
                      idx={idx}
                      flipped={flipped}
                      setFlipped={setFlipped}
                      front={<p className={`cj-display ${sizeConf.word} text-[#262220] text-center`}>{v.word}</p>}
                      back={<p className={`${sizeConf.def} text-[#262220] text-center leading-relaxed`}>{v.translation || v.def || (section.key === "phrase" ? t("v20", "Traduction indisponible — réessayez.") : t("v0", "Explication indisponible — réessayez."))}</p>}
                      frontBg="#FFFFFF"
                      backBg="#F7F3E8"
                      pad={sizeConf.pad}
                      flashcardMode={flashcardMode}
                    />
                  ))}
                </div>
              ) : (
                <div className={`${size === "sm" ? "columns-1 sm:columns-5" : size === "md" ? "columns-1 sm:columns-3" : "columns-1 sm:columns-2"} gap-3`}>
                  {section.items.map(({ v, idx }) => {
                    const note = notes[v.word.toLowerCase()];
                    return (
                      <div key={idx} style={{ backgroundColor: "#FFFFFF" }} className={`group break-inside-avoid mb-3 rounded-lg border border-[#26222014] shadow-sm ${sizeConf.pad}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className={`cj-display ${sizeConf.word} text-[#262220]`}>{v.word}</p>
                          <button onClick={() => removeVocab(idx)} className="text-[#26222055] opacity-0 transition group-hover:opacity-100 hover:text-[#B5432E]" title={t("v106", "Supprimer")}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {section.key === "phrase" ? (
                          v.translation && <p className={`mt-1 font-medium text-[#B08D57] ${sizeConf.def}`}>{v.translation}</p>
                        ) : (
                          <>
                            {v.translation && <p className={`mt-1 font-medium text-[#B08D57] ${sizeConf.def}`}>{v.translation}</p>}
                            {v.def && !v.def.includes("indisponible") && <p className={`mt-1 leading-relaxed text-[#6b665e] ${sizeConf.def}`}>{v.def}</p>}
                          </>
                        )}
                        {v.context && v.context.trim().toLowerCase() !== v.word.trim().toLowerCase() && (
                          <p className={`mt-1 italic leading-relaxed text-[#26222055] ${sizeConf.def}`}>{extractSentence(v.context, v.word)}</p>
                        )}
                        {note && editingWord !== v.word && (
                          <p className="mt-1.5 rounded bg-[#B08D5714] px-2 py-1 text-xs italic leading-relaxed text-[#7a5f30]">{note}</p>
                        )}
                        {editingWord === v.word ? (
                          <div className="mt-2">
                            <textarea
                              autoFocus
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              rows={2}
                              placeholder={t("v123", "Votre note…")}
                              className="w-full rounded border border-[#B08D5733] bg-white p-2 text-xs text-[#262220] focus:outline-none focus:ring-1 focus:ring-[#B08D57]"
                            />
                            <div className="mt-1 flex justify-end gap-2">
                              <button onClick={() => setEditingWord(null)} className="text-xs text-[#6b665e] hover:text-[#262220]">{t("v215", "Annuler")}</button>
                              <button onClick={() => saveNote(v.word)} className="text-xs font-medium text-[#7a5f30] hover:text-[#262220]">{t("v46", "Enregistrer")}</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingWord(v.word); setNoteText(note || ""); }}
                            className="mt-1.5 flex items-center gap-1 text-[11px] text-[#B08D57] opacity-0 transition group-hover:opacity-100 hover:text-[#7a5f30]"
                          >
                            <PenLine size={11} /> {note ? t("v124", "Modifier la note") : t("v47", "Ajouter une note")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null
        )
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   SIDEBAR TABS
--------------------------------------------------------------- */
function SideTabs({ view, setView }: { view: string | number; setView: (v: string | number) => void }) {
  const items: { id: string | number; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: "source", label: t("v24", "La source"), icon: PlayCircle },
    { id: "resources", label: t("v129", "Bibliothèque"), icon: History },
    ...DAYS.map((d) => ({ id: d.id, label: t("v238", "Day {n}").replace("{n}", String(d.id)), icon: d.icon })),
    { id: "journal", label: t("v229", "Journal"), icon: NotebookPen },
    { id: "carnet", label: t("v19", "Carnet"), icon: BookMarked },
  ];
  return (
    <div className="ml-5 flex shrink-0 flex-row flex-wrap gap-2 pt-2 md:ml-0 md:w-[124px] md:flex-col">
      {items.map((item) => {
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={String(item.id)}
            onClick={() => setView(item.id)}
            className={`cj-tab-ribbon flex h-11 w-11 flex-col items-center justify-center gap-1 transition-all md:h-[68px] md:w-full ${
              active
                ? "bg-[#F4EEE0] text-[#171B22] shadow-lg md:-mr-1 md:w-[140px]"
                : "bg-[#F4EEE01c] text-[#F4EEE0aa] hover:bg-[#F4EEE033]"
            }`}
          >
            <Icon size={16} className={active ? "text-[#B08D57]" : "opacity-80"} />
            <span className="hidden cj-mono text-[10px] font-medium uppercase leading-tight tracking-wide md:block">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------- */
export function CinqJoursApp(props: {
  resources: Record<string, unknown>[];
  setResources: (r: Record<string, unknown>[]) => void;
  lsKey: string;
}) {
  const { resources, setResources, lsKey } = props;
  const lastRes = resources[0];
  const { level } = useSettings();
  const [view, setView] = useState<string | number>("source");
  const boundedViews = view === "resources" || view === 2 || view === "journal" || view === "carnet";
  const [url, setUrl] = useState(() => String(lastRes?.url ?? ""));
  const [videoId, setVideoId] = useState<string | null>(() => (lastRes ? String(lastRes.video_id) : null));
  const [sourceType, setSourceType] = useState<"video" | "text" | null>(() => (lastRes ? (lastRes.type === "text" ? "text" : "video") : null));
  const [videoTitle, setVideoTitle] = useState<string | null>(() => (lastRes?.title ? String(lastRes.title) : null));
  const [transcript, setTranscript] = useState<{ t: string; text: string }[]>(() => {
    const t = lastRes?.transcript as { t: string; text: string }[] | undefined;
    if (Array.isArray(t) && t.length > 0) return t;
    return [];
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [textModeVersion, setTextModeVersion] = useState(0);
  const [videoWidth, setVideoWidth] = useState(100);
  useEffect(() => {
    if (!importError) return;
    const t = setTimeout(() => setImportError(null), 4000);
    return () => clearTimeout(t);
  }, [importError]);
  const [vocab, setVocab] = useState<{ word: string; def: string; context?: string; translation?: string; sourceId?: string; surface?: string; type?: "vocab" | "phrase" | "correction" }[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(lsKey);
      return raw ? (JSON.parse(raw) as { word: string; def: string; context?: string; translation?: string; sourceId?: string; surface?: string; type?: "vocab" | "phrase" | "correction" }[]) : [];
    } catch {
      return [];
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("cj-notes");
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

  const [frdicConnected, setFrdicConnected] = useState(false);
  const [frdicMode, setFrdicMode] = useState<"push" | "two-way">("push");
  const [frdicBusy, setFrdicBusy] = useState(false);
  const frdicConnectedRef = useRef(false);
  useEffect(() => { frdicConnectedRef.current = frdicConnected; }, [frdicConnected]);

  const targetLang = getLangCodes().targetLang;
  const activeDict = dictProviderForTarget(targetLang);
  const activeId = activeDict?.id ?? null;

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (resources.length === 0) return;
    const savedId = readLastSourceId();
    if (savedId) {
      const found = resources.find((r) => String(r.video_id) === savedId);
      if (found) {
        const fid = String(found.video_id);
        if (fid !== videoId) {
          setVideoId(fid);
          setUrl(String(found.url ?? ""));
          setVideoTitle(found.title ? String(found.title) : null);
          setSourceType(found.type === "text" ? "text" : "video");
          const t = found.transcript as { t: string; text: string }[] | undefined;
          if (Array.isArray(t) && t.length > 0) setTranscript(t);
          else setTranscript([]);
        }
        hasRestoredRef.current = true;
        return;
      }
    }
    if (!videoId && resources[0]) {
      const f = resources[0] as Record<string, unknown>;
      const fid = String((f as { video_id: unknown }).video_id);
      setVideoId(fid);
      setUrl(String(f.url ?? ""));
      setVideoTitle(f.title ? String(f.title) : null);
      setSourceType((f as { type: unknown }).type === "text" ? "text" : "video");
      const t = f.transcript as { t: string; text: string }[] | undefined;
      if (Array.isArray(t) && t.length > 0) setTranscript(t);
    }
    hasRestoredRef.current = true;
  }, [resources]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasRestoredRef.current && !videoId) return;
    if (videoId) rememberSourceId(videoId);
    else {
      try { window.localStorage.removeItem(LS_LAST_SOURCE); } catch { /* ignore */ }
    }
  }, [videoId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(lsKey, JSON.stringify(vocab));
    } catch {
      // ignore
    }
  }, [vocab, lsKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem("cj-notes", JSON.stringify(notes));
    } catch {
      // ignore
    }
  }, [notes]);

  useEffect(() => {
    if (!activeId) {
      setFrdicConnected(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/frdic/connect?provider=${activeId}`);
        if (res.ok) {
          const d = await res.json();
          if (!cancelled) {
            setFrdicConnected(Boolean(d.connected));
            if (d.mode === "push" || d.mode === "two-way") setFrdicMode(d.mode);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const setNote = (word: string, note: string) => {
    setNotes((n) => {
      const next = { ...n };
      const key = word.toLowerCase();
      if (note.trim()) next[key] = note.trim();
      else delete next[key];
      return next;
    });
    if (vocab.some((v) => v.word.toLowerCase() === word.toLowerCase())) {
      if (note.trim()) pushNoteToFrdic(word, note);
      else deleteNoteFromFrdic(word);
    }
  };

  const pushNoteToFrdic = async (word: string, note: string) => {
    if (!frdicConnectedRef.current || !activeId) return;
    try {
      await fetch(`/api/frdic/notes?provider=${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, note }),
      });
    } catch {
      // silencieux
    }
  };

  const deleteNoteFromFrdic = async (word: string) => {
    if (!frdicConnectedRef.current || !activeId) return;
    try {
      await fetch(`/api/frdic/notes?provider=${activeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
      });
    } catch {
      // silencieux
    }
  };

  const addVocab = (entry: { word: string; def: string; context?: string; translation?: string; sourceId?: string; surface?: string; type?: "vocab" | "phrase" | "correction" }) => {
    setVocab((v) => [entry, ...v].filter((e, i, a) => a.findIndex((e2) => e2.word === e.word) === i));
    if (entry.type !== "correction") {
      pushToFrdic(entry.word, entry.context);
    }
  };
  const removeVocab = (i: number) => {
    const entry = vocab[i];
    setVocab((v) => v.filter((_, idx) => idx !== i));
    if (entry) deleteWordFromFrdic(entry.word);
  };
  const removeVocabByWord = (word: string) => {
    const idx = vocab.findIndex((v) => v.word.toLowerCase() === word.toLowerCase());
    if (idx !== -1) removeVocab(idx);
  };

  const deleteWordFromFrdic = async (word: string) => {
    if (!frdicConnectedRef.current || !activeId) return;
    try {
      await fetch(`/api/frdic?provider=${activeId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
      });
    } catch {
      // silencieux
    }
  };

  const pushToFrdic = async (word: string, context?: string) => {
    if (!frdicConnectedRef.current || !activeId) return;
    try {
      await fetch(`/api/frdic?provider=${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, context }),
      });
    } catch {
      // silencieux : le carnet local reste la source de vérité
    }
  };

  const pushAllToFrdic = async () => {
    if (!activeId) return;
    for (const v of vocab) {
      if (v.type === "correction") continue;
      await pushToFrdic(v.word, v.context);
    }
    for (const [word, note] of Object.entries(notes)) {
      if (!word || !note) continue;
      try {
        await fetch(`/api/frdic/notes?provider=${activeId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, note }),
        });
      } catch {
        // silencieux : le carnet local reste la source de vérité
      }
    }
  };

  const frdicSync = async () => {
    if (!activeId) return;
    try {
      await pushAllToFrdic();
      if (frdicMode === "push") {
        setToast(t("v130", "Carnet envoyé au dictionnaire."));
        return;
      }
      const [wRes, nRes] = await Promise.all([
        fetch(`/api/frdic?provider=${activeId}`),
        fetch(`/api/frdic/notes?provider=${activeId}`),
      ]);
      const wData = wRes.ok ? await wRes.json() : { words: [] };
      const nData = nRes.ok ? await nRes.json() : { notes: [] };
      const words = Array.isArray(wData.words) ? wData.words : [];
      const notesArr = Array.isArray(nData.notes) ? nData.notes : [];
      setVocab((prev) => {
        const existingKeys = new Set(prev.map((v) => v.word.toLowerCase()));
        const additions: { word: string; def: string; translation: string; context: string; type: "vocab" }[] = [];
        const updates = new Map<string, string>();
        for (const w of words) {
          const key = String(w?.word || "").toLowerCase();
          if (!key) continue;
          if (!existingKeys.has(key)) additions.push({ word: String(w.word), def: String(w.exp || ""), translation: "", context: "", type: "vocab" });
          else if (w?.exp) updates.set(key, String(w.exp));
        }
        let next = prev;
        if (updates.size) next = next.map((v) => (updates.has(v.word.toLowerCase()) && !v.def ? { ...v, def: updates.get(v.word.toLowerCase())! } : v));
        return [...next, ...additions];
      });
      setNotes((prev) => {
        const next = { ...prev };
        for (const n of notesArr) {
          const key = String(n?.word || "").toLowerCase();
          const val = String(n?.note || "").trim();
          if (key && val && !next[key]) next[key] = val;
        }
        return next;
      });
      setToast(t("v131", "Synchronisation terminée."));
    } catch {
      setToast(t("v132", "Échec de la synchronisation."));
    }
  };

  const frdicConnect = async (token: string, mode: "push" | "two-way"): Promise<{ ok: boolean; error?: string }> => {
    const provider = activeId ?? "frdic";
    const language = activeDict?.language ?? "fr";
    setFrdicBusy(true);
    try {
      const res = await fetch(`/api/frdic/connect?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mode, language, category: "0" }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || d.error) {
        setFrdicBusy(false);
        const msg = d.error || t("v133", "Échec de la connexion.");
        setToast(msg);
        return { ok: false, error: msg };
      }
      setFrdicConnected(true);
      setFrdicMode(mode);
      setFrdicBusy(false);
      setToast(t("v134", "Compte connecté."));
      if (mode === "two-way") await frdicSync();
      return { ok: true };
    } catch {
      setFrdicBusy(false);
      setToast(t("v135", "Erreur réseau."));
      return { ok: false, error: t("v135", "Erreur réseau.") };
    }
  };

  const frdicSave = async (token: string, mode: "push" | "two-way"): Promise<{ ok: boolean; error?: string }> => {
    const provider = activeId ?? "frdic";
    const language = activeDict?.language ?? "fr";
    setFrdicBusy(true);
    try {
      const res = await fetch(`/api/frdic/connect?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mode, language, category: "0" }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || d.error) {
        setFrdicBusy(false);
        const msg = d.error || t("v136", "Échec de l'enregistrement.");
        setToast(msg);
        return { ok: false, error: msg };
      }
      setFrdicConnected(true);
      setFrdicMode(mode);
      setFrdicBusy(false);
      setToast(t("v137", "Paramètres enregistrés."));
      if (mode === "two-way") await frdicSync();
      return { ok: true };
    } catch {
      setFrdicBusy(false);
      setToast(t("v135", "Erreur réseau."));
      return { ok: false, error: t("v135", "Erreur réseau.") };
    }
  };

  const frdicDisconnect = async () => {
    try {
      await fetch(`/api/frdic/connect?provider=${activeId ?? "frdic"}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    setFrdicConnected(false);
    setFrdicMode("push");
    setToast(t("v138", "Déconnecté."));
  };

  const sourceText = useMemo(() => transcript.map((l) => l.text).join(" "), [transcript]);
  const savedWords = useMemo(() => {
    const s = new Set<string>();
    for (const v of vocab) {
      s.add(v.word.toLowerCase());
      if (v.surface) s.add(v.surface.toLowerCase());
    }
    return s;
  }, [vocab]);
  const savedSentences = useMemo(() => vocab.filter((v) => v.word.split(/\s+/).length > 1).map((v) => v.word.toLowerCase()), [vocab]);
  const savedCorrections = useMemo(() => new Set(vocab.filter((v) => v.type === "correction").map((v) => v.word.toLowerCase())), [vocab]);
  const carnetSidebarCount = useMemo(
    () => vocab.filter((v) => v.type !== "correction" && (videoId ? v.sourceId === videoId : false)).length,
    [vocab, videoId]
  );

  const handlePasteTranscript = (raw: string) => {
    const lines = raw.split("\n").filter((l) => l.trim());
    const result: { t: string; text: string }[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const tsMatch = line.match(/^(\d{1,2}:\d{2})\s+(.+)/);
      const bracketMatch = line.match(/^\[(\d{1,2}:\d{2})\]\s*(.*)/);
      if (tsMatch) {
        result.push({ t: tsMatch[1], text: tsMatch[2] });
        i++;
      } else if (bracketMatch) {
        result.push({ t: bracketMatch[1], text: bracketMatch[2] });
        i++;
      } else {
        const justTs = line.match(/^(\d{1,2}:\d{2})$/);
        if (justTs && i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].trim().match(/^\d{1,2}:\d{2}$/)) {
          result.push({ t: justTs[1], text: lines[i + 1].trim() });
          i += 2;
          continue;
        }
        result.push({ t: "", text: line });
        i++;
      }
    }
    const filtered = result.filter((l) => l.text.length > 0);
    if (filtered.length > 0) {
      setTranscript(filtered);
      if (videoId) saveTranscript(videoId, filtered);
    }
  };

  const saveTranscript = (vid: string, t: { t: string; text: string }[]) => {
    const idx = resources.findIndex((r) => r.video_id === vid);
    if (idx === -1) {
      const meta = { video_id: vid, url: url || "", title: videoTitle || vid, transcript: t, type: "video" as const, date: new Date().toISOString(), key: `${vid}-${Date.now()}` };
      setResources([meta, ...resources]);
      return;
    }
    const next = [...resources];
    next[idx] = { ...next[idx], transcript: t };
    setResources(next);
  };

  const onTranscriptChange = (segments: { t: string; text: string }[]) => {
    setTranscript(segments);
    if (sourceType === "text") {
      const id = videoId && String(videoId).startsWith("text-") ? videoId : `text-${Date.now()}`;
      if (!videoId || !String(videoId).startsWith("text-")) setVideoId(id);
      const firstLine = firstSentence(segments.map((l) => l.text).join(" ").trim() || t("v146","Texte"));
      const exists = resources.find((r) => r.video_id === id);
      if (exists) {
        setResources(resources.map((r) => (r.video_id === id ? { ...r, transcript: segments, title: r.title || firstLine } : r)));
      } else {
        const meta = { video_id: id, url: "", title: firstLine, transcript: segments, type: "text", date: new Date().toISOString(), key: `${id}-${Date.now()}` };
        setResources([meta, ...resources]);
      }
    } else if (videoId) {
      saveTranscript(videoId, segments);
    }
  };

  const fetchTitleClient = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        return data.title || null;
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleImport = async (sourceUrl: string) => {
    const id = extractYouTubeId(sourceUrl);
    if (videoId) saveDayState(videoId);
    if (id) {
      setVideoId(id);
    }
    setSourceType("video");
    setImporting(true);
    setImportError(null);
    setTranscript([]);
    setVideoTitle(null);
    clearDayState();
    try {
      const clientTitleP = fetchTitleClient(sourceUrl);

      let transcriptToSave: { t: string; text: string }[] | null = null;
      let apiTitle: string | null = null;
      let apiVideoId: string | null = null;

      // 1) Try client-side first (browser = residential IP, avoids datacenter blocks)
      if (id) {
        try {
          const clientRes = await fetchTranscriptClient(id);
          if (clientRes.transcript.length > 0) {
            transcriptToSave = clientRes.transcript;
            apiTitle = clientRes.title;
          }
        } catch {
          // client-side failed, fall through to server
        }
      }

      // 2) Server fallback (if client-side didn't yield a transcript)
      if (!transcriptToSave) {
        try {
          const apiRes = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: sourceUrl, target: getLangCodes().targetLang }),
          });
          const data = await apiRes.json();
          if (data.videoId) apiVideoId = data.videoId;
          if (data.title) apiTitle = data.title;
          if (Array.isArray(data.transcript) && data.transcript.length) {
            transcriptToSave = data.transcript;
          } else if (data.error && !transcriptToSave) {
            setImportError(data.error);
          }
        } catch {
          setImportError(t("v139", "Impossible de joindre le serveur."));
        }
      }

      const clientTitle = await clientTitleP;
      const title = apiTitle || clientTitle || null;
      const vid = apiVideoId || id;
      if (vid) setVideoId(vid);
      if (title) setVideoTitle(title);

      if (transcriptToSave) {
        setTranscript(transcriptToSave);
        setImportError(null);
      }

      if (vid) {
        const metaBase = {
          video_id: vid,
          url: sourceUrl,
          title,
          date: new Date().toISOString(),
          key: `${vid}-${Date.now()}`,
        };
        const existing = resources.find((r) => r.video_id === vid);
        if (transcriptToSave) {
          if (existing) {
            setResources([{ ...existing, transcript: transcriptToSave, title: existing.title || metaBase.title }, ...resources.filter((r) => r.video_id !== vid)]);
          } else {
            setResources([{ ...metaBase, transcript: transcriptToSave, type: "video" }, ...resources]);
          }
        } else {
          if (existing) setResources([existing, ...resources.filter((r) => r.video_id !== vid)]);
          else setResources([{ ...metaBase, type: "video" }, ...resources]);
        }
      }
    } catch {
      setImportError(t("v139", "Impossible de joindre le serveur."));
    } finally {
      setImporting(false);
    }
  };

  const DAY_STATE_KEYS = [
    "cj-correction-audio-v2", "cj-correction-day5",
    "cj-correction-summary", "cj-correction-writing",
    "cj-text-summary", "cj-text-writing",
    "cj-jour3-v2", "cj-topic-writing", "cj-topic-speaking",
  ];

  const saveDayState = (sourceId: string) => {
    try {
      const snapshot: Record<string, string | null> = {};
      for (const k of DAY_STATE_KEYS) snapshot[k] = window.localStorage.getItem(k);
      window.localStorage.setItem(`cj-daystate-${sourceId}`, JSON.stringify(snapshot));
    } catch { /* ignore */ }
  };

  const restoreDayState = (sourceId: string) => {
    try {
      const raw = window.localStorage.getItem(`cj-daystate-${sourceId}`);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as Record<string, string | null>;
      for (const k of DAY_STATE_KEYS) {
        if (snapshot[k] !== null) window.localStorage.setItem(k, snapshot[k]!);
        else window.localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  };

  const clearDayState = () => {
    try { DAY_STATE_KEYS.forEach((k) => window.localStorage.removeItem(k)); } catch { /* ignore */ }
  };

  const openResource = (resourceVideoId: string, sourceUrl: string) => {
    if (videoId) saveDayState(videoId);
    setUrl(sourceUrl);
    setVideoId(resourceVideoId);
    const found = resources.find((r) => r.video_id === resourceVideoId);
    setSourceType(found?.type === "text" ? "text" : "video");
    const existingTitle = found?.title ? String(found.title) : "";
    setVideoTitle(existingTitle);
    const saved = found?.transcript as { t: string; text: string }[] | undefined;
    if (Array.isArray(saved) && saved.length > 0) {
      setTranscript(saved);
      setImportError(null);
    } else {
      setTranscript([]);
    }
    restoreDayState(resourceVideoId);
    setView("source");
    if (!existingTitle && resourceVideoId && !String(resourceVideoId).startsWith("text-") && sourceUrl) {
      fetchTitleClient(sourceUrl).then((t) => {
        if (t) {
          setVideoTitle(t);
          setResources(resources.map((r) => r.video_id === resourceVideoId ? { ...r, title: t } : r));
        }
      });
    }
  };

  const removeResource = (key: string) => {
    const target = resources.find((r) => String(r.key) === key);
    setResources(resources.filter((r) => String(r.key) !== key));
    if (target) {
      try { window.localStorage.removeItem(`cj-daystate-${target.video_id}`); } catch { /* ignore */ }
    }
    if (target && target.video_id === videoId) {
      setTranscript([]);
      setVideoId(null);
      setSourceType(null);
      setVideoTitle(null);
      setUrl("");
      clearDayState();
    }
  };

  const isNumber = (v: string | number): v is number => typeof v === "number";
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="cj-root min-h-screen w-full bg-[#171B22]">
      <FontImport />
      <header className="flex items-center justify-between px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Logo size={44} className="shrink-0" />
          <div className="flex flex-col leading-none">
            <h1 className="cj-formal text-2xl text-[#F4EEE0]">Cinq jours</h1>
            <span className="cj-mono mt-1 hidden text-[11px] uppercase tracking-wider text-[#F4EEE066] sm:inline">
              {t("v140", "A five-day language learning routine")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 rounded-full border border-[#F4EEE022] px-3.5 py-1.5 text-sm text-[#F4EEE0dd] transition hover:bg-[#F4EEE011]"
          >
            <BookMarked size={15} />
            <span className="hidden sm:inline">{t("v19", "Carnet")}</span>
            {carnetSidebarCount > 0 && (
              <span className="cj-mono rounded-full bg-[#B08D57] px-1.5 py-0.5 text-[10px] text-[#171B22]">{carnetSidebarCount}</span>
            )}
          </button>
          <LanguageSwitcher />
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label={t("settings.title", "Paramètres")}
            className="flex items-center gap-2 rounded-full border border-[#F4EEE022] px-3 py-1.5 text-sm text-[#F4EEE0dd] transition hover:bg-[#F4EEE011]"
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-0 px-3 pb-10 md:flex-row md:gap-2 md:px-6">
        <SideTabs view={view} setView={setView} />
          <main className={`flex min-w-0 flex-1 flex-col rounded-2xl bg-[#F4EEE0] p-5 shadow-2xl md:p-9 ${boundedViews ? "max-h-[calc(500vh-9rem)] min-h-[780px]" : "min-h-[780px]"}`}>
          <div className={`flex-1 min-h-0 pb-6 ${boundedViews ? "overflow-y-auto cj-scrollbar" : ""}`}>
          {view === "source" && (
            <SourceView
              url={url}
              setUrl={setUrl}
              videoId={videoId}
              setVideoId={setVideoId}
              title={videoTitle}
              transcript={transcript}
              onTranscriptChange={onTranscriptChange}
              importing={importing}
              importError={importError}
              vocabCount={carnetSidebarCount}
              addVocab={addVocab}
              onImport={handleImport}
              onPasteTranscript={handlePasteTranscript}
              notes={notes}
              setNote={setNote}
              savedWords={savedWords}
              savedSentences={savedSentences}
              removeVocabByWord={removeVocabByWord}
              isTextSource={sourceType === "text"}
              textModeVersion={textModeVersion}
              videoWidth={videoWidth}
              setVideoWidth={setVideoWidth}
              level={level}
              onStartReadingMode={() => {
                if (videoId) saveDayState(videoId);
                setVideoId(null);
                setVideoTitle(null);
                setTranscript([]);
                setUrl("");
                setSourceType("text");
                setImportError(null);
                clearDayState();
                setTextModeVersion((n) => n + 1);
                setVideoWidth(100);
              }}
            />
          )}
          {view === "resources" && <ResourcesView resources={resources} onSelect={openResource} onDelete={removeResource} />}
          {(() => {
            const langKey = `${getLangCodes().targetLang}-${getLangCodes().translationLang}-${getUiLocale()}`;
            return (
              <>
                {view === 1 && <DayOne key={langKey} sourceText={sourceText} addVocab={addVocab} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />}
                {view === 4 && <DayFour key={langKey} sourceText={sourceText} sourceTitle={videoTitle} addVocab={addVocab} level={level} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />}
                {view === "journal" && <JournalView key={langKey} sourceText={sourceText} sourceTitle={videoTitle} addVocab={addVocab} level={level} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />}
              </>
            );
          })()}
          {view === 2 && <DayTwo transcript={transcript} videoId={videoId} isTextSource={sourceType === "text"} />}
          {view === 3 && <DayThree vocab={vocab} sourceText={sourceText} addVocab={addVocab} currentSourceId={videoId} level={level} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />}
          {view === 5 && <DayFive sourceText={sourceText} sourceTitle={videoTitle} addVocab={addVocab} level={level} savedCorrections={savedCorrections} removeVocabByWord={removeVocabByWord} />}
          {view === "carnet" && <CarnetView vocab={vocab} notes={notes} setNote={setNote} removeVocab={removeVocab} frdic={{ connected: frdicConnected, mode: frdicMode, busy: frdicBusy, enabled: !!activeDict, name: activeDict?.name ?? "", authUrl: activeDict?.authUrl ?? "", onConnect: frdicConnect, onSave: frdicSave, onDisconnect: frdicDisconnect, onSync: frdicSync }} />}
          </div>

          {view !== "resources" && view !== "journal" && view !== "carnet" && (
            <div className="mt-auto flex items-center justify-end border-t border-[#26222014] pt-5">
              <button
                onClick={() => setView(isNumber(view) && view === 5 ? "source" : isNumber(view) ? Math.min(5, view + 1) : 1)}
                className="flex items-center gap-1 text-sm text-[#6b665e] hover:text-[#262220]"
              >
                {isNumber(view) && view === 5
                  ? t("v143", "Retour à la source")
                  : !isNumber(view)
                    ? t("v144", "Commencer Jour 1")
                    : t("v228", "Commencer Jour {n}").replace("{n}", String(view + 1))}
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </main>
      </div>

      <VocabDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} vocab={vocab} currentSourceId={videoId} removeVocab={removeVocab} notes={notes} setNote={setNote} frdicConnected={frdicConnected} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#5C7A5A] px-4 py-1.5 text-xs font-medium text-white shadow-lg cj-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}