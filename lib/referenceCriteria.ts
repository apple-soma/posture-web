export type ReferenceCriterion = {
  id: string; measurementId: string; criterionType: 'cutoff' | 'range' | 'mean_sd'; cutoff?: number; lower?: number; upper?: number;
  population: string; measurementMethod: string; sourceTitle: string; sourceYear: number; sourceAuthors: string; sourceUrl: string; interpretation: string; evidenceLevel: 'high' | 'moderate' | 'limited' | 'uncertain' | 'unknown';
};

// This list is data, rather than evaluation logic, so additions do not change measurement code.
export const REFERENCE_CRITERIA: ReferenceCriterion[] = [{
  id: 'cva-mostafaee-2024', measurementId: 'cva', criterionType: 'cutoff', cutoff: 45.5,
  population: '20〜50歳、前方頭位の程度が異なる90名', measurementMethod: '立位の側面写真でC7と耳珠を用いたCVA測定',
  sourceTitle: 'Examining accuracy of and determining the best cutoff point for photographic-based postural angles to discriminate between slight and moderate-to-severe forward head posture',
  sourceYear: 2024, sourceAuthors: 'Neda Mostafaee, Nahid Pirayeh, Fatemeh HasanNia, Hossein Negahban, Mahsa Kasnavi', sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/36036498/',
  interpretation: '45.5°は、この研究において軽度と中等度〜重度の前方頭位を識別するために報告されたカットオフです。個人の疾患や異常を診断する基準ではありません。', evidenceLevel: 'unknown',
}];
