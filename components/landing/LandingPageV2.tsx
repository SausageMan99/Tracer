"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import TrailForgeMark from "@/components/brand/TrailForgeMark";
import GrainOverlay from "@/components/ui/GrainOverlay";

const palette = [
  ["Parchment", "#E6D6C4"],
  ["Forest", "#0B1F17"],
  ["Stone", "#A89C90"],
  ["Black", "#0A0A0A"],
];

const motifs = ["Waypoint", "Route", "Contour", "Peak", "Compass"];
const keywords = ["Organic", "Technical", "Exploratory"];

function BrandRouteMap({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "tf-brand-map tf-brand-map-compact" : "tf-brand-map"} aria-label="Carte TrailForge avec boucle GPX">
      <div className="tf-map-index">NO.04 / APP ICON · GPX</div>
      <svg viewBox="0 0 760 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Courbes de niveau et route générée">
        <defs>
          <pattern id="brandGrid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M42 0H0V42" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          </pattern>
          <filter id="roughInk">
            <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="2" seed="17" />
            <feDisplacementMap in="SourceGraphic" scale="1.2" />
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
          <text x="72" y="78">FOREST CORRIDOR</text>
          <text x="492" y="132">RIDGE LINE</text>
          <text x="464" y="462">CLOSED RETURN</text>
        </g>
      </svg>
      <div className="tf-map-note tf-map-note-a">trace retenue après lecture des corridors</div>
      <div className="tf-map-note tf-map-note-b">route rejetée · trop ouverte</div>
    </div>
  );
}

export default function LandingPageV2() {
  return (
    <main className="tf-brand-landing">
      <GrainOverlay opacity={0.09} />
      <nav className="tf-brand-nav" aria-label="Navigation TrailForge">
        <TrailForgeMark href="/" />
        <div>
          <a href="#system">Graphic system</a>
          <a href="#app">Applications</a>
          <Link href="/app">Open app</Link>
        </div>
      </nav>

      <section className="tf-brand-hero" data-od-id="brand-faithful-hero">
        <div className="tf-hero-left">
          <p className="tf-brand-kicker">PRIMARY MARK / WORDMARK DESCRIPTOR</p>
          <div className="tf-hero-lockup">
            <Image src="/trailforge-mark.png" alt="" width={998} height={998} priority />
            <div>
              <h1>TRAILFORGE</h1>
              <p>Route generation for trail running & cycling</p>
            </div>
          </div>
          <div className="tf-keywords" aria-label="Brand keywords">
            {keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
          </div>
          <p className="tf-brand-lede">A fluid mark forged by terrain and movement. TrailForge maps the wild, shapes the journey, and leaves space to explore.</p>
          <Link href="/app" className="tf-brand-cta">Forge your path</Link>
        </div>

        <div className="tf-hero-board" aria-label="TrailForge app icon and route preview">
          <div className="tf-app-icon"><Image src="/trailforge-mark.png" alt="Logo TrailForge" width={998} height={998} /></div>
          <BrandRouteMap />
        </div>
      </section>

      <section id="system" className="tf-system-board" aria-label="TrailForge graphic system">
        <div className="tf-system-heading">
          <p className="tf-brand-kicker">GRAPHIC SYSTEM</p>
          <h2>Built from route, contour, compass and field notes.</h2>
        </div>
        <div className="tf-palette">
          {palette.map(([name, color]) => (
            <article key={name} style={{ "--swatch": color } as CSSProperties}>
              <span />
              <strong>{name}</strong>
              <em>{color}</em>
            </article>
          ))}
        </div>
        <div className="tf-motifs">
          {motifs.map((motif, index) => (
            <article key={motif}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <strong>{motif}</strong>
            </article>
          ))}
        </div>
      </section>

      <section id="app" className="tf-application-board" data-od-id="brand-application-preview">
        <BrandRouteMap compact />
        <div>
          <p className="tf-brand-kicker">APPLICATIONS & TOUCHPOINTS</p>
          <h2>Le produit doit ressembler à une carte de terrain, pas à une skin SaaS.</h2>
          <p>La console garde une seule action claire : choisir le départ, lire les contraintes, puis dessiner une boucle GPX honnête.</p>
          <Link href="/app" className="tf-brand-cta">Dessiner la boucle</Link>
        </div>
      </section>
    </main>
  );
}
