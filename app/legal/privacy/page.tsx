import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Politique de confidentialité — TrailForge",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "18px",
  fontWeight: 600,
  color: "var(--text-primary)",
  margin: "32px 0 12px",
};

const paragraphStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "14px",
  lineHeight: "1.7",
  color: "var(--text-primary)",
  margin: "0 0 12px",
};

const mutedStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  color: "var(--text-muted)",
  margin: "0 0 8px",
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        background: "var(--bg-parchment)",
        minHeight: "100vh",
        padding: "48px 20px 80px",
      }}
    >
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--accent-forest)",
              textDecoration: "none",
              letterSpacing: "0.05em",
            }}
          >
            ← TrailForge
          </Link>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(24px, 4vw, 32px)",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 8px",
          }}
        >
          Politique de confidentialité
        </h1>

        <p style={mutedStyle}>Dernière mise à jour : 28 mars 2026</p>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid var(--border)",
            margin: "24px 0",
          }}
        />

        <section>
          <h2 style={sectionHeadingStyle}>1. Données collectées</h2>
          <p style={paragraphStyle}>
            TrailForge collecte uniquement les données nécessaires au
            fonctionnement du service :
          </p>
          <ul
            style={{
              ...paragraphStyle,
              paddingLeft: "20px",
              margin: "0 0 12px",
            }}
          >
            <li style={{ marginBottom: "6px" }}>
              <strong>Adresse e-mail</strong> — pour la création et la gestion
              de votre compte.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Données GPS (abonnés Pro)</strong> — coordonnées de départ
              et historique de parcours, stockés pour vous permettre d&apos;y accéder
              ultérieurement.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Paiement</strong> — traité intégralement par Stripe ; nous
              ne stockons jamais vos informations bancaires.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Adresse IP</strong> — utilisée temporairement pour la
              limitation de débit (rate limiting) afin de protéger le service.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Statistiques d&apos;usage</strong> — collectées de manière
              anonyme via Vercel Analytics, sans cookie de suivi.
            </li>
          </ul>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>2. Utilisation des données</h2>
          <p style={paragraphStyle}>
            Vos données sont utilisées exclusivement pour :
          </p>
          <ul
            style={{
              ...paragraphStyle,
              paddingLeft: "20px",
              margin: "0 0 12px",
            }}
          >
            <li style={{ marginBottom: "6px" }}>
              La fourniture et l&apos;amélioration du service de génération de
              parcours.
            </li>
            <li style={{ marginBottom: "6px" }}>
              La gestion de votre compte et de votre abonnement.
            </li>
            <li style={{ marginBottom: "6px" }}>
              La production de statistiques d&apos;usage anonymes et agrégées.
            </li>
          </ul>
          <p style={paragraphStyle}>
            Vos données personnelles ne sont jamais vendues, louées ni partagées
            avec des tiers à des fins commerciales.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>3. Cookies</h2>
          <p style={paragraphStyle}>
            TrailForge utilise un unique cookie de session d&apos;authentification,
            strictement nécessaire au fonctionnement du service. Aucun cookie de
            suivi publicitaire n&apos;est déposé.
          </p>
          <p style={paragraphStyle}>
            Vercel Analytics est configuré en mode sans cookie : aucune donnée
            de navigation n&apos;est persistée sur votre appareil à des fins
            analytiques.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>4. Hébergement et sécurité</h2>
          <p style={paragraphStyle}>
            L&apos;application est hébergée sur l&apos;infrastructure Vercel (régions
            US/EU). Toutes les communications sont chiffrées via TLS. Les
            paiements sont sécurisés par Stripe, certifié PCI DSS niveau 1.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>5. Vos droits RGPD</h2>
          <p style={paragraphStyle}>
            Conformément au Règlement Général sur la Protection des Données
            (RGPD), vous disposez des droits suivants :
          </p>
          <ul
            style={{
              ...paragraphStyle,
              paddingLeft: "20px",
              margin: "0 0 12px",
            }}
          >
            <li style={{ marginBottom: "6px" }}>
              <strong>Accès</strong> — obtenir une copie de vos données
              personnelles.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Rectification</strong> — corriger des données inexactes.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Suppression</strong> — demander l&apos;effacement de vos
              données (droit à l&apos;oubli).
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Portabilité</strong> — recevoir vos données dans un format
              structuré et lisible par machine.
            </li>
          </ul>
          <p style={paragraphStyle}>
            Pour exercer ces droits, contactez-nous à{" "}
            <a
              href="mailto:contact@trailforge.app"
              style={{ color: "var(--accent-forest)" }}
            >
              contact@trailforge.app
            </a>
            .
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>6. Contact</h2>
          <p style={paragraphStyle}>
            Pour toute question relative à cette politique de confidentialité :
          </p>
          <p style={paragraphStyle}>
            <a
              href="mailto:contact@trailforge.app"
              style={{ color: "var(--accent-forest)" }}
            >
              contact@trailforge.app
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
