/**
 * Coaching items shown on the result screen's "Improvement plan" tab.
 *
 * Ported from the prototype: every sentence is derived from the attempt's own numbers,
 * so the advice changes with the performance rather than being canned copy.
 */
import { fmtMinutes, type AttemptResult, type SectionResult, type Suggestion } from '@mockmint/shared';

const DRILL_BY_SECTION: Record<string, string> = {
  QA: 'arithmetic and algebra',
  DILR: 'timed table-and-arrangement sets',
  VARC: 'inference and para-summary sets',
};

export function buildSuggestions(result: AttemptResult): Suggestion[] {
  const out: Suggestion[] = [];
  const sections = result.sections;
  if (sections.length === 0) return out;

  // 1 — weakest section by accuracy.
  const weakest = [...sections].sort((a, b) => a.acc - b.acc)[0] as SectionResult;
  out.push({
    icon: '◎',
    tone: 'bad',
    priority: 'HIGH',
    title: `Your ${weakest.key} accuracy is ${weakest.acc}%`,
    body:
      `That is the weakest of the three sections this attempt. Work through ` +
      `${DRILL_BY_SECTION[weakest.key] ?? 'mixed sets'} in 20-minute blocks and review every ` +
      `wrong answer before moving on.`,
    tags: [weakest.name, `Accuracy ${weakest.acc}%`, `Score ${weakest.score}/${weakest.max}`],
  });

  // 2 — cost of negative marking.
  const negative = sections.reduce((sum, s) => sum + s.wrong, 0);
  if (negative > 0) {
    out.push({
      icon: '▽',
      tone: 'warn',
      priority: 'MEDIUM',
      title: `You lost ${negative} ${negative === 1 ? 'mark' : 'marks'} to negative marking`,
      body:
        negative > 8
          ? 'You are attempting questions you cannot convert. Leave a question the moment you have not found a foothold in 60 seconds — selection is worth more than speed at your accuracy level.'
          : 'Negative marking is under control. Keep the same selection discipline as you raise your attempt count.',
      tags: [`${result.wrong} incorrect`, `Attempt rate ${result.attemptRate}%`],
    });
  }

  // 3 — pace, measured per attempted question rather than per question on the paper.
  const slowest = [...sections].sort(
    (a, b) => b.timeSec / Math.max(1, b.attempted) - a.timeSec / Math.max(1, a.attempted),
  )[0] as SectionResult;
  const pace = Math.round(slowest.timeSec / Math.max(1, slowest.attempted));
  out.push({
    icon: '◷',
    tone: 'info',
    priority: 'MEDIUM',
    title: `${slowest.key} pace is ${pace}s per attempted question`,
    body:
      `Aim for 90–110s per question in ${slowest.key}. Practise with a visible per-question ` +
      `clock so pace becomes automatic rather than something you monitor.`,
    tags: [`Time ${fmtMinutes(slowest.timeSec)}`, `Attempted ${slowest.attempted}/${slowest.count}`],
  });

  // 4 — only when a large part of the paper went untouched.
  if (result.skipped > 20) {
    out.push({
      icon: '△',
      tone: 'ok',
      priority: 'LOW',
      title: `${result.skipped} questions left untouched`,
      body:
        `Your attempt rate is ${result.attemptRate}%. Once accuracy holds above 70%, raising ` +
        `attempts by five questions is worth roughly 12 marks — a full percentile band at your ` +
        `current score.`,
      tags: [`Attempt rate ${result.attemptRate}%`],
    });
  }

  return out;
}

export function timeNote(result: AttemptResult): string {
  const spent = fmtMinutes(result.timeSec);
  const tail =
    result.timeSec < 5400
      ? 'Large unused time usually means you abandoned sets early rather than reading them properly.'
      : 'Time use is close to full — the lever now is selection, not speed.';
  return `You spent ${spent} of the 120 available. ${tail}`;
}
