import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Conditions générales d\u2019utilisation — TrailForge",
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

export default function TermsPage() {
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
          Conditions générales d&apos;utilisation
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
          <h2 style={sectionHeadingStyle}>1. Objet</h2>
          <p style={paragraphStyle}>
            Les présentes conditions générales d&apos;utilisation (CGU) régissent
            l&apos;accès et l&apos;utilisation du service TrailForge, disponible à
            l&apos;adresse{" "}
            <a
              href="https://trailforge.app"
              style={{ color: "var(--accent-forest)" }}
            >
              trailforge.app
            </a>
            . TrailForge est un service de génération de parcours GPS pour la
            course à pied et le cyclisme.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>2. Accès au service</h2>
          <p style={paragraphStyle}>
            TrailForge propose deux niveaux d&apos;accès :
          </p>
          <ul
            style={{
              ...paragraphStyle,
              paddingLeft: "20px",
              margin: "0 0 12px",
            }}
          >
            <li style={{ marginBottom: "6px" }}>
              <strong>Formule gratuite</strong> — accès aux fonctionnalités de
              base de génération de parcours, sans inscription requise.
            </li>
            <li style={{ marginBottom: "6px" }}>
              <strong>Formule Pro</strong> — accès illimité avec fonctionnalités
              avancées, au tarif de <strong>8,99 € / mois</strong> ou{" "}
              <strong>79,99 € / an</strong>.
            </li>
          </ul>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>3. Abonnement et paiement</h2>
          <p style={paragraphStyle}>
            Les paiements sont traités par Stripe. L&apos;abonnement Pro est
            reconduit automatiquement à chaque échéance (mensuelle ou annuelle),
            sauf résiliation.
          </p>
          <p style={paragraphStyle}>
            Vous pouvez résilier votre abonnement à tout moment depuis votre
            espace client (portail Stripe). La résiliation prend effet à la fin
            de la période d&apos;abonnement en cours ; aucun remboursement au prorata
            n&apos;est effectué.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>4. Limitation de responsabilité</h2>
          <p style={paragraphStyle}>
            Les parcours générés par TrailForge sont des suggestions basées sur
            les données cartographiques OpenStreetMap (OSM). Ils ne constituent
            pas des recommandations de sécurité.
          </p>
          <p style={paragraphStyle}>
            L&apos;utilisateur est seul responsable de son aptitude physique, de
            l&apos;équipement utilisé et du respect des réglementations locales
            (propriété privée, zones protégées, conditions météorologiques, etc.)
            lors de la pratique sportive. TrailForge décline toute
            responsabilité en cas d&apos;accident, blessure ou dommage consécutif à
            l&apos;utilisation d&apos;un parcours généré.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>5. Propriété intellectuelle</h2>
          <p style={paragraphStyle}>
            Le code, le design et les algorithmes de TrailForge sont protégés
            par le droit de la propriété intellectuelle et restent la propriété
            exclusive de leurs auteurs.
          </p>
          <p style={paragraphStyle}>
            Les données cartographiques utilisées proviennent d&apos;OpenStreetMap et
            sont mises à disposition sous licence{" "}
            <a
              href="https://opendatacommons.org/licenses/odbl/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent-forest)" }}
            >
              Open Database License (ODbL)
            </a>
            . © Les contributeurs OpenStreetMap.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>6. Droit applicable</h2>
          <p style={paragraphStyle}>
            Les présentes CGU sont soumises au droit français. En cas de
            litige, les tribunaux compétents du ressort de Lyon seront
            exclusivement compétents.
          </p>
        </section>

        <section>
          <h2 style={sectionHeadingStyle}>7. Contact</h2>
          <p style={paragraphStyle}>
            Pour toute question relative aux présentes CGU :
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
