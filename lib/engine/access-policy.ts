import type { EnrichedEdge, SessionProfile } from "../types";

type AccessEdge = Pick<EnrichedEdge, "access" | "foot" | "bicycle">;

export function isRestrictedAccessForProfile(edge: AccessEdge, profile: SessionProfile): boolean {
  if (edge.access === "private" || edge.access === "no") return true;
  if (profile.sport === "running") return edge.foot === "no" || edge.access === "customers";
  return edge.bicycle === "no" || edge.access === "customers";
}
