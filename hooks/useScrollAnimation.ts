"use client";

import { useEffect, useRef, RefObject } from "react";

interface RevealOptions {
  /** CSS class to add when visible. Default: "is-visible" */
  visibleClass?: string;
  /** IntersectionObserver threshold. Default: 0.15 */
  threshold?: number;
  /** IntersectionObserver rootMargin. Default: "0px 0px -60px 0px" */
  rootMargin?: string;
  /** Whether to unobserve after first trigger. Default: true */
  once?: boolean;
  /** Delay before adding the visible class (ms). Default: 0 */
  delay?: number;
}

/**
 * Watches an element with IntersectionObserver and adds `is-visible`
 * when it enters the viewport. Pair with CSS reveal animations.
 *
 * @example
 * const ref = useRevealOnScroll<HTMLDivElement>();
 * <div ref={ref} className="reveal-up">Content</div>
 */
export function useRevealOnScroll<T extends Element = HTMLDivElement>(
  options: RevealOptions = {}
): RefObject<T> {
  const {
    visibleClass = "is-visible",
    threshold    = 0.15,
    rootMargin   = "0px 0px -60px 0px",
    once         = true,
    delay        = 0,
  } = options;

  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => el.classList.add(visibleClass), delay);
          } else {
            el.classList.add(visibleClass);
          }
          if (once) observer.unobserve(el);
        } else if (!once) {
          el.classList.remove(visibleClass);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleClass, threshold, rootMargin, once, delay]);

  return ref as RefObject<T>;
}

/**
 * Applies staggered reveal to multiple child elements.
 * Returns a ref for the parent container.
 *
 * @example
 * const ref = useStaggerReveal(".card");
 * <div ref={ref}><Card /><Card /><Card /></div>
 */
export function useStaggerReveal<T extends Element = HTMLDivElement>(
  childSelector: string,
  options: RevealOptions & { staggerMs?: number } = {}
): RefObject<T> {
  const { staggerMs = 100, ...rest } = options;
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const children = Array.from(container.querySelectorAll(childSelector));

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          children.forEach((child, i) => {
            setTimeout(() => {
              child.classList.add(rest.visibleClass ?? "is-visible");
            }, i * staggerMs + (rest.delay ?? 0));
          });
          if (rest.once !== false) observer.unobserve(container);
        }
      },
      {
        threshold: rest.threshold ?? 0.1,
        rootMargin: rest.rootMargin ?? "0px 0px -60px 0px",
      }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [childSelector, staggerMs, rest.delay, rest.once, rest.rootMargin, rest.threshold, rest.visibleClass]);

  return ref as RefObject<T>;
}
