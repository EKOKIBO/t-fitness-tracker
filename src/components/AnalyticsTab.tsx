import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Image as ImageIcon, Plus, X } from 'lucide-react';
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
    const pts: Array<{ dateMs: number; e1rmKg: number }> = [];
    const sorted = [...workouts].sort(
      (a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt)
    );
    for (const w of sorted) {
      const we = w.exercises.find((e) => e.exerciseId === currentLiftId);
      if (!we) continue;
      let best = 0;
      for (const s of we.sets) {
        if (!s.completed || s.type === 'W' || !s.weightKg || !s.reps) continue;
        const e1 = calculateHybridE1RM(s.weightKg, s.reps);
        if (e1 > best) best = e1;
      }
      if (best > 0) pts.push({ dateMs: w.finishedAt ?? w.startedAt, e1rmKg: best });
    }
    return pts;
  }, [workouts, currentLiftId]);

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
    if (bw && bw >= 30) {
      await db.clients.put({ ...activeClient, bodyweightKg: bw, updatedAt: Date.now() });
    }
    setMeasModalOpen(false);
    setMPhoto(null);
    pushToast('Saved measurements.');
  };

  if (!activeClient || !strength) return null;

  const rCenterX = 140;
  const rCenterY = 120;
  const rRadius = 76;
  const radarPolyPoints = RADAR_AXES.map((cat, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const ratio = Math.max(0.06, strength.categories[cat].score / 100);
    return `${rCenterX + Math.cos(ang) * rRadius * ratio},${
      rCenterY + Math.sin(ang) * rRadius * ratio
    }`;
  }).join(' ');

  return (
    <div className="screen-section">
      <div className="screen-head">
        <h1 className="screen-title">Analytics</h1>
        <button
          id="analytics-export-png-btn"
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setPngModalOpen(true)}
        >
          <ImageIcon size={15} /> Export PNG
        </button>
      </div>

      {/* STRENGTH SCORE & 5-AXIS RADAR */}
      <div className="section-block">
        <div className="section-header">
          <span className="section-label">Strength Score (90d)</span>
          <span className="row-sub tabular">{strength.balanceIndex}% balance</span>
        </div>

        <div className="list-group">
          <div style={{ padding: '16px 16px 8px' }}>
            <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
              <span className="tabular" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em' }}>
                {strength.strengthScore}
              </span>
              <span className="row-sub">{strength.tier}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
              <svg viewBox="0 0 280 238" width="268" height="228" role="img" aria-label="Strength Balance Radar">
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
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1"
                  />
                ))}

                {RADAR_AXES.map((cat, i) => {
                  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                  const x2 = rCenterX + Math.cos(ang) * rRadius;
                  const y2 = rCenterY + Math.sin(ang) * rRadius;
                  const lx = rCenterX + Math.cos(ang) * (rRadius + 28);
                  const ly = rCenterY + Math.sin(ang) * (rRadius + 21);
                  return (
                    <g key={cat}>
                      <line x1={rCenterX} y1={rCenterY} x2={x2} y2={y2} stroke="rgba(255,255,255,0.08)" />
                      <text x={lx} y={ly} textAnchor="middle" fill="#8E8E93" fontSize="10" fontWeight="500">
                        {CATEGORY_LABELS[cat]}
                      </text>
                      <text x={lx} y={ly + 12} textAnchor="middle" fill="#F5F5F7" fontSize="10.5" fontWeight="700">
                        {Math.round(strength.categories[cat].score)}
                      </text>
                    </g>
                  );
                })}

                <polygon
                  points={radarPolyPoints}
                  fill="rgba(0, 122, 255, 0.22)"
                  stroke="#007AFF"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          {RADAR_AXES.map((cat) => {
            const info = strength.categories[cat];
            return (
              <div key={cat} className="list-row" style={{ minHeight: 46 }}>
                <div className="list-row-body">
                  <span className="row-title" style={{ fontSize: 14 }}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className="row-sub">{info.bestLiftName ?? 'No lift logged'}</span>
                </div>
                <span className="tabular" style={{ fontWeight: 600, fontSize: 14 }}>
                  {info.bestE1rmKg > 0
                    ? `${formatWeight(info.bestE1rmKg, activeClient.unit)}${activeClient.unit}`
                    : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* MUSCLE VOLUME HEATMAP */}
      <div className="section-block">
        <div className="section-header">
          <span className="section-label">Muscle Volume</span>
          <div className="row" style={{ gap: 10 }}>
            {(
              [
                { d: 7, l: '7D' },
                { d: 30, l: '30D' },
                { d: 365, l: '1Y' },
                { d: 0, l: 'ALL' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.d}
                type="button"
                className="tabular"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: heatmapDays === opt.d ? 'var(--accent)' : 'var(--text-tertiary)',
                  minHeight: 28,
                }}
                onClick={() => setHeatmapDays(opt.d)}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        <div className="list-group">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="segmented">
              <button
                type="button"
                className={volumeMode === 'effective' ? 'active' : ''}
                onClick={() => setVolumeMode('effective')}
              >
                Effective Sets
              </button>
              <button
                type="button"
                className={volumeMode === 'raw' ? 'active' : ''}
                onClick={() => setVolumeMode('raw')}
              >
                Raw Fractional
              </button>
            </div>

            <MuscleHeatmapSvg
              volumeMap={muscleVol}
              mode={volumeMode}
              selectedMuscle={selectedMuscle}
              onSelectMuscle={(m) => setSelectedMuscle(m)}
            />
          </div>

          <div className="list-row" style={{ minHeight: 46 }}>
            {selectedMuscle ? (
              <>
                <span className="row-title" style={{ fontSize: 14 }}>
                  {MUSCLE_LABELS[selectedMuscle]}
                </span>
                <span className="row-sub tabular" style={{ color: 'var(--text-primary)' }}>
                  {muscleVol[selectedMuscle].effectiveSets} eff · {muscleVol[selectedMuscle].rawSets} raw
                </span>
              </>
            ) : (
              <span className="row-sub">Tap a muscle group to inspect sets.</span>
            )}
          </div>
        </div>
      </div>

      {/* e1RM LIFT PROGRESSION */}
      <div className="section-block">
        <div className="section-header">
          <span className="section-label">Estimated 1RM</span>
        </div>

        <div className="surface-panel col" style={{ gap: 12 }}>
          {loggedExercises.length > 0 && (
            <select
              value={currentLiftId}
              onChange={(e) => setSelectedLiftId(e.target.value)}
              style={{ minHeight: 40, padding: '0 10px', fontSize: 14 }}
            >
              {loggedExercises.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}

          {liftTrendPoints.length > 0 ? (
            <div style={{ width: '100%' }}>
              {(() => {
                const svgW = 560;
                const svgH = 170;
                const padL = 44;
                const padR = 18;
                const padT = 18;
                const padB = 24;
                const minVal = Math.floor(Math.min(...liftTrendPoints.map((p) => p.e1rmKg)) * 0.92);
                const maxVal =
                  Math.ceil(Math.max(...liftTrendPoints.map((p) => p.e1rmKg)) * 1.06) || 100;
                const plotW = svgW - padL - padR;
                const plotH = svgH - padT - padB;
                const coords = liftTrendPoints.map((pt, i) => ({
                  x:
                    liftTrendPoints.length === 1
                      ? padL + plotW / 2
                      : padL + (i / (liftTrendPoints.length - 1)) * plotW,
                  y:
                    padT +
                    plotH -
                    ((pt.e1rmKg - minVal) / Math.max(1, maxVal - minVal)) * plotH,
                  pt,
                }));
                const pathD = coords
                  .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`)
                  .join(' ');
                return (
                  <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto' }}>
                    {[0, 0.5, 1].map((t) => {
                      const y = padT + plotH * t;
                      const val = maxVal - (maxVal - minVal) * t;
                      return (
                        <g key={t}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={svgW - padR}
                            y2={y}
                            stroke="rgba(255,255,255,0.08)"
                          />
                          <text x={padL - 8} y={y + 4} textAnchor="end" fill="#636366" fontSize="10.5">
                            {formatWeight(val, activeClient.unit)}
                          </text>
                        </g>
                      );
                    })}
                    <path d={pathD} fill="none" stroke="#007AFF" strokeWidth="2.4" strokeLinejoin="round" />
                    {coords.map((c, i) => (
                      <g key={i}>
                        <circle cx={c.x} cy={c.y} r="4" fill="#141417" stroke="#007AFF" strokeWidth="2.2" />
                        <text x={c.x} y={svgH - 6} textAnchor="middle" fill="#636366" fontSize="10">
                          {new Date(c.pt.dateMs).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </text>
                        <text x={c.x} y={c.y - 9} textAnchor="middle" fill="#F5F5F7" fontSize="10" fontWeight="600">
                          {formatWeight(c.pt.e1rmKg, activeClient.unit)}
                        </text>
                      </g>
                    ))}
                  </svg>
                );
              })()}
            </div>
          ) : (
            <div className="empty-state">No weighted sets logged yet.</div>
          )}
        </div>
      </div>

      {/* MEASUREMENTS & PHOTO COMPARE */}
      <div className="section-block">
        <div className="section-header">
          <span className="section-label">Measurements</span>
          <button
            type="button"
            className="btn-text"
            style={{ minHeight: 28, fontSize: 13 }}
            onClick={() => {
              setMWeight(String(activeClient.bodyweightKg));
              setMeasModalOpen(true);
            }}
          >
            <Plus size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Log
          </button>
        </div>

        {photoMeasurements.length >= 2 && (
          <div className="col" style={{ gap: 8, marginBottom: 4 }}>
            <div className="photo-compare-wrap">
              <img
                src={photoMeasurements[0].photoDataUrl!}
                alt="Before"
                className="photo-compare-img"
              />
              <img
                src={photoMeasurements[photoMeasurements.length - 1].photoDataUrl!}
                alt="Latest"
                className="photo-compare-img"
                style={{ clipPath: `inset(0 0 0 ${compareSlider}%)` }}
              />
              <div className="photo-compare-divider" style={{ left: `${compareSlider}%` }} />
            </div>
            <div className="row-between">
              <span className="row-sub tabular">{photoMeasurements[0].date}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={compareSlider}
                onChange={(e) => setCompareSlider(Number(e.target.value))}
                style={{ flex: 1, margin: '0 12px' }}
              />
              <span className="row-sub tabular">
                {photoMeasurements[photoMeasurements.length - 1].date}
              </span>
            </div>
          </div>
        )}

        <div className="list-group">
          {measurements.length === 0 ? (
            <div className="empty-state">No measurements logged.</div>
          ) : (
            [...measurements]
              .reverse()
              .slice(0, 5)
              .map((m) => (
                <div key={m.id} className="list-row">
                  <div className="list-row-body">
                    <span className="row-title tabular">{m.date}</span>
                    <span className="row-sub tabular">
                      {m.bodyweightKg != null &&
                        `${formatWeight(m.bodyweightKg, activeClient.unit)}${activeClient.unit}`}
                      {m.bodyFatPct != null && ` · ${m.bodyFatPct}% BF`}
                      {m.waistCm != null && ` · Waist ${m.waistCm}cm`}
                      {m.chestCm != null && ` · Chest ${m.chestCm}cm`}
                    </span>
                  </div>
                  {m.photoDataUrl && <span className="row-sub">Photo</span>}
                </div>
              ))
          )}
        </div>
      </div>

      {/* Log Measurement Sheet */}
      {measModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMeasModalOpen(false);
          }}
        >
          <div className="modal-sheet">
            <div className="modal-header">
              <h2 className="modal-title">Log Measurements</h2>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => setMeasModalOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="field-row-3">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="tabular"
                    value={mWeight}
                    onChange={(e) => setMWeight(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Body Fat %</label>
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

              <label className="btn btn-secondary btn-full" style={{ cursor: 'pointer' }}>
                <Camera size={16} /> {mPhoto ? 'Photo Attached' : 'Add Progress Photo'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setMPhoto(await compressPhotoFile(f));
                  }}
                />
              </label>

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

      <ProgressCardModal
        open={pngModalOpen}
        clientId={activeClient.id}
        onClose={() => setPngModalOpen(false)}
      />
    </div>
  );
}
