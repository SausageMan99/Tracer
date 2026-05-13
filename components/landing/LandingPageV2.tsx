"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import TrailForgeMark from "@/components/brand/TrailForgeMark";
import GrainOverlay from "@/components/ui/GrainOverlay";

const palette = [
  ["Parchemin", "#E6D6C4"],
  ["Forêt", "#0B1F17"],
  ["Pierre", "#A89C90"],
  ["Noir", "#0A0A0A"],
];

const keywords = ["Organique", "Technique", "Exploratoire"];
const motifs = ["Point de passage", "Route", "Courbe de niveau", "Sommet", "Boussole"];
const touchpoints = ["Icône app", "Écran mobile", "Hero web", "Carte d’itinéraire", "Sticker", "Étiquette tissée", "Marquage t-shirt", "Carnet / carte terrain", "Avatar social"];

function TerrainGlyph({ index }: { index: number }) {
  const paths = [
    "M33 14 C50 22 44 44 62 54 C72 60 84 54 91 68",
    "M17 70 C34 38 58 26 84 20 C74 44 82 66 104 82",
    "M18 38 C38 22 62 28 78 45 C96 64 112 54 124 42",
    "M24 86 L52 34 L74 72 L88 50 L112 86",
    "M66 16 L78 66 L66 116 L54 66 Z",
  ];
  return (
    <svg viewBox="0 0 132 132" aria-hidden="true">
      <path className="tf-glyph-contour" d="M-8 42 C28 20 58 24 86 46 C106 62 126 54 142 34" />
      <path className="tf-glyph-contour" d="M-10 78 C28 54 62 60 90 82 C112 100 130 92 144 74" />
      <path className="tf-glyph-main" d={paths[index % paths.length]} />
      <circle cx="33" cy="14" r="3.5" />
    </svg>
  );
}

function BrandRouteMap({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "tf-brand-map tf-brand-map-compact" : "tf-brand-map"} aria-label="Carte TrailForge avec boucle GPX">
      <div className="tf-map-index">TRAILFORGE.COM / TERRAIN GPX</div>
      <svg viewBox="0 0 760 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Courbes de niveau et route générée">
        <defs>
          <pattern id="brandGrid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M42 0H0V42" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          </pattern>
          <filter id="roughInk">
            <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="17" />
            <feDisplacementMap in="SourceGraphic" scale="1.3" />
          </filter>
        </defs>
        <rect width="760" height="520" fill="url(#brandGrid)" opacity=".9" />
        <g className="tf-contours" filter="url(#roughInk)">
          {Array.from({ length: 14 }).map((_, index) => (
            <path key={index} d={`M ${-80 + index * 19} ${70 + index * 28} C ${90 + index * 18} ${18 + index * 8}, ${198 + index * 24} ${168 + index * 4}, ${330 + index * 11} ${116 + index * 20} S ${560 + index * 9} ${86 + index * 20}, 850 ${124 + index * 18}`} />
          ))}
          <path className="tf-secondary" d="M92 398 C168 316 230 342 302 252 C390 142 486 162 606 88" />
          <path className="tf-rejected" d="M118 122 C216 156 288 150 372 190 C464 234 534 282 680 274" />
          <path className="tf-route-halo" d="M216 398 C130 332 158 198 274 142 C402 80 566 132 600 250 C640 384 478 466 342 456 C286 452 244 430 216 398 Z" />
          <path className="tf-route" d="M216 398 C130 332 158 198 274 142 C402 80 566 132 600 250 C640 384 478 466 342 456 C286 452 244 430 216 398 Z" />
          <circle className="tf-start" cx="216" cy="398" r="6" />
        </g>
        <g className="tf-map-labels">
          <text x="72" y="78">CORRIDOR FORESTIER</text>
          <text x="492" y="132">LIGNE DE CRÊTE</text>
          <text x="464" y="462">RETOUR FERMÉ</text>
        </g>
      </svg>
      <div className="tf-map-note tf-map-note-a">trace retenue après lecture des corridors</div>
      <div className="tf-map-note tf-map-note-b">route rejetée · trop ouverte</div>
    </div>
  );
}

function RouteCard() {
  return (
    <article className="tf-route-card" aria-label="Exemple de carte route">
      <div className="tf-route-card-map"><BrandRouteMap compact /></div>
      <div className="tf-route-card-body">
        <span>Modéré</span>
        <strong>Boucle des crêtes</strong>
        <p>Forêt, lisières, retour propre</p>
        <div><em>12,4 km</em><em>+450 m</em><em>1h20</em></div>
      </div>
    </article>
  );
}

export default function LandingPageV2() {
  return (
    <main className="tf-brand-landing">
      <GrainOverlay opacity={0.1} />
      <nav className="tf-brand-nav" aria-label="Navigation TrailForge">
        <TrailForgeMark href="/" />
        <div>
          <a href="#identity">Identité</a>
          <a href="#system">Système graphique</a>
          <a href="#touchpoints">Supports</a>
          <Link href="/app">Ouvrir l’app</Link>
        </div>
      </nav>

      <section id="identity" className="tf-brand-hero" data-od-id="brand-board-hero">
        <div className="tf-hero-left">
          <p className="tf-brand-kicker">MARQUE PRINCIPALE / WORDMARK & DESCRIPTEUR</p>
          <div className="tf-hero-lockup">
            <Image src="/trailforge-mark.png" alt="" width={998} height={998} priority />
            <div>
              <h1>TRAILFORGE</h1>
              <p>Génération de routes pour trail running & vélo</p>
            </div>
          </div>
          <div className="tf-keywords" aria-label="Mots-clés de marque">
            {keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
          </div>
          <p className="tf-brand-lede">Une marque fluide forgée par le terrain et le mouvement. TrailForge lit les chemins, compose la sortie et laisse de l’espace à l’exploration.</p>
          <div className="tf-hero-actions">
            <Link href="/app" className="tf-brand-cta">Dessiner la boucle</Link>
            <Link href="/app" className="tf-brand-cta tf-brand-cta-secondary">Dessiner la boucle</Link>
          </div>
        </div>

        <div className="tf-hero-board" aria-label="TrailForge app icon and route preview">
          <div className="tf-app-icon"><Image src="/trailforge-mark.png" alt="Logo TrailForge" width={998} height={998} /></div>
          <div className="tf-mobile-splash">
            <Image src="/trailforge-mark.png" alt="" width={998} height={998} />
            <strong>TRAILFORGE</strong>
            <span>Continuer dehors</span>
          </div>
          <BrandRouteMap />
        </div>
      </section>

      <section className="tf-identity-strip" aria-label="Palette et typographies">
        <div className="tf-palette tf-palette-inline">
          {palette.map(([name, color]) => (
            <article key={name} style={{ "--swatch": color } as CSSProperties}>
              <span />
              <strong>{name}</strong>
              <em>{color}</em>
            </article>
          ))}
        </div>
        <div className="tf-type-board">
          <p className="tf-brand-kicker">TYPOGRAPHIE</p>
          <div><strong>Shibuya Display</strong><span>Organique. Fluide. Expressif.</span></div>
          <div><strong>Söhne Kraftig</strong><span>Technique. Net. Précis.</span></div>
          <p className="tf-type-sample">ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</p>
        </div>
      </section>

      <section id="system" className="tf-system-board" aria-label="Système graphique TrailForge">
        <div className="tf-system-heading">
          <div>
            <p className="tf-brand-kicker">SYSTÈME GRAPHIQUE</p>
            <h2>Pensé pour explorer. Dessiné pour durer.</h2>
          </div>
          <p>Un langage de points de passage, routes, courbes, sommets, boussole, chemins et flux — assez technique pour le GPX, assez tactile pour le terrain.</p>
        </div>
        <div className="tf-motifs">
          {motifs.map((motif, index) => (
            <article key={motif}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <TerrainGlyph index={index} />
              <strong>{motif}</strong>
            </article>
          ))}
        </div>
        <div className="tf-pattern-row">
          <article><span>06</span><strong>Système de motifs</strong><em>Courbes · chemins · sommets · flux</em></article>
          <article><span>07</span><strong>Badge compact</strong><em>TRAILFORGE / GPX / Données route</em></article>
          <article><span>08</span><strong>Mono + inversé</strong><em>Parchemin sur forêt, forêt sur parchemin</em></article>
        </div>
      </section>

      <section id="touchpoints" className="tf-touchpoints" data-od-id="brand-touchpoints">
        <div>
          <p className="tf-brand-kicker">APPLICATIONS & SUPPORTS</p>
          <h2>TrailForge doit vivre sur tous les supports d’aventure — numérique, textile, terrain.</h2>
          <p>Découvrir des boucles reculées, préparer la sortie avec confiance, partager la trace sans perdre l’identité outdoor.</p>
          <Link href="/app" className="tf-brand-cta">Dessiner la boucle</Link>
        </div>
        <div className="tf-touchpoint-grid">
          <div className="tf-touchpoint-large"><RouteCard /></div>
          {touchpoints.map((item, index) => (
            <article key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {index % 3 === 0 ? <Image src="/trailforge-mark.png" alt="" width={998} height={998} /> : <TerrainGlyph index={index} />}
              <strong>{item}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="tf-application-board" data-od-id="brand-application-preview">
        <BrandRouteMap compact />
        <div>
          <p className="tf-brand-kicker">APPLICATION PRODUIT</p>
          <h2>Une console terrain, pas une skin SaaS.</h2>
          <p>Le produit garde une seule action claire : choisir le départ, lire les contraintes, puis dessiner une boucle GPX honnête.</p>
          <Link href="/app" className="tf-brand-cta">Dessiner la boucle</Link>
        </div>
      </section>
    </main>
  );
}
