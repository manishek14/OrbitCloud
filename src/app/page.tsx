"use client";

// AbrIT — home route. Every real route renders the same <AppRoot/> shell;
// the shell resolves the view from the actual URL path.

import { AppRoot } from "@/components/app-root";

export default function Page() {
  return <AppRoot route="/" />;
}
