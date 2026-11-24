// Tells the walkthrough engine the Ask tab (or its phone sheet) is showing (F-12, "Ask about an assessment").
// Rendered by components/ReviewInspector.tsx beside the Ask panel. Calls useWalkthroughScreen.
// Not inside AskPanel: the document editor shows that panel too, and the "ask" walkthrough is for the Review tab.
import { useWalkthroughScreen } from '../../walkthrough/useWalkthroughScreen'
import type { AskWorkflow } from './useAsk'

/** Reports the Ask screen as ready once its earlier questions have loaded; draws nothing. */
export function AskScreen({ ask }: { ask: AskWorkflow | null }) {
  // Held back on an archived assessment (its conversations are only read), as the spec's offers rule says.
  useWalkthroughScreen('ask', ask?.state === 'ready', !!ask?.archived)
  return null
}
