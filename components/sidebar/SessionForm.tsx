"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import {
  PROFILES_BY_ID,
  PROFILES_BY_SPORT,
  SPORT_LABELS,
} from "@/lib/session-profiles";
import type {
  GenerateRouteError,
  GenerateRouteRequest,
  GenerateRouteResponse,
  Sport,
} from "@/lib/types";
import AddressInput from "@/components/sidebar/AddressInput";

// ── Sport list ────────────────────────────────────────────────────────────────

const SPORTS: Sport[] = ["running", "cycling_road", "cycling_gravel", "cycling_mtb"];

// ── Sport SVG icons ───────────────────────────────────────────────────────────

function RunningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9 1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z" />
    </svg>
  );
}

function RoadBikeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6l-2.2-2.5zm8.2 2c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z" />
    </svg>
  );
}

function GravelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <circle cx="6" cy="17" r="3.5" strokeWidth="2"/>
      <circle cx="18" cy="17" r="3.5" strokeWidth="2"/>
      <path d="M6 17 L9 8 L15 8 L18 17" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 8 L12 5 L15 8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7 12 L17 12" strokeLinecap="round"/>
      <circle cx="12" cy="8" r="1" fill="currentColor"/>
    </svg>
  );
}

function MtbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <circle cx="5" cy="17" r="4" strokeWidth="2.5"/>
      <circle cx="19" cy="17" r="4" strokeWidth="2.5"/>
      <path d="M5 17 L8.5 7 L14 7 L19 17" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8.5 7 L11 4" strokeLinecap="round"/>
      <path d="M11 4 L14 4" strokeLinecap="round"/>
      <path d="M14 7 L14 4" strokeLinecap="round"/>
      <path d="M6.5 12 L17.5 12" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

const SPORT_ICONS: Record<Sport, (cls: string) => React.ReactElement> = {
  running:        (cls) => <RunningIcon className={cls} />,
  cycling_road:   (cls) => <RoadBikeIcon className={cls} />,
  cycling_gravel: (cls) => <GravelIcon className={cls} />,
  cycling_mtb:    (cls) => <MtbIcon className={cls} />,
};

// ── Loading steps ─────────────────────────────────────────────────────────────

const LOADING_STEPS = ["ANALYSE DU TERRAIN...", "CALCUL DES PENTES...", "OPTIMISATION...", "FINALISATION..."];

// ── Chip labels ───────────────────────────────────────────────────────────────

const CHIP_LABELS: Record<string, string> = {
  running_endurance:          "Endurance",
  running_seuil:              "Seuil",
  running_intervals:          "30/30",
  running_sortie_longue:      "Longue",
  running_recuperation:       "Récup",
  cycling_road_endurance:     "Endurance",
  cycling_road_seuil:         "Seuil",
  cycling_road_intervals:     "Intervals",
  cycling_road_gran_fondo:    "Gran Fondo",
  cycling_road_recuperation:  "Récup",
  cycling_gravel_endurance:   "Endurance",
  cycling_gravel_gran_fondo:  "Gran Fondo",
  cycling_mtb_endurance:      "Endurance",
  cycling_mtb_intervals:      "Intervals",
};

// ── Build preset values ───────────────────────────────────────────────────────

function buildPresets(min: number, def: number, max: number, count = 4): number[] {
  const step = (max - min) / (count - 1);
  const raw  = Array.from({ length: count }, (_, i) => Math.round(min + i * step));
  if (!raw.includes(def)) {
    const closest = raw.reduce((a, b) =>
      Math.abs(b - def) < Math.abs(a - def) ? b : a
    );
    raw[raw.indexOf(closest)] = def;
  }
  return [...new Set(raw)].sort((a, b) => a - b);
}

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
    heatmapVisible,    heatmapSport,
    toggleHeatmap,     setHeatmapSport,
  } = useAppStore();

  const [selectedSport, setSelectedSport] = useState<Sport>("running");
  const [stepIndex, setStepIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(0);

  const isLoading = status === "loading";

  // Loading step animation — never reaches last step on timer alone;
  // caps at step 2 ("OPTIMISATION...") with progress at 80%.
  // The final step only appears when the API actually responds.
  useEffect(() => {
    if (!isLoading) { setStepIndex(0); setProgressPct(0); return; }
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

  const handleSportChange = (sport: Sport) => {
    setSelectedSport(sport);
    const profiles = PROFILES_BY_SPORT[sport] ?? [];
    if (profiles.length > 0) {
      const first = profiles[0];
      setProfileId(first.id);
      setTargetDistance(first.distanceRange.default);
      setTargetElevation(first.elevationRange.default);
    }
  };

  const handleProfileChange = (profileId: string) => {
    const profile = PROFILES_BY_ID.get(profileId);
    if (profile) {
      setProfileId(profile.id);
      setTargetDistance(profile.distanceRange.default);
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
    if (!address.trim() || !currentProfile || isLoading) return;
    setLoading();

    const body: GenerateRouteRequest = {
      address: address.trim(),
      profileId: selectedProfileId,
      targetDistanceKm,
      targetElevationM,
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
  }, [address, currentProfile, isLoading, selectedProfileId, setError, setLoading, setSuccess, targetDistanceKm, targetElevationM]);

  // Slider ranges
  const distMin     = currentProfile?.distanceRange.min     ?? 5;
  const distMax     = currentProfile?.distanceRange.max     ?? 100;
  const distDefault = currentProfile?.distanceRange.default ?? 20;
  const elevMin     = currentProfile?.elevationRange.min    ?? 0;
  const elevMax     = currentProfile?.elevationRange.max    ?? 2000;
  const elevDefault = currentProfile?.elevationRange.default ?? 300;

  const distPresets = useMemo(() => buildPresets(distMin, distDefault, distMax), [selectedProfileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const elevPresets = useMemo(() => buildPresets(elevMin, elevDefault, elevMax), [selectedProfileId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    borderRadius: "2px",
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    cursor: "pointer",
    transition: "all 0.2s var(--ease-out-expo)",
    border: "1px solid",
    ...(active ? chipActive : chipInactive),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}
      style={{ display: "flex", flexDirection: "column", paddingBottom: "24px" }}
      aria-label="Formulaire de génération de parcours"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "20px 24px 18px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <SidebarSectionLabel>Configurer la séance</SidebarSectionLabel>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "12px",
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          Génère un parcours en 10 secondes
        </p>
      </div>

      <div style={{ padding: "0 24px" }}>
        {/* ── Address ──────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: "20px" }}>
          <SidebarSectionLabel>Point de départ</SidebarSectionLabel>
          <AddressInput
            id="address"
            value={address}
            onChange={setAddress}
            placeholder="Ville, adresse…"
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

        {/* ── Sport selector ─────────────────────────────────────────────── */}
        <div>
          <SidebarSectionLabel>Sport</SidebarSectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
            role="radiogroup"
            aria-label="Sélection du sport"
          >
            {SPORTS.map((sport) => {
              const isActive = selectedSport === sport;
              return (
                <button
                  key={sport}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  disabled={isLoading}
                  onClick={() => handleSportChange(sport)}
                  style={{
                    height: "72px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    borderRadius: "2px",
                    border: isActive ? "1px solid var(--accent-lime)" : "1px solid var(--border)",
                    background: isActive ? "var(--bg-elevated)" : "var(--bg-surface)",
                    cursor: "pointer",
                    transition: "all 0.2s var(--ease-out-expo)",
                    color: isActive ? "var(--accent-lime)" : "var(--text-muted)",
                  }}
                >
                  {SPORT_ICONS[sport]("w-5 h-5")}
                  <span
                    style={{
                      fontFamily: "var(--font-syne), sans-serif",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    {SPORT_LABELS[sport]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Divider />

        {/* ── Session type chips ─────────────────────────────────────────── */}
        <div>
          <SidebarSectionLabel>Type de séance</SidebarSectionLabel>
          <div
            className="session-scroll"
            style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}
          >
            {(PROFILES_BY_SPORT[selectedSport] ?? []).map((profile) => {
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
                    borderRadius: "2px",
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
        </div>

        <Divider />

        {/* ── Mode toggle ────────────────────────────────────────────────── */}
        <div>
          <SidebarSectionLabel>Mode</SidebarSectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>

            {/* PERFORMANCE */}
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
                borderRadius: "2px",
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
                  Performance
                </div>
                <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Route, régularité, surface
                </div>
              </div>
            </button>

            {/* SCENIC */}
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
                borderRadius: "2px",
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
                  Scenic
                </div>
                <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Nature, popularité, découverte
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

        {/* ── Heatmap toggle (always visible, scenic badge) ──────────────── */}
        <Divider />
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "2px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ color: heatmapVisible ? "var(--accent-trail)" : "var(--text-muted)" }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M12 6c0 2-2 4-2 6 0 1.1.9 2 2 2s2-.9 2-2c0-2-2-4-2-6z"/>
              </svg>
              <span
                style={{
                  fontFamily: "var(--font-syne), sans-serif",
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  color: heatmapVisible ? "var(--text-primary)" : "var(--text-muted)",
                  textTransform: "uppercase",
                }}
              >
                Heatmap Strava
              </span>
            </div>
            <button
              type="button"
              onClick={toggleHeatmap}
              aria-label={heatmapVisible ? "Désactiver la heatmap" : "Activer la heatmap"}
              style={{
                position: "relative",
                width: "36px",
                height: "18px",
                borderRadius: "9px",
                border: "none",
                background: heatmapVisible ? "var(--accent-lime)" : "var(--bg-elevated)",
                cursor: "pointer",
                transition: "background 0.2s var(--ease-out-expo)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: heatmapVisible ? "20px" : "2px",
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: "white",
                  transition: "left 0.2s var(--ease-out-expo)",
                }}
              />
            </button>
          </div>

          {heatmapVisible && (
            <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
              {(["all", "running", "ride"] as const).map((sport) => (
                <button
                  key={sport}
                  type="button"
                  onClick={() => setHeatmapSport(sport)}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    borderRadius: "2px",
                    fontFamily: "var(--font-syne), sans-serif",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    border: "1px solid",
                    cursor: "pointer",
                    transition: "all 0.2s var(--ease-out-expo)",
                    textTransform: "uppercase",
                    ...(heatmapSport === sport ? chipActive : chipInactive),
                  }}
                >
                  {sport === "all" ? "Tous" : sport === "running" ? "Course" : "Vélo"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Generate button (sticky bottom) ────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "16px 24px",
          background: "linear-gradient(to top, var(--bg-deep) 80%, transparent)",
          zIndex: 10,
        }}
      >
        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          style={{
            width: "100%",
            height: "52px",
            background: isLoading ? "var(--bg-elevated)" : "var(--accent-lime)",
            color: isLoading ? "var(--text-muted)" : "var(--bg-deep)",
            border: "none",
            borderRadius: "2px",
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
          {isLoading ? LOADING_STEPS[stepIndex] : "GÉNÉRER →"}
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
              borderRadius: "2px",
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
