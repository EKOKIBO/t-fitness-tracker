import type { MuscleGroup } from '../types/models';
import type { MuscleVolumeMap } from '../engine/formulas';

interface MuscleHeatmapSvgProps {
  volumeMap?: MuscleVolumeMap;
  highlightPrimary?: MuscleGroup[];
  highlightSecondary?: MuscleGroup[];
  mode?: 'effective' | 'raw';
  selectedMuscle?: MuscleGroup | null;
  onSelectMuscle?: (m: MuscleGroup) => void;
  compact?: boolean;
}

export function MuscleHeatmapSvg({
  volumeMap,
  highlightPrimary,
  highlightSecondary,
  mode = 'effective',
  selectedMuscle,
  onSelectMuscle,
  compact = false,
}: MuscleHeatmapSvgProps) {
  // Find scale ceiling (12 sets/week = saturated peak stimulus)
  const getFill = (m: MuscleGroup): string => {
    if (highlightPrimary || highlightSecondary) {
      if (highlightPrimary?.includes(m)) return '#007AFF';
      if (highlightSecondary?.includes(m)) return 'rgba(0, 122, 255, 0.42)';
      return '#1C1C23';
    }
    if (!volumeMap) return '#1C1C23';
    const val = mode === 'effective' ? volumeMap[m].effectiveSets : volumeMap[m].rawSets;
    if (val <= 0) return '#1C1C23';
    const ratio = Math.min(1, val / 12);
    if (ratio < 0.25) return 'rgba(0, 122, 255, 0.28)';
    if (ratio < 0.55) return 'rgba(0, 122, 255, 0.55)';
    if (ratio < 0.85) return '#007AFF';
    return '#38BDF8';
  };

  const getStroke = (m: MuscleGroup) =>
    selectedMuscle === m ? '#FFB800' : 'rgba(255,255,255,0.08)';

  const bind = (m: MuscleGroup) => ({
    fill: getFill(m),
    stroke: getStroke(m),
    strokeWidth: selectedMuscle === m ? 1.8 : 0.8,
    style: { cursor: onSelectMuscle ? 'pointer' : 'default', transition: 'fill 200ms ease' },
    onClick: () => onSelectMuscle?.(m),
  });

  const height = compact ? 150 : 230;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        alignItems: 'center',
        justifyItems: 'center',
      }}
    >
      {/* ANTERIOR (FRONT) VIEW */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <svg viewBox="0 0 160 320" height={height} role="img" aria-label="Anterior muscle map">
          {/* Head & Neck silhouette */}
          <circle cx="80" cy="24" r="15" fill="#18181E" stroke="#282830" strokeWidth="1" />
          <rect x="73" y="39" width="14" height="12" rx="4" fill="#18181E" />

          {/* Traps (front upper) */}
          <path d="M58,52 L73,46 L87,46 L102,52 L96,60 L64,60 Z" {...bind('traps')} />

          {/* Chest (Pecs) */}
          <path d="M54,62 Q80,58 79,74 L79,95 Q64,97 53,88 Z" {...bind('chest')} />
          <path d="M106,62 Q80,58 81,74 L81,95 Q96,97 107,88 Z" {...bind('chest')} />

          {/* Front & Side Delts */}
          <ellipse cx="47" cy="68" rx="9" ry="13" {...bind('front_delts')} />
          <ellipse cx="113" cy="68" rx="9" ry="13" {...bind('front_delts')} />
          <path d="M37,63 Q34,76 41,85 L46,79 Q43,70 43,62 Z" {...bind('side_delts')} />
          <path d="M123,63 Q126,76 119,85 L114,79 Q117,70 117,62 Z" {...bind('side_delts')} />

          {/* Biceps */}
          <rect x="35" y="84" width="13" height="36" rx="6" {...bind('biceps')} />
          <rect x="112" y="84" width="13" height="36" rx="6" {...bind('biceps')} />

          {/* Forearms */}
          <path d="M35,123 L47,123 L43,164 L32,164 Z" {...bind('forearms')} />
          <path d="M113,123 L125,123 L128,164 L117,164 Z" {...bind('forearms')} />

          {/* Lats flare visible from front */}
          <path d="M53,92 L62,100 L60,126 L51,112 Z" {...bind('lats')} />
          <path d="M107,92 L98,100 L100,126 L109,112 Z" {...bind('lats')} />

          {/* Abs & Core */}
          <rect x="65" y="99" width="13" height="14" rx="3" {...bind('abs')} />
          <rect x="82" y="99" width="13" height="14" rx="3" {...bind('abs')} />
          <rect x="65" y="116" width="13" height="14" rx="3" {...bind('abs')} />
          <rect x="82" y="116" width="13" height="14" rx="3" {...bind('abs')} />
          <rect x="66" y="133" width="12" height="16" rx="3" {...bind('abs')} />
          <rect x="82" y="133" width="12" height="16" rx="3" {...bind('abs')} />

          {/* Quads */}
          <path d="M55,156 L77,158 L75,226 L58,224 Z" {...bind('quads')} />
          <path d="M83,158 L105,156 L102,224 L85,226 Z" {...bind('quads')} />

          {/* Knees */}
          <circle cx="67" cy="233" r="6" fill="#18181E" />
          <circle cx="93" cy="233" r="6" fill="#18181E" />

          {/* Calves / Shins */}
          <path d="M59,243 L74,243 L71,298 L61,298 Z" {...bind('calves')} />
          <path d="M86,243 L101,243 L99,298 L89,298 Z" {...bind('calves')} />
        </svg>
        {!compact && <span className="section-label">Anterior</span>}
      </div>

      {/* POSTERIOR (BACK) VIEW */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <svg viewBox="0 0 160 320" height={height} role="img" aria-label="Posterior muscle map">
          {/* Head & Neck */}
          <circle cx="80" cy="24" r="15" fill="#18181E" stroke="#282830" strokeWidth="1" />
          <rect x="73" y="39" width="14" height="12" rx="4" fill="#18181E" />

          {/* Traps */}
          <path d="M55,54 L80,44 L105,54 L92,82 L80,90 L68,82 Z" {...bind('traps')} />

          {/* Rear Delts */}
          <ellipse cx="46" cy="69" rx="10" ry="12" {...bind('rear_delts')} />
          <ellipse cx="114" cy="69" rx="10" ry="12" {...bind('rear_delts')} />

          {/* Upper Back (Rhomboids / Mid-Traps) */}
          <path d="M58,68 L79,80 L79,106 L57,96 Z" {...bind('upper_back')} />
          <path d="M102,68 L81,80 L81,106 L103,96 Z" {...bind('upper_back')} />

          {/* Lats */}
          <path d="M52,85 L68,100 L70,132 L54,118 Z" {...bind('lats')} />
          <path d="M108,85 L92,100 L90,132 L106,118 Z" {...bind('lats')} />

          {/* Lower Back (Erectors) */}
          <rect x="69" y="114" width="22" height="32" rx="6" {...bind('lower_back')} />

          {/* Triceps */}
          <rect x="35" y="84" width="13" height="36" rx="6" {...bind('triceps')} />
          <rect x="112" y="84" width="13" height="36" rx="6" {...bind('triceps')} />

          {/* Forearms */}
          <path d="M35,123 L47,123 L43,164 L32,164 Z" {...bind('forearms')} />
          <path d="M113,123 L125,123 L128,164 L117,164 Z" {...bind('forearms')} />

          {/* Glutes */}
          <path d="M54,149 Q67,145 79,153 L79,180 Q62,184 53,172 Z" {...bind('glutes')} />
          <path d="M106,149 Q93,145 81,153 L81,180 Q98,184 107,172 Z" {...bind('glutes')} />

          {/* Hamstrings */}
          <path d="M56,184 L77,184 L75,232 L59,232 Z" {...bind('hamstrings')} />
          <path d="M83,184 L104,184 L101,232 L85,232 Z" {...bind('hamstrings')} />

          {/* Calves (Gastrocnemius) */}
          <path d="M58,240 Q67,236 75,244 L72,296 L60,296 Z" {...bind('calves')} />
          <path d="M85,244 Q93,236 102,240 L100,296 L88,296 Z" {...bind('calves')} />
        </svg>
        {!compact && <span className="section-label">Posterior</span>}
      </div>
    </div>
  );
}
