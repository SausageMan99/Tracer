"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface NominatimSuggestion {
  place_id: number;
  display_name: string;
}

function formatSuggestion(s: NominatimSuggestion): { main: string; sub: string } {
  const parts = s.display_name.split(", ");
  return {
    main: parts.slice(0, 2).join(", "),
    sub: parts.slice(2).join(", "),
  };
}

/** Props for the `AddressInput` component. */
interface AddressInputProps {
  /** HTML `id` attribute — also used as the prefix for ARIA listbox ID */
  id: string;
  /** Current controlled value */
  value: string;
  /** Called whenever the input value changes or a suggestion is selected */
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** If true, renders in compact mode (smaller spinner, tighter padding) */
  compact?: boolean;
  /** If true, renders in dark sidebar colour scheme (slate-800 background) */
  dark?: boolean;
}

/**
 * Accessible address autocomplete input backed by Nominatim.
 *
 * After 380ms of debounce, queries the Nominatim OpenStreetMap geocoding API
 * and displays up to 5 suggestions in an ARIA-compliant listbox dropdown.
 * Supports keyboard navigation (ArrowUp/Down, Enter to select, Escape to close).
 *
 * Two visual variants: dark (sidebar) and light (default/compact).
 * A spinning indicator appears while the geocoding request is in flight.
 *
 * @component
 * @example
 * <AddressInput
 *   id="address"
 *   value={address}
 *   onChange={setAddress}
 *   placeholder="Ville, adresse…"
 *   dark
 * />
 */
export default function AddressInput({
  id,
  value,
  onChange,
  placeholder = "Adresse, ville…",
  disabled = false,
  compact = false,
  dark = false,
}: AddressInputProps) {
  const [suggestions, setSuggestions] = useState<NominatimSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = useCallback((query: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    // Abort any in-flight request to prevent stale results overwriting newer ones
    if (abortRef.current) abortRef.current.abort();

    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSearching(true);
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", query.trim());
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "6");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("dedupe", "1");
        // Bias results toward France + neighbouring countries
        url.searchParams.set("countrycodes", "fr,be,ch,lu,es,it,de");
        url.searchParams.set("accept-language", "fr");
        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            "User-Agent": "Tracer/1.0 (running-cycling route generator)",
            Accept: "application/json",
            "Accept-Language": "fr",
          },
        });
        if (res.ok) {
          const data: NominatimSuggestion[] = await res.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
          setActiveIndex(-1);
        }
      } catch (err) {
        // AbortError = request superseded by a newer one — not an error
        if (err instanceof Error && err.name !== "AbortError") {
          /* non-fatal */
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);
  }, []);

  const handleChange = (val: string) => {
    onChange(val);
    search(val);
  };

  const select = (s: NominatimSuggestion) => {
    onChange(s.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      select(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  };

  // ── Style variants ─────────────────────────────────────────────────────────
  const inputCls = dark
    ? `w-full border px-3 py-2.5 pr-9 text-sm
       focus:outline-none disabled:opacity-40 transition-all`
    : compact
    ? `w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 pr-8 text-sm
       focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent
       disabled:opacity-50 transition-colors`
    : `w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-9 text-sm
       focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
       disabled:bg-gray-50 disabled:text-gray-400 transition-colors`;

  const dropdownCls = dark
    ? "absolute z-50 w-full mt-1 overflow-hidden"
    : "absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden";

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={`${id}-listbox`}
          aria-expanded={showSuggestions}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined
          }
          className={inputCls}
          style={dark ? {
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "2px",
            color: "var(--text-primary)",
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "13px",
          } : undefined}
        />
        {isSearching && (
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          >
            <svg
              className={`animate-spin h-3.5 w-3.5 ${dark ? "" : "text-gray-400"}`}
              style={dark ? { color: "var(--text-muted)" } : undefined}
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </span>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          aria-label="Suggestions d'adresse"
          className={dropdownCls}
          style={dark ? {
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "2px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            marginTop: "4px",
          } : undefined}
        >
          {suggestions.map((s, i) => {
            const { main, sub } = formatSuggestion(s);
            const isActive = i === activeIndex;
            return (
              <li
                key={s.place_id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(s);
                }}
                className={!dark ? `px-3 py-2.5 cursor-pointer border-b last:border-b-0
                  border-gray-100 ${isActive ? "bg-red-50" : "hover:bg-gray-50"}` : undefined}
                style={dark ? {
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  background: isActive ? "var(--bg-elevated)" : "transparent",
                } : undefined}
              >
                <p style={dark ? {
                  fontSize: "12px",
                  fontFamily: "var(--font-inter), sans-serif",
                  fontWeight: 500,
                  color: isActive ? "var(--accent-lime)" : "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                } : undefined}
                className={!dark ? `text-sm font-medium truncate ${isActive ? "text-red-700" : "text-gray-800"}` : undefined}
                >
                  {main}
                </p>
                {sub && (
                  <p style={dark ? {
                    fontSize: "11px",
                    fontFamily: "var(--font-inter), sans-serif",
                    color: "var(--text-muted)",
                    marginTop: "2px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  } : undefined}
                  className={!dark ? "text-xs truncate mt-0.5 text-gray-400" : undefined}
                  >
                    {sub}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
