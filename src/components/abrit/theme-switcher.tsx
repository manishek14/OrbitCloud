"use client";

// Theme switcher: dark (default) / light / system — persisted by next-themes.
// Applies a brief .theme-anim class so colors transition smoothly instead of
// flashing (and instantly for prefers-reduced-motion users via CSS).
//
// The trigger icon is static (SunMoon) so hydration never depends on the
// resolved theme; menu items read the theme only after user interaction.

import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "dark", label: "تاریک", icon: Moon },
  { value: "light", label: "روشن", icon: Sun },
  { value: "system", label: "سیستم", icon: Monitor },
] as const;

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const applyWithTransition = (next: string) => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      root.classList.add("theme-anim");
      window.setTimeout(() => root.classList.remove("theme-anim"), 340);
    }
    setTheme(next);
  };

  const current = theme ?? "dark";

  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("rounded-lg", className)} aria-label="تغییر پوسته">
          <SunMoonIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => applyWithTransition(option.value)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <option.icon className="size-4" />
              {option.label}
            </span>
            {current === option.value ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Static trigger icon — renders identically on server and client. */
function SunMoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
      <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 2.83 2.83 0 0 0 4-4Z" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </svg>
  );
}
