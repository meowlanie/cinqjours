import { NextRequest, NextResponse } from "next/server";
import { DICT_PROVIDERS, isDictProviderId, type DictProvider, type DictProviderId } from "./dictProviders";

export function resolveProvider(req: NextRequest): DictProvider {
  const p = req.nextUrl.searchParams.get("provider");
  if (isDictProviderId(p) && DICT_PROVIDERS[p]) return DICT_PROVIDERS[p];
  return DICT_PROVIDERS.frdic;
}

const cookieNames = (id: DictProviderId) => ({
  token: `${id}_token`,
  category: `${id}_category`,
  mode: `${id}_mode`,
  language: `${id}_language`,
});

export function getToken(req: NextRequest, id: DictProviderId): string | undefined {
  const c = cookieNames(id);
  const v = req.cookies.get(c.token)?.value?.trim();
  if (v) return v;
  const h = req.headers.get(`x-${id}-token`)?.trim();
  return h || undefined;
}

export function getCategory(req: NextRequest, id: DictProviderId, fallback = "0"): string {
  const c = cookieNames(id);
  return req.cookies.get(c.category)?.value?.trim() || req.headers.get(`x-${id}-category`)?.trim() || fallback;
}

export function getLanguage(req: NextRequest, id: DictProviderId, fallback: string): string {
  const c = cookieNames(id);
  return req.cookies.get(c.language)?.value?.trim() || req.headers.get(`x-${id}-language`)?.trim() || fallback;
}

export function getMode(req: NextRequest, id: DictProviderId): "push" | "two-way" {
  const c = cookieNames(id);
  const m = req.cookies.get(c.mode)?.value?.trim();
  return m === "two-way" ? "two-way" : "push";
}

export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `NIS ${token}`,
    "User-Agent": "Mozilla/5.0 (compatible; CinqJours/1.0)",
    "Content-Type": "application/json",
  };
}

export function cleanExp(exp: unknown): string {
  if (typeof exp !== "string") return "";
  return exp.replace(/\s*<[^>]+>\s*/g, " ").replace(/\s+/g, " ").trim();
}

export function cookieOpts(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}

export function setProviderCookies(res: NextResponse, provider: DictProvider, token: string, language: string, mode: string, category: string) {
  const secure = process.env.NODE_ENV === "production";
  const c = cookieNames(provider.id);
  res.cookies.set(c.token, token, cookieOpts(secure));
  res.cookies.set(c.category, category, cookieOpts(secure));
  res.cookies.set(c.language, language, cookieOpts(secure));
  res.cookies.set(c.mode, mode, cookieOpts(secure));
}

export function clearProviderCookies(res: NextResponse, provider: DictProvider) {
  const c = cookieNames(provider.id);
  res.cookies.delete(c.token);
  res.cookies.delete(c.category);
  res.cookies.delete(c.language);
  res.cookies.delete(c.mode);
}
