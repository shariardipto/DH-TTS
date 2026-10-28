# Benchmark and evaluation

## Benchmark design

The private fixed benchmark contains **300 Bengali text prompts**. The diagnostic subset samples 15 IDs distributed across ten domains, including:

- Standard Bangladesh Bengali
- Newsroom speech and formal narration
- International / geopolitical terms
- Bangladesh names and institutions
- Foreign names and organizations
- Difficult pronunciation
- Numbers, dates, and acronyms
- Long-form sentence stability
- Voice-platform production terminology
- Bangladesh-specific lexical preference (drift guard)

The source benchmark CSV and reference-voice materials are **private**.

## Verification already completed

| Test | What it establishes | Result |
| --- | --- | --- |
| Training checkpoint metadata inspection | Readability and saved step counts | PASS |
| EMA → IndicF5 CFM strict loading | 364 keys and matching shapes | PASS |
| Diagnostic generation from training checkpoint | Pipeline generated 15 files | 15/15 |
| EMA-only export verification | Exported tensors exactly match source | 364/364 |
| Exported weights → IndicF5 strict loading | Inference without resumable training checkpoint | PASS |
| Exported-model WAV generation | Three benchmark IDs generated | 3/3 |

**Do not interpret synthesis success as an objective proof of superiority over IndicF5 base.**

## Planned quality study

For each matched ID, compare baseline and adapted model using exactly the same authorized reference recording, matching transcript, and consistent inference settings. Use randomized/blinded sample order and collect structured judgments for:

| Dimension | Suggested measure |
| --- | --- |
| Pronunciation fidelity | Word / phoneme and named-entity error annotation |
| Naturalness | Blind human rating, multiple raters |
| Voice consistency | Same-speaker perceptual judgments |
| Long-form stability | Repetitions, skips, truncation and silence |
| Benchmark reproducibility | Model revision, prompt ID, seed/settings, environment |

Publishing aggregate scores requires collecting and documenting those measurements. No MOS, WER, or pronunciation improvement figures are currently asserted.
