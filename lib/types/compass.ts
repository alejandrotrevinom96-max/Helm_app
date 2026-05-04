export type CompassBand =
  | 'strong'
  | 'clear'
  | 'steady'
  | 'uncertain'
  | 'off-course';

export type CompassDimensionId =
  | 'validation'
  | 'strategy'
  | 'execution'
  | 'traction'
  | 'market';

export type CompassConfidence = 'high' | 'medium' | 'low' | 'inferred';

export interface CompassSubcriterion {
  id: string;
  name: string;
  pts: number;
  maxPts: number;
  evidence: string;
  confidence: CompassConfidence;
  // 'auto' = computed from Helm data; 'form' = answered in the wizard.
  source: 'auto' | 'form';
}

export interface CompassDimension {
  id: CompassDimensionId;
  name: string;
  pts: number;
  maxPts: number;
  subcriteria: CompassSubcriterion[];
}

export interface CompassRedFlag {
  severity: 'critical' | 'warning';
  message: string;
}

export interface CompassRecommendationCTA {
  label: string;
  href: string;
}

export interface CompassRecommendation {
  id: string;
  dimension: CompassDimensionId;
  title: string;
  description: string;
  scoreLift: number;
  cta: CompassRecommendationCTA | null;
  effort: 'low' | 'medium' | 'high';
  priority: number;
}

export interface CompassReading {
  id: string;
  projectId: string;
  totalScore: number;
  band: CompassBand;
  dimensions: CompassDimension[];
  redFlags: CompassRedFlag[];
  bullCase: string[];
  bearCase: string[];
  dueDiligenceQuestion: string | null;
  recommendations: CompassRecommendation[];
  formData: Record<string, unknown>;
  computedBy: 'auto' | 'manual';
  dataQuality: number;
  createdAt: string | Date;
  bandLabel?: string;
}
