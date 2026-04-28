"use client";

import ClientMapWrapper from "@/components/map/ClientMapWrapper";
import SidebarContainer from "@/components/sidebar/SidebarContainer";
import AppNav from "@/components/app/AppNav";
import BottomSheet from "@/components/app/BottomSheet";

export default function AppPage() {
  return (
    <div className="app-viewport flex-col">
      {/* Fixed top nav */}
      <AppNav />

      {/* Main content */}
      <div className="relative flex flex-1 overflow-hidden" style={{ height: "calc(100dvh - 52px)" }}>
        {/* Desktop sidebar — always visible, left-anchored */}
        <aside
          className="hidden md:flex md:flex-col md:flex-shrink-0"
          style={{
            width: 360,
            background: "var(--bg-deep)",
            borderRight: "1px solid var(--app-border, #2A3D30)",
            overflow: "hidden",
          }}
          aria-label="Panneau de configuration du parcours"
        >
          <SidebarContainer />
        </aside>

        {/* Map — fills remaining space */}
        <main
          className="flex-1 relative"
          aria-label="Carte interactive du parcours généré"
        >
          <ClientMapWrapper />
        </main>

        {/* Mobile bottom sheet — overlays the map */}
        <div className="md:hidden">
          <BottomSheet defaultSnap="half">
            <SidebarContainer />
          </BottomSheet>
        </div>
      </div>
    </div>
  );
}
