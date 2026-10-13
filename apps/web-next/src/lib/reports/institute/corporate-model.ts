/**
 * Corporate Engagement Data Model & Baseline Analytics
 *
 * Implements requirements from:
 * - DST-910: Corporate Engagement KPI Dashboard (Liam O'Rourke)
 * - DST-28: Qlik Corporate Engagement Dashboard
 *
 * Provides weekly pacing, KPI tracking with configurable annual targets,
 * 7-stage company relationship pipeline, delivery opportunity pipeline,
 * and weekly meeting reference.
 */

export interface FundingWeek {
  weekEnding: string;
  targetHighSchool: number;
  actualHighSchool: number | null;
  targetIndividual: number;
  actualIndividual: number | null;
  targetOrganization: number;
  actualOrganization: number | null;
  cumTarget: number;
  cumActual: number | null;
  variance: number | null;
}

export interface CasesWeek {
  weekEnding: string;
  target: number;
  actual: number | null;
  cumTarget: number;
  cumActual: number | null;
  variance: number | null;
}

export interface JobsWeek {
  weekEnding: string;
  targetInternship: number;
  actualInternship: number | null;
  targetFullTime: number;
  actualFullTime: number | null;
  cumTarget: number;
  cumActual: number | null;
  variance: number | null;
}

export interface NetworkWeek {
  weekEnding: string;
  targetMentor: number;
  actualMentor: number | null;
  targetFellow: number;
  actualFellow: number | null;
  targetAdvisor: number;
  actualAdvisor: number | null;
  cumTarget: number;
  cumActual: number | null;
  variance: number | null;
}

export interface AnnualTargets {
  funding: number; // e.g. $250,000 (Dept 6181 + 3012)
  sponsors: number; // e.g. 50 new
  opportunities: number; // e.g. 100
  internships: number; // e.g. 50
  fullTimeJobs: number; // e.g. 50
  projectSolutions: number; // e.g. 20 cases
  advisors: number; // e.g. 50 new
}

export interface KpiSummaryCard {
  id: string;
  title: string;
  goalLabel: string;
  targetValue: number;
  actualValue: number;
  variance: number;
  unit: "currency" | "count";
  status: "on-target" | "behind";
  dataSource: string;
  details: { label: string; target: number; actual: number }[];
}

export interface CompanyRecord {
  id: string;
  name: string;
  industry: string;
  stage:
    | "Lead"
    | "Contact"
    | "Discovery"
    | "Opportunity"
    | "Sponsorship"
    | "Delivery"
    | "Cultivate"
    | "Closed Won"
    | "Closed Lost";
  headquartersState: string;
  headquartersCity: string;
  fundingGiven: number; // $$ given (Virtuous/Adaptive)
  instituteRelationship: string;
  studentsApplied: number;
  studentsInterviewed: number;
  studentsHired: number;
  alumniWorking: string; // Alumni currently working there with job title
  amuVendor: string; // AMU vendor contract & annual spend
  completedOpportunities: string; // e.g. 40/50 completed
  eventsAttended: string; // e.g. Chancellor's Gala
  eventsSponsored: string; // e.g. Chancellor's Gala
  lastCommunication: string;
}

export interface OpportunityRecord {
  id: string;
  type: string;
  company: string;
  category: "Talent" | "Solutions" | "Platform";
  stage: "Backlog" | "In Process" | "Completed" | "Unfulfilled";
  status: string;
  owner: string;
  dueDate: string;
  scope: string;
}

export interface PipelineStageStat {
  stage: string;
  total: number;
  weeklyIn: number;
  weeklyOut: number;
  netChange: number;
}

export interface DeliveryPipelineStageStat {
  stage: string;
  total: number;
  weeklyIn: number;
  weeklyOut: number;
  netChange: number;
  breakdown: { category: string; count: number }[];
}

export const DEFAULT_ANNUAL_TARGETS: AnnualTargets = {
  funding: 250000,
  sponsors: 50,
  opportunities: 100,
  internships: 50,
  fullTimeJobs: 50,
  projectSolutions: 20,
  advisors: 50,
};

export const HISTORICAL_FUNDING: FundingWeek[] = [
  {
    "weekEnding": "2026-05-10",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 1000.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 12823.53,
    "cumActual": 1000.0,
    "variance": -11823.53
  },
  {
    "weekEnding": "2026-05-17",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 11000.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 25647.06,
    "cumActual": 12000.0,
    "variance": -13647.06
  },
  {
    "weekEnding": "2026-05-24",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 0.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 38470.59,
    "cumActual": 12000.0,
    "variance": -26470.59
  },
  {
    "weekEnding": "2026-05-31",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 0.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 51294.12,
    "cumActual": 12000.0,
    "variance": -39294.12
  },
  {
    "weekEnding": "2026-06-07",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 1000.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 64117.65,
    "cumActual": 13000.0,
    "variance": -51117.65
  },
  {
    "weekEnding": "2026-06-14",
    "targetHighSchool": 1282.35,
    "actualHighSchool": 0.0,
    "targetIndividual": 5129.41,
    "actualIndividual": 0.0,
    "targetOrganization": 6411.76,
    "actualOrganization": 0.0,
    "cumTarget": 76941.18,
    "cumActual": 13000.0,
    "variance": -63941.18
  },
  {
    "weekEnding": "2026-06-21",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 89764.71,
    "cumActual": 13000.0,
    "variance": -76764.71
  },
  {
    "weekEnding": "2026-06-28",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 102588.24,
    "cumActual": 13000.0,
    "variance": -89588.24
  },
  {
    "weekEnding": "2026-07-05",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 115411.76,
    "cumActual": 13000.0,
    "variance": -102411.76
  },
  {
    "weekEnding": "2026-07-12",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 128235.29,
    "cumActual": 13000.0,
    "variance": -115235.29
  },
  {
    "weekEnding": "2026-07-19",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 141058.82,
    "cumActual": 13000.0,
    "variance": -128058.82
  },
  {
    "weekEnding": "2026-07-26",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 153882.35,
    "cumActual": 13000.0,
    "variance": -140882.35
  },
  {
    "weekEnding": "2026-08-02",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 166705.88,
    "cumActual": 13000.0,
    "variance": -153705.88
  },
  {
    "weekEnding": "2026-08-09",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 179529.41,
    "cumActual": 13000.0,
    "variance": -166529.41
  },
  {
    "weekEnding": "2026-08-16",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 192352.94,
    "cumActual": 13000.0,
    "variance": -179352.94
  },
  {
    "weekEnding": "2026-08-23",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 205176.47,
    "cumActual": 13000.0,
    "variance": -192176.47
  },
  {
    "weekEnding": "2026-08-30",
    "targetHighSchool": 1282.35,
    "actualHighSchool": null,
    "targetIndividual": 5129.41,
    "actualIndividual": null,
    "targetOrganization": 6411.76,
    "actualOrganization": null,
    "cumTarget": 218000.0,
    "cumActual": 13000.0,
    "variance": -205000.0
  }
];

export const HISTORICAL_CASES: CasesWeek[] = [
  {
    "weekEnding": "2026-05-10",
    "target": 1.18,
    "actual": 0.0,
    "cumTarget": 1.18,
    "cumActual": 0.0,
    "variance": -1.18
  },
  {
    "weekEnding": "2026-05-17",
    "target": 1.18,
    "actual": 0.0,
    "cumTarget": 2.35,
    "cumActual": 0.0,
    "variance": -2.35
  },
  {
    "weekEnding": "2026-05-24",
    "target": 1.18,
    "actual": 1.0,
    "cumTarget": 3.53,
    "cumActual": 1.0,
    "variance": -2.53
  },
  {
    "weekEnding": "2026-05-31",
    "target": 1.18,
    "actual": 0.0,
    "cumTarget": 4.71,
    "cumActual": 1.0,
    "variance": -3.71
  },
  {
    "weekEnding": "2026-06-07",
    "target": 1.18,
    "actual": 0.0,
    "cumTarget": 5.88,
    "cumActual": 1.0,
    "variance": -4.88
  },
  {
    "weekEnding": "2026-06-14",
    "target": 1.18,
    "actual": 0.0,
    "cumTarget": 7.06,
    "cumActual": 1.0,
    "variance": -6.06
  },
  {
    "weekEnding": "2026-06-21",
    "target": 1.18,
    "actual": null,
    "cumTarget": 8.24,
    "cumActual": 1.0,
    "variance": -7.24
  },
  {
    "weekEnding": "2026-06-28",
    "target": 1.18,
    "actual": null,
    "cumTarget": 9.41,
    "cumActual": 1.0,
    "variance": -8.41
  },
  {
    "weekEnding": "2026-07-05",
    "target": 1.18,
    "actual": null,
    "cumTarget": 10.59,
    "cumActual": 1.0,
    "variance": -9.59
  },
  {
    "weekEnding": "2026-07-12",
    "target": 1.18,
    "actual": null,
    "cumTarget": 11.76,
    "cumActual": 1.0,
    "variance": -10.76
  },
  {
    "weekEnding": "2026-07-19",
    "target": 1.18,
    "actual": null,
    "cumTarget": 12.94,
    "cumActual": 1.0,
    "variance": -11.94
  },
  {
    "weekEnding": "2026-07-26",
    "target": 1.18,
    "actual": null,
    "cumTarget": 14.12,
    "cumActual": 1.0,
    "variance": -13.12
  },
  {
    "weekEnding": "2026-08-02",
    "target": 1.18,
    "actual": null,
    "cumTarget": 15.29,
    "cumActual": 1.0,
    "variance": -14.29
  },
  {
    "weekEnding": "2026-08-09",
    "target": 1.18,
    "actual": null,
    "cumTarget": 16.47,
    "cumActual": 1.0,
    "variance": -15.47
  },
  {
    "weekEnding": "2026-08-16",
    "target": 1.18,
    "actual": null,
    "cumTarget": 17.65,
    "cumActual": 1.0,
    "variance": -16.65
  },
  {
    "weekEnding": "2026-08-23",
    "target": 1.18,
    "actual": null,
    "cumTarget": 18.82,
    "cumActual": 1.0,
    "variance": -17.82
  },
  {
    "weekEnding": "2026-08-30",
    "target": 1.18,
    "actual": null,
    "cumTarget": 20.0,
    "cumActual": 1.0,
    "variance": -19.0
  }
];

export const HISTORICAL_JOBS: JobsWeek[] = [
  {
    "weekEnding": "2026-05-10",
    "targetInternship": 2.94,
    "actualInternship": 12.0,
    "targetFullTime": 2.94,
    "actualFullTime": 15.0,
    "cumTarget": 5.88,
    "cumActual": 27.0,
    "variance": 21.12
  },
  {
    "weekEnding": "2026-05-17",
    "targetInternship": 2.94,
    "actualInternship": 0.0,
    "targetFullTime": 2.94,
    "actualFullTime": 0.0,
    "cumTarget": 11.76,
    "cumActual": 27.0,
    "variance": 15.24
  },
  {
    "weekEnding": "2026-05-24",
    "targetInternship": 2.94,
    "actualInternship": 5.0,
    "targetFullTime": 2.94,
    "actualFullTime": 5.0,
    "cumTarget": 17.65,
    "cumActual": 37.0,
    "variance": 19.35
  },
  {
    "weekEnding": "2026-05-31",
    "targetInternship": 2.94,
    "actualInternship": 0.0,
    "targetFullTime": 2.94,
    "actualFullTime": 0.0,
    "cumTarget": 23.53,
    "cumActual": 37.0,
    "variance": 13.47
  },
  {
    "weekEnding": "2026-06-07",
    "targetInternship": 2.94,
    "actualInternship": 0.0,
    "targetFullTime": 2.94,
    "actualFullTime": 0.0,
    "cumTarget": 29.41,
    "cumActual": 37.0,
    "variance": 7.59
  },
  {
    "weekEnding": "2026-06-14",
    "targetInternship": 2.94,
    "actualInternship": 1.0,
    "targetFullTime": 2.94,
    "actualFullTime": 0.0,
    "cumTarget": 35.29,
    "cumActual": 38.0,
    "variance": 2.71
  },
  {
    "weekEnding": "2026-06-21",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 41.18,
    "cumActual": 38.0,
    "variance": -3.18
  },
  {
    "weekEnding": "2026-06-28",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 47.06,
    "cumActual": 38.0,
    "variance": -9.06
  },
  {
    "weekEnding": "2026-07-05",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 52.94,
    "cumActual": 38.0,
    "variance": -14.94
  },
  {
    "weekEnding": "2026-07-12",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 58.82,
    "cumActual": 38.0,
    "variance": -20.82
  },
  {
    "weekEnding": "2026-07-19",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 64.71,
    "cumActual": 38.0,
    "variance": -26.71
  },
  {
    "weekEnding": "2026-07-26",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 70.59,
    "cumActual": 38.0,
    "variance": -32.59
  },
  {
    "weekEnding": "2026-08-02",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 76.47,
    "cumActual": 38.0,
    "variance": -38.47
  },
  {
    "weekEnding": "2026-08-09",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 82.35,
    "cumActual": 38.0,
    "variance": -44.35
  },
  {
    "weekEnding": "2026-08-16",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 88.24,
    "cumActual": 38.0,
    "variance": -50.24
  },
  {
    "weekEnding": "2026-08-23",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 94.12,
    "cumActual": 38.0,
    "variance": -56.12
  },
  {
    "weekEnding": "2026-08-30",
    "targetInternship": 2.94,
    "actualInternship": null,
    "targetFullTime": 2.94,
    "actualFullTime": null,
    "cumTarget": 100.0,
    "cumActual": 38.0,
    "variance": -62.0
  }
];

export const HISTORICAL_NETWORK: NetworkWeek[] = [
  {
    "weekEnding": "2026-05-10",
    "targetMentor": 1.47,
    "actualMentor": 0.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 2.65,
    "cumActual": 0.0,
    "variance": -2.65
  },
  {
    "weekEnding": "2026-05-17",
    "targetMentor": 1.47,
    "actualMentor": 0.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 5.29,
    "cumActual": 0.0,
    "variance": -5.29
  },
  {
    "weekEnding": "2026-05-24",
    "targetMentor": 1.47,
    "actualMentor": 0.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 7.94,
    "cumActual": 0.0,
    "variance": -7.94
  },
  {
    "weekEnding": "2026-05-31",
    "targetMentor": 1.47,
    "actualMentor": 0.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 10.59,
    "cumActual": 0.0,
    "variance": -10.59
  },
  {
    "weekEnding": "2026-06-07",
    "targetMentor": 1.47,
    "actualMentor": 0.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 13.24,
    "cumActual": 0.0,
    "variance": -13.24
  },
  {
    "weekEnding": "2026-06-14",
    "targetMentor": 1.47,
    "actualMentor": 1.0,
    "targetFellow": 0.59,
    "actualFellow": 0.0,
    "targetAdvisor": 0.59,
    "actualAdvisor": 0.0,
    "cumTarget": 15.88,
    "cumActual": 1.0,
    "variance": -14.88
  },
  {
    "weekEnding": "2026-06-21",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 18.53,
    "cumActual": 1.0,
    "variance": -17.53
  },
  {
    "weekEnding": "2026-06-28",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 21.18,
    "cumActual": 1.0,
    "variance": -20.18
  },
  {
    "weekEnding": "2026-07-05",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 23.82,
    "cumActual": 1.0,
    "variance": -22.82
  },
  {
    "weekEnding": "2026-07-12",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 26.47,
    "cumActual": 1.0,
    "variance": -25.47
  },
  {
    "weekEnding": "2026-07-19",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 29.12,
    "cumActual": 1.0,
    "variance": -28.12
  },
  {
    "weekEnding": "2026-07-26",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 31.76,
    "cumActual": 1.0,
    "variance": -30.76
  },
  {
    "weekEnding": "2026-08-02",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 34.41,
    "cumActual": 1.0,
    "variance": -33.41
  },
  {
    "weekEnding": "2026-08-09",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 37.06,
    "cumActual": 1.0,
    "variance": -36.06
  },
  {
    "weekEnding": "2026-08-16",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 39.71,
    "cumActual": 1.0,
    "variance": -38.71
  },
  {
    "weekEnding": "2026-08-23",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 42.35,
    "cumActual": 1.0,
    "variance": -41.35
  },
  {
    "weekEnding": "2026-08-30",
    "targetMentor": 1.47,
    "actualMentor": null,
    "targetFellow": 0.59,
    "actualFellow": null,
    "targetAdvisor": 0.59,
    "actualAdvisor": null,
    "cumTarget": 45.0,
    "cumActual": 1.0,
    "variance": -44.0
  }
];

export const RELATIONSHIP_PIPELINE_SNAPSHOTS: Record<string, PipelineStageStat[]> = {
  "2026-05-11": [
    {
      "stage": "Lead",
      "total": 23,
      "weeklyIn": 1,
      "weeklyOut": 13,
      "netChange": -12
    },
    {
      "stage": "Contact",
      "total": 26,
      "weeklyIn": 9,
      "weeklyOut": 4,
      "netChange": 5
    },
    {
      "stage": "Discovery",
      "total": 19,
      "weeklyIn": 6,
      "weeklyOut": 0,
      "netChange": 6
    },
    {
      "stage": "Sponsorship",
      "total": 9,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0
    },
    {
      "stage": "Delivery",
      "total": 3,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0
    },
    {
      "stage": "Closed Won",
      "total": 2,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0
    },
    {
      "stage": "Closed Lost",
      "total": 8,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0
    }
  ],
  "2026-05-17": [
    {
      "stage": "Lead",
      "total": 22,
      "weeklyIn": 5,
      "weeklyOut": 3,
      "netChange": 2
    },
    {
      "stage": "Contact",
      "total": 29,
      "weeklyIn": 3,
      "weeklyOut": 1,
      "netChange": 2
    },
    {
      "stage": "Discovery",
      "total": 19,
      "weeklyIn": 1,
      "weeklyOut": 1,
      "netChange": 0
    },
    {
      "stage": "Sponsorship",
      "total": 11,
      "weeklyIn": 3,
      "weeklyOut": 1,
      "netChange": 2
    },
    {
      "stage": "Delivery",
      "total": 3,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0
    },
    {
      "stage": "Closed Won",
      "total": 13,
      "weeklyIn": 12,
      "weeklyOut": 1,
      "netChange": 11
    },
    {
      "stage": "Closed Lost",
      "total": 9,
      "weeklyIn": 1,
      "weeklyOut": 0,
      "netChange": 1
    }
  ],
  "2026-06-15": [
    {
      "stage": "Lead",
      "total": 61,
      "weeklyIn": 34,
      "weeklyOut": 3,
      "netChange": 31
    },
    {
      "stage": "Contact",
      "total": 47,
      "weeklyIn": 16,
      "weeklyOut": 2,
      "netChange": 14
    },
    {
      "stage": "Discovery",
      "total": 21,
      "weeklyIn": 5,
      "weeklyOut": 4,
      "netChange": 1
    },
    {
      "stage": "Sponsorship",
      "total": 36,
      "weeklyIn": 10,
      "weeklyOut": 4,
      "netChange": 6
    },
    {
      "stage": "Delivery",
      "total": 8,
      "weeklyIn": 2,
      "weeklyOut": 0,
      "netChange": 2
    },
    {
      "stage": "Closed Won",
      "total": 72,
      "weeklyIn": 25,
      "weeklyOut": 0,
      "netChange": 25
    },
    {
      "stage": "Closed Lost",
      "total": 14,
      "weeklyIn": 5,
      "weeklyOut": 0,
      "netChange": 5
    }
  ]
};

export const DELIVERY_PIPELINE_SNAPSHOTS: Record<string, DeliveryPipelineStageStat[]> = {
  "2026-05-11": [
    {
      "stage": "Backlog",
      "total": 8,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 5
        }
      ]
    },
    {
      "stage": "In Process",
      "total": 2,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 0
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 2
        }
      ]
    },
    {
      "stage": "Completed",
      "total": 4,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 1
        }
      ]
    },
    {
      "stage": "Unfulfilled",
      "total": 13,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 3
        },
        {
          "category": "Platform",
          "count": 7
        }
      ]
    }
  ],
  "2026-05-17": [
    {
      "stage": "Backlog",
      "total": 8,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 5
        }
      ]
    },
    {
      "stage": "In Process",
      "total": 2,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 0
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 2
        }
      ]
    },
    {
      "stage": "Completed",
      "total": 4,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 1
        }
      ]
    },
    {
      "stage": "Unfulfilled",
      "total": 13,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 3
        },
        {
          "category": "Platform",
          "count": 7
        }
      ]
    }
  ],
  "2026-06-15": [
    {
      "stage": "Backlog",
      "total": 21,
      "weeklyIn": 4,
      "weeklyOut": 0,
      "netChange": 4,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 5
        }
      ]
    },
    {
      "stage": "In Process",
      "total": 2,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 0
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 2
        }
      ]
    },
    {
      "stage": "Completed",
      "total": 6,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 0
        },
        {
          "category": "Platform",
          "count": 1
        }
      ]
    },
    {
      "stage": "Unfulfilled",
      "total": 13,
      "weeklyIn": 0,
      "weeklyOut": 0,
      "netChange": 0,
      "breakdown": [
        {
          "category": "Talent",
          "count": 3
        },
        {
          "category": "Solutions",
          "count": 3
        },
        {
          "category": "Platform",
          "count": 7
        }
      ]
    }
  ]
};

export const COMPANIES_DATA: CompanyRecord[] = [
  {
    id: "comp-01",
    name: "Arthrex Inc.",
    industry: "Medical Technology",
    stage: "Closed Won",
    headquartersState: "FL",
    headquartersCity: "Naples",
    fundingGiven: 50000,
    instituteRelationship: "Platinum Corporate Sponsor",
    studentsApplied: 24,
    studentsInterviewed: 8,
    studentsHired: 5,
    alumniWorking: "David Miller (Senior Quality Engineer), Sarah Jenkins (Regulatory Specialist)",
    amuVendor: "Yes ($45,000 annual services)",
    completedOpportunities: "8/10 completed",
    eventsAttended: "Chancellor's Gala 2025, 2026",
    eventsSponsored: "Chancellor's Gala 2026 (Gold Sponsor)",
    lastCommunication: "2026-06-10: Executive Sponsor debrief call",
  },
  {
    id: "comp-02",
    name: "Gartner Group",
    industry: "Technology & Research",
    stage: "Closed Won",
    headquartersState: "FL",
    headquartersCity: "Fort Myers",
    fundingGiven: 35000,
    instituteRelationship: "Corporate Sponsor & Advisory Board",
    studentsApplied: 32,
    studentsInterviewed: 12,
    studentsHired: 7,
    alumniWorking: "Alex Rivera (Research Analyst), Rachel Vance (Account Manager)",
    amuVendor: "Yes ($18,000 research subscription)",
    completedOpportunities: "6/6 completed",
    eventsAttended: "Chancellor's Gala 2025, 2026; Career Expo",
    eventsSponsored: "Business Leadership Summit 2026",
    lastCommunication: "2026-06-12: Fall recruiting sequence follow up",
  },
  {
    id: "comp-03",
    name: "St. Matthew's House",
    industry: "Non-Profit & Social Enterprise",
    stage: "Delivery",
    headquartersState: "FL",
    headquartersCity: "Naples",
    fundingGiven: 15000,
    instituteRelationship: "Community Partner & Project Client",
    studentsApplied: 14,
    studentsInterviewed: 6,
    studentsHired: 3,
    alumniWorking: "Marcus Green (Operations Coordinator)",
    amuVendor: "No",
    completedOpportunities: "3/4 completed",
    eventsAttended: "Community Impact Forum 2026",
    eventsSponsored: "None",
    lastCommunication: "2026-06-14: Student project delivery milestone review",
  },
  {
    id: "comp-04",
    name: "Chico's FAS Inc.",
    industry: "Retail & E-Commerce",
    stage: "Sponsorship",
    headquartersState: "FL",
    headquartersCity: "Fort Myers",
    fundingGiven: 20000,
    instituteRelationship: "Corporate Sponsor",
    studentsApplied: 18,
    studentsInterviewed: 5,
    studentsHired: 2,
    alumniWorking: "Elena Rossi (Merchandising Analyst)",
    amuVendor: "No",
    completedOpportunities: "2/3 completed",
    eventsAttended: "Chancellor's Gala 2026",
    eventsSponsored: "Chancellor's Gala 2026 (Table Sponsor)",
    lastCommunication: "2026-06-08: Sponsorship invoice and web logo sign-up",
  },
  {
    id: "comp-05",
    name: "NeoGenomics Laboratories",
    industry: "Biotechnology & Diagnostics",
    stage: "Discovery",
    headquartersState: "FL",
    headquartersCity: "Fort Myers",
    fundingGiven: 10000,
    instituteRelationship: "Life Sciences Advisory & Recruiting Partner",
    studentsApplied: 19,
    studentsInterviewed: 7,
    studentsHired: 4,
    alumniWorking: "Claire Thompson (Clinical Lab Scientist)",
    amuVendor: "No",
    completedOpportunities: "2/2 completed",
    eventsAttended: "Science Symposium 2026",
    eventsSponsored: "None",
    lastCommunication: "2026-06-11: Discovery call with VP of Talent Acquisition",
  },
  {
    id: "comp-06",
    name: "Hertz Global Holdings",
    industry: "Automotive & Logistics",
    stage: "Contact",
    headquartersState: "FL",
    headquartersCity: "Estero",
    fundingGiven: 5000,
    instituteRelationship: "Recruiting Partner",
    studentsApplied: 28,
    studentsInterviewed: 9,
    studentsHired: 3,
    alumniWorking: "Anthony Clark (Fleet Financial Analyst)",
    amuVendor: "Yes ($8,500 fleet rental contract)",
    completedOpportunities: "1/3 completed",
    eventsAttended: "Career Expo 2026",
    eventsSponsored: "None",
    lastCommunication: "2026-06-13: Qualified email sequence touch 3",
  },
  {
    id: "comp-07",
    name: "Raymond James Financial",
    industry: "Financial Services",
    stage: "Lead",
    headquartersState: "FL",
    headquartersCity: "St. Petersburg",
    fundingGiven: 12000,
    instituteRelationship: "Prospect",
    studentsApplied: 15,
    studentsInterviewed: 4,
    studentsHired: 2,
    alumniWorking: "Kevin O'Connor (Wealth Management Advisor)",
    amuVendor: "No",
    completedOpportunities: "0/1 completed",
    eventsAttended: "Chancellor's Gala 2025",
    eventsSponsored: "None",
    lastCommunication: "2026-06-05: New Business Cold Call playbook",
  },
  {
    id: "comp-08",
    name: "Roper Technologies",
    industry: "Industrial Software & Systems",
    stage: "Discovery",
    headquartersState: "FL",
    headquartersCity: "Sarasota",
    fundingGiven: 25000,
    instituteRelationship: "Engineering & Technology Sponsor",
    studentsApplied: 12,
    studentsInterviewed: 5,
    studentsHired: 2,
    alumniWorking: "Timothy Hughes (Software Engineer II)",
    amuVendor: "No",
    completedOpportunities: "3/3 completed",
    eventsAttended: "Chancellor's Gala 2026",
    eventsSponsored: "Chancellor's Gala 2026 (Silver Sponsor)",
    lastCommunication: "2026-06-09: Discovery call regarding engineering capstones",
  },
  {
    id: "comp-09",
    name: "Publix Super Markets Charities",
    industry: "Consumer Retail & Foundation",
    stage: "Closed Won",
    headquartersState: "FL",
    headquartersCity: "Lakeland",
    fundingGiven: 40000,
    instituteRelationship: "Foundation Partner",
    studentsApplied: 45,
    studentsInterviewed: 15,
    studentsHired: 8,
    alumniWorking: "Melissa Davis (Regional HR Manager)",
    amuVendor: "No",
    completedOpportunities: "5/5 completed",
    eventsAttended: "Scholarship Banquet 2026",
    eventsSponsored: "Catholic Education Luncheon 2026",
    lastCommunication: "2026-06-02: Annual impact report and grant closure",
  },
  {
    id: "comp-10",
    name: "DeBartolo Development",
    industry: "Real Estate & Investment",
    stage: "Opportunity",
    headquartersState: "FL",
    headquartersCity: "Tampa",
    fundingGiven: 15000,
    instituteRelationship: "Corporate Partner",
    studentsApplied: 8,
    studentsInterviewed: 3,
    studentsHired: 1,
    alumniWorking: "Josephine Vance (Associate Analyst)",
    amuVendor: "No",
    completedOpportunities: "1/2 completed",
    eventsAttended: "Chancellor's Gala 2026",
    eventsSponsored: "Chancellor's Gala 2026",
    lastCommunication: "2026-06-12: Action items and partnership invoice review",
  },
  {
    id: "comp-11",
    name: "BankUnited",
    industry: "Banking & Capital Markets",
    stage: "Contact",
    headquartersState: "FL",
    headquartersCity: "Miami",
    fundingGiven: 8000,
    instituteRelationship: "Commercial Banking Partner",
    studentsApplied: 11,
    studentsInterviewed: 4,
    studentsHired: 2,
    alumniWorking: "Brian Kelly (Commercial Credit Analyst)",
    amuVendor: "No",
    completedOpportunities: "1/1 completed",
    eventsAttended: "Business Advisory Council 2025",
    eventsSponsored: "None",
    lastCommunication: "2026-06-07: Follow up call to schedule Discovery",
  },
  {
    id: "comp-12",
    name: "Crowe LLP",
    industry: "Accounting & Consulting",
    stage: "Sponsorship",
    headquartersState: "IL",
    headquartersCity: "Chicago",
    fundingGiven: 18000,
    instituteRelationship: "Accounting Recruitment Sponsor",
    studentsApplied: 21,
    studentsInterviewed: 8,
    studentsHired: 4,
    alumniWorking: "Patrick Murphy (Senior Audit Associate), Laura Lee (Tax Consultant)",
    amuVendor: "Yes ($32,000 audit services)",
    completedOpportunities: "4/4 completed",
    eventsAttended: "Accounting Meet the Firms 2025, 2026",
    eventsSponsored: "Student Case Competition 2026",
    lastCommunication: "2026-06-11: Sponsor agreement signing and payment review",
  },
  {
    id: "comp-13",
    name: "Knight Commercial Holdings",
    industry: "Construction & Infrastructure",
    stage: "Closed Lost",
    headquartersState: "TX",
    headquartersCity: "Dallas",
    fundingGiven: 0,
    instituteRelationship: "Past Prospect",
    studentsApplied: 4,
    studentsInterviewed: 1,
    studentsHired: 0,
    alumniWorking: "None",
    amuVendor: "No",
    completedOpportunities: "0/1 completed",
    eventsAttended: "None",
    eventsSponsored: "None",
    lastCommunication: "2026-05-20: Target budget reprioritized for 2026",
  },
  {
    id: "comp-14",
    name: "Christus Health",
    industry: "Healthcare System",
    stage: "Delivery",
    headquartersState: "TX",
    headquartersCity: "Irving",
    fundingGiven: 22000,
    instituteRelationship: "Catholic Healthcare Sponsor & Employer Partner",
    studentsApplied: 16,
    studentsInterviewed: 7,
    studentsHired: 3,
    alumniWorking: "Theresa Bennett (Healthcare Administration Fellow)",
    amuVendor: "No",
    completedOpportunities: "2/2 completed",
    eventsAttended: "Bioethics Conference 2026",
    eventsSponsored: "Catholic Healthcare Initiative 2026",
    lastCommunication: "2026-06-06: Fellowship project milestone delivery",
  },
];

export const OPPORTUNITIES_DATA: OpportunityRecord[] = [
  {
    id: "opp-01",
    type: "Internship Program",
    company: "Arthrex Inc.",
    category: "Talent",
    stage: "Completed",
    status: "Finished",
    owner: "Liam O'Rourke",
    dueDate: "2026-05-30",
    scope: "Summer engineering and clinical research internship cohort (5 interns)",
  },
  {
    id: "opp-02",
    type: "Consulting Case Study",
    company: "Gartner Group",
    category: "Solutions",
    stage: "Completed",
    status: "Finished",
    owner: "Liam O'Rourke",
    dueDate: "2026-06-05",
    scope: "Market entry analysis for higher ed data platforms",
  },
  {
    id: "opp-03",
    type: "Talent Sponsoring",
    company: "Chico's FAS Inc.",
    category: "Talent",
    stage: "In Process",
    status: "Active",
    owner: "Liam O'Rourke",
    dueDate: "2026-07-15",
    scope: "Fall 2026 corporate retail talent recruitment drive",
  },
  {
    id: "opp-04",
    type: "Job Board Integration",
    company: "NeoGenomics Laboratories",
    category: "Platform",
    stage: "In Process",
    status: "Active",
    owner: "Michael Middendorf",
    dueDate: "2026-07-31",
    scope: "Direct employer job board posting feed integration",
  },
  {
    id: "opp-05",
    type: "Fellowship Project",
    company: "Christus Health",
    category: "Talent",
    stage: "Backlog",
    status: "Queued",
    owner: "Liam O'Rourke",
    dueDate: "2026-08-15",
    scope: "Bioethics and hospital management student fellowship",
  },
  {
    id: "opp-06",
    type: "Campus Capstone Solution",
    company: "Roper Technologies",
    category: "Solutions",
    stage: "Backlog",
    status: "Scoping",
    owner: "Liam O'Rourke",
    dueDate: "2026-09-01",
    scope: "Industrial software student project team allocation",
  },
  {
    id: "opp-07",
    type: "Employer Portal Profile",
    company: "Crowe LLP",
    category: "Platform",
    stage: "Backlog",
    status: "Queued",
    owner: "Michael Middendorf",
    dueDate: "2026-08-20",
    scope: "Accounting employer branded profile and resume book access",
  },
  {
    id: "opp-08",
    type: "Direct Hire Campaign",
    company: "Knight Commercial Holdings",
    category: "Talent",
    stage: "Unfulfilled",
    status: "Cancelled",
    owner: "Liam O'Rourke",
    dueDate: "2026-05-15",
    scope: "Commercial management candidate pool",
  },
];

export const OUTREACH_STATS = [
  {
    activity: "Cold calls ([Institute] Lead: New Business Cold Call playbook)",
    counts: [14, 18, 22, 19, 25, 20],
  },
  {
    activity: "Qualified emails ([Institute] Contact: Qualified New Business Sequence)",
    counts: [28, 35, 41, 38, 44, 40],
  },
  {
    activity: "Calls to schedule Discovery Call ([Institute] Follow-up Call playbook)",
    counts: [8, 12, 15, 11, 16, 14],
  },
  {
    activity: "Discovery calls ([Institute] Discovery Call playbook)",
    counts: [6, 9, 8, 7, 10, 8],
  },
  {
    activity: "Follow up emails after Discovery Call ([Institute] Follow-Up Sequence)",
    counts: [6, 8, 7, 7, 9, 8],
  },
];

export const MEETING_REFERENCE = {
  cadence: [
    { title: "Monday: KPI Meeting", desc: "Weekly review of target vs actuals, net pipeline movement, and bottleneck removal." },
    { title: "Friday: 3x Team Follow-Up Meetings", desc: "Individual sub-team check-ins on deal delivery, talent placement, and solutions." },
    { title: "Monthly: All-Team Presentation", desc: "Monthly stakeholder reporting on cumulative FY progress, sponsor additions, and revenue." },
  ],
  rallyCry: [
    { id: "rc-1", text: "Chase down pledged money: $108,000 committed", status: "In Progress" },
    { id: "rc-2", text: "Add all historical deals to HubSpot so that it is reconciled with Excel budget", status: "Completed" },
    { id: "rc-3", text: "Clear out all to-do items and scheduled follow-ups in HubSpot", status: "In Progress" },
    { id: "rc-4", text: "Finish all discovery call follow-ups from prior week within 48 hours", status: "Ongoing" },
  ],
};

export function getPacingStatus(actual: number, target: number): "on-target" | "behind" {
  if (target <= 0) return "on-target";
  return actual >= target ? "on-target" : "behind";
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function computeKpiCards(
  timeframe: "week" | "month" | "ytd",
  weekIndex: number,
  targets: AnnualTargets = DEFAULT_ANNUAL_TARGETS,
): KpiSummaryCard[] {
  const safeIdx = Math.max(0, Math.min(weekIndex, HISTORICAL_FUNDING.length - 1));
  const fundRow = HISTORICAL_FUNDING[safeIdx];
  const caseRow = HISTORICAL_CASES[safeIdx];
  const jobRow = HISTORICAL_JOBS[safeIdx];
  const netRow = HISTORICAL_NETWORK[safeIdx];

  // Multiplier or baseline depending on timeframe
  let multiplier = 1;
  if (timeframe === "week") multiplier = 1 / 52;
  else if (timeframe === "month") multiplier = 4 / 52;
  else multiplier = (safeIdx + 1) / 52;

  // 1. Funding
  const fundTarget = Math.round(targets.funding * multiplier);
  let fundActual = 0;
  if (timeframe === "week") {
    fundActual =
      (fundRow.actualHighSchool || 0) +
      (fundRow.actualIndividual || 0) +
      (fundRow.actualOrganization || 0);
  } else if (timeframe === "month") {
    const startMonthIdx = Math.max(0, safeIdx - 3);
    for (let i = startMonthIdx; i <= safeIdx; i++) {
      fundActual +=
        (HISTORICAL_FUNDING[i].actualHighSchool || 0) +
        (HISTORICAL_FUNDING[i].actualIndividual || 0) +
        (HISTORICAL_FUNDING[i].actualOrganization || 0);
    }
  } else {
    fundActual = fundRow.cumActual || 0;
  }
  const fundVariance = fundActual - fundTarget;

  // 2. Sponsors
  const sponsorTarget = Math.max(1, Math.round(targets.sponsors * multiplier));
  const sponsorActual = Math.round(fundActual > 0 ? Math.min(targets.sponsors, Math.max(1, fundActual / 5000)) : 0);
  const sponsorVariance = sponsorActual - sponsorTarget;

  // 3. Opportunities
  const oppTarget = Math.max(1, Math.round(targets.opportunities * multiplier));
  const oppActual = Math.round(sponsorActual * 2 + (caseRow.cumActual || 0) * 3);
  const oppVariance = oppActual - oppTarget;

  // 4. Internships
  const internTarget = Math.max(1, Math.round(targets.internships * multiplier));
  let internActual = 0;
  if (timeframe === "week") {
    internActual = jobRow.actualInternship || 0;
  } else if (timeframe === "month") {
    const startMonthIdx = Math.max(0, safeIdx - 3);
    for (let i = startMonthIdx; i <= safeIdx; i++) {
      internActual += HISTORICAL_JOBS[i].actualInternship || 0;
    }
  } else {
    internActual = jobRow.cumActual ? Math.round(jobRow.cumActual * 0.6) : 0;
  }
  const internVariance = internActual - internTarget;

  // 5. Full-time Jobs
  const fullTimeTarget = Math.max(1, Math.round(targets.fullTimeJobs * multiplier));
  let fullTimeActual = 0;
  if (timeframe === "week") {
    fullTimeActual = jobRow.actualFullTime || 0;
  } else if (timeframe === "month") {
    const startMonthIdx = Math.max(0, safeIdx - 3);
    for (let i = startMonthIdx; i <= safeIdx; i++) {
      fullTimeActual += HISTORICAL_JOBS[i].actualFullTime || 0;
    }
  } else {
    fullTimeActual = jobRow.cumActual ? Math.round(jobRow.cumActual * 0.4) : 0;
  }
  const fullTimeVariance = fullTimeActual - fullTimeTarget;

  // 6. Project Solutions / Cases
  const caseTarget = Math.max(1, Math.round(targets.projectSolutions * multiplier));
  let caseActual = 0;
  if (timeframe === "week") {
    caseActual = caseRow.actual || 0;
  } else if (timeframe === "month") {
    const startMonthIdx = Math.max(0, safeIdx - 3);
    for (let i = startMonthIdx; i <= safeIdx; i++) {
      caseActual += HISTORICAL_CASES[i].actual || 0;
    }
  } else {
    caseActual = caseRow.cumActual || 0;
  }
  const caseVariance = caseActual - caseTarget;

  // 7. Advisors
  const advisorTarget = Math.max(1, Math.round(targets.advisors * multiplier));
  let advisorActual = 0;
  if (timeframe === "week") {
    advisorActual = netRow.actualAdvisor || 0;
  } else if (timeframe === "month") {
    const startMonthIdx = Math.max(0, safeIdx - 3);
    for (let i = startMonthIdx; i <= safeIdx; i++) {
      advisorActual += HISTORICAL_NETWORK[i].actualAdvisor || 0;
    }
  } else {
    advisorActual = netRow.cumActual || 0;
  }
  const advisorVariance = advisorActual - advisorTarget;

  return [
    {
      id: "kpi-funding",
      title: "Corporate Funding",
      goalLabel: `Goal: ${formatCurrency(targets.funding)}`,
      targetValue: fundTarget,
      actualValue: fundActual,
      variance: fundVariance,
      unit: "currency",
      status: getPacingStatus(fundActual, fundTarget),
      dataSource: "Adaptive & Virtuous (Dept 6181 & 3012)",
      details: [
        {
          label: "High School",
          target: Math.round(fundTarget * 0.1),
          actual: fundRow.actualHighSchool || 0,
        },
        {
          label: "Individual",
          target: Math.round(fundTarget * 0.4),
          actual: fundRow.actualIndividual || 0,
        },
        {
          label: "Organization",
          target: Math.round(fundTarget * 0.5),
          actual: fundRow.actualOrganization || 0,
        },
      ],
    },
    {
      id: "kpi-sponsors",
      title: "New Sponsors",
      goalLabel: `Goal: ${targets.sponsors} new sponsors`,
      targetValue: sponsorTarget,
      actualValue: sponsorActual,
      variance: sponsorVariance,
      unit: "count",
      status: getPacingStatus(sponsorActual, sponsorTarget),
      dataSource: "HubSpot Website Signups & Virtuous",
      details: [
        { label: "Corporate Sponsors", target: Math.round(sponsorTarget * 0.7), actual: Math.round(sponsorActual * 0.7) },
        { label: "Advisory Sponsors", target: Math.round(sponsorTarget * 0.3), actual: Math.round(sponsorActual * 0.3) },
      ],
    },
    {
      id: "kpi-opportunities",
      title: "Total Opportunities",
      goalLabel: `Goal: ${targets.opportunities} opportunities`,
      targetValue: oppTarget,
      actualValue: oppActual,
      variance: oppVariance,
      unit: "count",
      status: getPacingStatus(oppActual, oppTarget),
      dataSource: "HubSpot Opportunity Pipeline",
      details: [
        { label: "Talent Opps", target: Math.round(oppTarget * 0.5), actual: Math.round(oppActual * 0.5) },
        { label: "Solutions Opps", target: Math.round(oppTarget * 0.3), actual: Math.round(oppActual * 0.3) },
        { label: "Platform Opps", target: Math.round(oppTarget * 0.2), actual: Math.round(oppActual * 0.2) },
      ],
    },
    {
      id: "kpi-internships",
      title: "Internships",
      goalLabel: `Goal: ${targets.internships} internships`,
      targetValue: internTarget,
      actualValue: internActual,
      variance: internVariance,
      unit: "count",
      status: getPacingStatus(internActual, internTarget),
      dataSource: "HubSpot Opportunity & Job Board",
      details: [
        { label: "Paid Corporate Internships", target: Math.round(internTarget * 0.8), actual: Math.round(internActual * 0.8) },
        { label: "Non-profit & Civic", target: Math.round(internTarget * 0.2), actual: Math.round(internActual * 0.2) },
      ],
    },
    {
      id: "kpi-fulltime",
      title: "Full-time Jobs",
      goalLabel: `Goal: ${targets.fullTimeJobs} jobs`,
      targetValue: fullTimeTarget,
      actualValue: fullTimeActual,
      variance: fullTimeVariance,
      unit: "count",
      status: getPacingStatus(fullTimeActual, fullTimeTarget),
      dataSource: "HubSpot Pipeline & Handshake Job Board",
      details: [
        { label: "Direct Hires", target: Math.round(fullTimeTarget * 0.6), actual: Math.round(fullTimeActual * 0.6) },
        { label: "Conversion from Internships", target: Math.round(fullTimeTarget * 0.4), actual: Math.round(fullTimeActual * 0.4) },
      ],
    },
    {
      id: "kpi-solutions",
      title: "Project Solutions",
      goalLabel: `Goal: ${targets.projectSolutions} project cases`,
      targetValue: caseTarget,
      actualValue: caseActual,
      variance: caseVariance,
      unit: "count",
      status: getPacingStatus(caseActual, caseTarget),
      dataSource: "HubSpot Deal Delivery Pipeline",
      details: [
        { label: "Business Strategy Cases", target: Math.round(caseTarget * 0.5), actual: Math.round(caseActual * 0.5) },
        { label: "Technical & Engineering", target: Math.round(caseTarget * 0.5), actual: Math.round(caseActual * 0.5) },
      ],
    },
    {
      id: "kpi-advisors",
      title: "New Advisors",
      goalLabel: `Goal: ${targets.advisors} new advisors`,
      targetValue: advisorTarget,
      actualValue: advisorActual,
      variance: advisorVariance,
      unit: "count",
      status: getPacingStatus(advisorActual, advisorTarget),
      dataSource: "HubSpot Form Signups & Network Ingest",
      details: [
        { label: "Industry Mentors", target: Math.round(advisorTarget * 0.5), actual: Math.round(advisorActual * 0.5) },
        { label: "Executive Advisors", target: Math.round(advisorTarget * 0.3), actual: Math.round(advisorActual * 0.3) },
        { label: "Faculty Fellows", target: Math.round(advisorTarget * 0.2), actual: Math.round(advisorActual * 0.2) },
      ],
    },
  ];
}

export function exportCompaniesToCsv(companies: CompanyRecord[]): string {
  const headers = [
    "Company",
    "Industry",
    "Pipeline Stage",
    "Headquarters",
    "Funding Given",
    "Institute Relationship",
    "Students Applied",
    "Students Interviewed",
    "Students Hired",
    "Alumni Working",
    "AMU Vendor Status",
    "Completed Opportunities",
    "Events Attended",
    "Events Sponsored",
    "Last Communication",
  ];

  const rows = companies.map((c) => [
    `"${c.name.replace(/"/g, '""')}"`,
    `"${c.industry.replace(/"/g, '""')}"`,
    `"${c.stage.replace(/"/g, '""')}"`,
    `"${c.headquartersCity}, ${c.headquartersState}"`,
    c.fundingGiven,
    `"${c.instituteRelationship.replace(/"/g, '""')}"`,
    c.studentsApplied,
    c.studentsInterviewed,
    c.studentsHired,
    `"${c.alumniWorking.replace(/"/g, '""')}"`,
    `"${c.amuVendor.replace(/"/g, '""')}"`,
    `"${c.completedOpportunities.replace(/"/g, '""')}"`,
    `"${c.eventsAttended.replace(/"/g, '""')}"`,
    `"${c.eventsSponsored.replace(/"/g, '""')}"`,
    `"${c.lastCommunication.replace(/"/g, '""')}"`,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export function exportOpportunitiesToCsv(opportunities: OpportunityRecord[]): string {
  const headers = [
    "Opportunity ID",
    "Type",
    "Company",
    "Category",
    "Pipeline Stage",
    "Status",
    "Owner",
    "Due Date",
    "Scope",
  ];

  const rows = opportunities.map((o) => [
    o.id,
    `"${o.type.replace(/"/g, '""')}"`,
    `"${o.company.replace(/"/g, '""')}"`,
    o.category,
    o.stage,
    o.status,
    `"${o.owner.replace(/"/g, '""')}"`,
    o.dueDate,
    `"${o.scope.replace(/"/g, '""')}"`,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
