"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { buildRouteIntentionCard } from "@/lib/route-intentions";
import type {
  GenerateRouteError,
  GenerateRouteRequest,
  GenerateRouteResponse,
} from "@/lib/types";
import AddressInput from "@/components/sidebar/AddressInput";

const LOADING_STEPS = [
  "Lecture des chemins proches",
  "Recherche d'une boucle fermée",
  "Contrôle distance / D+",
  "Préparation du GPX",
];

const PHASE1_PROFILE_IDS = ["running_trail_decouverte", "running_trail", "running_endurance"] as const;
const PHASE1_PROFILES = PHASE1_PROFILE_IDS
  .map((id) => PROFILES_BY_ID.get(id))
  .filter((profile): profile is NonNullable<typeof profile> => profile != null);

const PHASE1_MAX_DISTANCE_KM = 15;
const PHASE1_MAX_ELEVATION_M = 600;

const INTENTION_COPY: Record<string, { label: string; caption: string }> = {
  running_trail_decouverte: {
    label: "Facile",
    caption: "Trail accessible, peu technique.",
  },
  running_trail: {
    label: "Modéré",
    caption: "Sentiers variés, un vrai peu de D+.",
  },
  running_endurance: {
    label: "Régulier",
    caption: "Boucle stable, effort zone 2.",
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.22em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        marginBottom: "10px",
      }}
    >
      {children}
    </span>
  );
}

function PanelCard({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      style={{
        padding: "14px",
        background: muted ? "rgba(17,26,21,0.58)" : "rgba(17,26,21,0.86)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  );
}

function ValueReadout({ value, unit }: { value: number | string; unit: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "22px",
        color: "var(--text-primary)",
        letterSpacing: "-0.04em",
        lineHeight: 1,
      }}
    >
      {value}
      <span style={{ fontSize: "11px", color: "var(--text-dim)", marginLeft: "5px", letterSpacing: 0 }}>{unit}</span>
    </span>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: "rgba(30,46,37,0.68)", margin: "14px 0" }} />;
}

export default function SessionForm() {
  const {
    address,
    setAddress,
    selectedProfileId,
    setProfileId,
    targetDistanceKm,
    setTargetDistance,
    targetElevationM,
    setTargetElevation,
    status,
    setLoading,
    setSuccess,
    setError,
    errorMessage,
    scenicMode,
    setScenicMode,
    setMapCenter,
    setSidebarOpen,
  } = useAppStore();

  const [stepIndex, setStepIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const isLoading = status === "loading";
  const canGenerate = address.trim().length > 2 && !isLoading;

  useEffect(() => {
    if (!isLoading) {
      const resetTimer = setTimeout(() => {
        setStepIndex(0);
        setProgressPct(0);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    const pcts = [18, 42, 68, 86];
    const delays = [0, 1800, 4200, 7600];
    const timers = delays.map((delay, index) => setTimeout(() => {
      setStepIndex(index);
      setProgressPct(pcts[index]);
    }, delay));
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  const currentProfile = PROFILES_BY_ID.get(selectedProfileId);
  const routeIntention = currentProfile ? buildRouteIntentionCard(currentProfile, scenicMode) : null;

  const distMin = Math.max(currentProfile?.distanceRange.min ?? 5, 5);
  const distMax = PHASE1_MAX_DISTANCE_KM;
  const elevMin = Math.max(currentProfile?.elevationRange.min ?? 50, 50);
  const elevMax = PHASE1_MAX_ELEVATION_M;

  const distPresets = useMemo(() => [5, 8, 10, 12, 15], []);
  const elevPresets = useMemo(() => [50, 150, 250, 400, 600], []);

  useEffect(() => {
    if (targetDistanceKm > PHASE1_MAX_DISTANCE_KM) setTargetDistance(PHASE1_MAX_DISTANCE_KM);
    if (targetElevationM > PHASE1_MAX_ELEVATION_M) setTargetElevation(PHASE1_MAX_ELEVATION_M);
  }, [setTargetDistance, setTargetElevation, targetDistanceKm, targetElevationM]);

  const handleProfileChange = (profileId: string) => {
    const profile = PROFILES_BY_ID.get(profileId);
    if (!profile) return;
    setProfileId(profile.id);
    setTargetDistance(Math.min(profile.distanceRange.default, PHASE1_MAX_DISTANCE_KM));
    setTargetElevation(Math.min(profile.elevationRange.default, PHASE1_MAX_ELEVATION_M));
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation || isLoading) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) {
          setAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          setMapCenter({ lat: latitude, lng: longitude });
          return;
        }
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${token}`)
          .then((r) => r.json())
          .then((data) => {
            const placeName = data.features?.[0]?.place_name ?? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            setAddress(placeName);
            setMapCenter({ lat: latitude, lng: longitude });
          })
          .catch(() => {
            setAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
            setMapCenter({ lat: latitude, lng: longitude });
          });
      },
      (err) => console.warn("Geolocation failed:", err)
    );
  };

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !PROFILES_BY_ID.has(selectedProfileId)) return;
    setLoading();

    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }

    const body: GenerateRouteRequest & { scenicMode?: boolean } = {
      address: address.trim(),
      profileId: selectedProfileId,
      targetDistanceKm: Math.min(targetDistanceKm, PHASE1_MAX_DISTANCE_KM),
      targetElevationM: Math.min(targetElevationM, PHASE1_MAX_ELEVATION_M),
      scenicMode: scenicMode || undefined,
    };

    try {
      const res = await fetch("/api/generate-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: GenerateRouteResponse | GenerateRouteError = await res.json();
      if (data.success) setSuccess(data.route);
      else setError(data.error);
    } catch {
      setError("Erreur réseau. Réessaie dans quelques secondes.");
    }
  }, [address, canGenerate, scenicMode, selectedProfileId, setError, setLoading, setSidebarOpen, setSuccess, targetDistanceKm, targetElevationM]);

  const reduceElevation = () => {
    const lowerPreset = [...elevPresets].reverse().find((value) => value < targetElevationM);
    setTargetElevation(Math.max(elevMin, lowerPreset ?? targetElevationM - 100));
  };

  const increaseDistance = () => {
    const higherPreset = distPresets.find((value) => value > targetDistanceKm);
    setTargetDistance(Math.min(distMax, higherPreset ?? targetDistanceKm + 1));
  };

  const focusDeparture = () => {
    if (typeof document === "undefined") return;
    document.getElementById("address")?.focus();
  };

  const presetChip = (active: boolean): React.CSSProperties => ({
    padding: "7px 10px",
    borderRadius: "7px",
    fontFamily: "var(--font-jetbrains), monospace",
    fontSize: "11px",
    cursor: isLoading ? "not-allowed" : "pointer",
    transition: "all 0.2s var(--ease-out-expo)",
    border: active ? "1px solid rgba(163,201,106,0.42)" : "1px solid var(--border)",
    background: active ? "rgba(163,201,106,0.1)" : "rgba(10,15,12,0.55)",
    color: active ? "var(--accent-lime)" : "var(--text-muted)",
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
      className="flex flex-col pb-6"
      aria-label="Formulaire de génération de boucle trail"
    >
      <div className="px-4 md:px-6 pt-5 pb-[18px] border-b border-[var(--border)]">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
          <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.24em", color: "var(--accent-sage)", textTransform: "uppercase" }}>
            Boucle trail courte
          </span>
          <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-dim)" }}>
            5–15km
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "27px", lineHeight: 1.02, color: "var(--text-primary)", letterSpacing: "-0.04em", marginBottom: "10px" }}>
          Nouvelle boucle trail
        </h1>
        <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.55 }}>
          Crée une boucle trail GPX autour de ton départ.
        </p>
      </div>

      <div className="px-4 md:px-6" style={{ paddingTop: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <PanelCard>
          <SectionLabel>Départ</SectionLabel>
          <AddressInput
            id="address"
            value={address}
            onChange={setAddress}
            placeholder="Adresse, parking, carrefour…"
            disabled={isLoading}
            dark
          />
          <button
            type="button"
            onClick={handleGeolocate}
            disabled={isLoading}
            style={{
              marginTop: "8px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "11px",
              color: "var(--accent-sage)",
              background: "none",
              border: "none",
              cursor: isLoading ? "not-allowed" : "pointer",
              padding: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
            Utiliser ma position
          </button>
        </PanelCard>

        <PanelCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px" }}>
            <SectionLabel>Distance</SectionLabel>
            <ValueReadout value={targetDistanceKm} unit="km" />
          </div>
          <input
            type="range"
            min={distMin}
            max={distMax}
            step={1}
            value={targetDistanceKm}
            onChange={(e) => setTargetDistance(Number(e.target.value))}
            disabled={isLoading}
            className="trailforge-slider"
            aria-label={`Distance cible : ${targetDistanceKm} km`}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
            {distPresets.map((v) => (
              <button key={v} type="button" onClick={() => setTargetDistance(v)} disabled={isLoading} style={presetChip(targetDistanceKm === v)}>
                {v}km
              </button>
            ))}
          </div>
          <p style={{ marginTop: "10px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.45 }}>
            5 à 15 km. Une vraie boucle courte avant d&apos;élargir le produit.
          </p>
        </PanelCard>

        <PanelCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px" }}>
            <SectionLabel>Dénivelé +</SectionLabel>
            <ValueReadout value={targetElevationM} unit="m" />
          </div>
          <input
            type="range"
            min={elevMin}
            max={elevMax}
            step={50}
            value={targetElevationM}
            onChange={(e) => setTargetElevation(Number(e.target.value))}
            disabled={isLoading}
            className="trailforge-slider trailforge-slider-amber"
            aria-label={`Dénivelé positif : ${targetElevationM} m`}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
            {elevPresets.map((v) => (
              <button key={v} type="button" onClick={() => setTargetElevation(v)} disabled={isLoading} style={presetChip(targetElevationM === v)}>
                {v}m
              </button>
            ))}
          </div>
          <p style={{ marginTop: "10px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.45 }}>
            Estimation. TrailForge affichera l&apos;écart réel avant export GPX.
          </p>
        </PanelCard>

        <PanelCard>
          <SectionLabel>Style de sortie</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
            {PHASE1_PROFILES.map((profile) => {
              const active = selectedProfileId === profile.id;
              const copy = INTENTION_COPY[profile.id] ?? { label: profile.name, caption: profile.description };
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => handleProfileChange(profile.id)}
                  disabled={isLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "12px",
                    borderRadius: "8px",
                    border: active ? "1px solid rgba(163,201,106,0.38)" : "1px solid var(--border)",
                    background: active ? "rgba(163,201,106,0.08)" : "rgba(10,15,12,0.48)",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", fontWeight: 700, color: active ? "var(--accent-lime)" : "var(--text-primary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {copy.label}
                    </span>
                    <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.35 }}>
                      {copy.caption}
                    </span>
                  </span>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: active ? "var(--accent-lime)" : "var(--border)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </PanelCard>

        <PanelCard muted>
          <SectionLabel>Préférence terrain</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setScenicMode(false)}
              disabled={isLoading}
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: !scenicMode ? "1px solid rgba(163,201,106,0.38)" : "1px solid var(--border)",
                background: !scenicMode ? "rgba(163,201,106,0.08)" : "rgba(10,15,12,0.48)",
                color: !scenicMode ? "var(--accent-lime)" : "var(--text-muted)",
                cursor: isLoading ? "not-allowed" : "pointer",
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Trace plus fiable
            </button>
            <button
              type="button"
              onClick={() => setScenicMode(true)}
              disabled={isLoading}
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: scenicMode ? "1px solid rgba(139,175,133,0.42)" : "1px solid var(--border)",
                background: scenicMode ? "rgba(139,175,133,0.09)" : "rgba(10,15,12,0.48)",
                color: scenicMode ? "var(--accent-sage)" : "var(--text-muted)",
                cursor: isLoading ? "not-allowed" : "pointer",
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Plus sauvage
            </button>
          </div>
          {routeIntention && (
            <>
              <Divider />
              <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                {routeIntention.promise}
              </p>
            </>
          )}
        </PanelCard>

      </div>

      <div
        className="sticky bottom-0 z-10 px-4 md:px-6 py-4"
        style={{ background: "linear-gradient(to top, var(--bg-deep) 78%, rgba(5,8,6,0))" }}
      >
        {isLoading && (
          <div style={{ marginBottom: "12px" }} aria-live="polite">
            <div style={{ height: "2px", background: "var(--border)", borderRadius: "999px", overflow: "hidden" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", background: "var(--accent-lime)", transition: "width 0.7s var(--ease-out-expo)" }} />
            </div>
            <p style={{ marginTop: "8px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-muted)" }}>
              {LOADING_STEPS[stepIndex]}
            </p>
          </div>
        )}
        <button
          type="submit"
          disabled={!canGenerate}
          aria-busy={isLoading}
          style={{
            width: "100%",
            height: "50px",
            background: canGenerate ? "var(--accent-lime)" : "rgba(30,46,37,0.92)",
            color: canGenerate ? "var(--bg-deep)" : "var(--text-muted)",
            border: "1px solid rgba(232,230,223,0.08)",
            borderRadius: "8px",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "12px",
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            cursor: canGenerate ? "pointer" : "not-allowed",
            transition: "all 0.2s var(--ease-out-expo)",
          }}
        >
          {isLoading ? "Ça explore le terrain…" : "Chercher une boucle"}
        </button>

        {!isLoading && (
          <p style={{ marginTop: "9px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.45, textAlign: "center" }}>
            TrailForge cherche une boucle GPX courte autour de ton départ. La fiabilité sera affichée avant export.
          </p>
        )}

        {status === "error" && (
          <div role="alert" aria-live="assertive" style={{ marginTop: "10px", padding: "12px 14px", background: "rgba(184,90,78,0.08)", border: "1px solid rgba(184,90,78,0.24)", borderRadius: "8px" }}>
            <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#d8897f", textTransform: "uppercase", marginBottom: "6px" }}>
              Pas de boucle fiable trouvée
            </p>
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              {errorMessage?.toLowerCase().includes("réseau")
                ? "Erreur réseau. Garde tes paramètres et réessaie dans quelques secondes."
                : "TrailForge n'a pas trouvé assez de chemins continus pour respecter ces paramètres autour de ce départ."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
              <button type="button" onClick={reduceElevation} disabled={targetElevationM <= elevMin} style={presetChip(false)}>Réduire le D+</button>
              <button type="button" onClick={increaseDistance} disabled={targetDistanceKm >= distMax} style={presetChip(false)}>Allonger un peu</button>
              <button type="button" onClick={focusDeparture} style={presetChip(false)}>Changer le départ</button>
              {scenicMode && <button type="button" onClick={() => setScenicMode(false)} style={presetChip(false)}>Prioriser trace fiable</button>}
            </div>
            {errorMessage && !errorMessage.toLowerCase().includes("réseau") && (
              <p style={{ marginTop: "8px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-dim)", lineHeight: 1.4 }}>
                Détail technique : {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
