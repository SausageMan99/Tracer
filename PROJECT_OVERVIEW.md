# Tracer — Project Overview

> A guide for anyone new to the project, regardless of coding experience.

---

## What Is TrailForge?

TrailForge is a **web application that generates running and cycling routes**. You give it a starting address, a target distance (e.g. 15 km), and optionally a target elevation gain (e.g. 300 m of climbing), and it creates a **loop route** — a route that starts and ends at the same place.

Think of it like a smart GPS that designs workout routes for you. Instead of you manually drawing a path on a map, Tracer does the thinking: it picks roads and trails that match your sport, avoids busy roads, prefers scenic paths, and makes sure you end up back where you started.

---

## What Problem Does It Solve?

Runners and cyclists face a common frustration: **finding new routes**. Most people end up doing the same 3-4 loops because designing a good route takes time and local knowledge. Tracer solves this by:

- **Generating routes automatically** — no manual drawing
- **Respecting your training goals** — a recovery jog gets flat, quiet roads; a gran fondo gets challenging climbs
- **Preferring quality roads/trails** — paved for road bikes, trails for MTB, scenic paths when possible
- **Always creating loops** — you start and finish at the same place
- **Working anywhere in the world** — it uses OpenStreetMap data, which covers the globe

---

## Who Is It For?

| Audience | Use Case |
|----------|----------|
| **Runners** | Endurance, intervals, long runs, recovery sessions |
| **Road cyclists** | Endurance rides, threshold training, gran fondos |
| **Gravel cyclists** | Mixed-surface exploration rides |
| **Mountain bikers** | Trail rides, technical interval sessions |

The app has **14 pre-configured training profiles** (5 running, 5 road cycling, 2 gravel, 2 MTB), each with appropriate distance ranges, elevation limits, and road/trail preferences.

---

## How Does It Work? (The Simple Version)

Here's what happens when a user clicks "Generate":

```
User fills in the form:
  - Address: "Place Bellecour, Lyon"
  - Profile: "Running - Endurance"
  - Distance: 12 km
  - Elevation: 150 m
        │
        ▼
1. GEOCODING — Converts the address into GPS coordinates (latitude/longitude)
        │
        ▼
2. MAP DATA — Downloads all roads, trails, and paths within a radius
   around that point from OpenStreetMap
        │
        ▼
3. SCORING — Each road segment gets a quality score based on:
   • Surface type (paved vs dirt vs gravel)
   • Steepness (flat vs hilly)
   • Scenery (near forests, rivers, parks?)
   • Quietness (residential street vs busy highway?)
        │
        ▼
4. ROUTE BUILDING — An algorithm explores many possible paths,
   trying to maximize the quality score while hitting the target
   distance and elevation
        │
        ▼
5. LOOP CLOSURE — When the route has covered ~75% of the target
   distance, it calculates the shortest way back to the start
        │
        ▼
6. RESULTS — The best routes are ranked and displayed on an
   interactive map with slope coloring and an elevation chart
```

The user can then:
- **Browse multiple route options** (the algorithm generates several alternatives)
- **See elevation details** with a color-coded chart
- **Export to GPX** to load the route on a GPS watch (Garmin, Suunto, etc.) or bike computer (Wahoo, etc.)

---

## How Does It Work? (The Technical Version)

### The Two Engines

Tracer has two routing engines:

#### V2 Engine (Primary) — The Smart One
This is the main engine, built from scratch. It:
1. **Queries OpenStreetMap** via the Overpass API to get raw road/trail data
2. **Builds a graph** — a network of intersections (nodes) connected by road segments (edges)
3. **Scores every edge** on 4 dimensions: surface quality, elevation profile, nature/scenery, and quietness
4. **Runs a beam search** — an algorithm that explores many possible routes simultaneously, keeping only the most promising ones at each step
5. **Uses 5 different search strategies** in parallel (exploring north, northeast, southeast, southwest, northwest) for diversity
6. **Closes the loop** using A* pathfinding (a classic shortest-path algorithm) to get back to the start

#### Legacy Engine (Fallback) — The Safe One
If the V2 engine fails (e.g., not enough roads in the area), the app falls back to external routing services:
- **GraphHopper** for running routes
- **OpenRouteService** for cycling routes

These are third-party APIs that handle the routing but offer less customization.

### The Scoring System

Every road segment is scored from 0 to 1 on four dimensions:

| Dimension | What it measures | Example |
|-----------|-----------------|---------|
| **Surface** | Road surface quality for your sport | A mountain biker scores dirt trails at 1.0 and smooth asphalt at 0.3 |
| **Elevation** | How well the steepness matches your session | A recovery run penalizes steep hills; a climbing ride rewards 3-8% gradients |
| **Nature** | Proximity to natural features | Roads near forests, rivers, or parks score 1.0 |
| **Quietness** | Traffic and safety level | Dedicated bike paths score 1.0; busy secondary roads score 0.1 |

Each training profile has different **weights** for these dimensions. For example, a gravel endurance ride weights surface and nature highly, while road intervals care mostly about flat, paved roads.

---

## Project Architecture

### Tech Stack (What Technologies Are Used)

| What | Technology | Why |
|------|-----------|-----|
| **Framework** | Next.js 15 | React-based framework that handles both the website (frontend) and the server logic (backend) in one project |
| **Language** | TypeScript | JavaScript with type safety — catches bugs before they happen |
| **Map** | Mapbox GL JS | Interactive map library for displaying routes |
| **State Management** | Zustand | Lightweight library that stores the app's current state (selected profile, generated route, etc.) |
| **Styling** | Tailwind CSS | Utility-based CSS framework for visual design |
| **Animations** | GSAP | Professional animation library used on the landing page |
| **Testing** | Vitest | Fast test runner |

### Folder Structure (What Lives Where)

```
Tracer/
│
├── app/                    ← PAGES & API
│   ├── page.tsx            ← The landing page (what you see at tracer.com)
│   └── api/
│       ├── generate-route/ ← The endpoint that generates routes
│       ├── feedback/       ← Stores user ratings (thumbs up/down)
│       └── waitlist/       ← Collects emails for early access
│
├── components/             ← UI BUILDING BLOCKS
│   ├── landing/            ← Landing page sections (hero, features, etc.)
│   ├── map/                ← The interactive map
│   ├── sidebar/            ← The form, results panel, elevation chart
│   └── ui/                 ← Reusable UI pieces (buttons, animations)
│
├── lib/                    ← CORE LOGIC (the brain)
│   ├── engine/             ← V2 routing engine (the most important code)
│   │   ├── graph-builder   ← Downloads & builds the road network
│   │   ├── edge-scorer     ← Scores each road segment
│   │   ├── orienteering-solver ← Finds the best routes (beam search)
│   │   ├── pathfinder      ← A* algorithm for shortest paths
│   │   └── route-post-processor ← Adds elevation data, ranks results
│   │
│   ├── services/           ← Server-side services
│   │   ├── rate-limiter    ← Prevents abuse (max requests per minute)
│   │   ├── feedback-store  ← Saves user feedback
│   │   └── waitlist        ← Manages waitlist signups
│   │
│   ├── utils/              ← Small helper functions
│   ├── store.ts            ← App state (Zustand)
│   ├── types.ts            ← Data type definitions
│   ├── errors.ts           ← Error handling
│   ├── session-profiles.ts ← The 14 training profiles
│   ├── gpx-export.ts       ← Generates GPX files for GPS devices
│   └── route-generator-legacy.ts ← Fallback routing engine
│
├── tests/                  ← AUTOMATED TESTS
│
└── docs/                   ← EXTRA DOCUMENTATION
```

### How Data Flows Through the App

```
┌─────────────────────────────────────────────────────────┐
│                      BROWSER                            │
│                                                         │
│  ┌──────────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ SessionForm  │───▶│  Zustand  │◀──│   MapView    │   │
│  │ (user input) │    │  (store)  │   │ (Mapbox map) │   │
│  └──────────────┘    └────┬─────┘    └──────────────┘   │
│                           │                              │
│                     POST /api/generate-route             │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      SERVER                             │
│                                                         │
│  ┌──────────────┐    ┌───────────────────────────────┐  │
│  │ Rate Limiter │───▶│     V2 Engine Pipeline        │  │
│  └──────────────┘    │                               │  │
│                      │  Overpass API → Graph Build    │  │
│                      │  → Edge Scoring → Beam Search │  │
│                      │  → Post-Processing → Results  │  │
│                      └───────────────┬───────────────┘  │
│                                      │                  │
│                          (if V2 fails, fallback)        │
│                                      │                  │
│                      ┌───────────────▼───────────────┐  │
│                      │     Legacy Engine             │  │
│                      │  GraphHopper / OpenRouteService│  │
│                      └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Key Features

### Route Generation
- Loop routes that start and end at the same place
- 14 sport-specific training profiles
- Adaptive distance tolerance (tighter for longer routes)
- 5 parallel search strategies for route diversity
- Scenic mode toggle for nature-focused routes

### Map Visualization
- Interactive Mapbox map with smooth route animation
- **Slope coloring**: route segments are colored by gradient (green = downhill, red = steep uphill)
- Direction arrows every 100m
- Hover synchronization between map and elevation chart

### Elevation Profile
- SVG chart showing the route's elevation over distance
- Hover over the chart to see the corresponding point on the map
- Displays total ascent (D+) and descent (D-)

### GPX Export
- One-click download of the route as a GPX file
- Compatible with Garmin, Wahoo, Suunto, Komoot, and others
- Includes elevation data and timestamps

### Landing Page
- Animated sections with GSAP
- WebGL terrain visualization
- A/B tested hero section via feature flags (GrowthBook)
- Waitlist signup for early access

### Safety & Reliability
- Rate limiting on all API endpoints (prevents abuse)
- Typed error system with user-friendly French error messages
- Automatic fallback from V2 to legacy engine
- Input validation against profile-specific ranges

---

## External Services (APIs the App Depends On)

| Service | What It Does | Required? |
|---------|-------------|-----------|
| **Mapbox** | Displays the map + converts addresses to coordinates | Yes (needs a free API token) |
| **Overpass (OpenStreetMap)** | Provides road/trail data for the V2 engine | Yes (free, no key needed) |
| **Open-Meteo** | Provides elevation data for any GPS coordinate | Yes (free, no key needed) |
| **GraphHopper** | Fallback routing for running | Optional (needs API key) |
| **OpenRouteService** | Fallback routing for cycling | Optional (needs API key) |

---

## Current State of the Project

### What's Working
- Full route generation pipeline (V2 + legacy fallback)
- All 14 training profiles
- Interactive map with slope coloring
- Elevation profile chart
- GPX export
- Feedback system (thumbs up/down)
- Landing page with animations
- Waitlist system
- Rate limiting and error handling
- Automated tests for core logic

### What's In Progress (Uncommitted Changes)
Based on the current git status, there are significant uncommitted changes across the codebase:
- Reorganization of `lib/` into `lib/utils/` and `lib/services/`
- Backend hardening (rate limiting, typed errors, input validation)
- Landing page V2 refinements
- New tests for the orienteering solver and feedback API
- Deletion of old/unused files (legacy landing page, animation helpers)

### Version
The project is at **v0.5.0** — functional but pre-launch. The waitlist system suggests it hasn't been publicly released yet.

### Code Quality
- TypeScript strict mode enabled
- Immutable data patterns throughout
- Automated tests via Vitest
- Clean separation between engine logic, services, and UI
- Well-organized folder structure with small, focused files

---

## Glossary

| Term | Meaning |
|------|---------|
| **Loop route** | A route that starts and ends at the same location |
| **D+ / D-** | Elevation gain (D+) and loss (D-) in meters |
| **Beam search** | An algorithm that explores many options in parallel, keeping only the best candidates at each step |
| **A*** | A classic pathfinding algorithm that finds the shortest path between two points |
| **OSM** | OpenStreetMap — a free, community-maintained map of the world |
| **Overpass API** | A service that lets you query OpenStreetMap data |
| **Graph** | A network of connected points — here, intersections connected by road segments |
| **Edge** | A connection between two points in a graph — here, a road segment |
| **Node** | A point in a graph — here, an intersection or waypoint |
| **GPX** | GPS Exchange Format — a standard file format for GPS routes |
| **Geocoding** | Converting a text address into GPS coordinates |
| **Zustand** | A lightweight state management library for React |
| **GSAP** | GreenSock Animation Platform — a professional animation library |
| **Mapbox GL JS** | A JavaScript library for interactive, WebGL-powered maps |
| **Vitest** | A fast JavaScript testing framework |
| **API endpoint** | A URL on the server that accepts requests and returns data |
| **Rate limiting** | Restricting how many requests a user can make in a time period |
| **Feature flags** | Toggles that enable/disable features for specific users (used for A/B testing) |
| **Scenic mode** | A toggle that makes the algorithm prefer routes near nature |
| **Session profile** | A predefined configuration for a specific type of training session |
