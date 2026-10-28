#!/usr/bin/env python3
"""Export DH-TTS v0.1-General EMA-only IndicF5 CFM weights to safetensors.

Does not modify the input checkpoint. Does not export optimizer, scheduler,
reference voices, audio, dataset or private training paths.

Usage:
  python export_dh_tts_ema.py --checkpoint "...\\model_last.pt" --output "...\\model.safetensors"
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

PREFIX = "ema_model."
EXPECTED_COUNT = 364


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = args.checkpoint.resolve()
    target = args.output.resolve()
    if not source.is_file():
        parser.error(f"Checkpoint not found: {source}")
    if source == target:
        parser.error("Output cannot overwrite the input training checkpoint.")
    if target.exists():
        parser.error(f"Output already exists; refusing to overwrite: {target}")

    target.parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(target.parent).free
    if free < 3 * 1024**3:
        parser.error("At least 3 GiB of free disk space is recommended for export.")

    print("Loading training checkpoint on CPU (memory-mapped)...", flush=True)
    ckpt = torch.load(source, map_location="cpu", weights_only=True, mmap=True)
    if ckpt.get("format") != "dh-tts-v0.1-general":
        raise RuntimeError(f"Unexpected checkpoint format: {ckpt.get('format')!r}")

    ema = ckpt.get("ema_model_state_dict")
    if not isinstance(ema, dict):
        raise RuntimeError("ema_model_state_dict is missing or not a mapping")

    weights = {}
    for key, value in ema.items():
        if key.startswith(PREFIX):
            if not isinstance(value, torch.Tensor):
                raise RuntimeError(f"Non-tensor EMA entry: {key}")
            clean_key = key[len(PREFIX):]
            weights[clean_key] = value.detach().cpu().contiguous()

    if len(weights) != EXPECTED_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_COUNT} EMA tensors, got {len(weights)}")

    metadata = {
        "format": "dh-tts-v0.1-general-ema-cfm",
        "base_model": "ai4bharat/IndicF5",
        "source_checkpoint": source.name,
        "microsteps": str(ckpt.get("step", "unknown")),
        "optimizer_steps": str(ckpt.get("optimizer_step", "unknown")),
        "vocab_size": str(ckpt.get("vocab_size", "unknown")),
        "train_size": str(ckpt.get("train_size", "unknown")),
    }

    temp = target.with_name(target.name + ".part")
    if temp.exists():
        raise RuntimeError(f"Temporary export exists; inspect before deleting: {temp}")
    print(f"Writing {len(weights)} EMA CFM tensors to {target} ...", flush=True)
    try:
        save_file(weights, str(temp), metadata=metadata)
        print("Verifying every exported tensor exactly...", flush=True)
        with safe_open(str(temp), framework="pt", device="cpu") as reader:
            keys = set(reader.keys())
            if keys != set(weights):
                raise RuntimeError("Exported keys do not match the source EMA keys")
            for key, original in weights.items():
                restored = reader.get_tensor(key)
                if restored.shape != original.shape or restored.dtype != original.dtype:
                    raise RuntimeError(f"Shape/dtype mismatch: {key}")
                if not torch.equal(restored, original):
                    raise RuntimeError(f"Tensor value mismatch: {key}")
        os.replace(temp, target)
    except BaseException:
        if temp.exists():
            temp.unlink()
        raise

    print("EXPORT AND VERIFICATION: PASS")
    print(f"EMA tensors       : {len(weights)}")
    print(f"Training microsteps: {metadata['microsteps']}")
    print(f"Optimizer steps   : {metadata['optimizer_steps']}")
    print(f"Size (GiB)       : {target.stat().st_size / 1024**3:.3f}")
    print(f"Exported model   : {target}")
    print("Keep this model PRIVATE unless rights/licensing permit its release.")


if __name__ == "__main__":
    main()
