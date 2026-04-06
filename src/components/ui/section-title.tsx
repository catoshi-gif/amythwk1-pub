import * as React from "react";
import { cn } from "@/lib/cn";

export function SectionTitle({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {eyebrow ? (
        <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-brandMint/80">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="font-display text-3xl tracking-tight text-brandCharcoal sm:text-4xl">{title}</h2>
      {description ? <p className="max-w-2xl text-sm leading-relaxed text-brandMuted sm:text-base">{description}</p> : null}
    </div>
  );
}
