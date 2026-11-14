"use client";

// Shared motion primitives (framer-motion) with reduced-motion safety net
// provided globally by <MotionConfig reducedMotion="user">.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useMotionValue, useSpring, type HTMLMotionProps } from "framer-motion";
import { useRouter } from "@/lib/router";

/**
 * Page transition wrapper used INSIDE persistent layouts: the layout (sidebar,
 * header) stays mounted while only the routed content animates.
 */
export function AnimatedContent({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={path}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Fade + slide-up reveal on scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 16,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay, ease: [0.21, 0.6, 0.35, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container for lists of cards. */
export function Stagger({
  children,
  className,
  delay = 0.05,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.21, 0.6, 0.35, 1] } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Animated counter (e.g. dashboards stats) — animates when scrolled into view. */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 30, stiffness: 90 });
  const [display, setDisplay] = useState(format ? format(0) : "0");

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, value, motionValue]);

  useEffect(() => {
    const unsubscribe = spring.on("change", (v) => {
      setDisplay(format ? format(Math.round(v)) : String(Math.round(v)));
    });
    return unsubscribe;
  }, [spring, format]);

  return (
    <span ref={ref} className={className} dir="auto">
      {display}
    </span>
  );
}
