# Training methodology

## Verified pilot configuration

| Setting | Value |
| --- | --- |
| Pretrained base | `IndicF5` |
| Architecture | CFM + DiT, dimension 1024, depth 22, 16 heads |
| Model parameters updated | All model parameters (full-parameter fine-tuning) |
| Train / validation | 682 / 76 audio clips |
| Training precision | FP32 |
| Physical batch size | 1 |
| Accumulation steps | 4 |
| Optimizer | AdamW |
| Learning rate | 1e-5 |
| Gradient norm clip | 1.0 |
| Warmup | 50 optimizer updates |
| Epochs | 1 completed pilot epoch |
| Total microsteps | 682 |
| Optimizer updates | 171 |
| Sample rate | 24,000 Hz |
| EMA | Updated after optimizer steps |
| Training seed | 666 |
| Validation seed | 260907 |

The source pipeline validated the prepared dataset split sizes and tokenizer vocabulary size (2,545), loaded the pretrained model strictly, and wrote a checkpoint that retained model, EMA, optimizer, scheduler and training metadata.

## Observed loss log

| Stage | Training loss | EMA validation loss |
| --- | ---: | ---: |
| Before fine-tuning (epoch 0) | n/a | 0.88888553 |
| After epoch 1 | 0.72019592 | 0.84840458 |

The recorded EMA validation objective decreased approximately 4.55% relative to the baseline. That is a **training objective change, not a verified pronunciation or perceptual-quality score**. Training and validation losses are not identical metrics.

## Checkpoint handling

The source run wrote a resumable checkpoint with training states. A separate verified export extracted its 364 EMA CFM tensors into a `.safetensors` file, excluding optimizer and scheduler states. Original and export were verified tensor-by-tensor. The export is private.

## Dataset scope

This run used **758 clips total**. It must not be interpreted as an assertion that an entire larger recording collection was used for this pilot. Audio, speaker identities, transcripts, and data provenance records are not included in this repository.
