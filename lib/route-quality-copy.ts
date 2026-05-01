export interface QualityWarningCopy {
  label: string;
  description: string;
}

export const QUALITY_WARNING_COPY: Record<string, QualityWarningCopy> = {
  DISTANCE_OFF_TARGET: {
    label: "Distance ajustée",
    description: "Le parcours trouvé s'éloigne de la distance demandée.",
  },
  ELEVATION_OFF_TARGET: {
    label: "D+ approximatif",
    description: "Le dénivelé estimé s’éloigne de la cible. TrailForge privilégie une boucle praticable quand le relief local ou les données d’altitude ne permettent pas mieux.",
  },
  LOOP_NOT_CLOSED: {
    label: "Boucle imparfaite",
    description: "Le retour au point de départ est moins propre que prévu.",
  },
  TOO_MUCH_BUSY_ROAD: {
    label: "Trop de grands axes",
    description: "Une part du tracé passe par des routes peu agréables.",
  },
  RESTRICTED_ACCESS: {
    label: "Accès à vérifier",
    description: "Certains segments peuvent avoir une restriction d'accès.",
  },
  ONEWAY_VIOLATION: {
    label: "Sens de circulation",
    description: "Le tracé vélo contient un segment à vérifier côté circulation.",
  },
  TOO_MUCH_BACKTRACKING: {
    label: "Allers-retours",
    description: "Le parcours répète trop certains segments.",
  },
  TOO_MANY_INTERSECTIONS: {
    label: "Tracé haché",
    description: "La route traverse beaucoup d'intersections.",
  },
  NOT_ENOUGH_TRAIL: {
    label: "Pas assez trail",
    description: "Le tracé manque de chemins naturels pour une vraie sortie trail.",
  },
  TOO_MUCH_PAVEMENT: {
    label: "Trop de bitume",
    description: "Le parcours contient trop de segments pavés pour la promesse trail.",
  },
  TRAIL_TOO_FRAGMENTED: {
    label: "Nature fragmentée",
    description: "Les chemins naturels sont trop courts ou trop dispersés pour former un bon corridor.",
  },
  U_TURN_DETECTED: {
    label: "Demi-tour détecté",
    description: "Le tracé contient un retour immédiat qui risque de mal passer sur le terrain.",
  },
  OSM_SURFACE_DATA_WEAK: {
    label: "Données OSM incomplètes",
    description: "Des chemins existent autour du départ, mais leurs surfaces sont peu renseignées dans OSM. Le tracé peut être intéressant, sans garantie trail.",
  },
  TRAIL_TOO_ROAD_HEAVY: {
    label: "Boucle trop routière",
    description: "Le réseau local force trop de route pour une vraie sortie trail. Essaie un départ plus proche des chemins ou une distance différente.",
  },
  ROUTE_INTENT_WEAK_MATCH: {
    label: "Intention trail partielle",
    description: "TrailForge a identifié une zone naturelle cible, mais la boucle ne l’exploite pas autant que prévu.",
  },
  NATURAL_BUT_PAVED: {
    label: "Nature bitumée",
    description: "Le tracé traverse un cadre naturel ou scénique, mais une partie importante reste sur revêtement dur.",
  },
  SELF_INTERSECTION_DETECTED: {
    label: "Croisement suspect",
    description: "La trace se croise ou se replie : vérifie le GPX avant de l’utiliser.",
  },
  OUT_AND_BACK_SHAPE: {
    label: "Forme aller-retour",
    description: "La boucle ressemble davantage à un aller-retour qu’à un vrai circuit.",
  },
  TOO_MANY_SHARP_TURNS: {
    label: "Virages brusques",
    description: "Le tracé contient beaucoup de changements de direction serrés.",
  },
  LOOP_TOO_CONSTRAINED: {
    label: "Boucle très contrainte",
    description: "Autour de ce départ, le réseau impose une trace compacte. Le parcours reste utilisable, mais il peut sembler moins fluide qu’une boucle en forêt.",
  },
  LOOP_GEOMETRY_WEAK: {
    label: "Géométrie fragile",
    description: "La forme générale de la boucle semble moins naturelle que prévu.",
  },
};

export function translateQualityWarning(code: string): QualityWarningCopy | null {
  return QUALITY_WARNING_COPY[code] ?? null;
}
