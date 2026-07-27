const DAY_MS = 86_400_000;

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

export interface LongevityStats {
  ageInDays: number;
  monthlyExchangeCounts: number[];
  quartersWithMeetings: number;
  totalInteractions: number;
}

/** Ancienneté fondée uniquement sur les interactions réellement observées. */
export function observedRelationshipAgeInDays(
  interactionTimes: number[],
  nowMs: number,
): number {
  const observedTimes = interactionTimes.filter((time) =>
    Number.isFinite(time) && time <= nowMs
  );
  if (!observedTimes.length) return 0;
  return Math.max(0, Math.floor((nowMs - Math.min(...observedTimes)) / DAY_MS));
}

/**
 * Longévité = durée observée + continuité des échanges + continuité des réunions.
 *
 * Il n'y a plus de seuil qui force le résultat à zéro. Le facteur de maturité
 * limite seulement le poids de la longévité dans le score composite durant les
 * 90 premiers jours. Dès qu'il existe des échanges horodatés, ils produisent
 * une information exploitable.
 */
export function scoreLongevite(
  stats: LongevityStats,
): { score: number; factor: number } {
  if (stats.totalInteractions <= 0) return { score: 0, factor: 0 };

  const ageInDays = Math.max(0, stats.ageInDays);
  const elapsedMonths = Math.max(1, Math.min(6, Math.ceil((ageInDays + 1) / 30)));
  const monthlyCounts = stats.monthlyExchangeCounts.slice(0, elapsedMonths);
  while (monthlyCounts.length < elapsedMonths) monthlyCounts.push(0);

  const activeMonthRatio =
    monthlyCounts.filter((count) => count > 0).length / elapsedMonths;
  const mean =
    monthlyCounts.reduce((total, count) => total + count, 0) / elapsedMonths;
  const regularity = mean > 0
    ? Math.max(
      0,
      1 -
        Math.sqrt(
            monthlyCounts.reduce(
              (total, count) => total + (count - mean) ** 2,
              0,
            ) / elapsedMonths,
          ) /
          mean /
          2,
    )
    : 0;

  const ageScore = clamp(ageInDays / (24 * 30));
  const consistency = activeMonthRatio * 0.65 + regularity * 0.35;
  const meetingContinuity = clamp(stats.quartersWithMeetings / 4);
  const score =
    ageScore * 0.45 + consistency * 0.40 + meetingContinuity * 0.15;

  // Une relation récente apporte déjà un signal, mais sa dimension de
  // longévité gagne progressivement son poids complet pendant 90 jours.
  const factor = 0.35 + clamp(ageInDays / 90) * 0.65;
  return { score: clamp(score) * factor, factor };
}
