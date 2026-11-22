import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
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
  const [targetWeight, setTargetWeight] = useState(
    String(initialWeightKg > 0 ? initialWeightKg : 100)
  );
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
            <h2 className="modal-title">Plates &amp; Warm-Up</h2>
            {exerciseName && <div className="row-sub">{exerciseName}</div>}
          </div>
          <button type="button" className="nav-icon-btn" onClick={onClose}>
            <X size={19} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <div className="field">
              <label>Target Weight (kg)</label>
              <input
                type="number"
                step="2.5"
                className="tabular"
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Barbell (kg)</label>
              <select value={barMass} onChange={(e) => setBarMass(Number(e.target.value))}>
                <option value={20}>20 kg</option>
                <option value={15}>15 kg</option>
                <option value={10}>10 kg</option>
                <option value={25}>25 kg</option>
              </select>
            </div>
          </div>

          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Per Side</span>
              <span className="row-sub tabular">
                {plateSolution.achievedWeightKg} kg ({plateSolution.perSideWeightKg} kg/side)
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
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      paddingLeft: 10,
                      background: 'var(--bg-canvas)',
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
                          height: `${Math.round(slot.heightPct * 1.02)}px`,
                          background: slot.color,
                          color:
                            slot.weightKg === 5 || slot.weightKg === 15 ? '#000000' : '#FFFFFF',
                        }}
                      >
                        {slot.weightKg}
                      </div>
                    ))
                  )
                )}
              </div>
            </div>

            {plateSolution.platesPerSide.length > 0 && (
              <div className="row-sub tabular">
                {plateSolution.platesPerSide
                  .map((p) => `${p.countPerSide} × ${p.weightKg}kg`)
                  .join('  +  ')}
              </div>
            )}
          </div>

          <div className="section-block">
            <div className="section-header">
              <span className="section-label">Warm-Up Sets</span>
              {onInsertWarmups && (
                <button
                  type="button"
                  className="btn-text"
                  style={{ minHeight: 28, fontSize: 13 }}
                  onClick={() => {
                    onInsertWarmups(warmups);
                    onClose();
                  }}
                >
                  <Plus size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Insert
                </button>
              )}
            </div>

            <div className="list-group">
              {warmups.map((w, idx) => (
                <div key={`${w.weightKg}-${idx}`} className="list-row" style={{ minHeight: 46 }}>
                  <span className="row-title tabular">
                    {formatWeight(w.weightKg, unit)} {unit} × {w.reps}
                  </span>
                  <span className="row-sub tabular">{w.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
