# Privacy and responsible release policy

This repository is intentionally a **code-and-documentation portfolio** rather than a public release of a speaker-cloning model.

## Never upload without explicit authorization

- Original speech recordings and edited clips
- Transcripts, alignment files and potentially identifying metadata
- Benchmark reference voice and reference transcript
- Fine-tuned `.safetensors` weights, `.pt` training checkpoints, optimizer states
- Generated WAVs that reproduce an identifiable voice without release permission
- Hugging Face / GitHub tokens, API keys, `.env` files and cloud credentials
- Internal platform configuration, user databases and staff information

The exported model is stored in a **private** external model repository. Private storage does not itself establish a right to host or reproduce a speaker's voice; speaker permissions and applicable organizational rights must be reviewed.

## Before sharing a public audio demonstration

1. Confirm audio/voice identity ownership and explicit consent for the proposed audience and use.
2. Use only release-approved reference audio, transcripts and samples.
3. Check the base model's own access conditions and applicable licensing before redistribution or live deployment.
4. Prefer preset, reviewed audio comparisons for a public engineering portfolio rather than unrestricted voice cloning.
5. Recheck staged Git changes and Git history for accidentally added private assets.

## Source code publication

Utilities in `scripts/` are kept generic and accept file paths via CLI flags. Their publication is not authorization to publish any data, voice sample, or model file.
