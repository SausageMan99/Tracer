import Image from "next/image";
import Link from "next/link";

type TrailForgeMarkProps = {
  href?: string;
  compact?: boolean;
  muted?: boolean;
};

function MarkGlyph() {
  return (
    <span className="tf-mark-glyph" aria-hidden="true">
      <Image src="/trailforge-mark.png" alt="" width={998} height={998} priority />
    </span>
  );
}

export default function TrailForgeMark({ href, compact = false, muted = false }: TrailForgeMarkProps) {
  const content = (
    <span className={`tf-mark ${compact ? "tf-mark-compact" : ""} ${muted ? "tf-mark-muted" : ""}`.trim()}>
      <MarkGlyph />
      {!compact && (
        <span className="tf-mark-text">
          <span>TRAILFORGE</span>
          <small>Route generation for trail running & cycling</small>
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
