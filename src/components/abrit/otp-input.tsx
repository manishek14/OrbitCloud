"use client";

// OTP input with clear focus behavior, error shake feedback, auto-submit on
// completion, and a resend countdown hook.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";

export function OTPInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  autoFocus = true,
  length = 6,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  className?: string;
}) {
  const completedRef = useRef(false);

  const handleChange = (next: string) => {
    onChange(next);
    if (next.length === length && !completedRef.current) {
      completedRef.current = true;
      // Small tactile confirmation on completion.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(30);
      }
      onComplete?.(next);
    } else if (next.length < length) {
      completedRef.current = false;
    }
  };

  return (
    <motion.div
      animate={invalid ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
      className={cn("flex justify-center", className)}
      dir="ltr"
    >
      <InputOTP
        maxLength={length}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        autoFocus={autoFocus}
      >
        <InputOTPGroup>
          {Array.from({ length: length / 2 }).map((_, i) => (
            <InputOTPSlot key={i} index={i} className={cn(invalid && "border-destructive text-destructive")} />
          ))}
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          {Array.from({ length: length - length / 2 }).map((_, i) => (
            <InputOTPSlot key={i} index={i + length / 2} className={cn(invalid && "border-destructive text-destructive")} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </motion.div>
  );
}

/** Countdown for OTP resend buttons. Returns remaining seconds; reset() restarts. */
export function useCountdown(initialSeconds: number) {
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = (seconds: number = initialSeconds) => {
    clear();
    setRemaining(seconds);
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clear();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => clear, []);

  return { remaining, start, reset: () => start(initialSeconds) };
}

/** Copy helper with toast feedback (used for OTP codes, refs, etc.). */
export function useCopyToClipboard() {
  const { toast } = useToast();
  return (text: string, label = "کپی شد.") => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: label }))
      .catch(() => undefined);
  };
}
