import type { LangCode } from "./languages";

export type DictProviderId = "frdic" | "godic" | "eudic";

export interface DictProvider {
  id: DictProviderId;
  /** 中文显示名，例如「法语助手」「德语助手」「欧路词典」。 */
  name: string;
  /** OpenAPI 授权页面。 */
  authUrl: string;
  /** API 根地址，例如 https://api.frdic.com */
  apiBase: string;
  /** 同步接口使用的语言参数（fr / de / en）。 */
  language: string;
  /** 对应的学习目标语言。 */
  targetLang: LangCode;
}

export const DICT_PROVIDERS: Record<DictProviderId, DictProvider> = {
  frdic: {
    id: "frdic",
    name: "法语助手",
    authUrl: "https://my.frdic.com/OpenAPI/Authorization",
    apiBase: "https://api.frdic.com",
    language: "fr",
    targetLang: "fr",
  },
  godic: {
    id: "godic",
    name: "德语助手",
    authUrl: "https://my.godic.net/OpenAPI/Authorization",
    apiBase: "https://api.frdic.com",
    language: "de",
    targetLang: "de",
  },
  eudic: {
    id: "eudic",
    name: "欧路词典",
    authUrl: "https://my.eudic.net/OpenAPI/Authorization",
    apiBase: "https://api.eudic.net",
    language: "en",
    targetLang: "en",
  },
};

export function dictProviderForTarget(target: LangCode): DictProvider | null {
  for (const p of Object.values(DICT_PROVIDERS)) {
    if (p.targetLang === target) return p;
  }
  return null;
}

export function isDictProviderId(x: unknown): x is DictProviderId {
  return x === "frdic" || x === "godic" || x === "eudic";
}
