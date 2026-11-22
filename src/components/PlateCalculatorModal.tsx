import { useMemo, useState } from 'react';
import { Flame, Plus, X } from 'lucide-react';
import {
  DEFAULT_PLATE_INVENTORY_KG,
  generateWarmupRamp,
  solveGreedyBarbellPlates,
  type WarmupSetPrescription,
} from '../engine/formulas';
import { formatWeight, type WeightUnit } from '../types/models';

interface PlateCalculatorModalProps {
  open: boolean;
  onClose: () => void;
  initialWeightKg: number;
  barWeightKg: number;
  plateInventoryKg: number[];
  unit: WeightUnit;
  exerciseName?: string;
  onInsertWarmups?: (warmups: WarmupSetPrescription[]) => void;
}

export function PlateCalculatorModal({
  open,
  onClose,
  initialWeightKg,
  barWeightKg,
  plateInventoryKg,
  unit,
  exerciseName,
  onInsertWarmups,
}: PlateCalculatorModalProps) {
  const [targetWeight, setTargetWeight] = useState(String(initialWeightKg > 0 ? initialWeightKg : 100));
  const [barMass, setBarMass] = useState(barWeightKg || 20);

  const parsedTarget = Math.max(barMass, parseFloat(targetWeight) || barMass);

  const plateSolution = useMemo(
    () =>
      solveGreedyBarbellPlates(
        parsedTarget,
        barMass,
        plateInventoryKg.length > 0 ? plateInventoryKg : DEFAULT_PLATE_INVENTORY_KG
      ),
    [parsedTarget, barMass, plateInventoryKg]
  );

  const warmups = useMemo(
    () => generateWarmupRamp(parsedTarget, barMass, 2.5),
    [parsedTarget, barMass]
  );

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="card-title">Barbell Plate Solver &amp; Warm-Up Ramp</h2>
            <p className="card-meta">{exerciseName || 'Greedy IPF color-coded plate loader'}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <div className="field">
              <label>Working Target Weight (kg)</label>
              <input
                type="number"
                step="2.5"
                className="tabular"
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Empty Barbell (kg)</label>
              <select
                value={barMass}
                onChange={(e) => setBarMass(Number(e.target.value))}
              >
                <option value={20}>20 kg (Men's Olympic)</option>
                <option value={15}>15 kg (Women's Olympic)</option>
                <option value={10}>10 kg (EZ / Technique Bar)</option>
                <option value={25}>25 kg (Trap / Safety Bar)</option>
              </select>
            </div>
          </div>

          {/* Visual IPF Barbell End-Cap */}
          <div className="col" style={{ gap: 6 }}>
            <div className="row-between">
              <span className="section-label">Per-Side Loading (IPF Colors)</span>
              <span className="card-meta tabular">
                Loaded: <strong>{plateSolution.achievedWeightKg} kg</strong> ({plateSolution.perSideWeightKg} kg/side)
              </span>
            </div>

            <div className="barbell-stage">
              <div className="barbell-shaft" />
              <div className="barbell-collar" />
              <div className="barbell-sleeve">
                {plateSolution.platesPerSide.length === 0 ? (
                  <span
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      paddingLeft: 12,
                      background: '#0d0d10',
                    }}
                  >
                    Empty Bar
                  </span>
                ) : (
                  plateSolution.platesPerSide.flatMap((slot) =>
                    Array.from({ length: slot.countPerSide }, (_, idx) => (
                      <div
                        key={`${slot.weightKg}-${idx}`}
                        className="barbell-plate tabular"
                        style={{
                          height: `${Math.round(slot.heightPct * 1.05)}px`,
                          background: slot.color,
                          color: slot.weightKg === 5 || slot.weightKg === 15 ? '#0A0A0C' : '#FFFFFF',
                        }}
                      >
                        {slot.weightKg}
                      </div>
                    ))
                  )
                )}
              </div>
            </div>

            <div className="chip-row">
              {plateSolution.platesPerSide.map((p) => (
                <span key={p.weightKg} className="chip tabular">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: p.color,
                    }}
                  />
                  {p.countPerSide} × {p.weightKg}kg / side
                </span>
              ))}
              {plateSolution.remainderPerSideKg > 0 && (
                <span className="chip danger tabular">
                  Unloaded remainder: {plateSolution.remainderPerSideKg}kg/side
                </span>
              )}
            </div>
          </div>

          <div className="divider" />

          {/* Warm-Up Ramp Generator */}
          <div className="col">
            <div className="row-between">
              <div className="row">
                <Flame size={15} style={{ color: 'var(--accent-pr)' }} />
                <span className="section-label">Auto Warm-Up Ramp (40% · 60% · 80%)</span>
              </div>
              {onInsertWarmups && (
                <button
                  type="button"
                  className="btn btn-amber btn-sm"
                  onClick={() => {
                    onInsertWarmups(warmups);
                    onClose();
                  }}
                >
                  <Plus size={14} /> Add to Exercise
                </button>
              )}
            </div>

            <div className="col" style={{ gap: 6 }}>
              {warmups.map((w, idx) => {
                const subPlates = solveGreedyBarbellPlates(w.weightKg, barMass, plateInventoryKg);
                return (
                  <div
                    key={`${w.weightKg}-${idx}`}
                    className="card card-compact row-between"
                    style={{ background: 'var(--bg-well)' }}
                  >
                    <div className="row">
                      <span className="chip pr tabular">W{idx + 1}</span>
                      <div>
                        <div className="tabular" style={{ fontWeight: 700, fontSize: 14 }}>
                          {formatWeight(w.weightKg, unit)} {unit} × {w.reps} reps
                        </div>
                        <div className="card-meta tabular">
                          {w.label} ·{' '}
                          {subPlates.platesPerSide.length > 0
                            ? subPlates.platesPerSide
                                .map((p) => `${p.countPerSide}×${p.weightKg}`)
                                .join(' + ') + '/side'
                            : 'Empty bar'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
