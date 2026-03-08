"use client";

import { useState, useCallback } from "react";

type Sport = "running" | "cycling" | "both";
type Source = "landing" | "post-generation";

interface WaitlistFormState {
  readonly email: string;
  readonly sport: Sport;
  readonly status: "idle" | "submitting" | "success" | "error";
  readonly message: string;
}

interface WaitlistFormActions {
  readonly setEmail: (email: string) => void;
  readonly setSport: (sport: Sport) => void;
  readonly submit: () => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useWaitlistForm(source: Source): WaitlistFormState & WaitlistFormActions {
  const [state, setState] = useState<WaitlistFormState>({
    email: "",
    sport: "running",
    status: "idle",
    message: "",
  });

  const setEmail = useCallback((email: string) => {
    setState((prev) => ({ ...prev, email, status: "idle", message: "" }));
  }, []);

  const setSport = useCallback((sport: Sport) => {
    setState((prev) => ({ ...prev, sport }));
  }, []);

  const submit = useCallback(async () => {
    const trimmed = state.email.trim();

    if (!EMAIL_RE.test(trimmed)) {
      setState((prev) => ({
        ...prev,
        status: "error",
        message: "Email invalide.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, status: "submitting" }));

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          sport: state.sport,
          source,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          status: "error",
          message: data.message ?? "Une erreur est survenue.",
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        status: "success",
        message: data.message ?? "Bienvenue dans la forge.",
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        message: "Erreur réseau. Réessaye.",
      }));
    }
  }, [state.email, state.sport, source]);

  return { ...state, setEmail, setSport, submit };
}
