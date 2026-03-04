"use client";

import { useAppStore } from "@/lib/store";
import SessionForm from "./SessionForm";
import RouteResult from "./RouteResult";
import ElevationProfile from "./ElevationProfile";

/**
 * Orchestrates the sliding-panel transition between the form and results views.
 * Both panels are mounted simultaneously; CSS translateX slides them.
 */
export default function SidebarContainer() {
  const { status } = useAppStore();
  const showResult = status === "success";

  return (
    <div
      style={{ position: "relative", flex: 1, overflow: "hidden" }}
    >
      {/* Form panel — slides left when results appear */}
      <div
        className="sidebar-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          transition: "transform 500ms cubic-bezier(0.16,1,0.3,1)",
          transform: showResult ? "translateX(-100%)" : "translateX(0)",
        }}
      >
        <SessionForm />
      </div>

      {/* Result panel — slides in from right */}
      <div
        className="sidebar-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          transition: "transform 500ms cubic-bezier(0.16,1,0.3,1)",
          transform: showResult ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <RouteResult />
        <ElevationProfile />
      </div>
    </div>
  );
}
