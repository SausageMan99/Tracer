"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import TrailForgeMark from "@/components/brand/TrailForgeMark";
import GrainOverlay from "@/components/ui/GrainOverlay";
import { gsap, ScrollTrigger } from "@/lib/gsap-setup";

const TerrainCanvas = dynamic(
  () => import("@/components/landing/TerrainCanvas"),
  { ssr: false, loading: () => null }
);

const moods = [
  { label: "Forêt profonde", note: "chemins couverts · lisières · silence" },
  { label: "Bords d’eau", note: "rives calmes · passages ouverts" },
  { label: "Chemins sauvages", note: "traces discrètes · terrain vivant" },
  { label: "D+ doux", note: "relief présent · effort maîtrisé" },
];

const routeCards = [
  {
    name: "Boucle des lisières humides",
    meta: "8,4 km · 124 m D+ · 63% chemins naturels",
    body: "Une boucle calme qui quitte vite les axes ouverts pour suivre les bois, puis revient par une trace roulante.",
  },
  {
    name: "Tour des chemins clairs",
    meta: "11,2 km · 210 m D+ · GPX prêt",
    body: "Une sortie plus longue, pensée pour garder du rythme sans perdre la sensation de terrain.",
  },
];

const compositionSteps = [
  ["01", "Lire", "chemins, ruptures de pente, eau, bois"],
  ["02", "Écarter", "routes parasites, retours trop sales, faux raccourcis"],
  ["03", "Composer", "une boucle fermée qui garde du caractère"],
];

function LivingMapHero() {
  return (
    <div className="living-map" aria-hidden="true">
      <TerrainCanvas cameraY={42} cameraZ={78} opacity={0.34} />
      <svg className="living-map-svg" viewBox="0 0 920 720" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="tf-wobble">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="1.8" />
          </filter>
          <radialGradient id="tf-glow" cx="52%" cy="48%" r="46%">
            <stop offset="0%" stopColor="#D7E8B0" stopOpacity="0.16" />
            <stop offset="62%" stopColor="#2F4A36" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#07110D" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="920" height="720" fill="url(#tf-glow)" />
        {Array.from({ length: 14 }).map((_, i) => (
          <path
            key={i}
            className="living-contour"
            style={{ animationDelay: `${i * 0.18}s` }}
            d={`M ${-90 + i * 16} ${88 + i * 37} C ${92 + i * 14} ${32 + i * 26}, ${246 + i * 16} ${206 + i * 16}, ${418 + i * 8} ${142 + i * 31} S ${726 + i * 12} ${112 + i * 36}, ${1010} ${170 + i * 27}`}
          />
        ))}
        <path className="living-secondary living-secondary-a" d="M102 512 C190 460 252 468 324 408 C405 338 475 318 562 344 C628 363 692 318 770 246" />
        <path className="living-secondary living-secondary-b" d="M214 128 C244 220 338 248 420 238 C532 224 620 284 672 382 C708 450 765 496 848 506" />
        <path className="living-ghost living-ghost-a" d="M148 604 C248 548 350 602 468 502 C560 424 674 430 812 350" />
        <path className="living-ghost living-ghost-b" d="M88 318 C210 292 274 346 390 300 C492 260 594 178 790 178" />
        <path className="living-route-shadow" d="M258 504 C154 456 176 314 300 250 C410 193 596 182 664 276 C738 379 625 525 475 552 C392 566 314 546 258 504 Z" />
        <path className="living-route" d="M258 504 C154 456 176 314 300 250 C410 193 596 182 664 276 C738 379 625 525 475 552 C392 566 314 546 258 504 Z" />
        <circle className="living-start" cx="258" cy="504" r="6" />
        <g className="living-labels">
          <text x="118" y="178">BOIS DENSE</text>
          <text x="626" y="210">LIGNE DE CRÊTE</text>
          <text x="580" y="565">RETOUR CALME</text>
          <text x="72" y="590">49.18N · 0.36W</text>
        </g>
      </svg>
    </div>
  );
}

function FieldPanel() {
  return (
    <div className="field-panel" aria-label="Aperçu du générateur TrailForge">
      <div className="field-panel-header">
        <span>Préparer une sortie</span>
        <em>beta fermée</em>
      </div>
      <label>
        Point de départ
        <span className="fake-input">Parking du bois, Caen</span>
      </label>
      <div className="field-grid">
        <label>
          Distance
          <span className="fake-value">8 km</span>
        </label>
        <label>
          Dénivelé
          <span className="fake-value">150 m</span>
        </label>
      </div>
      <label>
        Ambiance
        <span className="fake-input accent">Forêt profonde · chemins calmes</span>
      </label>
      <Link href="/app" className="draw-button">Dessiner la boucle</Link>
    </div>
  );
}

function CompositionLab() {
  return (
    <div className="composition-lab" aria-label="Séquence de composition d'une boucle">
      <div className="lab-map">
        <svg viewBox="0 0 520 420" preserveAspectRatio="xMidYMid meet">
          <path className="lab-contour" d="M32 118 C130 40 260 56 360 118 C438 166 486 138 538 92" />
          <path className="lab-contour" d="M-10 220 C110 156 218 176 304 230 C398 290 470 256 550 198" />
          <path className="lab-contour" d="M48 336 C146 278 238 302 330 344 C410 382 470 360 528 310" />
          <path className="lab-vein" d="M70 310 C148 246 216 238 286 182 C338 140 394 120 470 82" />
          <path className="lab-vein lab-vein-muted" d="M104 108 C180 164 238 172 302 212 C368 254 420 286 470 348" />
          <path className="lab-choice" d="M144 300 C96 220 146 128 258 104 C370 80 454 154 430 252 C408 344 262 374 144 300 Z" />
          <circle cx="144" cy="300" r="5" />
        </svg>
      </div>
      <div className="lab-steps">
        {compositionSteps.map(([kicker, title, text]) => (
          <article key={title}>
            <span>{kicker}</span>
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function LandingPageV2() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.from(".tf-landing-nav", { y: -18, opacity: 0, duration: 0.8, ease: "power3.out" });
      gsap.from(".tf-hero-copy > *", { y: 34, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.11, delay: 0.18 });
      gsap.from(".field-panel", { y: 48, opacity: 0, rotate: -0.4, duration: 1.1, ease: "power3.out", delay: 0.48 });

      gsap.utils.toArray<HTMLElement>(".tf-act-section, .tf-mood-section, .tf-route-section, .tf-product-reveal, .tf-final-cta").forEach((section) => {
        gsap.from(section.querySelectorAll("h2, .eyebrow, p, article, .composition-lab, .field-panel, .tf-mark"), {
          y: 36,
          opacity: 0,
          duration: 0.82,
          ease: "power3.out",
          stagger: 0.06,
          scrollTrigger: { trigger: section, start: "top 72%" },
        });
      });

      gsap.to(".living-map", {
        yPercent: 8,
        scale: 1.05,
        ease: "none",
        scrollTrigger: { trigger: ".tf-hero-section", start: "top top", end: "bottom top", scrub: true },
      });
    }, rootRef);

    return () => {
      ctx.revert();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return (
    <main ref={rootRef} className="tf-landing">
      <GrainOverlay opacity={0.055} />
      <nav className="tf-landing-nav">
        <TrailForgeMark href="/" />
        <div>
          <a href="#moods">Ambiances</a>
          <a href="#composition">Composition</a>
          <a href="#product">Produit</a>
          <Link href="/app">Ouvrir l’app</Link>
        </div>
      </nav>

      <section className="tf-hero-section">
        <LivingMapHero />
        <div className="tf-hero-copy">
          <p className="eyebrow">instrument cartographique · GPX · trail</p>
          <h1>Laisse le terrain dessiner ta sortie.</h1>
          <p className="lead">
            TrailForge lit les chemins, le relief et les zones naturelles autour de ton départ pour composer une boucle qui a du caractère.
          </p>
          <div className="hero-actions">
            <Link href="/app" className="primary-action">Dessiner une boucle</Link>
            <span>pas de dashboard · pas de route parfaite · une trace honnête à éprouver dehors</span>
          </div>
        </div>
        <FieldPanel />
      </section>

      <section className="tf-act-section tf-act-terrain">
        <div className="act-number">01</div>
        <div>
          <p className="eyebrow">le terrain d’abord</p>
          <h2>Pas une optimisation abstraite. Une lecture du lieu.</h2>
        </div>
        <p>
          Le produit doit donner l’impression d’observer les bois, les lisières, l’eau, les ruptures de pente et les chemins continus avant de proposer une boucle. Les métriques existent, mais elles arrivent après le terrain.
        </p>
      </section>

      <section id="moods" className="tf-mood-section">
        <div className="section-intro">
          <p className="eyebrow">choisir une envie</p>
          <h2>Les filtres deviennent des ambiances de sortie.</h2>
        </div>
        <div className="mood-grid">
          {moods.map((mood) => (
            <article key={mood.label} className="mood-card">
              <span />
              <h3>{mood.label}</h3>
              <p>{mood.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="composition" className="tf-route-section tf-route-section-lab">
        <div className="route-stage-card">
          <p className="eyebrow">composition cartographique</p>
          <h2>La carte hésite, écarte, puis stabilise une boucle.</h2>
          <p>
            L’interaction doit montrer une forme de jugement : lire les corridors, refuser les mauvais retours, préserver le caractère de la sortie. C’est là que TrailForge s’éloigne d’un simple générateur.
          </p>
        </div>
        <CompositionLab />
      </section>

      <section className="tf-route-section">
        <div className="route-stage-card">
          <p className="eyebrow">la boucle apparaît</p>
          <h2>Une animation signature, pas un décor.</h2>
          <p>
            Courbes de niveau qui respirent, chemins secondaires qui s’allument, zones parasites qui s’effacent, puis une trace lichen qui se stabilise. Le geste de marque doit faire sentir que la carte compose la sortie.
          </p>
        </div>
        <div className="route-card-stack">
          {routeCards.map((route) => (
            <article key={route.name} className="editorial-route-card">
              <p>{route.meta}</p>
              <h3>{route.name}</h3>
              <span>{route.body}</span>
            </article>
          ))}
        </div>
      </section>

      <section id="product" className="tf-product-reveal">
        <div>
          <p className="eyebrow">preuve produit</p>
          <h2>L’interface arrive tard, comme l’instrument derrière l’expérience.</h2>
          <p>
            Le générateur doit rester simple : départ, distance, ambiance, D+. Le résultat doit donner envie de sortir : nom de boucle, carte lisible, GPX visible, fiabilité honnête.
          </p>
        </div>
        <FieldPanel />
      </section>

      <section className="tf-final-cta">
        <TrailForgeMark />
        <h2>Une carte qui donne envie de sortir, pas un SaaS qui parle d’IA.</h2>
        <Link href="/app" className="primary-action">Tester le nouveau flow</Link>
      </section>
    </main>
  );
}
