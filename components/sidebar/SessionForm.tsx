"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  PROFILES_BY_ID,
} from "@/lib/session-profiles";
import { buildRouteIntentionCard } from "@/lib/route-intentions";
import type {
  GenerateRouteError,
  GenerateRouteRequest,
  GenerateRouteResponse,
} from "@/lib/types";
import AddressInput from "@/components/sidebar/AddressInput";

// ── Loading steps ─────────────────────────────────────────────────────────────

const LOADING_STEPS = ["ANALYSE DU TERRAIN...", "CALCUL DES PENTES...", "OPTIMISATION...", "FINALISATION..."];

// ── Chip labels ───────────────────────────────────────────────────────────────

const CHIP_LABELS: Record<string, string> = {
  running_trail_decouverte:   "Découverte",
  running_trail:              "Trail",
  running_endurance:          "Endurance",
};

const PHASE1_PROFILE_IDS = ["running_trail_decouverte", "running_trail", "running_endurance"] as const;
const PHASE1_PROFILES = PHASE1_PROFILE_IDS
  .map((id) => PROFILES_BY_ID.get(id))
  .filter((profile): profile is NonNullable<typeof profile> => profile != null);

const PHASE1_MAX_DISTANCE_KM = 15;

// ── Section label ─────────────────────────────────────────────────────────────

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.3em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        marginBottom: "12px",
      }}
    >
      {children}
    </span>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div
      style={{
        height: "1px",
        background: "var(--border)",
        margin: "20px 0",
      }}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SessionForm() {
  const {
    address,          setAddress,
    selectedProfileId, setProfileId,
    targetDistanceKm,  setTargetDistance,
    targetElevationM,  setTargetElevation,
    status,
    setLoading,        setSuccess,        setError,
    errorMessage,
    scenicMode,        setScenicMode,
    setMapCenter,
    setSidebarOpen,
  } = useAppStore();

  const [stepIndex, setStepIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(0);

  const isLoading = status === "loading";

  // Loading step animation — never reaches last step on timer alone;
  // caps at step 2 ("OPTIMISATION...") with progress at 80%.
  // The final step only appears when the API actually responds.
  useEffect(() => {
    if (!isLoading) {
      const resetTimer = setTimeout(() => {
        setStepIndex(0);
        setProgressPct(0);
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    const pcts = [15, 45, 70, 80];
    const delays = [0, 2000, 4500, 8000]; // ms after loading starts
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Cap at step 2 on timer — step 3 only via slower timeout
    for (let step = 1; step < LOADING_STEPS.length; step++) {
      timers.push(setTimeout(() => {
        setStepIndex(step);
        setProgressPct(pcts[step]);
      }, delays[step]));
    }
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  const currentProfile = PROFILES_BY_ID.get(selectedProfileId);
  const routeIntention = currentProfile
    ? buildRouteIntentionCard(currentProfile, scenicMode)
    : null;

  const handleProfileChange = (profileId: string) => {
    const profile = PROFILES_BY_ID.get(profileId);
    if (profile) {
      setProfileId(profile.id);
      setTargetDistance(Math.min(profile.distanceRange.default, PHASE1_MAX_DISTANCE_KM));
      setTargetElevation(profile.elevationRange.default);
    }
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`
        )
          .then((r) => r.json())
          .then((data) => {
            const placeName =
              data.features?.[0]?.place_name ??
              `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
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
    if (!address.trim() || !PROFILES_BY_ID.has(selectedProfileId) || isLoading) return;
    setLoading();

    // Close sidebar on mobile when generating
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }

    const body: GenerateRouteRequest & { scenicMode?: boolean } = {
      address: address.trim(),
      profileId: selectedProfileId,
      targetDistanceKm,
      targetElevationM,
      scenicMode: scenicMode || undefined,
    };

    try {
      const res = await fetch("/api/generate-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: GenerateRouteResponse | GenerateRouteError = await res.json();
      if (data.success) {
        setSuccess(data.route);
      } else {
        setError(data.error);
      }
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    }
  }, [address, isLoading, selectedProfileId, setError, setLoading, setSuccess, targetDistanceKm, targetElevationM, scenicMode, setSidebarOpen]);

  // Slider ranges
  const distMin = currentProfile?.distanceRange.min ?? 5;
  const distMax = Math.min(currentProfile?.distanceRange.max ?? PHASE1_MAX_DISTANCE_KM, PHASE1_MAX_DISTANCE_KM);
  const elevMin = currentProfile?.elevationRange.min ?? 0;
  const elevMax = currentProfile?.elevationRange.max ?? 2000;

  const distPresets = (currentProfile?.distancePresets ?? []).filter((v) => v <= PHASE1_MAX_DISTANCE_KM);
  const elevPresets = currentProfile?.elevationPresets ?? [];

  // ── Shared styles ──────────────────────────────────────────────────────────

  const chipActive: React.CSSProperties = {
    background: "var(--accent-lime)",
    color: "var(--bg-deep)",
    border: "1px solid var(--accent-lime)",
    fontWeight: 700,
  };

  const chipInactive: React.CSSProperties = {
    background: "var(--bg-surface)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
  };

  const presetChip = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px",
    borderRadius: "var(--radius-control)",
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    cursor: "pointer",
    transition: "all 0.2s var(--ease-out-expo)",
    border: "1px solid",
    background: active ? "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))" : "rgba(18,29,22,0.78)",
    color: active ? "#071009" : "var(--text-muted)",
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
      className="flex flex-col pb-6"
      aria-label="Formulaire de génération de parcours"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 pt-5 pb-[18px] border-b border-[var(--border)]">

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <SidebarSectionLabel>Atelier trail</SidebarSectionLabel>
          <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--accent-amber)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            5–15 km
          </span>
        </div>
        <h1 style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "24px", lineHeight: 1.1, color: "var(--text-primary)", marginBottom: "10px", letterSpacing: "-0.02em" }}>
          Crée une boucle trail fiable.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "12px",
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          Départ, D+, surface nature. Un GPX propre si la route tient vraiment.
        </p>
      </div>

      <div className="px-4 md:px-6">
        {/* ── Address ──────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: "20px" }}>
          <SidebarSectionLabel>Point de départ</SidebarSectionLabel>
          <AddressInput
            id="address"
            value={address}
            onChange={setAddress}
            placeholder="Adresse, parking, point de départ…"
            disabled={isLoading}
            dark
          />
          <button
            type="button"
            onClick={handleGeolocate}
            disabled={isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "11px",
              color: "var(--accent-sage)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "6px 0",
              transition: "color 0.2s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            </svg>
            Utiliser ma position
          </button>
        </div>

        <Divider />

        {/* ── Session type chips ─────────────────────────────────────────── */}
        <div>
          <SidebarSectionLabel>Intention</SidebarSectionLabel>
          <div
            className="session-scroll"
            style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}
          >
            {PHASE1_PROFILES.map((profile) => {
              const isActive = selectedProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => handleProfileChange(profile.id)}
                  disabled={isLoading}
                  style={{
                    flexShrink: 0,
                    padding: "6px 14px",
                    borderRadius: "999px",
                    fontFamily: "var(--font-syne), sans-serif",
                    fontSize: "11px",
                    fontWeight: isActive ? 700 : 400,
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    transition: "all 0.2s var(--ease-out-expo)",
                    border: "1px solid",
                    ...(isActive ? chipActive : chipInactive),
                  }}
                >
                  {CHIP_LABELS[profile.id] ?? profile.name}
                </button>
              );
            })}
          </div>
          {currentProfile && (
            <p
              style={{
                marginTop: "10px",
                fontFamily: "var(--font-inter), sans-serif",
                fontSize: "12px",
                color: "var(--text-muted)",
                lineHeight: 1.6,
              }}
            >
              {currentProfile.description}
            </p>
          )}
          {routeIntention && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 14px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderLeft: "3px solid var(--accent-sage)",
                borderRadius: "var(--radius-control)",
              }}
              aria-label="Intention du parcours"
            >
              <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-primary)", textTransform: "uppercase", marginBottom: "6px" }}>
                {routeIntention.title}
              </p>
              <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                {routeIntention.promise}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {routeIntention.biases.map((bias) => (
                  <span key={bias} style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", color: "var(--accent-sage)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {bias}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* ── Mode toggle ───────────────────────────────────────────────── */}
        <div>
          <SidebarSectionLabel>Surface</SidebarSectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>

            {/* RÉGULIER */}
            <button
              type="button"
              onClick={() => setScenicMode(false)}
              disabled={isLoading}
              style={{
                height: "72px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: "0 16px",
                borderRadius: "var(--radius-control)",
                background: !scenicMode ? "var(--bg-elevated)" : "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderLeft: !scenicMode ? "3px solid var(--accent-lime)" : "3px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s var(--ease-out-expo)",
                textAlign: "left",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ color: !scenicMode ? "var(--accent-lime)" : "var(--text-muted)", flexShrink: 0 }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              <div>
                <div style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", color: !scenicMode ? "var(--text-primary)" : "var(--text-muted)", textTransform: "uppercase" }}>
                  Régulier
                </div>
                <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Surface stable, régularité, peu de dénivelé technique
                </div>
              </div>
            </button>

            {/* NATURE */}
            <button
              type="button"
              onClick={() => setScenicMode(true)}
              disabled={isLoading}
              style={{
                height: "72px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: "0 16px",
                borderRadius: "var(--radius-control)",
                background: scenicMode ? "var(--bg-elevated)" : "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderLeft: scenicMode ? "3px solid var(--accent-sage)" : "3px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s var(--ease-out-expo)",
                textAlign: "left",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ color: scenicMode ? "var(--accent-sage)" : "var(--text-muted)", flexShrink: 0 }}>
                <path d="M17 8C8 10 5.9 16.17 3.82 19.78a1 1 0 001.81.82C7.13 17 9 13 17 8z"/>
                <path d="M12 2C12 6 10 8 10 8s2.5 0 5-2"/>
              </svg>
              <div>
                <div style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", color: scenicMode ? "var(--text-primary)" : "var(--text-muted)", textTransform: "uppercase" }}>
                  Nature
                </div>
                <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Sentiers, forêt, chemins, découverte
                </div>
              </div>
            </button>
          </div>
        </div>

        <Divider />

        {/* ── Distance slider ────────────────────────────────────────────── */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "16px" }}>
            <SidebarSectionLabel>Distance cible</SidebarSectionLabel>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "28px",
                fontWeight: 500,
                color: "var(--text-primary)",
                lineHeight: 1,
              }}
            >
              {targetDistanceKm}
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", color: "var(--text-muted)", marginLeft: "4px" }}>km</span>
            </span>
          </div>
          <input
            type="range"
            min={distMin} max={distMax} step={1}
            value={targetDistanceKm}
            onChange={(e) => setTargetDistance(Number(e.target.value))}
            disabled={isLoading}
            className="trailforge-slider"
            style={{ width: "100%", accentColor: "var(--accent-lime)" }}
            aria-label={`Distance cible : ${targetDistanceKm} km`}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
            {distPresets.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTargetDistance(v)}
                disabled={isLoading}
                style={presetChip(targetDistanceKm === v)}
              >
                {v} km
              </button>
            ))}
          </div>
        </div>

        <Divider />

        {/* ── Elevation slider ───────────────────────────────────────────── */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "16px" }}>
            <SidebarSectionLabel>Dénivelé positif</SidebarSectionLabel>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "28px",
                fontWeight: 500,
                color: "var(--text-primary)",
                lineHeight: 1,
              }}
            >
              {targetElevationM}
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", color: "var(--text-muted)", marginLeft: "4px" }}>m</span>
            </span>
          </div>
          <input
            type="range"
            min={elevMin} max={elevMax} step={10}
            value={targetElevationM}
            onChange={(e) => setTargetElevation(Number(e.target.value))}
            disabled={isLoading}
            className="trailforge-slider"
            style={{ width: "100%", accentColor: "var(--accent-amber)" }}
            aria-label={`Dénivelé positif : ${targetElevationM} m`}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
            {elevPresets.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTargetElevation(v)}
                disabled={isLoading}
                style={presetChip(targetElevationM === v)}
              >
                {v} m
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Generate button (sticky bottom) ────────────────────────────── */}
      <div
        className="sticky bottom-0 z-10 px-4 md:px-6 py-4"
        style={{
          background: "linear-gradient(to top, var(--bg-deep) 80%, transparent)",
        }}
      >
        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          style={{
            width: "100%",
            height: "52px",
            background: isLoading ? "var(--bg-elevated)" : "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))",
            color: isLoading ? "var(--text-muted)" : "#071009",
            border: "1px solid rgba(242,240,232,0.14)",
            borderRadius: "var(--radius-control)",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            cursor: isLoading ? "not-allowed" : "pointer",
            transition: "all 0.3s var(--ease-out-expo)",
            position: "relative",
            overflow: "hidden",
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.01)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 24px rgba(168,214,114,0.3)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "";
            (e.currentTarget as HTMLElement).style.boxShadow = "";
          }}
        >
          {/* Loading progress bar */}
          {isLoading && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                height: "2px",
                background: "var(--accent-lime)",
                width: `${progressPct}%`,
                transition: "width 0.6s var(--ease-out-expo)",
              }}
            />
          )}
          {isLoading ? LOADING_STEPS[stepIndex] : "TRACER LA BOUCLE →"}
        </button>

        {status === "error" && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              marginTop: "10px",
              padding: "12px 16px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "var(--radius-control)",
            }}
          >
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#f87171", lineHeight: 1.5 }}>
              {errorMessage}
            </p>
          </div>
        )}
      </div>
    </form>
  );
}
