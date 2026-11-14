"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Dark is the default experience; light and system remain selectable
          and persist across sessions (next-themes, class strategy, no flash). */}
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem themes={["dark", "light", "system"]}>
        {/* reducedMotion="user": every framer-motion animation is automatically
            reduced to instant state changes when the visitor prefers
            reduced motion (accessibility requirement). */}
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster position="top-center" richColors closeButton dir="rtl" />
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
