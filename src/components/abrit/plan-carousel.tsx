"use client";

// پلن‌ها — animated horizontal plan carousel (RTL-first).
//
// Behavior contract (product spec §4):
//   • Autoplay advances ONE card every 5 seconds.
//   • Previous/next controls + pagination indicators.
//   • Autoplay PAUSES while the user hovers, focuses, or interacts (touch /
//     manual navigation) and resumes with a cooldown so cards are never
//     interrupted mid-read.
//   • Native touch/swipe scrolling (CSS scroll-snap — no JS drag hacks).
//   • prefers-reduced-motion: autoplay is disabled and scrolling jumps
//     instantly (no smooth animation).
//   • Fully responsive: 1 card (mobile) → 2 (sm) → 3 (lg); RTL-aware.
//
// The carousel is a presentation layer ONLY: every card value comes from the
// commerce catalog API. All plans also remain reachable in the full grid
// below the carousel (plans view), so nothing is hidden behind the slider.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toFaDigits } from "@/lib/format/fa";

const AUTOPLAY_MS = 5000;
const INTERACTION_COOLDOWN_MS = 12000;

/** Distance from one slide to the next (width + column gap). */
function slideStep(track: HTMLElement): number {
  const first = track.querySelector<HTMLElement>("[data-carousel-slide]");
  if (!first) return 0;
  const gap = parseFloat(getComputedStyle(track).columnGap || "0") || 0;
  return first.getBoundingClientRect().width + gap;
}

// prefers-reduced-motion as an external store (SSR-safe: server snapshot false).
function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function PlanCarousel({
  children,
  ariaLabel,
  className,
}: {
  /** One child per slide — rendered in order inside the snap track. */
  children: ReactNode[];
  ariaLabel: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  // Autoplay is disabled entirely under prefers-reduced-motion.
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  // Autoplay keeps running unless paused; `cooldownUntil` implements the
  // "don't interrupt the reader" rule after manual interaction.
  const [paused, setPaused] = useState(false);
  const cooldownUntilRef = useRef(0);
  const resumeTimerRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const indexRef = useRef(0);

  // Ref mirror for the interval callback (updated in an effect, never render).
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Measure slide count; keep the indicator row in sync with the DOM.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setCount(track.querySelectorAll("[data-carousel-slide]").length);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [children]);

  // Follow the scroll position so indicators/controls reflect reality (this
  // also keeps swipe gestures in sync — the source of truth is the scroll).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const step = slideStep(track);
      if (step <= 0) return;
      // RTL scrollLeft is ≤ 0 (negative toward the next slide); LTR is ≥ 0.
      const next = Math.min(count - 1, Math.max(0, Math.round(Math.abs(track.scrollLeft) / step)));
      indexRef.current = next;
      setIndex(next);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [count]);

  const goTo = useCallback(
    (target: number, immediate = false) => {
      const track = trackRef.current;
      if (!track) return;
      const step = slideStep(track);
      if (step <= 0) return;
      const clamped = Math.min(count - 1, Math.max(0, target));
      const rtl = getComputedStyle(track).direction === "rtl";
      track.scrollTo({
        left: rtl ? -clamped * step : clamped * step,
        behavior: immediate || reduced ? "auto" : "smooth",
      });
    },
    [count, reduced],
  );

  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  // Autoplay: one card every 5s, wrapping to the start; skipped entirely
  // under prefers-reduced-motion or while paused/cooling down.
  useEffect(() => {
    if (reduced || count < 2) return;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      if (Date.now() < cooldownUntilRef.current) return;
      const atEnd = indexRef.current >= count - 1;
      goTo(atEnd ? 0 : indexRef.current + 1);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [reduced, count, goTo]);

  /** Manual navigation — pauses autoplay for the interaction cooldown. */
  const manual = (fn: () => void) => {
    cooldownUntilRef.current = Date.now() + INTERACTION_COOLDOWN_MS;
    fn();
  };

  const clearResumeTimer = () => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const pause = () => {
    clearResumeTimer();
    setPaused(true);
  };

  const resumeSoon = () => {
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => setPaused(false), 900);
  };

  useEffect(() => clearResumeTimer, []);

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      className={cn("relative", className)}
      onMouseEnter={pause}
      onMouseLeave={resumeSoon}
      onFocusCapture={pause}
      onBlurCapture={resumeSoon}
      onTouchStart={pause}
      onTouchEnd={resumeSoon}
    >
      {/* Snap track — native swipe on touch devices, RTL-aware. */}
      <div
        ref={trackRef}
        className="hide-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2"
      >
        {children.map((child, i) => (
          <div
            key={i}
            data-carousel-slide
            className="w-[86%] shrink-0 snap-start sm:w-[48%] lg:w-[calc((100%-2.5rem)/3)]"
          >
            {child}
          </div>
        ))}
      </div>

      {/* Prev / next controls */}
      <button
        type="button"
        onClick={() => manual(prev)}
        disabled={index <= 0}
        aria-label="پلن قبلی"
        className="absolute -start-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card/95 shadow-md transition-all hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-0 md:flex"
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => manual(next)}
        disabled={index >= count - 1}
        aria-label="پلن بعدی"
        className="absolute -end-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card/95 shadow-md transition-all hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-0 md:flex"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>

      {/* Pagination indicators — accessible touch targets (audit UI-3):
          the visual dot stays 8px, but the button itself is 24×24 so the
          tabs meet WCAG 2.5.8 / mobile touch-target minimums. */}
      {count > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-1" role="tablist" aria-label="موقعیت پلن‌ها">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`پلن ${toFaDigits(i + 1)}`}
              onClick={() => manual(() => goTo(i))}
              className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-muted-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-2 rounded-full transition-all duration-300",
                  i === index ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
