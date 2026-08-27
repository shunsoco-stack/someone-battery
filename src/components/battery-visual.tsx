import type { CSSProperties } from "react";
import { Sparkles } from "lucide-react";

type Props = {
  percentage: number | null;
  compact?: boolean;
  preview?: boolean;
};

export function BatteryVisual({
  percentage,
  compact = false,
  preview = false,
}: Props) {
  const amount = percentage ?? 0;
  const mood =
    percentage === null
      ? "unknown"
      : amount <= 20
        ? "low"
        : amount === 100
          ? "full"
          : "steady";
  const label =
    percentage === null
      ? "まだ充電残量は表示されていません"
      : `充電残量 ${percentage}%`;
  const style = {
    "--charge": `${amount}%`,
    "--empty": `${100 - amount}%`,
  } as CSSProperties;
  return (
    <div
      className={`battery-visual mood-${mood} ${compact ? "is-compact" : ""} ${preview ? "is-preview" : ""}`}
      style={style}
      role="img"
      aria-label={label}
    >
      {!compact && <div className="battery-aura" aria-hidden="true" />}
      <div className="battery-body" aria-hidden="true">
        <div className="battery-interior">
          <div className="battery-fill" />
          <div className="battery-grid" />
          {!compact && (
            <>
              <span className="battery-reading">
                {percentage ?? "–"}
                <span>%</span>
              </span>
              <span className="battery-reading battery-reading-ink">
                {percentage ?? "–"}
                <span>%</span>
              </span>
            </>
          )}
        </div>
      </div>
      <span className="battery-terminal" aria-hidden="true" />
      {!compact && mood === "full" && (
        <div className="battery-sparkles" aria-hidden="true">
          <Sparkles className="sparkle-one" size={29} />
          <Sparkles className="sparkle-two" size={21} />
          <Sparkles className="sparkle-three" size={17} />
        </div>
      )}
    </div>
  );
}
