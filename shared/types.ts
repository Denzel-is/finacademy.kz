export type Role = "student" | "admin" | "superadmin";
export type User = {
  id: string;
  name: string;
  login: string;
  role: Role;
  group_id: string | null;
  group_name?: string;
  blocked: number;
  must_change_password?: number;
  created_at?: string;
};
export type Test = {
  id: string;
  title: string;
  discipline: string;
  description: string;
  question_count: number;
  bank_count: number;
  pass_percent: number;
  minutes: number;
  max_attempts: number;
  published: number;
  proctor_mode: "off" | "log" | "warn" | "block";
  proctor_limit: number;
  fullscreen: number;
  show_result: number;
  show_history: number;
  demo: number;
  created_at: string;
  assigned_count?: number;
  attempts_used?: number;
  access?: {
    id: string;
    starts_at: string | null;
    ends_at: string | null;
    max_attempts: number;
  };
  active_attempt?: string | null;
};
export type Group = {
  id: string;
  name: string;
  description: string;
  student_count: number;
  assignment_count: number;
  created_at: string;
};
export type Option = { id: string; text: string };
export type Question = { id: string; text: string; options: Option[] };
export type BankQuestion = Question & {
  test_id: string;
  correct_id: string;
  archived: number;
};
export type Answers = Record<string, string>;
export type Attempt = {
  id: string;
  user_id: string;
  test_id: string;
  test_title: string;
  student_name: string;
  group_name: string;
  status: "active" | "completed" | "expired" | "blocked";
  started_at: string;
  deadline: string | null;
  finished_at: string | null;
  pass_percent: number;
  questions: Question[];
  answers: Answers;
  version: number;
  score: number | null;
  percent: number | null;
  passed: number | null;
  violation_count: number;
  proctor_mode: Test["proctor_mode"];
  proctor_limit: number;
  fullscreen: number;
  proctor_epoch: number;
  show_result: number;
  show_history: number;
  total_questions?: number;
  server_now: string;
};
export type ResultRow = Omit<Attempt, "questions" | "answers"> & {
  total_questions: number;
  login: string;
};
export type ResultsPageData = {
  items: ResultRow[];
  total: number;
  stats: { completed: number; average: number; active: number; violations: number };
  page: number;
  page_size: number;
};
export type ResultsExportChunk = {
  items: ResultRow[];
  next_cursor: string | null;
  snapshot: string;
};
export type Assignment = {
  id: string;
  test_id: string;
  title: string;
  group_id: string | null;
  user_id: string | null;
  target_name: string;
  starts_at: string | null;
  ends_at: string | null;
  max_attempts: number;
  closed: number;
  minutes?: number | null;
  test_minutes?: number;
  student_count: number;
};
export type ProctorKind =
  "focus" | "hidden" | "fullscreen" | "reload" | "offline";
export type ProctorEvent = {
  id: string;
  kind: ProctorKind;
  occurredAt: string;
  returnedAt?: string;
  durationMs?: number;
  questionCode?: string;
};
export type JournalRow = {
  event_id: string;
  epoch: number;
  kind: ProctorKind;
  occurred_at: string;
  received_at: string;
  returned_at: string | null;
  duration_ms: number;
  question_code: string;
  counted: number;
};
export type Dashboard = {
  students: number;
  groups: number;
  tests: number;
  completed: number;
  active: number;
  average: number;
  passed: number;
  violations: number;
  recent: ResultRow[];
  trend: { day: string; completed: number; passed: number }[];
  activity: {
    id: string;
    action: string;
    details: string;
    created_at: string;
    name: string;
  }[];
  popular: { title: string; count: number; average: number }[];
};
