/**
 * Reusable GSAP animation constants and helpers.
 * Import these throughout the app for consistent motion design.
 */
import { gsap } from "gsap";

// ── Easing ────────────────────────────────────────────────────────────────────

export const EASE_OUT_EXPO = "expo.out";
export const EASE_IN_OUT  = "power2.inOut";

// ── Durations ─────────────────────────────────────────────────────────────────

export const DURATION_FAST = 0.4;
export const DURATION_MID  = 0.7;
export const DURATION_SLOW = 1.2;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reveal an element by animating it from below.
 */
export function revealFromBottom(
  el: Element | null,
  delay = 0,
  duration = DURATION_MID
) {
  if (!el) return;
  gsap.from(el, {
    y: 40,
    opacity: 0,
    duration,
    delay,
    ease: EASE_OUT_EXPO,
  });
}

/**
 * Reveal text/content via clip-path from the bottom.
 */
export function clipReveal(
  el: Element | null,
  delay = 0,
  duration = DURATION_SLOW
) {
  if (!el) return;
  gsap.from(el, {
    clipPath: "inset(100% 0 0 0)",
    duration,
    delay,
    ease: EASE_OUT_EXPO,
  });
}

/**
 * Fade in an element optionally with a scale.
 */
export function fadeIn(
  el: Element | null,
  delay = 0,
  fromScale = 1,
  duration = DURATION_MID
) {
  if (!el) return;
  gsap.from(el, {
    opacity: 0,
    scale: fromScale,
    duration,
    delay,
    ease: EASE_OUT_EXPO,
  });
}

/**
 * Stagger-reveal a list of elements from below.
 */
export function staggerReveal(
  els: Element[],
  stagger = 0.15,
  delay = 0,
  duration = DURATION_MID
) {
  if (!els.length) return;
  gsap.from(els, {
    y: 40,
    opacity: 0,
    duration,
    delay,
    stagger,
    ease: EASE_OUT_EXPO,
  });
}

/**
 * Animate a number from `from` to `to`.
 */
export function animateCounter(
  el: Element | null,
  from: number,
  to: number,
  duration = 1.5,
  delay = 0,
  onUpdate?: (val: number) => void
) {
  if (!el) return;
  const obj = { val: from };
  gsap.to(obj, {
    val: to,
    duration,
    delay,
    ease: "power2.out",
    onUpdate: () => {
      if (onUpdate) {
        onUpdate(Math.round(obj.val));
      } else {
        el.textContent = Math.round(obj.val).toString();
      }
    },
  });
}
