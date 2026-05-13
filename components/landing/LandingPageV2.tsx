"use client";

import Link from "next/link";
import TrailForgeMark from "@/components/brand/TrailForgeMark";
import GrainOverlay from "@/components/ui/GrainOverlay";

const fieldReadings = [
  ["courbes", "lisière humide", "+124 m"],
  ["surface", "chemin forestier", "63%"],
  ["retour", "propre / fermé", "0.2 km"],
];

const constraints = ["éviter départementales", "garder les bois", "boucle courte", "GPX exportable"];

function FieldMapPlate({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "carto-plate carto-plate-compact" : "carto-plate"} aria-label="Plan cartographique TrailForge">
      <div className="map-sheet-index">IGN-TF / 49.18N · 0.36W</div>
      <svg viewBox="0 0 920 640" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Carte sensible avec courbes de niveau et boucle GPX">
        <defs>
          <pattern id="paperGrid" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M46 0H0V46" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
          </pattern>
          <filter id="mapInk">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="11" />
            <feDisplacementMap in="SourceGraphic" scale="1.15" />
          </filter>
        </defs>
        <rect width="920" height="640" fill="currentColor" opacity="0.03" />
        <rect width="920" height="640" fill="url(#paperGrid)" />
        <g className="map-contours" filter="url(#mapInk)">
          {Array.from({ length: 18 }).map((_, index) => (
            <path
              key={index}
              d={`M ${-80 + index * 13} ${56 + index * 31} C ${118 + index * 6} ${8 + index * 18}, ${220 + index * 20} ${168 + index * 9}, ${360 + index * 10} ${112 + index * 23} S ${655 + index * 10} ${76 + index * 25}, ${1010} ${128 + index * 24}`}
            />
          ))}
          <path className="river" d="M66 540 C162 468 238 476 326 400 C430 310 512 334 610 256 C698 186 774 180 872 110" />
          <path className="track rejected" d="M132 188 C238 222 326 210 420 252 C526 300 608 360 790 358" />
          <path className="track" d="M152 506 C244 430 300 420 370 330 C438 244 522 218 642 240 C724 254 788 214 850 146" />
          <path className="route-shadow" d="M250 488 C154 426 190 270 326 210 C468 148 644 190 690 314 C742 456 568 558 414 552 C342 550 288 526 250 488 Z" />
          <path className="route-line" d="M250 488 C154 426 190 270 326 210 C468 148 644 190 690 314 C742 456 568 558 414 552 C342 550 288 526 250 488 Z" />
          <circle className="start-pin" cx="250" cy="488" r="6" />
        </g>
        <g className="map-labels">
          <text x="84" y="148">BOIS DENSE</text>
          <text x="604" y="196">CRÊTE BASSE</text>
          <text x="540" y="540">RETOUR PROPRE</text>
          <text x="78" y="594">départ · parking du bois</text>
        </g>
      </svg>
      <div className="map-annotation map-annotation-a">trace proposée après lecture des corridors</div>
      <div className="map-annotation map-annotation-b">route rejetée : trop ouverte</div>
      <div className="map-scale"><span /> 500 m</div>
    </div>
  );
}

export default function LandingPageV2() {
  return (
    <main className="field-landing">
      <GrainOverlay opacity={0.075} />
      <nav className="field-nav" aria-label="Navigation TrailForge">
        <TrailForgeMark href="/" />
        <div>
          <a href="#lecture">Lecture</a>
          <a href="#instrument">Instrument</a>
          <Link href="/app">Ouvrir la carte</Link>
        </div>
      </nav>

      <section className="field-hero" data-od-id="landing-field-hero">
        <div className="hero-map-stage">
          <FieldMapPlate />
        </div>
        <aside className="departure-cartouche" aria-label="Cartouche de départ">
          <span className="cartouche-kicker">départ choisi</span>
          <strong>Parking du bois</strong>
          <p>8 km · 150 m D+ · forêt profonde · retour propre</p>
          <Link href="/app" className="field-cta">Dessiner la boucle</Link>
        </aside>
        <div className="hero-statement">
          <p className="field-kicker">instrument GPX / carnet de terrain</p>
          <h1>Laisse le terrain dessiner ta sortie.</h1>
          <p className="field-lede">TrailForge lit chemins, relief, lisières et mauvais retours avant de proposer une boucle courte exportable en GPX.</p>
        </div>
      </section>

      <section id="lecture" className="reading-strip" data-od-id="terrain-reading-strip">
        <div className="folio">01 / lecture terrain</div>
        {fieldReadings.map(([label, value, metric]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <em>{metric}</em>
          </article>
        ))}
      </section>

      <section className="field-spread" data-od-id="cartographic-sequence">
        <div className="spread-copy">
          <p className="field-kicker">composition, pas marketing</p>
          <h2>La carte hésite d’abord. Elle écarte ensuite. La boucle vient à la fin.</h2>
          <p>Le produit ne promet pas une sortie parfaite. Il rend visibles les compromis : densité de chemins, fermeture de boucle, surface inconnue, écart au D+. Le silence de l’interface laisse la carte travailler.</p>
        </div>
        <div className="constraint-ledger">
          {constraints.map((constraint, index) => (
            <div key={constraint}><span>{String(index + 1).padStart(2, "0")}</span>{constraint}</div>
          ))}
        </div>
      </section>

      <section id="instrument" className="instrument-spread" data-od-id="app-preview-spread">
        <FieldMapPlate compact />
        <div className="instrument-copy">
          <p className="field-kicker">dans l’app</p>
          <h2>Une console de préparation, pas un formulaire SaaS.</h2>
          <p>Départ, distance, D+, ambiance, contraintes. Les métriques servent la sortie ; elles ne deviennent pas un mini-dashboard.</p>
          <Link href="/app" className="field-cta">Dessiner la boucle</Link>
        </div>
      </section>
    </main>
  );
}
