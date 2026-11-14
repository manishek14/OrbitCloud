// GET /api/commerce/catalog — the authoritative commercial catalog.
//
// The frontend NEVER embeds commercial values (fixes COM-12: the Orchard
// repository duplicated prices in 9+ places). The catalog is served from the
// server so every consumer (plan cards, comparison table, contract selector,
// Drive quota mapping) reads the same data.

import { NextResponse } from "next/server";
import {
  readCommercialCatalog,
  QUOTE_LIMITS,
  COMMERCE_POLICY_FA,
} from "@/lib/commerce/catalog";
import { handleRouteError } from "@/lib/api/http";

export async function GET() {
  try {
    const catalog = await readCommercialCatalog();
    return NextResponse.json(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        packages: catalog.packages.filter((p) => p.active),
        contracts: catalog.contracts.filter((c) => c.active),
        limits: QUOTE_LIMITS,
        policy: {
          ...COMMERCE_POLICY_FA,
          allowedMonths: catalog.contracts.filter((c) => c.active).map((c) => c.months),
          minimumMonths: Math.min(...catalog.contracts.filter((c) => c.active).map((c) => c.months)),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error, "commerce/catalog");
  }
}
