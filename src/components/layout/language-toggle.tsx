"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SupportedLocale } from "@/i18n/locales";

const LOCALES: Array<{ id: SupportedLocale; label: string; short: string }> = [
  { id: "en", label: "English", short: "EN" },
  { id: "es", label: "Español", short: "ES" },
  { id: "ko", label: "한국어", short: "KO" },
];

export function LanguageToggle({ className }: { className?: string }) {
  const router = useRouter();
  const locale = useLocale() as SupportedLocale;
  const t = useTranslations("LanguageToggle");
  const active = LOCALES.find((item) => item.id === locale) ?? LOCALES[0];

  async function changeLocale(nextLocale: SupportedLocale) {
    if (nextLocale === locale) return;
    const response = await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: nextLocale }),
    });
    if (!response.ok) return;
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t("current", { language: active.label })}
        title={t("current", { language: active.label })}
        className={cn(
          "flex h-10 items-center justify-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Languages className="h-4 w-4" />
        <span className="text-[11px] font-semibold tracking-wide">{active.short}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {t("label")}
        </div>
        {LOCALES.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => void changeLocale(item.id)}
            className="gap-2"
          >
            <span className="flex-1">{item.label}</span>
            {item.id === locale && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
