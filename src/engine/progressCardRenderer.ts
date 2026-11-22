import type {
  BodyMeasurement,
  Client,
  Exercise,
  MovementCategory,
  MuscleGroup,
  Workout,
} from '../types/models';
import { CATEGORY_LABELS, MUSCLE_LABELS, formatWeight } from '../types/models';
import {
  calculateHybridE1RM,
  computeCompositeStrengthScore,
  computeMuscleVolume,
} from './formulas';

export type ReportRangeDays = 30 | 90 | 365 | 0; // 0 = All-Time

export interface ProgressCardInput {
  client: Client;
  allWorkouts: Workout[];
  measurements: BodyMeasurement[];
  exerciseMap: Map<string, Exercise>;
  rangeDays: ReportRangeDays;
}

interface LiftSeriesPoint {
  dateMs: number;
  e1rmKg: number;
}

interface LiftSeries {
  exerciseId: string;
  name: string;
  color: string;
  points: LiftSeriesPoint[];
  latestKg: number;
  deltaKg: number;
}

interface PrRecord {
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rmKg: number;
  dateStr: string;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 24
) {
  ctx.fillStyle = '#141417';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = '#242429';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function rangeLabel(days: ReportRangeDays): string {
  if (days === 30) return 'Last 30 Days';
  if (days === 90) return 'Last 90 Days';
  if (days === 365) return 'Last 12 Months';
  return 'All-Time Report';
}

/**
 * Generates an ultra-crisp 2x Retina PNG Progress Report Card (1200 x 1760 px)
 * completely offline on HTML5 Canvas—ready to save or share to WhatsApp / iMessage.
 */
export async function renderClientProgressCardPng(
  input: ProgressCardInput
): Promise<{ blob: Blob; dataUrl: string }> {
  const W = 1200;
  const H = 1760;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const { client, allWorkouts, measurements, exerciseMap, rangeDays } = input;
  const now = Date.now();
  const cutoff = rangeDays > 0 ? now - rangeDays * 86_400_000 : 0;

  const periodWorkouts = allWorkouts
    .filter((w) => !w.deletedAt && w.status === 'completed' && (w.finishedAt ?? w.startedAt) >= cutoff)
    .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));

  // Core analytics
  const strength = computeCompositeStrengthScore(
    client,
    allWorkouts,
    exerciseMap,
    rangeDays > 0 ? rangeDays : 0,
    now
  );
  const muscleVol = computeMuscleVolume(periodWorkouts, exerciseMap);
  const totalVolumeKg = periodWorkouts.reduce((acc, w) => acc + (w.totalVolumeKg || 0), 0);
  const totalWorkingSets = periodWorkouts.reduce(
    (acc, w) =>
      acc +
      w.exercises.reduce(
        (ea, ex) => ea + ex.sets.filter((s) => s.completed && s.type !== 'W').length,
        0
      ),
    0
  );

  // Build top 3 lifts e1RM series over time
  const seriesByEx = new Map<string, LiftSeriesPoint[]>();
  const bestPrByEx = new Map<string, PrRecord>();

  for (const w of periodWorkouts) {
    const ts = w.finishedAt ?? w.startedAt;
    for (const exEntry of w.exercises) {
      let bestSetE1rm = 0;
      let bestSet: { w: number; r: number } | null = null;
      for (const s of exEntry.sets) {
        if (!s.completed || s.type === 'W' || !s.reps || s.reps <= 0) continue;
        const wt = s.weightKg ?? 0;
        if (wt <= 0) continue;
        const e1rm = calculateHybridE1RM(wt, s.reps);
        if (e1rm > bestSetE1rm) {
          bestSetE1rm = e1rm;
          bestSet = { w: wt, r: s.reps };
        }
      }
      if (bestSetE1rm > 0 && bestSet) {
        const list = seriesByEx.get(exEntry.exerciseId) ?? [];
        list.push({ dateMs: ts, e1rmKg: bestSetE1rm });
        seriesByEx.set(exEntry.exerciseId, list);

        const prevPr = bestPrByEx.get(exEntry.exerciseId);
        if (!prevPr || bestSetE1rm > prevPr.e1rmKg) {
          bestPrByEx.set(exEntry.exerciseId, {
            exerciseName: exerciseMap.get(exEntry.exerciseId)?.name ?? exEntry.exerciseId,
            weightKg: bestSet.w,
            reps: bestSet.r,
            e1rmKg: bestSetE1rm,
            dateStr: formatShortDate(ts),
          });
        }
      }
    }
  }

  const seriesColors = ['#007AFF', '#10B981', '#FFB800'];
  const topSeries: LiftSeries[] = Array.from(seriesByEx.entries())
    .sort((a, b) => {
      // Prioritize lifts with >=2 sessions and higher e1RM
      const multiDiff = (b[1].length >= 2 ? 1 : 0) - (a[1].length >= 2 ? 1 : 0);
      if (multiDiff !== 0) return multiDiff;
      const maxB = Math.max(...b[1].map((p) => p.e1rmKg));
      const maxA = Math.max(...a[1].map((p) => p.e1rmKg));
      return maxB - maxA;
    })
    .slice(0, 3)
    .map(([exId, points], idx) => {
      const first = points[0].e1rmKg;
      const latest = points[points.length - 1].e1rmKg;
      return {
        exerciseId: exId,
        name: exerciseMap.get(exId)?.name ?? exId,
        color: seriesColors[idx % seriesColors.length],
        points,
        latestKg: latest,
        deltaKg: Math.round((latest - first) * 10) / 10,
      };
    });

  const topPrs = Array.from(bestPrByEx.values())
    .sort((a, b) => b.e1rmKg - a.e1rmKg)
    .slice(0, 5);

  // Weekly tonnage bars (up to last 8 buckets)
  const weeklyMap = new Map<string, { label: string; volumeKg: number; sortKey: number }>();
  for (const w of periodWorkouts) {
    const ts = w.finishedAt ?? w.startedAt;
    const d = new Date(ts);
    const dayOfWeek = (d.getDay() + 6) % 7;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek);
    const key = monday.toISOString().slice(0, 10);
    const cur = weeklyMap.get(key) ?? {
      label: formatShortDate(monday.getTime()),
      volumeKg: 0,
      sortKey: monday.getTime(),
    };
    cur.volumeKg += w.totalVolumeKg || 0;
    weeklyMap.set(key, cur);
  }
  const weeklyBars = Array.from(weeklyMap.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(-8);

  // === BACKGROUND CANVAS ===
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  // === HEADER ===
  const pad = 56;
  // T! Brand Badge
  ctx.fillStyle = '#141417';
  roundRect(ctx, pad, 48, 72, 72, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = '800 38px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  ctx.fillStyle = '#F5F5F7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', pad + 28, 86);
  ctx.fillStyle = '#007AFF';
  ctx.fillText('!', pad + 51, 86);

  // Client name + subtitle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#F5F5F7';
  ctx.font = '700 42px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  ctx.fillText(client.name, pad + 96, 86);

  ctx.fillStyle = '#8E8E93';
  ctx.font = '500 21px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  const genDate = new Date(now).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  ctx.fillText(
    `${rangeLabel(rangeDays).toUpperCase()}  ·  ${genDate}`,
    pad + 96,
    118
  );

  // Clean Tier Label on Top Right
  const tierText = strength.tier.toUpperCase();
  ctx.font = '600 18px -apple-system, BlinkMacSystemFont, Inter, sans-serif';
  const pillW = ctx.measureText(tierText).width + 40;
  ctx.fillStyle = '#141417';
  roundRect(ctx, W - pad - pillW, 62, pillW, 44, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#F5F5F7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tierText, W - pad - pillW / 2, 85);

  // === KPI ROW (4 CARDS — STRICT MONOCHROME METRICS) ===
  const kpiY = 158;
  const kpiH = 132;
  const gap = 20;
  const kpiW = (W - pad * 2 - gap * 3) / 4;

  const volDisplay =
    totalVolumeKg >= 1000
      ? `${(totalVolumeKg / 1000).toFixed(1)}t`
      : `${Math.round(totalVolumeKg)} ${client.unit}`;

  const kpis = [
    { label: 'SESSIONS', value: `${periodWorkouts.length}`, sub: `${totalWorkingSets} working sets`, color: '#F5F5F7' },
    { label: 'VOLUME', value: volDisplay, sub: 'Cumulative load', color: '#F5F5F7' },
    { label: 'STRENGTH', value: `${strength.strengthScore}`, sub: 'DOTS 0–100', color: '#F5F5F7' },
    { label: 'BALANCE', value: `${strength.balanceIndex}%`, sub: '5-axis symmetry', color: '#F5F5F7' },
  ];

  kpis.forEach((kpi, i) => {
    const x = pad + i * (kpiW + gap);
    drawCard(ctx, x, kpiY, kpiW, kpiH, 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8E8E98';
    ctx.font = '700 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(kpi.label, x + 22, kpiY + 36);

    ctx.fillStyle = kpi.color;
    ctx.font = '800 42px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(kpi.value, x + 22, kpiY + 88);

    ctx.fillStyle = '#71717A';
    ctx.font = '500 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(kpi.sub, x + 22, kpiY + 116);
  });

  // === SECTION 2: e1RM STRENGTH TREND GRAPH ===
  const chartY = 322;
  const chartH = 380;
  drawCard(ctx, pad, chartY, W - pad * 2, chartH, 24);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Estimated 1RM Strength Progression', pad + 28, chartY + 44);
  ctx.fillStyle = '#8E8E98';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Hybrid Brzycki / Empirical e1RM across top compound lifts', pad + 28, chartY + 70);

  const plotX = pad + 78;
  const plotY = chartY + 104;
  const plotW = W - pad * 2 - 116;
  const plotH = 192;

  if (topSeries.length > 0) {
    const allPts = topSeries.flatMap((s) => s.points);
    const minTs = Math.min(...allPts.map((p) => p.dateMs));
    const maxTs = Math.max(...allPts.map((p) => p.dateMs));
    const rawMinY = Math.min(...allPts.map((p) => p.e1rmKg));
    const rawMaxY = Math.max(...allPts.map((p) => p.e1rmKg));
    const minY = Math.max(0, Math.floor((rawMinY * 0.88) / 5) * 5);
    const maxY = Math.ceil((rawMaxY * 1.08) / 5) * 5 || 100;

    // Horizontal grid lines
    ctx.strokeStyle = '#242429';
    ctx.lineWidth = 1.5;
    ctx.font = '500 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const y = plotY + (plotH * g) / 4;
      const val = maxY - ((maxY - minY) * g) / 4;
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
      ctx.fillText(`${formatWeight(val, client.unit)}`, plotX - 12, y + 5);
    }

    // Plot each lift series
    for (const s of topSeries) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      s.points.forEach((pt, idx) => {
        const xRatio = maxTs > minTs ? (pt.dateMs - minTs) / (maxTs - minTs) : 0.5;
        const yRatio = maxY > minY ? (pt.e1rmKg - minY) / (maxY - minY) : 0.5;
        const px = plotX + xRatio * plotW;
        const py = plotY + plotH - yRatio * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Dots
      s.points.forEach((pt) => {
        const xRatio = maxTs > minTs ? (pt.dateMs - minTs) / (maxTs - minTs) : 0.5;
        const yRatio = maxY > minY ? (pt.e1rmKg - minY) / (maxY - minY) : 0.5;
        const px = plotX + xRatio * plotW;
        const py = plotY + plotH - yRatio * plotH;
        ctx.fillStyle = '#0A0A0C';
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 3.5;
        ctx.stroke();
      });
    }

    // Legend row at bottom of chart card
    ctx.textAlign = 'left';
    let lx = pad + 28;
    const ly = chartY + chartH - 30;
    for (const s of topSeries) {
      ctx.fillStyle = s.color;
      roundRect(ctx, lx, ly - 13, 14, 14, 4);
      ctx.fill();
      const shortName = s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name;
      const deltaTag =
        s.deltaKg > 0
          ? ` (+${formatWeight(s.deltaKg, client.unit)})`
          : s.deltaKg < 0
          ? ` (${formatWeight(s.deltaKg, client.unit)})`
          : '';
      const label = `${shortName}: ${formatWeight(s.latestKg, client.unit)}${client.unit}${deltaTag}`;
      ctx.fillStyle = '#E4E4E7';
      ctx.font = '600 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(label, lx + 22, ly);
      lx += ctx.measureText(label).width + 44;
    }
  } else {
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.font = '500 20px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Log weighted sessions to plot strength progression curves.', W / 2, plotY + plotH / 2);
  }

  // === SECTION 3 (TWO COLUMNS): 5-AXIS BALANCE RADAR + WEEKLY VOLUME BARS ===
  const midY = 728;
  const midH = 440;
  const halfW = (W - pad * 2 - 24) / 2;

  // Left: 5-Axis Radar
  drawCard(ctx, pad, midY, halfW, midH, 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('5-Axis Strength Radar', pad + 28, midY + 44);
  ctx.fillStyle = '#8E8E98';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`DOTS Normalized · Balance ${strength.balanceIndex}%`, pad + 28, midY + 70);

  const cx = pad + halfW / 2;
  const cy = midY + 258;
  const rMax = 132;
  const axes: MovementCategory[] = ['squat', 'horizontal_push', 'pull', 'vertical_push', 'hinge'];

  // Concentric pentagons
  for (let ring = 1; ring <= 4; ring++) {
    const r = (rMax * ring) / 4;
    ctx.beginPath();
    axes.forEach((_, idx) => {
      const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = '#242429';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Axis spokes + labels
  axes.forEach((cat, idx) => {
    const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * rMax, cy + Math.sin(ang) * rMax);
    ctx.strokeStyle = '#242429';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const lx = cx + Math.cos(ang) * (rMax + 34);
    const ly = cy + Math.sin(ang) * (rMax + 26);
    const score = Math.round(strength.categories[cat].score);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#D4D4D8';
    ctx.font = '600 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`${CATEGORY_LABELS[cat]}`, lx, ly);
    ctx.fillStyle = '#007AFF';
    ctx.font = '700 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`${score}`, lx, ly + 20);
  });

  // Filled radar polygon
  ctx.beginPath();
  axes.forEach((cat, idx) => {
    const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
    const ratio = Math.max(0.06, strength.categories[cat].score / 100);
    const x = cx + Math.cos(ang) * rMax * ratio;
    const y = cy + Math.sin(ang) * rMax * ratio;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 122, 255, 0.25)';
  ctx.fill();
  ctx.strokeStyle = '#007AFF';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Right: Weekly Volume Bars
  const rightX = pad + halfW + 24;
  drawCard(ctx, rightX, midY, halfW, midH, 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Weekly Volume Load', rightX + 28, midY + 44);
  ctx.fillStyle = '#8E8E98';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`Total tonnage per week (${client.unit})`, rightX + 28, midY + 70);

  if (weeklyBars.length > 0) {
    const bx0 = rightX + 34;
    const by0 = midY + 115;
    const bwArea = halfW - 68;
    const bhArea = 250;
    const maxVol = Math.max(...weeklyBars.map((b) => b.volumeKg), 1);
    const slotW = bwArea / weeklyBars.length;
    const barW = Math.min(46, slotW * 0.58);

    weeklyBars.forEach((bar, i) => {
      const h = Math.max(10, (bar.volumeKg / maxVol) * bhArea);
      const x = bx0 + i * slotW + (slotW - barW) / 2;
      const y = by0 + bhArea - h;

      ctx.fillStyle = i === weeklyBars.length - 1 ? '#10B981' : '#007AFF';
      roundRect(ctx, x, y, barW, h, 8);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '600 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const valText =
        bar.volumeKg >= 1000
          ? `${(bar.volumeKg / 1000).toFixed(1)}t`
          : `${Math.round(bar.volumeKg)}`;
      ctx.fillText(valText, x + barW / 2, y - 8);

      ctx.fillStyle = '#71717A';
      ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(bar.label, x + barW / 2, by0 + bhArea + 24);
    });
  } else {
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.font = '500 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('No completed sessions in selected range.', rightX + halfW / 2, midY + 240);
  }

  // === SECTION 4 (TWO COLUMNS): PERSONAL RECORDS + MUSCLE FOCUS ===
  const botY = 1194;
  const botH = 446;

  // Left: Top PRs Achieved
  drawCard(ctx, pad, botY, halfW, botH, 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Top Personal Records', pad + 28, botY + 44);
  ctx.fillStyle = '#FFB800';
  ctx.font = '600 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Best working sets & estimated 1RMs', pad + 28, botY + 70);

  if (topPrs.length > 0) {
    topPrs.forEach((pr, idx) => {
      const ry = botY + 98 + idx * 64;
      ctx.fillStyle = '#1E1E24';
      roundRect(ctx, pad + 24, ry, halfW - 48, 54, 14);
      ctx.fill();

      // Gold PR rank badge
      ctx.fillStyle = 'rgba(255, 184, 0, 0.16)';
      roundRect(ctx, pad + 34, ry + 11, 34, 32, 9);
      ctx.fill();
      ctx.fillStyle = '#FFB800';
      ctx.textAlign = 'center';
      ctx.font = '800 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`#${idx + 1}`, pad + 51, ry + 33);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const title = pr.exerciseName.length > 22 ? pr.exerciseName.slice(0, 21) + '…' : pr.exerciseName;
      ctx.fillText(title, pad + 82, ry + 26);

      ctx.fillStyle = '#8E8E98';
      ctx.font = '500 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(
        `${formatWeight(pr.weightKg, client.unit)}${client.unit} × ${pr.reps} · ${pr.dateStr}`,
        pad + 82,
        ry + 45
      );

      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFB800';
      ctx.font = '700 19px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(
        `${formatWeight(pr.e1rmKg, client.unit)}${client.unit}`,
        pad + halfW - 38,
        ry + 33
      );
      ctx.fillStyle = '#71717A';
      ctx.font = '500 12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('e1RM', pad + halfW - 38, ry + 48);
    });
  } else {
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.font = '500 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('No PR records logged yet.', pad + halfW / 2, botY + 230);
  }

  // Right: Top Muscle Volume + Body Measurement Delta
  drawCard(ctx, rightX, botY, halfW, botH, 24);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Muscle Stimulus Focus', rightX + 28, botY + 44);
  ctx.fillStyle = '#8E8E98';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Effective fractional working sets (RPE-weighted)', rightX + 28, botY + 70);

  const sortedMuscles = (Object.keys(muscleVol) as MuscleGroup[])
    .map((m) => ({ muscle: m, ...muscleVol[m] }))
    .filter((m) => m.rawSets > 0)
    .sort((a, b) => b.effectiveSets - a.effectiveSets)
    .slice(0, 6);

  const maxMuscleSets = Math.max(...sortedMuscles.map((m) => m.rawSets), 1);

  if (sortedMuscles.length > 0) {
    sortedMuscles.forEach((entry, idx) => {
      const y = botY + 106 + idx * 44;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#E4E4E7';
      ctx.font = '600 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(MUSCLE_LABELS[entry.muscle], rightX + 28, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '600 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`${entry.effectiveSets} eff / ${entry.rawSets} raw`, rightX + halfW - 28, y);

      const barTrackW = halfW - 56;
      ctx.fillStyle = '#1E1E24';
      roundRect(ctx, rightX + 28, y + 10, barTrackW, 12, 6);
      ctx.fill();

      const rawW = Math.max(8, (entry.rawSets / maxMuscleSets) * barTrackW);
      ctx.fillStyle = 'rgba(0, 122, 255, 0.35)';
      roundRect(ctx, rightX + 28, y + 10, rawW, 12, 6);
      ctx.fill();

      const effW = Math.max(8, (entry.effectiveSets / maxMuscleSets) * barTrackW);
      ctx.fillStyle = '#007AFF';
      roundRect(ctx, rightX + 28, y + 10, effW, 12, 6);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = '#71717A';
    ctx.textAlign = 'center';
    ctx.font = '500 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('Complete sessions to map muscle volume.', rightX + halfW / 2, botY + 210);
  }

  // Bodyweight / Waist delta strip at bottom of Muscle card
  const sortedMeas = [...measurements]
    .filter((m) => !m.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestMeas = sortedMeas[sortedMeas.length - 1];
  const firstMeas = sortedMeas[0];

  const stripY = botY + botH - 64;
  ctx.fillStyle = '#1E1E24';
  roundRect(ctx, rightX + 24, stripY, halfW - 48, 44, 12);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#A1A1AA';
  ctx.font = '600 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  const bwCurrent = latestMeas?.bodyweightKg ?? client.bodyweightKg;
  const bwDelta =
    firstMeas?.bodyweightKg && latestMeas?.bodyweightKg && sortedMeas.length > 1
      ? Math.round((latestMeas.bodyweightKg - firstMeas.bodyweightKg) * 10) / 10
      : null;
  const waistDelta =
    firstMeas?.waistCm && latestMeas?.waistCm && sortedMeas.length > 1
      ? Math.round((latestMeas.waistCm - firstMeas.waistCm) * 10) / 10
      : null;

  const bwText = `Bodyweight: ${formatWeight(bwCurrent, client.unit)} ${client.unit}${
    bwDelta != null ? ` (${bwDelta > 0 ? '+' : ''}${bwDelta}kg)` : ''
  }`;
  const waistText =
    waistDelta != null ? `  ·  Waist: ${waistDelta > 0 ? '+' : ''}${waistDelta}cm` : '';
  ctx.fillText(bwText + waistText, rightX + 40, stripY + 27);

  // === FOOTER ===
  ctx.textAlign = 'left';
  ctx.fillStyle = '#52525B';
  ctx.font = '600 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('TRACKED WITH T! STRENGTH & COACHING OS', pad, H - 52);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#71717A';
  ctx.font = '500 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('Hybrid e1RM · DOTS Strength Score · RPE Effective Volume', W - pad, H - 52);

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG blob.'))), 'image/png');
  });

  return { blob, dataUrl };
}
