import ClientMapWrapper from "@/components/map/ClientMapWrapper";
import SidebarContainer from "@/components/sidebar/SidebarContainer";
import AppNav from "@/components/app/AppNav";

export default function AppPage() {
  return (
    <div className="app-viewport flex-col">
      {/* Fixed top nav */}
      <AppNav />

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          height: "calc(100dvh - 52px)",
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            width: "360px",
            flexShrink: 0,
            background: "var(--bg-deep)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
          aria-label="Panneau de configuration du parcours"
        >
          <SidebarContainer />
        </aside>

        {/* Map */}
        <main
          style={{ flex: 1, position: "relative" }}
          aria-label="Carte interactive du parcours généré"
        >
          <ClientMapWrapper />
        </main>
      </div>
    </div>
  );
}
