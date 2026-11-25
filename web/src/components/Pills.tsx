import type { Difficulty, Verdict } from '../data/types'

export function DifficultyPill({ level }: { level: Difficulty }) {
  return <span className={`diff diff-${level.toLowerCase()}`}>{level}</span>
}

const verdictClass: Record<Verdict, string> = {
  Accepted: 'v-ac',
  'Wrong Answer': 'v-wa',
  'Time Limit Exceeded': 'v-tle',
  'Runtime Error': 'v-wa',
  'Compile Error': 'v-wa',
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return <span className={`verdict ${verdictClass[verdict]}`}>{verdict}</span>
}
