export type Difficulty = 'Easy' | 'Medium' | 'Hard'
export type Lang = 'python' | 'cpp' | 'go'

export interface Example {
  input: string
  output: string
  note?: string
}

export interface Problem {
  letter: string
  slug: string
  title: string
  difficulty: Difficulty
  tags: string[]
  acceptance: number
  timeLimitMs: number
  memoryMb: number
  statement: string[]
  input: string
  output: string
  examples: Example[]
  constraints: string[]
  starter: Record<Lang, string>
}

export type Verdict =
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Runtime Error'
  | 'Compile Error'

export type JudgePhase = 'queued' | 'compiling' | 'running' | 'done'

export interface TestResult {
  n: number
  status: 'pending' | 'pass' | 'fail' | 'tle'
  timeMs?: number
}

export interface Submission {
  id: string
  slug: string
  lang: Lang
  verdict: Verdict
  timeMs: number
  memoryMb: number
  at: number
}

export interface JudgeState {
  phase: JudgePhase
  tests: TestResult[]
  verdict?: Verdict
  timeMs?: number
  memoryMb?: number
  message?: string // compiler output / runtime error detail
}

export interface Cell {
  status: 'solved' | 'tried' | 'none'
  minute?: number
  tries: number
}

export interface Standing {
  user: string
  you: boolean
  solved: number
  penalty: number
  cells: Record<string, Cell>
}
