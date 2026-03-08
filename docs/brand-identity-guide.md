# TrailForge — Brand Identity Guide

**Version:** 1.0
**Date:** 2026-03-07
**Status:** Reference document

---

## Table of Contents

1. [Brand Foundation](#1-brand-foundation)
2. [Color System](#2-color-system)
3. [Typography System](#3-typography-system)
4. [Logo System — Adobe Illustrator Guide](#4-logo-system--adobe-illustrator-guide)
5. [Visual Elements](#5-visual-elements)
6. [Motion & Animation](#6-motion--animation)
7. [Photography & Imagery Direction](#7-photography--imagery-direction)
8. [Higgsfield AI — Video Content Prompts](#8-higgsfield-ai--video-content-prompts)
9. [Asset File Structure](#9-asset-file-structure)
10. [Social Media Templates](#10-social-media-templates)

---

## 1. Brand Foundation

### Vision

> TrailForge — Forge ton prochain parcours en 10 secondes.
> Le seul generateur de parcours GPS qui comprend ton sport, ton terrain et ton niveau.

### Brand Personality

- **Warm, not corporate.** "Un nouveau chemin t'attend" — not "Optimisez vos performances"
- **Organic, handcrafted.** The app feels like unfolding a topo map on the hood of a car
- **Anti-screen-time.** Users spend <30 seconds in the app, then go outside
- **Discovery-driven.** Every route is an adventure, not a routine
- **No toxic gamification.** No infinite feed, no addictive notifications

### Key Metaphor

**"La carte IGN depliee sur le capot"** — A topographic map unfolded on the hood of a car before a hike. This is the aesthetic north star for everything: textures, shapes, colors, illustrations.

### Tone of Voice

| Do | Don't |
|---|---|
| "Ce parcours passe par un sentier que seulement 3% des coureurs de ta zone ont emprunte" | "You've unlocked a new achievement!" |
| "Qu'est-ce qu'on forge aujourd'hui ?" | "Select your workout parameters" |
| "Bonne sortie" | "Share your activity on social media" |
| Celebrer la decouverte | Optimiser la performance |
| Tutoyer (tu/ton/ta) | Vouvoyer |

---

## 2. Color System

### Dark Mode (Digital Default — currently implemented)

| Token | Hex | RGB | Usage |
|---|---|---|---|
| `--bg-deep` | `#080C0A` | 8, 12, 10 | Page background, deepest layer |
| `--bg-surface` | `#0D1410` | 13, 20, 16 | Card backgrounds, sidebar |
| `--bg-elevated` | `#141C17` | 20, 28, 23 | Elevated cards, inputs, modals |
| `--border` | `#2A3D30` | 42, 61, 48 | All borders, dividers |
| `--text-primary` | `#E8EDE9` | 232, 237, 233 | Headings, body text |
| `--text-muted` | `#8FA898` | 143, 168, 152 | Secondary text, placeholders |
| `--accent-moss` | `#4A7C59` | 74, 124, 89 | Disabled states, subtle accents |
| `--accent-sage` | `#7FB08A` | 127, 176, 138 | Secondary buttons, tags |
| `--accent-lime` | `#A8D672` | 168, 214, 114 | Primary CTA, active states, brand accent |
| `--accent-amber` | `#D4A843` | 212, 168, 67 | Warnings, premium badges |
| `--accent-trail` | `#C17A3A` | 193, 122, 58 | Trail/earth tones, secondary accent |
| `--gradient-hero` | `linear-gradient(160deg, #080C0A 0%, #0F1F12 50%, #080C0A 100%)` | — | Hero section background |

### Light Mode (Marketing, Print — not yet in code)

| Token | Hex | Usage |
|---|---|---|
| `--bg-deep` | `#F7F5F0` | Blanc casse chaud — page background |
| `--bg-surface` | `#EDE8DF` | Sable clair — card backgrounds |
| `--bg-elevated` | `#FFFFFF` | Pure white — elevated surfaces |
| `--border` | `#D4CFC5` | Warm gray — borders |
| `--text-primary` | `#1A1A1A` | Charbon — headings, body text |
| `--text-muted` | `#6B6357` | Warm gray — secondary text |
| `--accent-moss` | `#2D5F3E` | Vert foret — primary accent in light mode |
| `--accent-sage` | `#7FB08A` | Vert sauge — same |
| `--accent-lime` | `#2D5F3E` | Use vert foret as primary in light (lime is too bright) |
| `--accent-amber` | `#D4A843` | Same |
| `--accent-trail` | `#C17A3A` | Terre cuite — same |

### Light Mode CSS (to add to `globals.css`)

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg-deep:      #F7F5F0;
    --bg-surface:   #EDE8DF;
    --bg-elevated:  #FFFFFF;
    --border:       #D4CFC5;
    --text-primary: #1A1A1A;
    --text-muted:   #6B6357;
    --accent-moss:  #2D5F3E;
    --accent-sage:  #7FB08A;
    --accent-lime:  #2D5F3E;
    --accent-amber: #D4A843;
    --accent-trail: #C17A3A;
    --gradient-hero: linear-gradient(160deg, #F7F5F0 0%, #EDE8DF 50%, #F7F5F0 100%);
  }
}
```

### Semantic Usage Rules

| Context | Color to use |
|---|---|
| Primary CTA (buttons, links) | `--accent-lime` |
| Secondary actions | `--accent-sage` |
| Disabled / inactive | `--accent-moss` at 50% opacity |
| Premium / upgrade prompts | `--accent-amber` |
| Earth / trail elements, warm accents | `--accent-trail` |
| Danger / destructive | `#D64545` (not in current palette — add if needed) |
| Success / confirmation | `--accent-sage` |

### Accessibility — Contrast Ratios (Dark Mode)

| Foreground | Background | Ratio | WCAG |
|---|---|---|---|
| `#E8EDE9` on `#080C0A` | text-primary on bg-deep | 16.2:1 | AAA |
| `#8FA898` on `#080C0A` | text-muted on bg-deep | 7.1:1 | AAA |
| `#A8D672` on `#080C0A` | accent-lime on bg-deep | 10.4:1 | AAA |
| `#E8EDE9` on `#141C17` | text-primary on bg-elevated | 12.8:1 | AAA |
| `#8FA898` on `#141C17` | text-muted on bg-elevated | 5.6:1 | AA |

---

## 3. Typography System

### Font Stack

| Role | Font | Type | Why |
|---|---|---|---|
| **Display / Titles** | **Fraunces** | Variable serif | Organic "wonky" serifs feel handcrafted. 4 variable axes (weight, optical size, softness, WONK) give immense creative range. The `WONK` axis adds irregularity that embodies the artisan/forge brand. Much more expressive than Lora or Playfair. |
| **UI Headings / Labels** | **DM Sans** | Geometric sans | Warmer and more legible than Syne at small sizes (9-12px labels). Neutral enough to let Fraunces be the personality font. Close to SF Pro metrics for iOS consistency. |
| **Body Text** | **Inter** | Humanist sans | Excellent readability. Great French character support. Already validated. Maps to SF Pro on iOS. |
| **Data / Metrics** | **JetBrains Mono** | Monospace | Perfect for route stats (distance, D+, pace). Clear number differentiation. Maps to SF Mono on iOS. |

### Why Fraunces

Fraunces is a variable font with 4 axes:

- **`wght`** (weight): Thin 100 to Black 900
- **`opsz`** (optical size): 9pt to 144pt — automatically adjusts contrast, x-height, spacing, and width
- **`SOFT`** (softness): Sharp to SuperSoft — controls serif roundness
- **`WONK`** (wonk): 0 (off) or 1 (on) — activates irregular, handcrafted character shapes

The WONK axis is what makes Fraunces perfect for TrailForge: it adds organic irregularity to the h, n, m glyphs that makes text feel hand-lettered rather than machine-set. It auto-activates below 18pt but can be toggled manually at any size.

Fraunces has 100+ predefined instances across 2 styles (Roman/Italic) x 3 optical sizes (9pt/72pt/144pt) x 3 softness levels (Sharp/Soft/SuperSoft) x 5 weights.

**Recommended settings for TrailForge:**
- Hero titles: Fraunces Italic 700, `font-variation-settings: 'SOFT' 50, 'WONK' 1`
- Section titles: Fraunces Italic 500, `font-variation-settings: 'SOFT' 30, 'WONK' 1`
- Small headings: Fraunces Regular 600, `font-variation-settings: 'SOFT' 0, 'WONK' 0`

### Why DM Sans replaces Syne

Syne has quirky letter shapes that feel "techy" rather than organic. DM Sans:
- Has warmer curves, more suited to the outdoor aesthetic
- Better legibility at 9-12px label sizes (used extensively for uppercase tracking labels)
- More neutral, doesn't compete with Fraunces for personality
- Closer to SF Pro metrics, making iOS/web consistency easier

### Type Scale

| Level | Font | Weight | Size | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|---|
| **Hero** | Fraunces Italic | 700 | `clamp(52px, 9vw, 96px)` | 0.95 | -0.02em | Landing page hero title |
| **H2** | Fraunces Italic | 500 | `clamp(28px, 4vw, 48px)` | 1.05 | -0.01em | Section titles |
| **H3** | DM Sans | 600 | 16-18px | 1.3 | 0 | Card titles, sidebar headings |
| **Body** | Inter | 400 | 14-15px | 1.6 | 0 | Paragraphs, descriptions |
| **Label** | DM Sans | 600 | 9-11px | 1.2 | 0.2-0.4em | Uppercase labels, badges, nav items |
| **Data** | JetBrains Mono | 500 | 13-14px | 1.4 | 0 | Route stats: distance, D+, pace, score |
| **Data Large** | JetBrains Mono | 400 | 24-32px | 1.0 | -0.02em | Hero metric numbers |
| **Caption** | Inter | 400 | 12px | 1.4 | 0 | Footnotes, attribution |

### iOS Font Mapping

| Web Font | iOS Equivalent | Strategy |
|---|---|---|
| Fraunces | Bundle as custom `.ttf` in Xcode | Must bundle — no system equivalent |
| DM Sans | SF Pro (system) or bundle DM Sans | SF Pro is close enough for most UI |
| Inter | SF Pro (system) | Nearly identical metrics, use system |
| JetBrains Mono | SF Mono (system) or bundle | SF Mono works for data display |

### Code — `app/layout.tsx`

Replace the current font imports with:

```typescript
import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  DM_Sans,
  Inter,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";
import SmoothScrollProvider from "@/components/providers/SmoothScrollProvider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

// ... in the html tag:
// className={`${fraunces.variable} ${dmSans.variable} ${inter.variable} ${jetbrainsMono.variable}`}
```

### Code — `tailwind.config.ts`

Replace the `fontFamily` section:

```typescript
fontFamily: {
  fraunces: ["var(--font-fraunces)", "Georgia", "serif"],
  "dm-sans": ["var(--font-dm-sans)", "sans-serif"],
  inter:    ["var(--font-inter)", "sans-serif"],
  mono:     ["var(--font-jetbrains)", "monospace"],
},
```

### Code — `app/globals.css`

Replace these lines in `:root`:

```css
/* Replace these: */
--font-inter:    "Inter", sans-serif;
--font-syne:     "Syne", sans-serif;

/* With these: */
--font-inter:    "Inter", sans-serif;
--font-dm-sans:  "DM Sans", sans-serif;
--font-fraunces: "Fraunces", Georgia, serif;
```

### Find & Replace — Component Files

Run these replacements across all 10 component files listed below:

| Find | Replace With |
|---|---|
| `var(--font-playfair)` | `var(--font-fraunces)` |
| `var(--font-syne)` | `var(--font-dm-sans)` |
| `font-playfair` | `font-fraunces` |
| `font-syne` | `font-dm-sans` |

**Files to update:**
1. `components/landing/LandingPage.tsx`
2. `components/landing/StackingFeatureCards.tsx`
3. `components/map/MapView.tsx`
4. `components/ui/MagneticButton.tsx`
5. `components/ui/SurfaceBar.tsx`
6. `components/sidebar/FeedbackButtons.tsx`
7. `components/sidebar/RouteResult.tsx`
8. `components/sidebar/SessionForm.tsx`
9. `components/sidebar/ElevationProfile.tsx`
10. `components/app/AppNav.tsx`

---

## 4. Logo System — Adobe Illustrator Guide

### Concept: "The Forge Mark"

The logomark combines two core metaphors:
- **Trail/Path**: Topographic contour lines — flowing, organic parallel curves
- **Forge**: Craftsmanship, shaping, precision

The mark shows 3-4 overlapping topographic contour lines that form an abstract trail path, evoking forward motion and outdoor discovery. The lines should feel hand-drawn, not perfectly geometric — matching the "formes arrondies, coins genereux" directive.

### Step-by-Step Illustrator Process

#### Step 1: Set Up the Document

1. Open Adobe Illustrator
2. **File > New**
3. Set artboard to **1024 x 1024 px** (this is the master size for the iOS app icon)
4. Color mode: **RGB** (digital-first)
5. Raster effects: **300 PPI**
6. Add 4 more artboards for the other components:
   - Artboard 2: **2400 x 600 px** (horizontal lockup)
   - Artboard 3: **1200 x 1200 px** (stacked lockup)
   - Artboard 4: **2400 x 400 px** (wordmark only)
   - Artboard 5: **2400 x 800 px** (tagline lockup)

#### Step 2: Create the Color Swatches

1. Open **Window > Swatches**
2. Create a new color group called "TrailForge Dark"
3. Add these swatches:
   - Lime accent: `#A8D672` (primary mark color on dark)
   - Off-white: `#E8EDE9` (text on dark)
   - Deep green: `#080C0A` (dark background)
   - Forest green: `#0F1F12` (gradient stop)
4. Create a second group "TrailForge Light":
   - Forest green: `#2D5F3E` (primary mark color on light)
   - Charcoal: `#1A1A1A` (text on light)
   - Warm white: `#F7F5F0` (light background)
5. Create a third group "Monochrome":
   - Pure white: `#FFFFFF`
   - Pure black: `#1A1A1A`

#### Step 3: Draw the Logomark (Artboard 1)

1. Select the **Pen Tool (P)**
2. Draw the first contour line:
   - Start from the left side of the artboard (~200px in)
   - Create a flowing, organic curve that moves from left to right
   - Use 4-5 anchor points with smooth bezier handles
   - The curve should gently rise and fall like a topographic elevation line
   - Stroke: 3pt, no fill
3. Duplicate the curve (Alt+Drag down):
   - Create 3 more curves below the first, each ~60-80px apart
   - Each successive curve should be slightly different — not parallel copies
   - The curves should converge on the right side, suggesting a trail/path narrowing into the distance
4. Vary the stroke widths:
   - Top curve: 4pt (thickest, closest to viewer)
   - Second: 3pt
   - Third: 2pt
   - Bottom: 1.5pt (thinnest, furthest away)
5. **Optional enhancement**: The negative space between the top 2 curves can subtly suggest the letter "T" when viewed from a distance. Don't force it — subtlety is key.
6. Select all curves, then **Object > Expand** to convert strokes to filled shapes
7. Use **Pathfinder > Unite** if you want a single compound shape, or keep as separate paths for flexibility
8. Color the mark: `#A8D672` (lime accent)

#### Step 4: Test at Small Sizes

1. **View > Zoom** to view the mark at 16x16, 32x32, and 48x48 pixels
2. If details are lost at small sizes, create a simplified version:
   - Reduce to 2-3 curves instead of 4
   - Increase stroke weight proportionally
   - This simplified version becomes the favicon
3. Save both versions: `logomark-full` and `logomark-simplified`

#### Step 5: Create the Wordmark (Artboard 4)

1. Download Fraunces font from https://fonts.google.com/specimen/Fraunces
2. Install the variable font file on your system
3. Type "TRAILFORGE" using the **Type Tool (T)**
4. Font: Fraunces, Weight: 700 (Bold), Style: Italic
5. If the variable font is installed, set: `font-variation-settings: 'SOFT' 30, 'WONK' 1`
   - In Illustrator's OpenType panel, look for the Stylistic Sets or Variable Font sliders
6. Letter-spacing: **50** (Illustrator tracking value) — slightly expanded for readability
7. Color: `#E8EDE9` (off-white for dark backgrounds)
8. **Alternative**: You can also set "Trail" and "Forge" as two words: "TRAIL" in regular weight, "FORGE" in bold — to create visual hierarchy within the wordmark

#### Step 6: Assemble the Lockups

**Horizontal lockup (Artboard 2):**
1. Place the logomark on the left
2. Place the wordmark to the right, vertically centered
3. Gap between mark and wordmark = 50% of the mark's width (clear space rule)

**Stacked lockup (Artboard 3):**
1. Place the logomark centered at the top
2. Place the wordmark centered below
3. Gap = 40% of the mark's height

**Tagline lockup (Artboard 5):**
1. Start with the stacked lockup
2. Add tagline below: "Forge ton parcours" in DM Sans 400, `#8FA898` (text-muted)
3. Font size: ~40% of the wordmark size
4. Letter-spacing: 100 (Illustrator tracking)

#### Step 7: Create All Color Variations

1. Select the full-color-on-dark version on each artboard
2. **Edit > Edit Colors > Recolor Artwork**
3. For each variation, remap colors:

| Variation | Mark Color | Text Color | Background |
|---|---|---|---|
| Full color on dark | `#A8D672` | `#E8EDE9` | `#080C0A` |
| Full color on light | `#2D5F3E` | `#1A1A1A` | `#F7F5F0` |
| Monochrome white | `#FFFFFF` | `#FFFFFF` | transparent |
| Monochrome dark | `#1A1A1A` | `#1A1A1A` | transparent |
| Single-color lime | `#A8D672` | `#A8D672` | transparent |

4. Save each variation as a separate artboard or layer

#### Step 8: Create the App Icon

1. On Artboard 1 (1024x1024):
2. Draw a background rectangle filling the entire artboard
3. Apply gradient fill: `#080C0A` to `#0F1F12` (160 degrees, matching `--gradient-hero`)
4. Place the logomark centered, sized to ~60% of the artboard (leave padding for iOS safe area)
5. Mark color: `#A8D672`
6. **Add subtle grain texture**:
   - Create a new rectangle over everything
   - **Effect > Texture > Grain** (Intensity: 15, Contrast: 30, Type: Stippled)
   - Set layer blending mode to **Overlay**, opacity **3-5%**
7. Flatten and export as **PNG 1024x1024** — no transparency, no rounded corners (iOS adds the rounding)

#### Step 9: Export Everything

Use **File > Export > Export for Screens**:

| Asset | Artboard | Formats | Sizes |
|---|---|---|---|
| Logomark (full detail) | 1 | SVG, PDF, PNG @1x @2x @3x | Default |
| Logomark (simplified) | 1 variant | SVG, PNG | 16, 32, 48, 180, 192, 512 px |
| Wordmark | 4 | SVG, PNG @2x | Default |
| Horizontal lockup | 2 | SVG, PNG @2x | Default |
| Stacked lockup | 3 | SVG, PNG @2x | Default |
| Tagline lockup | 5 | SVG, PNG @2x | Default |
| iOS App Icon | 1 (with bg) | PNG | 1024x1024 |

**For the favicon `.ico` file:**
1. Export the simplified logomark as PNGs at 16, 32, and 48px
2. Use an online tool (realfavicongenerator.net) or Photoshop to combine into a multi-resolution `.ico` file

**SVG export settings:**
- Styling: Internal CSS
- Font: Convert to outlines
- Images: Embed
- Decimal: 2
- Minify: Yes
- Responsive: Yes

### Clear Space & Minimum Size Rules

- **Clear space**: Minimum padding around the logo = 50% of the logomark height (on all sides)
- **Minimum sizes**:
  - Logomark alone: 24px
  - Horizontal lockup: 120px wide
  - Stacked lockup: 80px wide
- **Never**: Stretch, rotate, add drop shadows, use non-brand colors, place on busy photo backgrounds without a tinted overlay

---

## 5. Visual Elements

### Grain Overlay

Used throughout the UI to add texture and warmth:

```html
<svg width="0" height="0" style="position:absolute">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
</svg>
```

Apply as a pseudo-element overlay with `opacity: 0.03-0.05`, `mix-blend-mode: overlay`.

### Topographic Illustrations

- Use as decorative background elements (not functional)
- Style: thin stroke lines (0.5-1px), `--accent-moss` color at 10-20% opacity
- Pattern: concentric, flowing contour lines — like elevation maps
- Never perfectly circular — always organic and irregular

### Icon Style

- **Stroke-based**, not filled
- Stroke width: 1.5px at 24px icon size
- Line cap: round
- Line join: round
- Style: organic, slightly imperfect — avoid pixel-perfect geometric icons
- Color: `--text-muted` default, `--accent-lime` for active state

### Border Radius

- **Current state**: 2px (sharp) — needs migration
- **Target**: 16-20px for cards, buttons, inputs (generous, organic feel)
- **Small elements** (badges, tags): 8px
- **Full round**: pills for status indicators
- **Map container**: 0px (maps look better without rounding)

### Spacing Scale

Use this 8px-base scale consistently:

| Token | Value | Usage |
|---|---|---|
| `xs` | 4px | Tight gaps (icon + label) |
| `sm` | 8px | Inner padding small elements |
| `md` | 12px | Default gap |
| `lg` | 16px | Card padding, section gap |
| `xl` | 24px | Between sections |
| `2xl` | 32px | Major section spacing |
| `3xl` | 48px | Landing page section gaps |
| `4xl` | 80px | Hero section vertical padding |
| `section` | `clamp(24px, 8vw, 120px)` | Responsive section padding |

---

## 6. Motion & Animation

### Easing

All animations use the same custom easing:

```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

This gives a fast start and gentle deceleration — feels natural and responsive.

### Durations

| Type | Duration | Usage |
|---|---|---|
| Micro | 0.15s | Hover states, button feedback |
| Standard | 0.7s | Fade-up reveals, scale transitions |
| Dramatic | 1.2s | Hero clip-reveals, page transitions |
| Pulse | 2.0-2.4s | Loading indicators, radar pulse |

### Reveal Patterns

| Pattern | CSS Class | Description |
|---|---|---|
| Fade up | `.reveal-up` | `opacity: 0, translateY(40px)` to visible |
| Clip reveal | `.clip-reveal` | `clip-path: inset(100% 0 0 0)` to `inset(0%)` |
| Scale fade | `.scale-fade` | `opacity: 0, scale(0.92)` to visible |
| Fade | `.reveal-fade` | Simple opacity transition |

### Reduced Motion

Always respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 7. Photography & Imagery Direction

### Subject Matter

- Trails, forests, mountain ridges, gravel roads
- Runners and cyclists from behind or in silhouette — never posed, never looking at camera
- Morning mist, golden hour light, dappled forest light
- Equipment (watches, bikes, shoes) shot in natural environments, never studio
- Maps and compasses as props — reinforces the navigation metaphor

### Treatment

- **Lighting**: Natural, golden hour preferred. Warm tones.
- **Saturation**: Slightly desaturated (-10-15%), warm color shift
- **Contrast**: Medium — not flat, not crunchy
- **Grain**: Add subtle grain overlay (matching the SVG feTurbulence aesthetic)
- **Never**: HDR, heavy vignette, neon colors, gym/indoor settings, selfies

### Color Grading (Adobe Lightroom / Premiere)

- Temperature: +5-10 (slightly warm)
- Tint: +3 (slightly magenta-warm)
- Highlights: -15 (recover sky detail)
- Shadows: +10 (open up dark areas)
- Vibrance: -10 (slightly muted)
- Split toning: Highlights warm (#D4A843 at 10%), Shadows green (#2D5F3E at 5%)

---

## 8. Higgsfield AI — Video Content Prompts

Go to https://higgsfield.ai/create/video to generate each video.

### Video 1: Brand Launch (Instagram Reels / TikTok)

**Model:** WAN 2.5 (best for text-to-video with natural motion)

**Cinema Studio Settings:**
- Camera: ARRI (filmic look)
- Lens: Spherical, 35mm
- Camera preset: **Dolly In** (builds anticipation)

**Prompt — Scene 1 (The Pain, 5 seconds):**
```
Close-up of hands scrolling on a smartphone screen showing a map app, fingers
tracing a route repeatedly with visible frustration. Indoor setting, desk with
coffee cup. Warm tungsten lighting, shallow depth of field. The mood is restless
and confined. Film grain, muted colors, 24fps cinematic.
```

**Prompt — Scene 2 (The Moment, 3 seconds):**
```
Close-up of a thumb tapping a single green button on a dark phone screen.
A bright lime-green pulse animation ripples from the tap point. The screen
shows a route appearing instantly on a dark map. Shallow depth of field,
the phone fills the frame. Clean, modern, dark UI aesthetic.
```

**Prompt — Scene 3 (The Freedom, 7 seconds):**
```
Wide shot of a trail runner emerging from a forest onto a mountain ridge at
golden hour. Camera follows from behind with a slow dolly forward. The runner
is silhouetted against warm orange-gold sky. Pine trees frame the edges.
Soft lens flare, natural film grain, slightly desaturated warm tones.
Cinematic 24fps, anamorphic lens look with subtle bokeh.
```

**Post-production (Adobe Premiere / After Effects):**
1. Import all 3 clips
2. Cut and sequence: Scene 1 (0-5s) > Scene 2 (5-8s) > Scene 3 (8-15s)
3. Add text overlay at 13s: "TrailForge" in Fraunces Italic 700, `#E8EDE9`, fade-up animation
4. Add tagline at 14s: "Forge ton parcours en 10 secondes" in DM Sans 400, `#8FA898`
5. Color grade all clips with the Lightroom preset from Section 7
6. Add subtle grain overlay (3-5% opacity) across all clips
7. Audio: ambient nature sounds (wind, birds) — no music, or minimal ambient synth pad
8. Export: 1080x1920 (vertical), H.264, 30fps

---

### Video 2: App Store Preview

**Model:** Kling 3.0 (best for realistic outdoor footage with controlled motion)

**Cinema Studio Settings:**
- Camera: RED (sharp, detailed)
- Lens: Spherical, 50mm
- Camera preset: **Crane Shot** (sweeping reveals)

**Prompt — B-Roll Clip 1 (Trail Overview, 5 seconds):**
```
Aerial drone shot slowly descending over a winding single-track trail through
a dense green forest. Morning mist rising between the trees. The trail curves
and disappears into the distance. Soft natural lighting, slightly overcast.
Cinematic color grading, film grain, 24fps. The mood is peaceful and inviting.
```

**Prompt — B-Roll Clip 2 (Runner in Action, 5 seconds):**
```
Medium shot tracking a trail runner from the side, running along a forest path
at sunrise. Dappled light through the tree canopy. The runner wears neutral
earth-toned clothing. Camera moves smoothly at running pace. Shallow depth of
field, warm golden light, subtle lens flare. Film grain, 24fps cinematic.
```

**Prompt — B-Roll Clip 3 (Cyclist on Gravel, 5 seconds):**
```
Low angle shot of a gravel cyclist riding past on a dirt road with golden wheat
fields on both sides. Late afternoon warm light. Dust particles visible in the
light. Camera is static, cyclist moves through frame left to right. Cinematic
depth of field, warm desaturated tones, film grain.
```

**Post-production (Adobe Premiere):**
1. Intercut B-roll clips with screen recordings of the TrailForge app
2. Screen recordings should show: selecting sport > generating route > viewing result > exporting GPX
3. Total length: 15-30 seconds (App Store requirement)
4. Add end card with stacked lockup logo on `#080C0A` background
5. No voiceover — rely on visual storytelling + captions
6. Export: 1080x1920 (portrait for iPhone), H.265

---

### Video 3: "Parcours du Jour" Series (Recurring Social Content)

**Model:** Sora 2 via **Sora 2 Trends** feature (generates trend-accurate social content)

**How to use Sora 2 Trends:**
1. Go to Higgsfield > Sora 2 Trends
2. Upload one image (a screenshot of a TrailForge route result, or a trail photo)
3. The system automatically applies motion logic and platform pacing

**Prompt — Forest Trail Edition:**
```
Slow cinematic push-in through a misty European forest trail in early morning.
Soft volumetric light rays breaking through the canopy. A narrow dirt path
winds between moss-covered trees. No people. The mood is serene, mysterious,
and inviting. Warm green color palette, film grain, shallow depth of field.
```

**Prompt — Mountain Ridge Edition:**
```
Slow dolly forward along a mountain ridge trail at golden hour. Panoramic view
of distant peaks and valleys below. Wildflowers along the trail edges. Warm
golden light, slight haze in the valley. The mood is expansive and free.
Cinematic anamorphic look, subtle lens flare, film grain.
```

**Prompt — Gravel Road Edition:**
```
Static wide shot of a long straight gravel road stretching into the distance
through rolling countryside. Late afternoon light casting long shadows. A
single cyclist appears small in the distance, approaching. Warm earth tones,
desaturated, film grain. The mood is solitary and contemplative.
```

**Post-production template (reuse for each edition):**
1. Import Higgsfield clip (5-8 seconds)
2. Add lower-third overlay:
   - Route name: Fraunces Italic 500, `#E8EDE9`
   - Stats: JetBrains Mono 400, `#8FA898` — "12.4 km | D+ 340m | Score 87/100"
3. Add TrailForge watermark (simplified logomark, bottom-right, 5% opacity)
4. Add grain overlay (3%)
5. Export: 1080x1080 (IG post) + 1080x1920 (IG story/Reels)

---

### Higgsfield Tips

- **Layered prompt system**: Don't mix camera, character, and motion instructions in the same sentence. Structure as: Subject > Action > Setting > Camera > Lighting > Style.
- **Be specific with camera**: Use verbs like "dolly in", "orbit", "crane up", "static" — not vague terms like "moving camera".
- **One style per clip**: Pick one visual style (warm cinematic, misty moody, golden hour) and commit. Don't mix.
- **Film grain in prompt**: Always include "film grain" in your Higgsfield prompts — it's a core part of the TrailForge aesthetic.
- **Aspect ratios**: WAN 2.5 and Kling 3.0 support custom aspect ratios. Set to 9:16 for social, 16:9 for App Store landscape.

---

## 9. Asset File Structure

After creating all assets, organize them in the `public/` directory:

```
public/
  favicon.ico                         # Multi-res: 16, 32, 48px
  favicon.svg                         # Modern browsers (scalable)
  apple-touch-icon.png                # 180x180
  icon-192.png                        # PWA manifest
  icon-512.png                        # PWA manifest
  og-image.png                        # 1200x630 default Open Graph
  site.webmanifest                    # PWA manifest file

  brand/
    logo-mark.svg                     # Full color mark (lime on transparent)
    logo-mark-light.svg               # Forest green mark (for light backgrounds)
    logo-mark-mono-white.svg          # White monochrome
    logo-mark-mono-dark.svg           # Dark monochrome
    logo-wordmark.svg                 # "TRAILFORGE" wordmark
    logo-wordmark-light.svg           # Wordmark for light backgrounds
    logo-lockup-horizontal.svg        # Mark + wordmark (dark bg variant)
    logo-lockup-horizontal-light.svg  # Mark + wordmark (light bg variant)
    logo-lockup-stacked.svg           # Stacked variant (dark bg)
    logo-lockup-stacked-light.svg     # Stacked variant (light bg)
    app-icon-1024.png                 # iOS master icon

  social/
    og-default.png                    # 1200x630 — Open Graph
    og-square.png                     # 1080x1080 — Instagram
    twitter-banner.png                # 1500x500 — Twitter/X header
```

### `site.webmanifest` content:

```json
{
  "name": "TrailForge",
  "short_name": "TrailForge",
  "description": "Generateur de parcours GPS — Forge ton parcours en 10 secondes",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#080C0A",
  "theme_color": "#A8D672",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Updated metadata for `layout.tsx`:

```typescript
export const metadata: Metadata = {
  title: "TrailForge — Generateur de parcours GPS",
  description:
    "Genere un parcours running ou cyclisme adapte a ta seance en 10 secondes. D+, distance, surface — zero compromis.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  manifest: "/site.webmanifest",
};
```

---

## 10. Social Media Templates

### Sizes

| Platform | Format | Size (px) | Aspect Ratio |
|---|---|---|---|
| Instagram Post | Square | 1080 x 1080 | 1:1 |
| Instagram Story / Reels | Vertical | 1080 x 1920 | 9:16 |
| Open Graph (link previews) | Landscape | 1200 x 630 | ~1.91:1 |
| Twitter/X Header | Banner | 1500 x 500 | 3:1 |
| Twitter/X Post Image | Landscape | 1200 x 675 | 16:9 |
| App Store Screenshots (iPhone) | Vertical | 1290 x 2796 | ~9:19.5 |

### Template Layout — Instagram Post (1080x1080)

```
+------------------------------------------+
|                                          |
|  [Background: trail photo or solid       |
|   #080C0A with topo illustration]        |
|                                          |
|  "Parcours du jour"                      |
|   Fraunces Italic 500, #8FA898, 28px     |
|                                          |
|  "Foret de Fontainebleau"                |
|   Fraunces Italic 700, #E8EDE9, 48px     |
|                                          |
|  12.4 km  |  D+ 340m  |  Score 87       |
|   JetBrains Mono 500, #A8D672, 18px      |
|                                          |
|  [Small logomark bottom-right]           |
|   #A8D672 at 30% opacity                 |
+------------------------------------------+
```

### Template Layout — Open Graph (1200x630)

```
+----------------------------------------------------------+
|                                                          |
|  [Background: gradient-hero or trail photo]              |
|                                                          |
|  [Stacked lockup centered]                               |
|   Logomark + "TRAILFORGE"                                |
|                                                          |
|  "Forge ton parcours en 10 secondes"                     |
|   DM Sans 500, #8FA898, 20px                             |
|                                                          |
|  [Subtle topo lines in background, 5% opacity]           |
+----------------------------------------------------------+
```

---

## Appendix: Execution Checklist

### Phase 1: Logo (Adobe Illustrator)
- [ ] Set up Illustrator document with 5 artboards
- [ ] Create color swatch groups (Dark, Light, Monochrome)
- [ ] Draw logomark (topographic contour lines)
- [ ] Test at small sizes, create simplified favicon version
- [ ] Create wordmark in Fraunces Italic 700
- [ ] Assemble horizontal lockup
- [ ] Assemble stacked lockup
- [ ] Assemble tagline lockup
- [ ] Create all 5 color variations for each component
- [ ] Create app icon (1024x1024 with gradient bg + grain)
- [ ] Export all SVGs, PNGs, PDFs
- [ ] Generate favicon .ico file (realfavicongenerator.net)

### Phase 2: Typography (Code Changes)
- [ ] Install Fraunces + DM Sans locally for preview
- [ ] Update `app/layout.tsx` with new font imports
- [ ] Update `tailwind.config.ts` with new font families
- [ ] Update `app/globals.css` with new CSS variables
- [ ] Find & replace font references in all 10 component files
- [ ] Visual test all pages

### Phase 3: Assets (File Organization)
- [ ] Create `public/` directory structure
- [ ] Place all logo exports in `public/brand/`
- [ ] Place favicon files in `public/`
- [ ] Create `site.webmanifest`
- [ ] Update metadata in `layout.tsx`
- [ ] Create OG image and social templates

### Phase 4: Light Mode
- [ ] Add light mode CSS variables to `globals.css`
- [ ] Test all components with `prefers-color-scheme: light`

### Phase 5: Higgsfield Video Content
- [ ] Generate Scene 1, 2, 3 for Brand Launch video
- [ ] Generate B-roll clips for App Store preview
- [ ] Generate first 3 "Parcours du Jour" clips
- [ ] Post-produce in Premiere with brand color grading + grain
- [ ] Export for all social formats
