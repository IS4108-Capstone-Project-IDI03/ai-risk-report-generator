// Starter questions on an empty conversation (CB-01 AC13), about documents in the
// knowledge base so each one gets a real cited answer. Drawn by components/Starters.tsx.
import { IconRegistry } from '../../design-system'

// The design system's icons (docs/areas/design-system-v2.md: one icon family).
const standard = IconRegistry.evidence.standard
const report = IconRegistry.evidence.report

/** The starter questions shown when a conversation is empty: the pill's words, then what is asked. */
export const starters: { displayText: string; prompt: string; icon: string }[] = [
  {
    displayText: 'Design density for Ordinary Hazard Group 2',
    prompt: 'What sprinkler design density does NFPA 13 require for Ordinary Hazard Group 2?',
    icon: standard,
  },
  {
    displayText: 'NFPA 25 inspection intervals',
    prompt: 'How often does NFPA 25 require sprinkler systems to be inspected and tested?',
    icon: standard,
  },
  {
    displayText: 'Clearance between sprinklers and storage',
    prompt: 'What clearance does FM require between sprinkler deflectors and the top of storage?',
    icon: standard,
  },
  {
    displayText: 'Fire pumps in past office reports',
    prompt: 'What did past Singapore office reports recommend about fire pump testing?',
    icon: report,
  },
]
