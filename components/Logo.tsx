export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Cinq Jours"
      width={size}
      height={size}
      className={className}
    />
  );
}
