import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  Image as ImageIcon,
  Plus,
  Ruler,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db, generateId } from '../db/database';
import {
  calculateHybridE1RM,
  computeCompositeStrengthScore,
  computeMuscleVolume,
} from '../engine/formulas';
import {
  CATEGORY_LABELS,
  MUSCLE_LABELS,
  formatWeight,
  type BodyMeasurement,
  type MovementCategory,
  type MuscleGroup,
} from '../types/models';
import { MuscleHeatmapSvg } from './MuscleHeatmapSvg';
import { ProgressCardModal } from './ProgressCardModal';

const RADAR_AXES: MovementCategory[] = [
  'squat',
  'horizontal_push',
  'pull',
  'vertical_push',
  'hinge',
];

async function compressPhotoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 720;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas error'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AnalyticsTab() {
  const { activeClient, exerciseMap, pushToast } = useApp();

  const [heatmapDays, setHeatmapDays] = useState<7 | 30 | 365 | 0>(7);
  const [volumeMode, setVolumeMode] = useState<'effective' | 'raw'>('effective');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | null>(null);
  const [selectedLiftId, setSelectedLiftId] = useState<string>('');
  const [pngModalOpen, setPngModalOpen] = useState(false);

  // Body Measurements & Photo Overlay State
  const [measModalOpen, setMeasModalOpen] = useState(false);
  const [compareSlider, setCompareSlider] = useState(50);
  const [mDate, setMDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mWeight, setMWeight] = useState('');
  const [mFat, setMFat] = useState('');
  const [mChest, setMChest] = useState('');
  const [mWaist, setMWaist] = useState('');
  const [mHips, setMHips] = useState('');
  const [mBicepL, setMBicepL] = useState('');
  const [mBicepR, setMBicepR] = useState('');
  const [mThighL, setMThighL] = useState('');
  const [mThighR, setMThighR] = useState('');
  const [mPhoto, setMPhoto] = useState<string | null>(null);

  const workouts =
    useLiveQuery(
      () =>
        activeClient
          ? db.workouts
              .where('clientId')
              .equals(activeClient.id)
              .filter((w) => !w.deletedAt && w.status === 'completed')
              .toArray()
          : [],
      [activeClient?.id]
    ) ?? [];

  const measurements =
    useLiveQuery(
      () =>
        activeClient
          ? db.measurements
              .where('clientId')
              .equals(activeClient.id)
              .filter((m) => !m.deletedAt)
              .sortBy('date')
          : [],
      [activeClient?.id]
    ) ?? [];

  const strength = useMemo(() => {
    if (!activeClient) return null;
    return computeCompositeStrengthScore(activeClient, workouts, exerciseMap, 90);
  }, [activeClient, workouts, exerciseMap]);

  const heatmapWorkouts = useMemo(() => {
    if (heatmapDays === 0) return workouts;
    const cutoff = Date.now() - heatmapDays * 86_400_000;
    return workouts.filter((w) => (w.finishedAt ?? w.startedAt) >= cutoff);
  }, [workouts, heatmapDays]);

  const muscleVol = useMemo(
    () => computeMuscleVolume(heatmapWorkouts, exerciseMap),
    [heatmapWorkouts, exerciseMap]
  );

  // Logged exercises for e1RM trend selector
  const loggedExercises = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of workouts) {
      for (const we of w.exercises) {
        if (we.sets.some((s) => s.completed && s.type !== 'W' && (s.weightKg ?? 0) > 0)) {
          counts.set(we.exerciseId, (counts.get(we.exerciseId) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => ({ id, name: exerciseMap.get(id)?.name ?? id }));
  }, [workouts, exerciseMap]);

  const currentLiftId = selectedLiftId || loggedExercises[0]?.id || '';

  const liftTrendPoints = useMemo(() => {
    if (!currentLiftId) return [];
    const pts: Array<{ dateMs: number; e1rmKg: number; bestSetLabel: string }> = [];
    const sorted = [...workouts].sort(
      (a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt)
    );
    for (const w of sorted) {
      const we = w.exercises.find((e) => e.exerciseId === currentLiftId);
      if (!we) continue;
      let best = 0;
      let label = '';
      for (const s of we.sets) {
        if (!s.completed || s.type === 'W' || !s.weightKg || !s.reps) continue;
        const e1 = calculateHybridE1RM(s.weightKg, s.reps);
        if (e1 > best) {
          best = e1;
          label = `${formatWeight(s.weightKg, activeClient?.unit ?? 'kg')}×${s.reps}`;
        }
      }
      if (best > 0) {
        pts.push({ dateMs: w.finishedAt ?? w.startedAt, e1rmKg: best, bestSetLabel: label });
      }
    }
    return pts;
  }, [workouts, currentLiftId, activeClient?.unit]);

  const photoMeasurements = useMemo(
    () => measurements.filter((m) => Boolean(m.photoDataUrl)),
    [measurements]
  );

  const saveMeasurement = async () => {
    if (!activeClient) return;
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const bw = num(mWeight);
    const rec: BodyMeasurement = {
      id: generateId('meas'),
      clientId: activeClient.id,
      date: mDate,
      bodyweightKg: bw,
      bodyFatPct: num(mFat),
      chestCm: num(mChest),
      waistCm: num(mWaist),
      hipsCm: num(mHips),
      leftBicepCm: num(mBicepL),
      rightBicepCm: num(mBicepR),
      leftThighCm: num(mThighL),
      rightThighCm: num(mThighR),
      photoDataUrl: mPhoto,
      updatedAt: Date.now(),
      deletedAt: null,
    };
    await db.measurements.put(rec);
    // Sync latest client bodyweight for accurate DOTS normalization
    if (bw && bw >= 30) {
      await db.clients.put({ ...activeClient, bodyweightKg: bw, updatedAt: Date.now() });
    }
    setMeasModalOpen(false);
    setMPhoto(null);
    pushToast('Saved body measurements!', 'positive');
  };

  if (!activeClient || !strength) return null;

  // Radar Geometry
  const rCenterX = 140;
  const rCenterY = 120;
  const rRadius = 78;
  const radarPolyPoints = RADAR_AXES.map((cat, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const ratio = Math.max(0.06, strength.categories[cat].score / 100);
    return `${rCenterX + Math.cos(ang) * rRadius * ratio},${
      rCenterY + Math.sin(ang) * rRadius * ratio
    }`;
  }).join(' ');

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Strength Lab &amp; Analytics</h1>
          <p className="page-subtitle">
            DOTS Composite Score, 5-Axis Symmetry &amp; Biomechanical Muscle Volume for{' '}
            <strong>{activeClient.name}</strong>
          </p>
        </div>

        <button
          id="analytics-export-png-btn"
          type="button"
          className="btn btn-primary"
          onClick={() => setPngModalOpen(true)}
        >
          <ImageIcon size={15} /> Export Progress PNG
        </button>
      </div>

      {/* SECTION 1: COMPOSITE STRENGTH SCORE & 5-AXIS BALANCE RADAR */}
      <div className="grid-2">
        <div className="card col" style={{ gap: 12 }}>
          <div className="row-between">
            <div>
              <span className="section-label">Composite Strength Score (90d)</span>
              <div className="row" style={{ gap: 10, marginTop: 4 }}>
                <span className="tabular" style={{ fontSize: 38, fontWeight: 800, lineHeight: 1 }}>
                  {strength.strengthScore}
                </span>
                <span className="chip pr">{strength.tier}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="section-label">Balance Index</span>
              <div
                className="tabular"
                style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-positive)' }}
              >
                {strength.balanceIndex}%
              </div>
            </div>
          </div>

          {/* 5-Axis SVG Radar Chart */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <svg viewBox="0 0 280 240" width="275" height="236" role="img" aria-label="5-Axis Strength Balance Radar">
              {[0.25, 0.5, 0.75, 1].map((scale) => (
                <polygon
                  key={scale}
                  points={RADAR_AXES.map((_, i) => {
                    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                    return `${rCenterX + Math.cos(ang) * rRadius * scale},${
                      rCenterY + Math.sin(ang) * rRadius * scale
                    }`;
                  }).join(' ')}
                  fill="none"
                  stroke="#242429"
                  strokeWidth="1"
                />
              ))}

              {RADAR_AXES.map((cat, i) => {
                const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                const x2 = rCenterX + Math.cos(ang) * rRadius;
                const y2 = rCenterY + Math.sin(ang) * rRadius;
                const lx = rCenterX + Math.cos(ang) * (rRadius + 28);
                const ly = rCenterY + Math.sin(ang) * (rRadius + 22);
                return (
                  <g key={cat}>
                    <line x1={rCenterX} y1={rCenterY} x2={x2} y2={y2} stroke="#242429" strokeWidth="1" />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      fill="#A1A1AA"
                      fontSize="9.5"
                      fontWeight="600"
                    >
                      {CATEGORY_LABELS[cat]}
                    </text>
                    <text
                      x={lx}
                      y={ly + 11}
                      textAnchor="middle"
                      fill="#007AFF"
                      fontSize="10"
                      fontWeight="800"
                    >
                      {Math.round(strength.categories[cat].score)}
                    </text>
                  </g>
                );
              })}

              <polygon
                points={radarPolyPoints}
                fill="rgba(0, 122, 255, 0.24)"
                stroke="#007AFF"
                strokeWidth="2.2"
              />
            </svg>
          </div>

          {/* 5-Pattern Breakdown List */}
          <div className="col" style={{ gap: 6 }}>
            {RADAR_AXES.map((cat) => {
              const info = strength.categories[cat];
              return (
                <div key={cat} className="row-between" style={{ fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{CATEGORY_LABELS[cat]}</strong>
                    {info.bestLiftName ? ` · ${info.bestLiftName}` : ' · No lift logged'}
                  </span>
                  <span className="tabular" style={{ fontWeight: 700 }}>
                    {info.bestE1rmKg > 0
                      ? `${formatWeight(info.bestE1rmKg, activeClient.unit)}${activeClient.unit} (${Math.round(info.score)})`
                      : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 2: INTERACTIVE ANTERIOR / POSTERIOR SVG MUSCLE HEATMAP */}
        <div className="card col" style={{ gap: 12 }}>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h2 className="card-title">Muscle Volume Heatmap</h2>
              <p className="card-meta">Tap any muscle to inspect fractional sets</p>
            </div>

            <div className="row" style={{ gap: 4 }}>
              {(
                [
                  { d: 7, l: '7d' },
                  { d: 30, l: '30d' },
                  { d: 365, l: '1yr' },
                  { d: 0, l: 'All' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.d}
                  type="button"
                  className={`chip tabular ${heatmapDays === opt.d ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                  onClick={() => setHeatmapDays(opt.d)}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>

          <div className="split-pill">
            <button
              type="button"
              className={volumeMode === 'effective' ? 'active' : ''}
              onClick={() => setVolumeMode('effective')}
            >
              Effective Sets (RPE-Adjusted)
            </button>
            <button
              type="button"
              className={volumeMode === 'raw' ? 'active' : ''}
              onClick={() => setVolumeMode('raw')}
            >
              Raw Fractional Sets
            </button>
          </div>

          <MuscleHeatmapSvg
            volumeMap={muscleVol}
            mode={volumeMode}
            selectedMuscle={selectedMuscle}
            onSelectMuscle={(m) => setSelectedMuscle(m)}
          />

          <div
            className="card card-compact row-between"
            style={{ background: 'var(--bg-well)' }}
          >
            {selectedMuscle ? (
              <>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{MUSCLE_LABELS[selectedMuscle]}</strong>
                  <div className="card-meta">Primary = 1.0 · Secondary = 0.5 · RPE &lt; 6 discounted</div>
                </div>
                <div className="tabular" style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>
                    {muscleVol[selectedMuscle].effectiveSets} eff sets
                  </div>
                  <div className="card-meta">{muscleVol[selectedMuscle].rawSets} raw sets</div>
                </div>
              </>
            ) : (
              <span className="card-meta">
                Tap a muscle silhouette above to inspect effective vs. raw fractional volume.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: HYBRID e1RM PROGRESSION TREND CHART */}
      <div className="card col" style={{ gap: 12 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row">
            <TrendingUp size={16} style={{ color: 'var(--accent-primary)' }} />
            <h2 className="card-title">Hybrid e1RM Lift Progression</h2>
          </div>

          {loggedExercises.length > 0 && (
            <select
              value={currentLiftId}
              onChange={(e) => setSelectedLiftId(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13, maxWidth: 260 }}
            >
              {loggedExercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {liftTrendPoints.length > 0 ? (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            {(() => {
              const svgW = 620;
              const svgH = 190;
              const padL = 48;
              const padR = 20;
              const padT = 18;
              const padB = 28;
              const minVal = Math.floor(Math.min(...liftTrendPoints.map((p) => p.e1rmKg)) * 0.92);
              const maxVal = Math.ceil(Math.max(...liftTrendPoints.map((p) => p.e1rmKg)) * 1.06) || 100;
              const plotW = svgW - padL - padR;
              const plotH = svgH - padT - padB;
              const coords = liftTrendPoints.map((pt, i) => {
                const x =
                  liftTrendPoints.length === 1
                    ? padL + plotW / 2
                    : padL + (i / (liftTrendPoints.length - 1)) * plotW;
                const y =
                  padT +
                  plotH -
                  ((pt.e1rmKg - minVal) / Math.max(1, maxVal - minVal)) * plotH;
                return { x, y, pt };
              });
              const pathD = coords
                .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`)
                .join(' ');
              return (
                <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto' }}>
                  {[0, 0.5, 1].map((t) => {
                    const y = padT + plotH * t;
                    const labelVal = maxVal - (maxVal - minVal) * t;
                    return (
                      <g key={t}>
                        <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke="#242429" strokeWidth="1" />
                        <text x={padL - 8} y={y + 4} textAnchor="end" fill="#71717A" fontSize="10.5">
                          {formatWeight(labelVal, activeClient.unit)}
                        </text>
                      </g>
                    );
                  })}
                  <path d={pathD} fill="none" stroke="#007AFF" strokeWidth="2.8" strokeLinejoin="round" />
                  {coords.map((c, i) => (
                    <g key={i}>
                      <circle cx={c.x} cy={c.y} r="4.5" fill="#0A0A0C" stroke="#007AFF" strokeWidth="2.5" />
                      <text x={c.x} y={svgH - 8} textAnchor="middle" fill="#71717A" fontSize="10">
                        {new Date(c.pt.dateMs).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </text>
                      <text x={c.x} y={c.y - 9} textAnchor="middle" fill="#E4E4E7" fontSize="10" fontWeight="700">
                        {formatWeight(c.pt.e1rmKg, activeClient.unit)}
                      </text>
                    </g>
                  ))}
                </svg>
              );
            })()}
          </div>
        ) : (
          <div className="empty-state">
            Complete weighted sets for {activeClient.name} to plot hybrid e1RM trends.
          </div>
        )}
      </div>

      {/* SECTION 4: 14-POINT BODY MEASUREMENTS & PHOTO OVERLAY COMPARISON SLIDER */}
      <div className="card col" style={{ gap: 12 }}>
        <div className="row-between">
          <div className="row">
            <Ruler size={16} style={{ color: 'var(--accent-positive)' }} />
            <div>
              <h2 className="card-title">Body Measurements &amp; Photo Compare</h2>
              <p className="card-meta">Track physique changes alongside strength metrics</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setMWeight(String(activeClient.bodyweightKg));
              setMeasModalOpen(true);
            }}
          >
            <Plus size={14} /> Log Check-In
          </button>
        </div>

        {/* Before/After Photo Overlay Slider when >= 2 photos exist */}
        {photoMeasurements.length >= 2 && (
          <div className="col" style={{ gap: 8 }}>
            <div className="photo-compare-wrap">
              <img
                src={photoMeasurements[0].photoDataUrl!}
                alt="Before check-in"
                className="photo-compare-img"
              />
              <img
                src={photoMeasurements[photoMeasurements.length - 1].photoDataUrl!}
                alt="Latest check-in"
                className="photo-compare-img"
                style={{ clipPath: `inset(0 0 0 ${compareSlider}%)` }}
              />
              <div className="photo-compare-divider" style={{ left: `${compareSlider}%` }} />
            </div>
            <div className="row-between">
              <span className="card-meta tabular">Before: {photoMeasurements[0].date}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={compareSlider}
                onChange={(e) => setCompareSlider(Number(e.target.value))}
                style={{ flex: 1, margin: '0 12px' }}
              />
              <span className="card-meta tabular">
                Latest: {photoMeasurements[photoMeasurements.length - 1].date}
              </span>
            </div>
          </div>
        )}

        {measurements.length > 0 ? (
          <div className="col" style={{ gap: 6 }}>
            {[...measurements]
              .reverse()
              .slice(0, 5)
              .map((m) => (
                <div
                  key={m.id}
                  className="card card-compact row-between"
                  style={{ background: 'var(--bg-well)', flexWrap: 'wrap' }}
                >
                  <div>
                    <strong className="tabular" style={{ fontSize: 13.5 }}>
                      {m.date}
                    </strong>
                    <div className="card-meta tabular">
                      {m.bodyweightKg != null && `BW ${formatWeight(m.bodyweightKg, activeClient.unit)}${activeClient.unit}`}
                      {m.bodyFatPct != null && ` · BF ${m.bodyFatPct}%`}
                      {m.waistCm != null && ` · Waist ${m.waistCm}cm`}
                      {m.chestCm != null && ` · Chest ${m.chestCm}cm`}
                      {m.rightBicepCm != null && ` · Arm ${m.rightBicepCm}cm`}
                    </div>
                  </div>
                  {m.photoDataUrl && <span className="chip active">Photo</span>}
                </div>
              ))}
          </div>
        ) : (
          <div className="empty-state">No body check-ins logged yet for {activeClient.name}.</div>
        )}
      </div>

      {/* LOG MEASUREMENT MODAL */}
      {measModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMeasModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="card-title">Log Body Measurements · {activeClient.name}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMeasModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field-row-3">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Bodyweight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="tabular"
                    value={mWeight}
                    onChange={(e) => setMWeight(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Body Fat (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="tabular"
                    value={mFat}
                    onChange={(e) => setMFat(e.target.value)}
                  />
                </div>
              </div>

              <div className="field-row-3">
                <div className="field">
                  <label>Chest (cm)</label>
                  <input type="number" step="0.5" value={mChest} onChange={(e) => setMChest(e.target.value)} />
                </div>
                <div className="field">
                  <label>Waist (cm)</label>
                  <input type="number" step="0.5" value={mWaist} onChange={(e) => setMWaist(e.target.value)} />
                </div>
                <div className="field">
                  <label>Hips (cm)</label>
                  <input type="number" step="0.5" value={mHips} onChange={(e) => setMHips(e.target.value)} />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>L / R Bicep (cm)</label>
                  <div className="row">
                    <input type="number" step="0.2" placeholder="L" value={mBicepL} onChange={(e) => setMBicepL(e.target.value)} style={{ width: '50%' }} />
                    <input type="number" step="0.2" placeholder="R" value={mBicepR} onChange={(e) => setMBicepR(e.target.value)} style={{ width: '50%' }} />
                  </div>
                </div>
                <div className="field">
                  <label>L / R Thigh (cm)</label>
                  <div className="row">
                    <input type="number" step="0.2" placeholder="L" value={mThighL} onChange={(e) => setMThighL(e.target.value)} style={{ width: '50%' }} />
                    <input type="number" step="0.2" placeholder="R" value={mThighR} onChange={(e) => setMThighR(e.target.value)} style={{ width: '50%' }} />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Progress Photo (Optional — compressed locally for overlay slider)</label>
                <label className="btn btn-secondary btn-sm" style={{ width: 'fit-content', cursor: 'pointer' }}>
                  <Camera size={14} /> {mPhoto ? 'Photo Attached ✓' : 'Attach Progress Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const dataUrl = await compressPhotoFile(f);
                      setMPhoto(dataUrl);
                    }}
                  />
                </label>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={() => void saveMeasurement()}
              >
                Save Check-In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLIENT PROGRESS PNG MODAL */}
      <ProgressCardModal
        open={pngModalOpen}
        clientId={activeClient.id}
        onClose={() => setPngModalOpen(false)}
      />
    </div>
  );
}
