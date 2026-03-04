# Strava Heatmap Integration

How the Strava global heatmap is fetched, proxied, and used to score route popularity.

---

## Overview

The [Strava Global Heatmap](https://www.strava.com/heatmap) is a raster tile service that shows aggregated activity density from millions of Strava users. In TrailForge, it powers the **Scenic mode** popularity scoring — routes through popular running/cycling areas score higher.

The heatmap tiles are protected by Amazon CloudFront signed cookies. Accessing them without valid cookies returns a 403. TrailForge routes all tile requests through a local Go proxy that holds these cookies.

---

## Architecture

```
Browser (Mapbox GL raster source)
  │
  │  GET /api/heatmap-tile?sport=all&color=hot&z=12&x=1234&y=5678
  ▼
Next.js API Route (/app/api/heatmap-tile/route.ts)
  │  [CORS bridge — same-origin to bypass browser CORS blocking on :8080]
  │
  │  GET http://localhost:8080/identified/globalheat/all/hot/12/1234/5678@2x.png
  ▼
Go Proxy (cmd/proxy/, port 8080)
  │  [Injects CloudFront cookies into request headers]
  │
  │  GET https://heatmap-external-a.strava.com/identified/globalheat/all/hot/12/1234/5678@2x.png
  ▼
Strava CloudFront CDN
```

### Why two proxy layers?

**Layer 1 — Go proxy (`:8080`):** Holds the CloudFront signed cookies. These cookies are attached to the Strava session, so they can't be included in the Next.js server bundle (they expire and change). The Go proxy is a simple HTTP reverse proxy that adds the cookie headers before forwarding.

**Layer 2 — Next.js API route (`/api/heatmap-tile`):** Browsers block cross-origin requests from `http://localhost:3000` to `http://localhost:8080` due to CORS policy. The Next.js API route is same-origin, so it can make the proxy request server-to-server and return the result to the browser.

---

## Tile URL Format

```
https://heatmap-external-a.strava.com/identified/globalheat/{sport}/{color}/{z}/{x}/{y}@2x.png?v=19
```

| Parameter | Valid values | Description |
|-----------|-------------|-------------|
| `sport` | `all`, `running`, `ride` | Filter by activity type |
| `color` | `hot`, `blue`, `bluered` | Heatmap colour scheme |
| `z` | integer | Tile zoom level (10–14 recommended) |
| `x`, `y` | integers | OSM tile coordinates |

TrailForge uses `sport=all&color=hot` by default. The `hot` colormap maps low density to black and high density to white via red and yellow, which is easy to analyse pixel-by-pixel.

Other tile origins:
- `heatmap-external-b.strava.com`
- `heatmap-external-c.strava.com`

These are load-balanced; any subdomain works. The Go proxy uses the `-a` variant.

---

## CloudFront Cookie Authentication

### Required cookies

Strava's CloudFront distribution requires three signed cookies on every tile request:

| Cookie | Lifetime | Description |
|--------|----------|-------------|
| `CloudFront-Policy` | ~4 weeks | Base64-encoded JSON access policy |
| `CloudFront-Signature` | ~4 weeks | RSA signature of the policy |
| `CloudFront-Key-Pair-Id` | ~4 weeks | CloudFront key pair ID |

Without these cookies, the CDN returns `403 Forbidden`.

### How to obtain the cookies

1. Log in to [strava.com](https://www.strava.com) in your browser
2. Navigate to [strava.com/heatmap](https://www.strava.com/heatmap)
3. Open DevTools → Network tab
4. Filter requests by `heatmap-external`
5. Click on any tile request
6. In the Headers tab, find the `Cookie:` request header
7. Copy the three `CloudFront-*` values

### How to update the Go proxy

In `cmd/proxy/main.go`, find the cookie constants and update them:

```go
const (
    cfPolicy    = "eyJTdGF0ZW1lbnQiOlt..."   // CloudFront-Policy value
    cfSignature = "XXXXXXXXXX~..."             // CloudFront-Signature value
    cfKeyPairID = "APKXXXXXXXX"                // CloudFront-Key-Pair-Id value
)
```

Restart the proxy after updating:

```bash
# Stop the running proxy (Ctrl+C or kill the process)
go run ./cmd/proxy
```

### Cookie expiry

Cookies are valid for approximately 3–4 weeks. When they expire, heatmap tiles return 403, and:
- The Mapbox raster layer shows blank tiles
- Popularity scoring falls back to `0.5` (neutral)

The app continues to function normally — only Scenic mode's popularity boost is affected.

---

## Popularity Scoring

`scoreRoutePopularity()` in `lib/heatmap-scorer.ts` converts heatmap tile pixels into a popularity score for a route.

### Algorithm

For each route point (sampled every ~200 m to limit API calls):

1. **Tile coordinate conversion** — convert `[lat, lng]` to tile `[x, y]` at zoom 12:

```typescript
const n = Math.pow(2, zoom);
const tileX = Math.floor(((lng + 180) / 360) * n);
const tileY = Math.floor(
  ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * n
);
```

2. **Pixel coordinate within tile** — convert the fractional tile position to a pixel offset within the 256×256 tile:

```typescript
const pixelX = Math.floor(((lng + 180) / 360 * n - tileX) * 256);
const pixelY = Math.floor(((1 - ...) / 2 * n - tileY) * 256);
```

3. **Tile fetch** — request the PNG tile via `/api/heatmap-tile`

4. **OffscreenCanvas pixel read** — draw the tile into an `OffscreenCanvas`, then read a 7×7 pixel block centred on `(pixelX, pixelY)`:

```typescript
const imageData = ctx.getImageData(pixelX - 3, pixelY - 3, 7, 7);
```

5. **Brightness computation** — apply the "hot" colormap luminance formula to each pixel:

```
brightness = (R × 0.5 + G × 0.3 + B × 0.1) / (255 × 0.9)
```

The weights (0.5 for red, 0.3 for green, 0.1 for blue) reflect the "hot" colormap's encoding: red indicates medium activity density, yellow-green indicates high density, white indicates very high density.

6. **Mean across sampled points** → `popularityScore` in [0, 1]

### Why zoom 12?

Zoom 12 tiles cover approximately 38 km² (depending on latitude). This is coarse enough that tiles are reused across nearby route points (reducing API calls) but fine enough to distinguish between a popular riverside path and a quiet parallel street 500 m away.

Zoom levels 10–11 would be faster but too coarse. Zoom 13–14 would be more precise but generate far more tile requests per route.

### Why 7×7 pixels?

A single pixel covers ~37 m² at zoom 12. Reading a 7×7 block (covering ~1 800 m²) smooths out pixel-level noise and accounts for GPS coordinate imprecision in both the route and the historical heatmap data.

### Fallback behaviour

If the Go proxy is not running, the tile fetch returns 502. In this case, `getPointPopularity()` returns `0.5` — the neutral midpoint. This means popularity neither boosts nor penalises routes, and Scenic mode degrades gracefully to pure terrain scoring.

---

## Integration with MapView

`MapView.tsx` adds a Mapbox GL raster source for the Strava heatmap when `scenicMode` is true:

```typescript
map.addSource("strava-heatmap", {
  type: "raster",
  tiles: ["/api/heatmap-tile?sport=all&color=hot&z={z}&x={x}&y={y}"],
  tileSize: 256,
});

map.addLayer({
  id: "strava-heatmap-layer",
  type: "raster",
  source: "strava-heatmap",
  paint: {
    "raster-opacity": 0.45,
    "raster-fade-duration": 0,
  },
});
```

The `{z}/{x}/{y}` placeholders are filled in by Mapbox GL at request time. The layer is removed from the map (not just hidden) when Scenic mode is toggled off, to avoid Mapbox continuing to fetch tiles in the background.

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| Blank heatmap tiles | 403 from Strava CloudFront | Renew cookies (see above) |
| Heatmap tiles show but popularity score is 0.5 | OffscreenCanvas unavailable | Check browser support (requires modern Chrome/Firefox) |
| 502 on `/api/heatmap-tile` | Go proxy not running | Run `go run ./cmd/proxy` |
| 400 on `/api/heatmap-tile` | Invalid `sport` or `color` param | Check Mapbox tile URL template |
| Go proxy returns 403 | CloudFront cookies expired | Renew cookies (see above) |
