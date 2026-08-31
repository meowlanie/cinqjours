import type { SVGProps } from "react";

/**
 * Cinq Jours logo — a calendar with a speech-bubble tail (language) and a "5" (cinq jours).
 */
export function Logo({ size = 36, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cinq Jours"
      {...props}
    >
      <defs>
        <linearGradient id="cj-logo-body" x1="32" y1="84" x2="208" y2="200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6C5CE7" />
          <stop offset="1" stopColor="#4834D4" />
        </linearGradient>
      </defs>

      {/* Speech-bubble tail (language) */}
      <path d="M170 200 L206 200 L200 236 Z" fill="url(#cj-logo-body)" />

      {/* Calendar body */}
      <rect x="32" y="84" width="176" height="116" rx="16" fill="url(#cj-logo-body)" />

      {/* Binding bar */}
      <rect x="32" y="64" width="176" height="22" rx="11" fill="#A29BFE" />

      {/* Ring holes */}
      <circle cx="64" cy="64" r="6" fill="#FFFFFF" />
      <circle cx="120" cy="64" r="6" fill="#FFFFFF" />
      <circle cx="176" cy="64" r="6" fill="#FFFFFF" />

      {/* Number 5 (stroke) */}
      <path
        d="M146 112 H92 V136 C92 162 116 178 140 178 H92"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={15}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
