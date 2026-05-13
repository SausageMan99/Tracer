import Link from "next/link";

type TrailForgeMarkProps = {
  href?: string;
  compact?: boolean;
  muted?: boolean;
};

function MarkGlyph() {
  return (
    <span className="tf-mark-glyph" aria-hidden="true">
      <svg viewBox="0 0 42 42" role="img">
        <path className="tf-mark-contour" d="M7 26c6-13 18-18 29-11" />
        <path className="tf-mark-contour tf-mark-contour-soft" d="M5 17c8-9 19-12 31-6" />
        <path className="tf-mark-trace" d="M11 27c4 6 13 7 19 2 5-5 2-13-5-14-8-1-14 4-15 10 0 5 5 9 11 8" />
        <circle cx="11" cy="27" r="2.1" />
      </svg>
    </span>
  );
}

export default function TrailForgeMark({ href, compact = false, muted = false }: TrailForgeMarkProps) {
  const content = (
    <span className={`tf-mark ${compact ? "tf-mark-compact" : ""} ${muted ? "tf-mark-muted" : ""}`.trim()}>
      <MarkGlyph />
      {!compact && (
        <span className="tf-mark-text">
          <span>TrailForge</span>
          <small>la carte vivante</small>
        </span>
      )}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="tf-mark-link" aria-label="TrailForge">
      {content}
    </Link>
  );
}
