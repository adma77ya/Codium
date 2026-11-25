import type { Problem } from './types'

const MARK = 'write your solution here'

export const problems: Problem[] = [
  {
    letter: 'A',
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Map'],
    acceptance: 78.4,
    timeLimitMs: 1000,
    memoryMb: 256,
    statement: [
      'You are given a list of integers and a target value. Find two different positions whose values add up to the target.',
      'Exactly one valid pair exists in every test. Print the two positions in increasing order, using zero-based indexing.',
    ],
    input: 'The first line has n and the target. The second line has n integers.',
    output: 'Two integers: the positions of the pair, in increasing order.',
    examples: [
      { input: '4 9\n2 7 11 15', output: '0 1', note: '2 + 7 = 9, so the positions are 0 and 1.' },
      { input: '3 6\n3 2 4', output: '1 2' },
    ],
    constraints: ['2 ≤ n ≤ 100 000', '-10⁹ ≤ values, target ≤ 10⁹', 'Exactly one pair is valid'],
    starter: {
      python: `import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    n, target = int(data[0]), int(data[1])\n    nums = list(map(int, data[2:2 + n]))\n    # ${MARK}\n\nmain()\n`,
      cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n; long long target;\n    cin >> n >> target;\n    vector<long long> a(n);\n    for (auto &x : a) cin >> x;\n    // ${MARK}\n    return 0;\n}\n`,
      go: `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tin := bufio.NewReader(os.Stdin)\n\tvar n int\n\tvar target int64\n\tfmt.Fscan(in, &n, &target)\n\ta := make([]int64, n)\n\tfor i := range a {\n\t\tfmt.Fscan(in, &a[i])\n\t}\n\t// ${MARK}\n}\n`,
    },
  },
  {
    letter: 'B',
    slug: 'valid-brackets',
    title: 'Valid Brackets',
    difficulty: 'Easy',
    tags: ['Stack', 'String'],
    acceptance: 64.1,
    timeLimitMs: 1000,
    memoryMb: 256,
    statement: [
      'A string contains only the characters ( ) [ ] { }. It is valid when every opening bracket is closed by the same kind of bracket, in the correct order.',
      'Print YES if the string is valid, otherwise NO.',
    ],
    input: 'One line with the string.',
    output: 'YES or NO.',
    examples: [
      { input: '()[]{}', output: 'YES' },
      { input: '(]', output: 'NO' },
      { input: '([{}])', output: 'YES' },
    ],
    constraints: ['1 ≤ length ≤ 200 000'],
    starter: {
      python: `s = input().strip()\n# ${MARK}\n`,
      cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    string s; cin >> s;\n    // ${MARK}\n    return 0;\n}\n`,
      go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar s string\n\tfmt.Scan(&s)\n\t// ${MARK}\n}\n`,
    },
  },
  {
    letter: 'C',
    slug: 'longest-unique-run',
    title: 'Longest Unique Run',
    difficulty: 'Medium',
    tags: ['Sliding Window', 'Hash Map'],
    acceptance: 41.7,
    timeLimitMs: 1500,
    memoryMb: 256,
    statement: [
      'Given a string, find the length of the longest contiguous substring in which no character appears twice.',
    ],
    input: 'One line with a string of lowercase letters.',
    output: 'One integer: the length of the longest such substring.',
    examples: [
      { input: 'abcabcbb', output: '3', note: 'The substring abc has length 3.' },
      { input: 'bbbbb', output: '1' },
    ],
    constraints: ['1 ≤ length ≤ 500 000'],
    starter: {
      python: `s = input().strip()\n# ${MARK}\n`,
      cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    string s; cin >> s;\n    // ${MARK}\n    return 0;\n}\n`,
      go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar s string\n\tfmt.Scan(&s)\n\t// ${MARK}\n}\n`,
    },
  },
  {
    letter: 'D',
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'Medium',
    tags: ['Sorting', 'Intervals'],
    acceptance: 38.2,
    timeLimitMs: 2000,
    memoryMb: 256,
    statement: [
      'You are given closed intervals [l, r]. Merge every group of overlapping intervals and print the result sorted by start.',
      'Intervals that touch at an endpoint, such as [1, 3] and [3, 5], count as overlapping.',
    ],
    input: 'The first line has n. Each of the next n lines has two integers l and r.',
    output: 'The merged intervals, one per line, as "l r".',
    examples: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', output: '1 6\n8 10\n15 18' },
    ],
    constraints: ['1 ≤ n ≤ 200 000', '0 ≤ l ≤ r ≤ 10⁹'],
    starter: {
      python: `import sys\n\ndata = sys.stdin.read().split()\nn = int(data[0])\nintervals = [(int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n)]\n# ${MARK}\n`,
      cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    vector<pair<int,int>> v(n);\n    for (auto &p : v) cin >> p.first >> p.second;\n    // ${MARK}\n    return 0;\n}\n`,
      go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar n int\n\tfmt.Scan(&n)\n\t// ${MARK}\n}\n`,
    },
  },
  {
    letter: 'E',
    slug: 'median-of-two-arrays',
    title: 'Median of Two Sorted Arrays',
    difficulty: 'Hard',
    tags: ['Binary Search', 'Divide and Conquer'],
    acceptance: 29.5,
    timeLimitMs: 2000,
    memoryMb: 256,
    statement: [
      'Two sorted arrays are given. Find the median of all their elements combined, without merging them.',
      'Your solution must run in O(log(m + n)) time.',
    ],
    input: 'Line 1: m and n. Line 2: m sorted integers. Line 3: n sorted integers.',
    output: 'The median, printed with one decimal place.',
    examples: [
      { input: '2 1\n1 3\n2', output: '2.0' },
      { input: '2 2\n1 2\n3 4', output: '2.5' },
    ],
    constraints: ['0 ≤ m, n ≤ 1 000 000', 'm + n ≥ 1', '-10⁹ ≤ values ≤ 10⁹'],
    starter: {
      python: `import sys\n\ndata = sys.stdin.read().split()\n# ${MARK}\n`,
      cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int m, n; cin >> m >> n;\n    vector<long long> a(m), b(n);\n    for (auto &x : a) cin >> x;\n    for (auto &x : b) cin >> x;\n    // ${MARK}\n    return 0;\n}\n`,
      go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar m, n int\n\tfmt.Scan(&m, &n)\n\t// ${MARK}\n}\n`,
    },
  },
]

export const STARTER_MARK = MARK
export const bySlug = (slug: string) => problems.find((p) => p.slug === slug)
