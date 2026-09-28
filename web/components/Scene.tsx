import type { CSSProperties } from 'react';

/**
 * A tiny drawn landscape that previews a camera move (`camera`) or a look (`look`) with CSS animation.
 * Purely decorative; it plays while `playing` is set or while its tile is hovered or focused.
 */
export function Scene({
  camera,
  look,
  playing = false,
  className,
  style,
}: {
  camera?: string;
  look?: string;
  playing?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = ['scene', camera && `cam-${camera}`, look && `look-${look}`, playing && 'is-playing', className].filter(Boolean).join(' ');
  return (
    <span className={classes} style={style} aria-hidden="true">
      <span className="scene-world">
        <span className="scene-sky" />
        <span className="scene-sun" />
        <span className="scene-far" />
        <span className="scene-near" />
        <span className="scene-subject" />
      </span>
      <span className="scene-grade" />
    </span>
  );
}
