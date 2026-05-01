# Tourville pavedRatio edge-level audit

Adresse: 7 Rue des Pommiers, 14210 Tourville-sur-Odon
Profil: running_trail, scenicMode=true, D+=benchmarks Tourville (80/120/140/150 m)

Diagnostic court: pavedRatio est majoritairement porté par des voies OSM explicitement `surface=asphalt` ou `surface=concrete`, souvent `scenic=true`. Ce n'est pas un bug de formule pavedRatio: le moteur compte correctement le bitume tagué. Le problème produit est plutôt que le solver accepte des corridors boisés goudronnés et ne reste pas assez longtemps sur chemins non revêtus quand ils existent.

## tourville-pommiers-trail-5k
Best: 4.678 km, productionScore 0.8767, trailRatio 0.7763, pavedRatio 0.8891, repeat 0.0084, uTurn 0
Edge audit: 4.1591/4.6781 km paved (0.8891), dont 2.1554 km tagués surface pavée, 2.0037 km inférés route sans surface, 2.2321 km à la fois paved et scenic.

Segments paved principaux:
- edges 157-253, 1.9007 km, ways 239278607, 232858996, 232858995, 298999678, 360421768, 1343461738, 1357761115, 1116245858, 1357761168, 1343461743, 1357761167, 1357761166, 1357761116, 1343461728, 1343461686, 1343461687, 1357761172, 1357761169, 1343461684, 188797858, highway path, tertiary, residential, footway, surface asphalt, unknown, firstEdge 2470780733-10207510386-239278607, score 0.9239, reason surface=asphalt
- edges 0-101, 1.3695 km, ways 188797858, 1343461685, 1343461683, 1357761112, 1357761111, 1357761135, 1343461692, 1343461726, 1357761110, 1354373139, 1343461662, 1354373140, 1223134969, 1354373144, 1343461725, 360744736, 360421763, 360421764, 1343461650, 1343461653, 1357761151, 1357761152, 1343461652, 272822888, 448513551, 1116213597, 1166085845, highway residential, footway, secondary, tertiary, surface unknown, asphalt, concrete, firstEdge 1994199364-1994199359-188797858, score 0.4119, reason missing surface; quiet road highway=residential
- edges 115-137, 0.6389 km, ways 519965281, 144597211, 1330354712, 360421764, highway residential, secondary, surface unknown, firstEdge 1478320679-7517838260-519965281, score 0.8998, reason missing surface; quiet road highway=residential
- edges 145-155, 0.25 km, ways 144597194, 360421768, highway residential, surface unknown, firstEdge 1581353676-10207510358-144597194, score 0.3723, reason missing surface; quiet road highway=residential

## tourville-pommiers-trail-8k
Best: 7.86 km, productionScore 0.8015, trailRatio 0.7525, pavedRatio 0.5636, repeat 0.0037, uTurn 0
Edge audit: 4.4297/7.8602 km paved (0.5636), dont 1.6014 km tagués surface pavée, 2.8283 km inférés route sans surface, 2.0908 km à la fois paved et scenic.

Segments paved principaux:
- edges 218-273, 1.8606 km, ways 77928883, 1338539229, 1125145432, 1120285536, 1116213599, 1120285535, 1343461695, 1354373148, 1343461694, 1343461693, 1357761111, 1357761112, 1343461683, 1343461685, 188797858, highway unclassified, path, cycleway, footway, residential, surface unknown, asphalt, concrete, firstEdge 1478911101-2153620245-77928883, score 0.9196, reason missing surface; quiet road highway=unclassified
- edges 97-119, 0.6389 km, ways 519965281, 144597211, 1330354712, 360421764, highway residential, secondary, surface unknown, firstEdge 1478320679-7517838260-519965281, score 0.9196, reason missing surface; quiet road highway=residential
- edges 160-184, 0.6053 km, ways 1010360796, 188797867, 360421772, 188797884, highway residential, surface unknown, asphalt, firstEdge 1994199232-11409378387-1010360796, score 0.3921, reason missing surface; quiet road highway=residential
- edges 0-30, 0.6027 km, ways 188797858, 188797866, 1120285540, 1120285539, 1120285541, 360744736, 360421763, 360421764, 232860187, highway residential, cycleway, secondary, surface unknown, asphalt, firstEdge 1994199364-1994199359-188797858, score 0.3921, reason missing surface; quiet road highway=residential
- edges 57-66, 0.277 km, ways 232860186, 232860183, highway residential, surface unknown, firstEdge 12430663917-2411704161-232860186, score 0.9196, reason missing surface; quiet road highway=residential

## tourville-pommiers-trail-10k
Best: 8.97 km, productionScore 0.7642, trailRatio 0.8402, pavedRatio 0.3293, repeat 0.0216, uTurn 0
Edge audit: 2.9537/8.9703 km paved (0.3293), dont 1.4062 km tagués surface pavée, 1.5475 km inférés route sans surface, 1.5592 km à la fois paved et scenic.

Segments paved principaux:
- edges 71-112, 0.7349 km, ways 1010360796, 188797867, 288932118, 288932117, 288144287, 288144286, highway residential, tertiary, surface unknown, asphalt, firstEdge 1994199232-11409378387-1010360796, score 0.3921, reason missing surface; quiet road highway=residential
- edges 0-30, 0.712 km, ways 188797858, 188797866, 1120285540, 1120285539, 1120285541, 360744736, 360421763, 360421764, highway residential, cycleway, secondary, surface unknown, asphalt, firstEdge 1994199364-1994199359-188797858, score 0.3921, reason missing surface; quiet road highway=residential
- edges 254-290, 0.648 km, ways 298999678, 298999713, 1223129771, 1343461727, 1343461687, 1357761172, 1357761169, 1343461684, 188797858, highway tertiary, residential, footway, surface asphalt, unknown, firstEdge 6183638382-3029308403-298999678, score 0.8931, reason surface=asphalt
- edges 228-252, 0.5889 km, ways 188797884, 360421772, 232858996, highway residential, path, surface unknown, asphalt, firstEdge 1994199345-11345756907-188797884, score 0.9196, reason missing surface; quiet road highway=residential
- edges 176-179, 0.2218 km, ways 77928883, 1338539231, highway unclassified, surface unknown, firstEdge 1478911101-441768046-77928883, score 0.9196, reason missing surface; quiet road highway=unclassified

## tourville-pommiers-trail-12k
Best: 10.526 km, productionScore 0.6902, trailRatio 0.816, pavedRatio 0.4172, repeat 0.0028, uTurn 0
Edge audit: 4.3914/10.5265 km paved (0.4172), dont 2.234 km tagués surface pavée, 2.1573 km inférés route sans surface, 2.2555 km à la fois paved et scenic.

Segments paved principaux:
- edges 199-233, 2.0125 km, ways 77928883, 1338539229, 1125145432, 1343461709, 1343461711, 1338539233, highway unclassified, path, footway, secondary, surface unknown, asphalt, firstEdge 1478911101-2153620245-77928883, score 0.9196, reason missing surface; quiet road highway=unclassified
- edges 0-30, 0.712 km, ways 188797858, 188797866, 1120285540, 1120285539, 1120285541, 360744736, 360421763, 360421764, highway residential, cycleway, secondary, surface unknown, asphalt, firstEdge 1994199364-1994199359-188797858, score 0.3921, reason missing surface; quiet road highway=residential
- edges 71-95, 0.6053 km, ways 1010360796, 188797867, 360421772, 188797884, highway residential, surface unknown, asphalt, firstEdge 1994199232-11409378387-1010360796, score 0.3921, reason missing surface; quiet road highway=residential
- edges 265-292, 0.4694 km, ways 746482829, 279151443, 416082254, highway residential, unclassified, surface unknown, asphalt, firstEdge 1478320653-2833942948-746482829, score 0.3921, reason missing surface; quiet road highway=residential
- edges 305-336, 0.4173 km, ways 1338539233, 360744736, 1343461702, 1343461701, 1343461700, 1120285535, 1343461695, 1354373148, 1343461694, 1343461693, 1357761111, 1357761112, 1343461683, 1343461685, 188797858, highway secondary, footway, cycleway, residential, surface asphalt, concrete, unknown, firstEdge 10845887329-10209092694-1338539233, score 0.3812, reason surface=asphalt

Conclusion: ajuster prudemment le scoring/solver plutôt que la classification globale. Une route forestière asphaltée doit rester paved pour le ratio, même si elle est scenic. Le levier propre est de favoriser la continuité non revêtue et de pénaliser paved scenic seulement quand le profil est trail/running, pas de reclasser asphalt en trail.

