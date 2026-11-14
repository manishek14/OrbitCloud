"use client";

// Shared client root rendered by EVERY real route page (src/app/**/page.tsx).
// Pages pass their concrete path so SSR and hydration agree (no flash), and
// the AppShell resolves the actual view from the router.

import { RouterProvider } from "@/lib/router";
import { AppShell } from "@/components/app-shell";

export function AppRoot({ route }: { route: string }) {
  return (
    <RouterProvider initialPath={route}>
      <AppShell />
    </RouterProvider>
  );
}
