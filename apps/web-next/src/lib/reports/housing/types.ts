export type Sec = "w" | "m" | "o";

export type Resident = {
  pcid: string;
  email?: string;
  first?: string;
  last?: string;
  name?: string;
  building?: string;
  room?: string;
  session?: string;
  class_status?: string;
  student_type?: string;
  transfer?: boolean;
  college_attend?: string;
  category?: string;
  sport?: string;
  roster_status?: string;
  athletic_type?: string;
  entry_term?: string;
  gender?: string;
  hometown?: string;
  is_athlete?: boolean;
  price_type?: string;
  move_in_erez?: string;
  move_in_early?: string;
  move_in?: string;
  move_in_source?: string;
  end_date?: string;
  early_reason?: string;
  early_groups?: string[];
};

export type WithdrawnInfo = {
  excluded_from_feed?: number;
  deposit_total?: number;
  deposit_total_w?: number;
  deposit_total_m?: number;
  withdrawn_total?: number;
  withdrawn_w?: number;
  withdrawn_m?: number;
};

export type ResidentsPayload = {
  generated?: string | null;
  count?: number;
  source?: string;
  session?: string;
  cached_at?: string;
  withdrawn?: WithdrawnInfo;
  verification_candidates?: VerificationCandidate[];
  residents?: Resident[];
  error?: string;
};

export type VerificationCandidate = {
  pcid: string;
  name?: string;
  email?: string;
  building?: string;
  room?: string;
  category?: string;
  class_status?: string;
  student_type?: string;
  gender?: string;
  roster_status?: string;
  athletic_type?: string;
  is_athlete?: boolean;
  sheet_sport?: string;
  slate_sport?: string;
  groups?: string[];
  move_in?: string;
  move_in_source?: string;
  reasons?: string[];
};

export type VerificationEdit = {
  status?: string;
  move_in?: string;
  note?: string;
};

export type VerificationState = {
  edits: Record<string, VerificationEdit>;
  notes: unknown[];
};

export type RoomEdit = {
  status?: string;
  capacity?: string | number;
  note?: string;
};

export type RoomVerificationState = {
  edits: Record<string, RoomEdit>;
};

export type ChartRoom = {
  number: string;
  type?: string;
  cap: number;
  col: number;
  row: number;
  w?: number;
  h?: number;
};

export type ChartFloor = {
  level: number;
  name?: string;
  rooms: ChartRoom[];
};

export type HallChart = {
  hall: { code: string; name: string };
  floors: ChartFloor[];
};

export type StudyAbroad = {
  session?: string;
  houses?: Record<string, number>;
  total?: number;
  cached_at?: string;
  stale?: boolean;
  error?: string;
};

export type HallMeta = {
  abbr: string;
  name: string;
  sec: Sec;
  std: number;
};
