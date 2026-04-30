"use client";

import ClientMapWrapper from "@/components/map/ClientMapWrapper";
import SidebarContainer from "@/components/sidebar/SidebarContainer";
import AppNav from "@/components/app/AppNav";
import { useAppStore } from "@/lib/store";

export default function AppPage() {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <div className="app-viewport flex-col">
      {/* Fixed top nav */}
      <AppNav />

      {/* Main content */}
      <div className="relative flex flex-1 overflow-hidden" style={{ height: "calc(100dvh - 52px)" }}>
        {/* Backdrop overlay — mobile only */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
            style={{ background: "rgba(5,8,6,0.62)", backdropFilter: "blur(12px)" }}
          />
        )}

        {/* Sidebar — mobile: slide-over drawer / desktop: always visible */}
        <aside
          className={`
            fixed inset-0 z-40 w-full
            transform transition-transform duration-300
            md:relative md:w-[390px] md:flex-shrink-0 md:transform-none md:transition-none
            md:border-r md:border-[var(--border)]
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          `}
          style={{
            background: "linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-surface) 58%, var(--bg-elevated) 100%)",
            backgroundImage: "var(--topo-lines), linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-surface) 58%, var(--bg-elevated) 100%)",
            backgroundSize: "320px 320px, auto",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "32px 0 96px rgba(0,0,0,0.52)",
          }}
          aria-label="Panneau de configuration du parcours"
        >
          {/* Mobile close button */}
          <button
            type="button"
            className="absolute top-3 right-3 z-50 p-2 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le panneau"
            style={{ color: "var(--text-muted)", background: "none", border: "none" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <SidebarContainer />
        </aside>

        {/* Map */}
        <main
          className="flex-1 relative"
          aria-label="Carte interactive du parcours généré"
        >
          <ClientMapWrapper />
        </main>

        {/* Mobile FAB — "Configurer" button when sidebar is closed */}
        {!sidebarOpen && (
          <button
            type="button"
            className="fixed bottom-6 right-4 z-20 md:hidden"
            onClick={() => setSidebarOpen(true)}
            style={{
              background: "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))",
              color: "#071009",
              border: "1px solid rgba(242,240,232,0.18)",
              borderRadius: "999px",
              padding: "14px 24px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Configurer
          </button>
        )}
      </div>
    </div>
  );
}
