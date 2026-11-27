"use client";

// Path-based SPA router on the History API.
//
// Every real URL is served by a dedicated Next.js page (src/app/**/page.tsx)
// that renders the shared <AppRoot/> shell. Client-side navigation happens
// without a server round-trip (history.pushState + a custom event), keeping
// the smooth in-app page transitions, while the browser URL is always a real
// path (e.g. /portal/orders) — not a hash alias.
//
// Server-owned routes (the real Orchard Core administration behind the
// reverse proxy: /admin, its static assets and Orchard identity pages) get a
// full document navigation instead of a pushState, so they are served by
// Orchard itself.
//
// Legacy #/... hash URLs from the previous build are migrated transparently
// on first load.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";

export interface RouteLocation {
  /** Normalized path, always starts with "/". */
  path: string;
  /** Query params parsed from the query string. */
  query: Record<string, string>;
  /** Raw path + query (without host). */
  raw: string;
}

export interface RouterApi extends RouteLocation {
  navigate: (to: string, options?: { replace?: boolean; keepScroll?: boolean }) => void;
  replace: (to: string, options?: { keepScroll?: boolean }) => void;
  back: () => void;
  /** Builds an href for <a href> usage (real path; server routes included). */
  href: (to: string) => string;
}

const FALLBACK: RouteLocation = { path: "/", query: {}, raw: "/" };

const NAVIGATE_EVENT = "orbit:navigate";

/**
 * Routes owned by the server — the real Orchard Core application behind the
// reverse proxy. These must produce full document navigations (never
 * pushState) so Orchard serves them.
 */
export function isServerRoute(to: string): boolean {
  return /^\/(admin|_content|media|login|logoff|register|changepassword|forgotpassword|resetpassword)(\/|$)/i.test(
    to,
  );
}

function parseLocation(): RouteLocation {
  if (typeof window === "undefined") return FALLBACK;
  const raw = window.location.pathname + window.location.search || "/";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.length > 1 ? pathPart.replace(/\/+$/, "") : pathPart || "/";
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      if (!pair) continue;
      const [key, value = ""] = pair.split("=");
      try {
        query[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        query[key] = value;
      }
    }
  }
  return { path: path || "/", query, raw };
}

export function RouterProvider({
  children,
  initialPath = "/",
}: {
  children: ReactNode;
  /** Concrete path of the page rendering this provider (SSR-consistent, no flash). */
  initialPath?: string;
}) {
  const [location, setLocation] = useState<RouteLocation>(() => ({
    path: initialPath,
    query: {},
    raw: initialPath,
  }));

  useEffect(() => {
    const sync = () => setLocation(parseLocation());

    // Migrate legacy hash URLs (e.g. #/portal/orders → /portal/orders).
    const hash = window.location.hash;
    if (hash.startsWith("#/")) {
      const target = hash.slice(1);
      if (isServerRoute(target)) {
        window.location.replace(target);
        return;
      }
      window.history.replaceState(null, "", target);
    }

    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean; keepScroll?: boolean }) => {
    let target = to.startsWith("/") ? to : "/" + to;
    if (typeof window === "undefined") return;

    if (isServerRoute(target)) {
      // Full document navigation so the reverse proxy serves Orchard Core.
      if (options?.replace) window.location.replace(target);
      else window.location.assign(target);
      return;
    }

    const current = window.location.pathname + window.location.search;
    const [pathPart, queryPart] = target.split("?");
    const normalizedPath = pathPart.length > 1 ? pathPart.replace(/\/+$/, "") : pathPart || "/";
    const normalized = queryPart !== undefined ? `${normalizedPath}?${queryPart}` : normalizedPath;

    if (current === normalized) {
      if (!options?.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (options?.replace) {
      window.history.replaceState(null, "", normalized);
    } else {
      window.history.pushState(null, "", normalized);
    }
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
    if (!options?.keepScroll) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    }
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  const replace = useCallback(
    (to: string, options?: { keepScroll?: boolean }) => {
      navigate(to, { ...options, replace: true });
    },
    [navigate],
  );

  const href = useCallback((to: string) => (to.startsWith("/") ? to : "/" + to), []);

  const api = useMemo<RouterApi>(
    () => ({ ...location, navigate, replace, back, href }),
    [location, navigate, replace, back, href],
  );

  return <RouterContext.Provider value={api}>{children}</RouterContext.Provider>;
}

export const RouterContext = createContext<RouterApi | null>(null);

export function useRouter(): RouterApi {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside <RouterProvider>");
  return ctx;
}

/**
 * Anchor for SPA routes (pushState navigation, keeps transitions) and for
 * server routes (real href, full document navigation). Middle/ctrl-click
 * always behaves natively.
 */
export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const { navigate, href } = useRouter();
  return (
    <a
      href={href(to)}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (isServerRoute(to)) return; // let the browser hit the server route
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Returns true when `path` matches the current route (exact or prefix). */
export function useIsActive() {
  const { path } = useRouter();
  return useCallback(
    (target: string, exact = false) => {
      if (exact) return path === target;
      if (target === "/") return path === "/";
      return path === target || path.startsWith(target + "/");
    },
    [path],
  );
}

// ---------------------------------------------------------------------------
// Route matching with :params
// ---------------------------------------------------------------------------

export interface MatchResult {
  params: Record<string, string>;
}

export function matchRoute(path: string, pattern: string): MatchResult | null {
  const pathParts = path.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (pp !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}
