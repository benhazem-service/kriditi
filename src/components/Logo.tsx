import React from 'react';

export const Logo = ({ className = "w-8 h-8" }: { className?: string }) => {
  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width="100" height="100" rx="24" fill="white" />
        {/* Microphone Body */}
        <rect x="38" y="25" width="24" height="35" rx="12" fill="#3B82F6" />
        {/* Microphone Grille Lines */}
        <rect x="42" y="32" width="16" height="2" rx="1" fill="white" fillOpacity="0.5" />
        <rect x="42" y="38" width="16" height="2" rx="1" fill="white" fillOpacity="0.5" />
        <rect x="42" y="44" width="16" height="2" rx="1" fill="white" fillOpacity="0.5" />
        
        {/* Microphone Stand */}
        <path d="M30 48C30 59.0457 38.9543 68 50 68C61.0457 68 70 59.0457 70 48" stroke="#3B82F6" strokeWidth="6" strokeLinecap="round" />
        <path d="M50 68V78" stroke="#3B82F6" strokeWidth="6" strokeLinecap="round" />
        <path d="M38 78H62" stroke="#3B82F6" strokeWidth="6" strokeLinecap="round" />
        
        {/* Gold Coin */}
        <circle cx="68" cy="45" r="18" fill="#FCD34D" stroke="#D97706" strokeWidth="2" />
        <circle cx="68" cy="45" r="14" stroke="#D97706" strokeWidth="1" strokeDasharray="2 2" />
        <rect x="78" y="42" width="6" height="6" rx="2" fill="#D97706" />
      </svg>
    </div>
  );
};
