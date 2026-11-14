"use client";

import { AppRoot } from "@/components/app-root";

// Unknown paths render the public 404 view (the shell falls through to
// NotFoundView for any unmatched route).
export default function NotFound() {
  return <AppRoot route="/__404__" />;
}
