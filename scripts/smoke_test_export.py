#!/usr/bin/env python3
"""Smoke-test a private DH-TTS EMA-only safetensors export on the original IndicF5 wrapper.

This script does not load any training checkpoint, optimizer state, or training dataset.

Run (PowerShell, with the recovered IndicF5 Python):
    python test_dh_tts_exported.py \
        --weights '...\\model.safetensors' \
        --csv '...\\DH_TTS_BD_BN_Benchmark_v0.1.csv' \
        --ref-audio '...\\benchmark_ref.WAV' \
        --ref-text-file '...\\benchmark_ref.txt' \
        --out-dir '...\\exported_inference_test'

Requires explicit authorization for the chosen reference voice. Keep generated samples
private unless you have the rights to share them.
"""
from __future__ import annotations

import argparse
import csv
import gc
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from safetensors import safe_open
from safetensors.torch import load_file
from transformers import AutoModel

DEFAULT_IDS = ("DHBN-031", "DHBN-151", "DHBN-181")
EXPECTED_TENSORS = 364
EXPECTED_FORMAT = "dh-tts-v0.1-general-ema-cfm"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, required=True, help="Private exported EMA model.safetensors")
    parser.add_argument("--csv", type=Path, required=True, help="Original locked benchmark CSV")
    parser.add_argument("--ref-audio", type=Path, required=True, help="Authorized reference WAV")
    parser.add_argument("--ref-text-file", type=Path, required=True, help="Reference WAV's accurate transcript")
    parser.add_argument("--out-dir", type=Path, required=True, help="Fresh private output folder")
    parser.add_argument("--repo-id", default="ai4bharat/IndicF5")
    parser.add_argument("--revision", default=None, help="Optional pinned Hugging Face revision")
    parser.add_argument("--ids", nargs="+", default=list(DEFAULT_IDS), help="Benchmark IDs to generate")
    return parser.parse_args()


def get_raw_cfm(model: torch.nn.Module) -> torch.nn.Module:
    wrapped = model.ema_model
    return wrapped._orig_mod if hasattr(wrapped, "_orig_mod") else wrapped


def normalized_audio(audio) -> np.ndarray:
    samples = np.asarray(audio)
    if samples.dtype == np.int16:
        samples = samples.astype(np.float32) / 32768.0
    else:
        samples = samples.astype(np.float32)
    samples = np.squeeze(samples)
    if samples.ndim != 1 or samples.size == 0:
        raise RuntimeError(f"Expected nonempty mono waveform, received shape {samples.shape}")
    if not np.isfinite(samples).all():
        raise RuntimeError("Generated audio contains NaN or Inf")
    peak = float(np.max(np.abs(samples)))
    if peak > 1.0:
        samples = samples / peak * 0.98
    return samples


def main() -> None:
    args = parse_args()
    for p in (args.weights, args.csv, args.ref_audio, args.ref_text_file):
        if not p.is_file():
            raise FileNotFoundError(p)

    ref_text = args.ref_text_file.read_text(encoding="utf-8").strip()
    if not ref_text or sum("\u0980" <= c <= "\u09ff" for c in ref_text) < 20:
        raise ValueError("Reference transcript is empty or does not look like the expected Bengali text")

    with args.csv.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if len(rows) != 300:
        raise ValueError(f"Expected locked 300-row benchmark, got {len(rows)}")
    by_id = {row["id"].strip(): row for row in rows}
    unknown = [item for item in args.ids if item not in by_id]
    if unknown:
        raise ValueError(f"IDs not found in benchmark: {unknown}")
    if len(args.ids) != len(set(args.ids)):
        raise ValueError("Duplicate IDs are not allowed")

    if args.out_dir.exists() and any(args.out_dir.glob("DHBN-*.wav")):
        raise FileExistsError(
            f"Output folder already contains benchmark WAV files: {args.out_dir}. "
            "Choose a fresh folder to avoid mixing results."
        )
    args.out_dir.mkdir(parents=True, exist_ok=True)

    with safe_open(str(args.weights), framework="pt", device="cpu") as f:
        metadata = f.metadata() or {}
        weight_keys = set(f.keys())
    if metadata.get("format") != EXPECTED_FORMAT:
        raise RuntimeError(f"Unexpected exported format: {metadata.get('format')!r}")
    if len(weight_keys) != EXPECTED_TENSORS:
        raise RuntimeError(f"Expected {EXPECTED_TENSORS} exported tensors; got {len(weight_keys)}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("=" * 72, flush=True)
    print("DH TTS — INFERENCE-ONLY SAFETENSORS SMOKE TEST", flush=True)
    print("Device       :", device, flush=True)
    print("Export file  :", args.weights, flush=True)
    print("EMA tensors  :", len(weight_keys), flush=True)
    print("Train steps  :", metadata.get("microsteps", "unknown"), flush=True)
    print("Optimizer upd:", metadata.get("optimizer_steps", "unknown"), flush=True)
    print("Test IDs     :", ", ".join(args.ids), flush=True)
    print("NOTE: Training checkpoint is not accessed by this program.", flush=True)
    print("=" * 72, flush=True)

    kwargs = {"trust_remote_code": True}
    if args.revision:
        kwargs["revision"] = args.revision
    model = AutoModel.from_pretrained(args.repo_id, **kwargs)
    model = model.to(device)
    model.eval()

    exported_state = load_file(str(args.weights), device="cpu")
    raw_cfm = get_raw_cfm(model)
    base_state = raw_cfm.state_dict()
    missing = sorted(set(base_state) - set(exported_state))
    unexpected = sorted(set(exported_state) - set(base_state))
    mismatch = sorted(
        key for key in set(base_state) & set(exported_state)
        if tuple(base_state[key].shape) != tuple(exported_state[key].shape)
        or base_state[key].dtype != exported_state[key].dtype
    )
    print("Tensor key/shape/dtype check:", flush=True)
    print(f"  missing={len(missing)} unexpected={len(unexpected)} mismatch={len(mismatch)}", flush=True)
    if missing or unexpected or mismatch:
        raise RuntimeError(
            f"Export incompatible with wrapper: missing={missing[:3]}, "
            f"unexpected={unexpected[:3]}, mismatch={mismatch[:3]}"
        )

    raw_cfm.load_state_dict(exported_state, strict=True)
    print("EXPORTED EMA LOAD: PASS", flush=True)
    del exported_state
    gc.collect()

    manifest = []
    for index, sample_id in enumerate(args.ids, 1):
        row = by_id[sample_id]
        text = row["text"].strip()
        if not text:
            raise ValueError(f"Empty benchmark text: {sample_id}")
        path = args.out_dir / f"{sample_id}.wav"
        print(f"[{index}/{len(args.ids)}] GENERATE {sample_id}", flush=True)
        with torch.inference_mode():
            audio = model(text, ref_audio_path=str(args.ref_audio), ref_text=ref_text)
        audio = normalized_audio(audio)
        sf.write(path, audio, samplerate=24000, subtype="PCM_16")
        duration = len(audio) / 24000
        manifest.append({
            "id": sample_id, "text": text, "wav": str(path),
            "duration_seconds": f"{duration:.3f}",
            "weight_file": args.weights.name,
            "model": "dh-tts-v0.1-general-e001-exported-ema",
        })
        print(f"  written={path.name} duration={duration:.2f}s", flush=True)

    manifest_path = args.out_dir / "generation_manifest.csv"
    with manifest_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(manifest[0]))
        writer.writeheader()
        writer.writerows(manifest)
    print("=" * 72, flush=True)
    print("EXPORTED MODEL INFERENCE: PASS", flush=True)
    print(f"Generated: {len(manifest)}/{len(args.ids)}", flush=True)
    print("Output dir:", args.out_dir, flush=True)
    print("Manifest  :", manifest_path, flush=True)


if __name__ == "__main__":
    main()
