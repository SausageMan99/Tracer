# IGN POC fixtures

Static, hand-authored GeoJSON fixtures for the artifact-only IGN terrain context POC.

These files deliberately model only broad terrain context polygons for Tourville, Caen Colline aux Oiseaux, and Meudon. They are not a routing graph and must not be used to rewrite OSM `surface`, `highway`, route-quality ratios, solver gates, or scoring thresholds.

Surface honesty invariant: an OSM edge tagged `asphalt`, `concrete`, `paved`, `sett`, or `paving_stones` remains paved even when it intersects a forest/park/natural fixture. The POC may emit `EXPLICIT_PAVED_IN_NATURAL_CONTEXT` diagnostics, not fake trail/non-paved ratios.
