"use client";

import { useState } from "react";

/** A number drawn from the name, so robots side by side never float or blink in step. */
function nameHash(nickname: string): number {
  let hash = 0;
  for (const char of nickname) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}

/** The picture bound to an agent's first name, or its initial when there is no picture or it fails to load.
 * The pictures have a transparent background, so the circle behind them follows the theme.
 * The robot powers on when it mounts, blinks now and then through its `-blink` twin picture,
 * and floats gently while `alive` is set. A robot without a twin picture simply never blinks. */
export function AgentAvatar({ nickname, avatar, size = 32, alive = false }: { nickname: string; avatar?: string | undefined; size?: number; alive?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [noBlink, setNoBlink] = useState(false);
  const style = { width: size, height: size };
  if (avatar && !failed) {
    const hash = nameHash(nickname);
    const blinkStyle = { animationDuration: `${4200 + (hash % 2800)}ms`, animationDelay: `-${hash % 4200}ms` };
    return <span className="robot-boot block shrink-0 rounded-full bg-[var(--raised)] shadow-[inset_0_0_0_1px_var(--line)]" style={style}>
      <span className={`relative block ${alive ? "robot-idle" : ""}`} style={alive ? { ...style, animationDelay: `-${hash % 3200}ms` } : style}>
        <img src={avatar} alt={nickname} width={size} height={size} onError={() => setFailed(true)} className="block rounded-full object-cover" style={style} />
        {!noBlink && <img src={avatar.replace(/\.webp$/, "-blink.webp")} alt="" aria-hidden width={size} height={size} onError={() => setNoBlink(true)} className="robot-blink absolute inset-0 block rounded-full object-cover" style={{ ...style, ...blinkStyle }} />}
      </span>
    </span>;
  }
  return <span role="img" aria-label={nickname} className="grid shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-semibold text-[var(--accent)]" style={style}>{nickname.charAt(0).toUpperCase()}</span>;
}

/** "Tom · Dev": the first name the run gave an agent, then its role, or the bare type for an agent recorded before names existed. */
export function AgentName({ name, nickname, role, className = "" }: { name: string; nickname?: string | undefined; role?: string | undefined; className?: string }) {
  if (!nickname) return <span className={className}>{name}</span>;
  const suffix = role ?? name;
  return <span className={className}>{nickname}{suffix && <span className="text-[var(--muted)]"> · {suffix}</span>}</span>;
}
