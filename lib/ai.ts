const DEEPSEEK_BASE = "https://api.deepseek.com";
const MISTRAL_BASE = "https://api.mistral.ai/v1";

export const AI_ENABLED = Boolean(process.env.DEEPSEEK_API_KEY);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms = 50000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── DeepSeek (text features) ────────────────────────────────────────────

async function deepseekGenerate(
  messages: { role: string; content: string }[],
  opts: { temperature?: number; responseFormat?: { type: string }; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY n'est pas configurée (variable d'environnement manquante).");

  let lastErr: (Error & { status?: number }) | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));

    const res = await fetchWithTimeout(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Réponse IA vide ou inattendue.");
      return content;
    }

    const text = await res.text();
    const err = new Error(`Erreur IA (${res.status}): ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    lastErr = err;

    if (res.status !== 429) throw err;
  }

  throw lastErr || new Error("Erreur IA inconnue.");
}

// ── Mistral Voxtral (audio + speaking-practice correction) ───────────────

async function mistralGenerate(body: Record<string, unknown>, modelOverride?: string): Promise<string> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY n'est pas configurée (variable d'environnement manquante).");

  const model = modelOverride || process.env.MISTRAL_MODEL || "voxtral-mini-latest";

  let lastErr: (Error & { status?: number }) | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));

    const res = await fetchWithTimeout(`${MISTRAL_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, ...body }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Réponse IA vide ou inattendue.");
      return content;
    }

    const text = await res.text();
    const err = new Error(`Erreur IA (${res.status}): ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    lastErr = err;

    if (res.status !== 429 && res.status !== 503) throw err;
  }

  throw lastErr || new Error("Erreur IA inconnue.");
}

// ── Public API ──────────────────────────────────────────────────────────

export async function aiChat(messages: ChatMessage[], opts: { maxTokens?: number; responseSchema?: unknown } = {}): Promise<string> {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const sysText = systemMsgs.map((m) => m.content).join("\n\n");

  const dsMessages = [
    ...(sysText ? [{ role: "system", content: sysText }] : []),
    ...nonSystem.map((m) => ({ role: m.role, content: m.content })),
  ];

  const wantsJson = opts.responseSchema != null;

  return deepseekGenerate(dsMessages, {
    temperature: 0.2,
    responseFormat: wantsJson ? { type: "json_object" } : undefined,
    maxTokens: opts.maxTokens,
  });
}

export async function aiTranscribeAudio(dataUrl: string, prompt: string): Promise<string> {
  const meta = dataUrl.match(/^data:audio\/([a-z0-9]+)(?:;codecs=[^;,]*)?;base64,/i);
  if (!meta) throw new Error("Format audio invalide.");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const format =
    meta[1] === "webm" ? "webm" : meta[1] === "mp3" ? "mp3" : meta[1] === "ogg" ? "ogg" : "wav";

  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY n'est pas configurée (variable d'environnement manquante).");

  // 1) Speech-to-text via Mistral's dedicated transcription endpoint
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([Buffer.from(base64, "base64")], { type: `audio/${format}` }),
    `audio.${format}`
  );
  fd.append("model", process.env.MISTRAL_MODEL || "voxtral-mini-latest");
  fd.append("language", "fr");
  fd.append("response_format", "text");

  const transRes = await fetchWithTimeout(`${MISTRAL_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });

  if (!transRes.ok) {
    const text = await transRes.text();
    const err = new Error(
      `Mistral: Erreur transcription (${transRes.status}): ${text.slice(0, 300)}`
    ) as Error & { status?: number };
    err.status = transRes.status;
    throw err;
  }

  let transcript = (await transRes.text()).trim();
  if (transcript.startsWith("{")) {
    try {
      const j = JSON.parse(transcript);
      if (typeof j.text === "string") transcript = j.text.trim();
    } catch {
      /* ignore */
    }
  }
  if (!transcript) return JSON.stringify({ segments: [] });

  // 2) Correction + segmentation via a text chat model
  const correctionPrompt = `${prompt}\n\nTRANSCRIPTION :\n"""${transcript.slice(0, 6000)}"""\n\nRéponds UNIQUEMENT en JSON valide (sans texte autour, sans bloc de code) : {"segments":[...]}`;

  return mistralGenerate(
    {
      messages: [{ role: "user", content: correctionPrompt }],
      temperature: 0.2,
    },
    process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest"
  );
}

export function parseJson(text: string): unknown {
  let cleaned = text.trim();

  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
