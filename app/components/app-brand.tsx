export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-logo compact" : "brand-logo"} aria-label="SkillMatch AI">
      <i aria-hidden="true" />
      <span>SkillMatch</span>
      <em>AI</em>
    </div>
  );
}
