import type { ProductOutcomeLabelV3 } from "./types";

export interface RouteV3ProductCopy {
  title: string;
  subtitle: string;
  tone: "ok" | "adjusted" | "refused";
}

export function routeV3ProductCopy(label: ProductOutcomeLabelV3, reason?: string): RouteV3ProductCopy {
  switch (label) {
    case "generated_trail":
      return {
        title: "Trail généré",
        subtitle: "Boucle trail honnête: les portions asphaltées restent comptées comme route, pas comme sentier.",
        tone: "ok",
      };
    case "generated_urban_nature":
      return {
        title: "Nature urbaine générée",
        subtitle: "Parcours vert urbain, distinct d'une promesse trail pur.",
        tone: "ok",
      };
    case "adjusted_trail":
      return {
        title: "Trail ajusté",
        subtitle: "Trace utile, avec compromis explicites sur le terrain ou la distance.",
        tone: "adjusted",
      };
    case "adjusted_urban_nature":
      return {
        title: "Nature urbaine ajustée",
        subtitle: "Le secteur ne permet pas un vrai trail: TrailForge propose une trace verte urbaine sans maquiller le bitume.",
        tone: "adjusted",
      };
    case "adjusted_paved_scenic":
      return {
        title: "Route scénique ajustée",
        subtitle: "Parcours exploitable mais majoritairement roulant/pavé: ce n'est pas vendu comme trail.",
        tone: "adjusted",
      };
    case "adjusted_short":
      return {
        title: "Distance ajustée",
        subtitle: "La trace propre disponible est plus courte que demandé.",
        tone: "adjusted",
      };
    case "refused_topology":
    case "refused_repeat_overlap":
    case "refused_no_geometry":
    case "refused_assembly_timeout":
    case "refused_poor_graph":
    case "refused_other":
      return {
        title: "Refus honnête V3",
        subtitle: reason || "Le moteur refuse de fabriquer une trace quand le graphe ne soutient pas la promesse terrain.",
        tone: "refused",
      };
  }
}

export function routeV3WarningCopy(warning: string): string {
  const lower = warning.toLowerCase();
  if (lower.includes("asphalt") || lower.includes("paved") || lower.includes("bitume")) {
    return "Les surfaces pavées restent comptées comme pavées, même si le segment est agréable.";
  }
  if (lower.includes("urban_nature") || lower.includes("urban nature")) {
    return "Nature urbaine: parcs/canaux/corridors verts, séparés du trail strict.";
  }
  if (lower.includes("pathtrackunknown") || lower.includes("unknown")) {
    return "Certains chemins manquent de surface OSM: ils ne sont pas ajoutés au trail strict.";
  }
  if (lower.includes("repeat") || lower.includes("overlap")) {
    return "Répétition/chevauchement détecté: la trace n'est pas survendue comme boucle propre.";
  }
  if (lower.includes("no product-valid") || lower.includes("insufficient")) {
    return "Terrain insuffisant pour une route produit honnête sur cette demande.";
  }
  return warning;
}
