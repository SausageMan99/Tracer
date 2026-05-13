import Link from "next/link";

type TrailForgeMarkProps = {
  href?: string;
  compact?: boolean;
  muted?: boolean;
};

function MarkGlyph() {
  return (
    <span className="tf-mark-glyph" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img" focusable="false">
        <path
          className="tf-mark-terrain tf-mark-terrain-a"
          d="M43.6 6.8c-7.5 2.2-14.2 7.7-18.1 14.9-3.2 5.9-4.3 12.6-2.8 18.6 1.4 5.7 5.1 10.6 10.4 13.6"
        />
        <path
          className="tf-mark-terrain tf-mark-terrain-b"
          d="M52.4 16.3c-5.2-1.2-11.4.3-17.1 4.1-6.8 4.6-11.7 11.8-12.6 18.9-.7 5.7 1.4 10.5 5.8 13.3"
        />
        <path
          className="tf-mark-ridge"
          d="M18.5 54.9c8.8-2.2 15.8-8.1 18.7-15.7 2.2-5.7 1.5-11.1-1.7-14.8-3.5-4-9.4-4.6-15.2-1.5-6.6 3.5-10.9 10.8-10.1 17.4.7 5.7 4.8 10 10.9 11.6"
        />
        <path
          className="tf-mark-route"
          d="M11.2 42.5c9.7 5.3 19.5 2.9 27-5.6 6.8-7.8 9.8-18.4 16.7-24.8"
        />
        <circle className="tf-mark-start" cx="11.2" cy="42.5" r="2.4" />
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
          <small>Route generation for trail running</small>
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
