// Filler words (um, uh…), shared by the transcript panel and captions.
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'])
export const isFiller = (w: { w: string } | string) => FILLERS.has((typeof w === 'string' ? w : w.w).toLowerCase().replace(/[^a-z]/g, ''))
