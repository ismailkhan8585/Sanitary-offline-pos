import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type TranslationKey } from './en';
import { ur } from './ur';
import { ApiError } from '@/lib/api';

export type Lang = 'en' | 'ur';
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const LANG_KEY = 'pos.lang';

export function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'ur' ? v : null;
  } catch {
    return null;
  }
}

export function translate(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
  const text: string = (lang === 'ur' ? ur[key] : undefined) ?? en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? '')) : text;
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
  /** Shows an error from the server in plain words, in the selected language. */
  errorText: (err: unknown) => string;
  /** Translated unit name ("coil" → "کوائل"); unknown units are shown as typed. */
  unitLabel: (unit: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => storedLang() ?? 'en');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Language still switches for this visit.
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const t: TFunction = (key, params) => translate(lang, key, params);
    const errorText = (err: unknown) => {
      if (err instanceof ApiError) {
        const key = `err.${err.code}` as TranslationKey;
        const params = Object.fromEntries(Object.entries(err.params).map(([k, v]) => [k, String(v)]));
        return key in en ? t(key, params) : err.message;
      }
      return err instanceof Error ? err.message : String(err);
    };
    const unitLabel = (unit: string) => {
      const key = `unit.${unit}` as TranslationKey;
      return key in en ? t(key) : unit;
    };
    return { lang, setLang, t, errorText, unitLabel };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** Picks the Urdu name in Urdu mode when one exists. */
export function useLocalName() {
  const { lang } = useI18n();
  return (item: { nameEn: string; nameUr?: string | null }) => (lang === 'ur' && item.nameUr ? item.nameUr : item.nameEn);
}
