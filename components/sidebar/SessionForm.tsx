"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { buildRouteIntentionCard } from "@/lib/route-intentions";
import type { GenerateRouteApiResponse, GenerateRouteError, GenerateRouteRequest } from "@/lib/types";
import AddressInput from "@/components/sidebar/AddressInput";

const LOADING_STEPS = ["lecture du terrain", "corridors", "retour propre", "GPX propre"];
const PHASE1_PROFILE_IDS = ["running_trail_decouverte", "running_trail", "running_endurance"] as const;
const PHASE1_PROFILES = PHASE1_PROFILE_IDS.map((id) => PROFILES_BY_ID.get(id)).filter((profile): profile is NonNullable<typeof profile> => profile != null);
const PHASE1_MAX_DISTANCE_KM = 15;
const PHASE1_MAX_ELEVATION_M = 600;
const INTENTION_COPY: Record<string, { label: string; caption: string }> = {
  running_trail_decouverte: { label: "Lisières calmes", caption: "Accessible, chemins lisibles, peu de surprise." },
  running_trail: { label: "Chemins sauvages", caption: "Plus de sentiers, plus de caractère." },
  running_endurance: { label: "Sortie roulante", caption: "Boucle régulière, effort continu." },
};

function ConsoleLabel({ children, value }: { children: React.ReactNode; value?: React.ReactNode }) {
  return <div className="console-label"><span>{children}</span>{value}</div>;
}

export default function SessionForm() {
  const {
    address, setAddress, selectedProfileId, setProfileId, targetDistanceKm, setTargetDistance,
    targetElevationM, setTargetElevation, status, setLoading, setSuccess, setError, errorMessage,
    scenicMode, setScenicMode, setMapCenter, setSidebarOpen, setSuccessV3,
  } = useAppStore();

  const [stepIndex, setStepIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [experimentalV3, setExperimentalV3] = useState(false);
  const isLoading = status === "loading";
  const canGenerate = address.trim().length > 2 && !isLoading;
  const currentProfile = PROFILES_BY_ID.get(selectedProfileId);
  const routeIntention = currentProfile ? buildRouteIntentionCard(currentProfile, scenicMode) : null;
  const distMin = Math.max(currentProfile?.distanceRange.min ?? 5, 5);
  const elevMin = Math.max(currentProfile?.elevationRange.min ?? 50, 50);
  const distPresets = useMemo(() => [5, 8, 10, 12, 15], []);
  const elevPresets = useMemo(() => [50, 150, 250, 400, 600], []);

  useEffect(() => {
    if (!isLoading) {
      const reset = setTimeout(() => { setStepIndex(0); setProgressPct(0); }, 0);
      return () => clearTimeout(reset);
    }
    const pcts = [18, 44, 72, 92];
    const timers = [0, 1600, 3900, 6800].map((delay, index) => setTimeout(() => { setStepIndex(index); setProgressPct(pcts[index]); }, delay));
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

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
    navigator.geolocation.getCurrentPosition((pos) => {
      const { longitude, latitude } = pos.coords;
      setAddress(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      setMapCenter({ lat: latitude, lng: longitude });
    }, (err) => console.warn("Geolocation failed:", err));
  };

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !PROFILES_BY_ID.has(selectedProfileId)) return;
    setLoading();
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
    const body: GenerateRouteRequest & { scenicMode?: boolean } = {
      address: address.trim(), profileId: selectedProfileId,
      targetDistanceKm: Math.min(targetDistanceKm, PHASE1_MAX_DISTANCE_KM),
      targetElevationM: Math.min(targetElevationM, PHASE1_MAX_ELEVATION_M),
      scenicMode: scenicMode || undefined,
      engineVersion: experimentalV3 ? "v3_experimental" : undefined,
    };
    try {
      const res = await fetch("/api/generate-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data: GenerateRouteApiResponse | GenerateRouteError = await res.json();
      if (data.success && data.engine === "v3-clean-room") {
        setSuccessV3(data);
      } else if (data.success && "route" in data) {
        setSuccess(data.route);
      } else if (!data.success) {
        setError(data.error, data);
      } else {
        setError("Réponse route invalide. Aucun tracé exploitable reçu.");
      }
    } catch { setError("Erreur réseau. Réessaie dans quelques secondes."); }
  }, [address, canGenerate, experimentalV3, scenicMode, selectedProfileId, setError, setLoading, setSidebarOpen, setSuccess, setSuccessV3, targetDistanceKm, targetElevationM]);

  const chipProps = (active: boolean) => ({ className: "field-chip", "data-active": active });

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleGenerate(); }} className="prep-console pb-6" aria-label="Console de préparation terrain">
      <header className="console-header">
        <p className="field-kicker">console de terrain · beta</p>
        <h1>Préparer la boucle.</h1>
        <p>Laisse le terrain dessiner une boucle GPX autour de ton départ.</p>
        <p>TrailForge cherche une boucle GPX courte autour de ton départ. La fiabilité sera affichée avant export.</p>
      </header>

      <section className="console-section">
        <ConsoleLabel>Départ</ConsoleLabel>
        <AddressInput id="address" value={address} onChange={setAddress} placeholder="adresse, parking, carrefour…" disabled={isLoading} dark />
        <button type="button" className="field-chip mt-2" onClick={handleGeolocate} disabled={isLoading}>utiliser ma position</button>
      </section>

      <section className="console-section">
        <ConsoleLabel value={<span className="console-value">{targetDistanceKm} km</span>}>Distance</ConsoleLabel>
        <input type="range" min={distMin} max={PHASE1_MAX_DISTANCE_KM} step={1} value={targetDistanceKm} onChange={(e) => setTargetDistance(Number(e.target.value))} disabled={isLoading} className="trailforge-slider" aria-label={`Distance cible : ${targetDistanceKm} km`} />
        <div className="preset-row">{distPresets.map((v) => <button key={v} type="button" onClick={() => setTargetDistance(v)} disabled={isLoading} {...chipProps(targetDistanceKm === v)}>{v} km</button>)}</div>
      </section>

      <section className="console-section">
        <ConsoleLabel value={<span className="console-value">{targetElevationM} m</span>}>D+</ConsoleLabel>
        <input type="range" min={elevMin} max={PHASE1_MAX_ELEVATION_M} step={50} value={targetElevationM} onChange={(e) => setTargetElevation(Number(e.target.value))} disabled={isLoading} className="trailforge-slider" aria-label={`Dénivelé positif : ${targetElevationM} m`} />
        <div className="preset-row">{elevPresets.map((v) => <button key={v} type="button" onClick={() => setTargetElevation(v)} disabled={isLoading} {...chipProps(targetElevationM === v)}>{v} m</button>)}</div>
      </section>

      <section className="console-section">
        <ConsoleLabel>Style de sortie</ConsoleLabel>
        <div className="choice-grid">
          {PHASE1_PROFILES.map((profile) => {
            const active = selectedProfileId === profile.id;
            const copy = INTENTION_COPY[profile.id] ?? { label: profile.name, caption: profile.description };
            return <button key={profile.id} type="button" className="intent-option" data-active={active} onClick={() => handleProfileChange(profile.id)} disabled={isLoading}><strong>{copy.label}</strong><span>{copy.caption}</span></button>;
          })}
        </div>
      </section>

      <section className="console-section">
        <ConsoleLabel>Préférence terrain</ConsoleLabel>
        <div className="choice-grid">
          <button type="button" className="constraint-toggle" data-active={!scenicMode} onClick={() => setScenicMode(false)} disabled={isLoading}>Trace plus fiable</button>
          <button type="button" className="constraint-toggle" data-active={scenicMode} onClick={() => setScenicMode(true)} disabled={isLoading}>Plus sauvage</button>
        </div>
        {routeIntention && <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-muted)]">{routeIntention.promise}</p>}
      </section>

      <section className="console-section">
        <ConsoleLabel>Expérimental</ConsoleLabel>
        <button type="button" className="constraint-toggle" data-active={experimentalV3} onClick={() => setExperimentalV3((value) => !value)} disabled={isLoading} aria-pressed={experimentalV3}>
          V3 clean-room {experimentalV3 ? "activée" : "désactivée"}
        </button>
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Opt-in manuel: V2.5 reste le moteur par défaut. V3 affiche des labels honnêtes et peut refuser plutôt que maquiller une trace.
        </p>
      </section>

      <footer className="console-footer">
        {isLoading && <div className="loading-note" aria-live="polite"><div className="loading-bar"><span style={{ width: `${progressPct}%` }} /></div>{LOADING_STEPS[stepIndex]}</div>}
        {status === "error" && <div className="error-note" role="alert"><strong>Pas de boucle fiable trouvée</strong><br />Note terrain : {errorMessage?.toLowerCase().includes("réseau") ? "réseau instable, paramètres conservés." : "pas assez de chemins continus pour tenir ces paramètres."}<div className="error-actions"><button type="button" className="field-chip" onClick={() => setTargetElevation(Math.max(elevMin, targetElevationM - 100))}>Réduire le D+</button><button type="button" className="field-chip" onClick={() => setTargetDistance(Math.min(PHASE1_MAX_DISTANCE_KM, targetDistanceKm + 1))}>Allonger un peu</button><button type="button" className="field-chip" onClick={() => document.getElementById("address")?.focus()}>Changer le départ</button>{scenicMode && <button type="button" className="field-chip" onClick={() => setScenicMode(false)}>Prioriser trace fiable</button>}</div></div>}
        <button type="submit" className="draw-submit" disabled={!canGenerate} aria-busy={isLoading}>{isLoading ? "lecture en cours" : "Dessiner la boucle"}</button>
      </footer>
    </form>
  );
}
