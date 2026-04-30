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
    description: "Le dénivelé trouvé ne colle pas parfaitement à la cible.",
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
  "Données terrain moyennes : beaucoup de chemins sans surface renseignée dans OSM.": {
    label: "Donnée OSM partielle",
    description: "TrailForge voit des chemins, mais les surfaces sont mal renseignées : le potentiel trail est probable, pas garanti.",
  },
  "Boucle trop routière pour une sortie trail.": {
    label: "Boucle trop routière",
    description: "Le réseau local force trop de route par rapport à l'objectif trail.",
  },
};

export function translateQualityWarning(code: string): QualityWarningCopy | null {
  return QUALITY_WARNING_COPY[code] ?? null;
}
