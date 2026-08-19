interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'search' | 'document' | 'collection';
}

export default function EmptyState({ icon, title, description, action, variant = 'default' }: EmptyStateProps) {
  const renderSvg = () => {
    if (icon) return icon;

    switch (variant) {
      case 'search':
        return (
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="35" cy="35" r="18" stroke="#C7D2FE" strokeWidth="3" fill="none" />
            <line x1="48" y1="48" x2="62" y2="62" stroke="#C7D2FE" strokeWidth="3" strokeLinecap="round" />
            <circle cx="28" cy="32" r="2" fill="#C7D2FE" />
            <circle cx="36" cy="28" r="2" fill="#C7D2FE" />
            <circle cx="42" cy="33" r="2" fill="#C7D2FE" />
            <path d="M28 38 Q35 42 42 38" stroke="#C7D2FE" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        );
      case 'document':
        return (
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="12" width="36" height="48" rx="3" stroke="#C7D2FE" strokeWidth="2.5" fill="none" />
            <path d="M44 12 L56 24" stroke="#C7D2FE" strokeWidth="2.5" fill="none" />
            <path d="M44 12 L44 24 L56 24" stroke="#C7D2FE" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
            <line x1="28" y1="32" x2="48" y2="32" stroke="#E0E7FF" strokeWidth="2" strokeLinecap="round" />
            <line x1="28" y1="39" x2="44" y2="39" stroke="#E0E7FF" strokeWidth="2" strokeLinecap="round" />
            <line x1="28" y1="46" x2="40" y2="46" stroke="#E0E7FF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'collection':
        return (
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="40" cy="56" rx="28" ry="8" stroke="#C7D2FE" strokeWidth="2" fill="none" />
            <ellipse cx="40" cy="44" rx="28" ry="8" stroke="#C7D2FE" strokeWidth="2" fill="none" />
            <ellipse cx="40" cy="32" rx="28" ry="8" stroke="#C7D2FE" strokeWidth="2.5" fill="none" />
            <path d="M12 32 L12 56" stroke="#C7D2FE" strokeWidth="2" />
            <path d="M68 32 L68 56" stroke="#C7D2FE" strokeWidth="2" />
          </svg>
        );
      default:
        return (
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="16" y="24" width="48" height="36" rx="4" stroke="#C7D2FE" strokeWidth="2.5" fill="none" />
            <path d="M16 34 L40 48 L64 34" stroke="#C7D2FE" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
          </svg>
        );
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 opacity-70">
        {renderSvg()}
      </div>
      <h3 className="text-sm font-medium text-white mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-400 mb-4 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
