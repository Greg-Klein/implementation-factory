"use client";

import { useState } from "react";

/** The picture bound to an agent's first name, or its initial when there is no picture or it fails to load. */
export function AgentAvatar({ nickname, avatar, size = 32 }: { nickname: string; avatar?: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (avatar && !failed) {
    return <img src={avatar} alt={nickname} width={size} height={size} onError={() => setFailed(true)} className="shrink-0 rounded-full bg-[var(--line)] object-cover shadow-[inset_0_0_0_1px_var(--line)]" style={style} />;
  }
  return <span role="img" aria-label={nickname} className="grid shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-semibold text-[var(--accent)]" style={style}>{nickname.charAt(0).toUpperCase()}</span>;
}

/** "Tom · Dev": the first name the run gave an agent, then its role, or the bare type for an agent recorded before names existed. */
export function AgentName({ name, nickname, role, className = "" }: { name: string; nickname?: string | undefined; role?: string | undefined; className?: string }) {
  if (!nickname) return <span className={className}>{name}</span>;
  const suffix = role ?? name;
  return <span className={className}>{nickname}{suffix && <span className="text-[var(--muted)]"> · {suffix}</span>}</span>;
}
