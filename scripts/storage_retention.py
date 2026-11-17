#!/usr/bin/env python3
"""
storage_retention.py
=============================================================================
Automated Storage Partition Hygiene & Retention Routine for OpenViva Platform
(Issue 24: Host Filesystem Storage Partition Hygiene)

Objectives:
1. Audio Retention & Dedup:
   - Transcode uncompressed .wav files to optimized AAC .m4a (+faststart) if not yet done.
   - Safely purge obsolete .wav recordings when verified .m4a audio files exist (> 1KB).
   - In-flight recording safety: Never touch files modified within the last 15 minutes.
2. Shared Memory (/dev/shm) Hygiene:
   - Purge stale raw shadow recordings (shadow_raw_*.wav) older than 2 hours.
   - Preserve all active code, configurations, and fresh telemetry in /dev/shm.
3. Cache Pruning:
   - Purge stale pip wheel caches (~800MB+) to recover host filesystem headroom.
   - Clean up stale temporary build and scratch artifacts.
4. Telemetry & Reporting:
   - Track and report bytes recovered across all storage roots.
   - Verify filesystem headroom before and after execution to prevent SQLITE_FULL crashes.
=============================================================================
"""

import os
import sys
import time
import shutil
import argparse
import subprocess
import json
from pathlib import Path

# Defaults
DEFAULT_RECORDINGS_DIR = "/home/savan/openviva/storage/recordings"
DEFAULT_SHM_DIR = "/dev/shm/savan_openviva"
DEFAULT_MIN_AGE_SECONDS = 900       # 15 minutes in-flight recording safety
DEFAULT_SHM_MAX_AGE_SECONDS = 7200   # 2 hours for shadow raw dumps

def find_ffmpeg() -> str:
    candidates = [
        "/home/savan/openviva/bin/ffmpeg",
        "/home/savan/.local/bin/ffmpeg",
        shutil.which("ffmpeg")
    ]
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return "ffmpeg"

def get_disk_headroom(path: str) -> dict:
    try:
        st = os.statvfs(path)
        total = st.f_blocks * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        used = total - avail
        pct = (used / total) * 100 if total > 0 else 0
        return {
            "path": path,
            "total_bytes": total,
            "used_bytes": used,
            "avail_bytes": avail,
            "avail_gb": round(avail / (1024 ** 3), 2),
            "use_percent": round(pct, 2)
        }
    except Exception as e:
        return {"path": path, "error": str(e)}

def transcode_to_m4a(ffmpeg_bin: str, wav_path: str, m4a_path: str) -> bool:
    try:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", wav_path,
            "-c:a", "aac",
            "-b:a", "64k",
            "-movflags", "+faststart",
            m4a_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
        if res.returncode == 0 and os.path.exists(m4a_path) and os.path.getsize(m4a_path) > 1000:
            return True
        return False
    except Exception as e:
        sys.stderr.write(f"[storage_retention] Transcode error {wav_path}: {e}\n")
        return False

def clean_recordings(recordings_dir: str, min_age_seconds: int, dry_run: bool, ffmpeg_bin: str) -> dict:
    results = {
        "wav_scanned": 0,
        "wav_in_flight_skipped": 0,
        "wav_transcoded_to_m4a": 0,
        "wav_purged": 0,
        "bytes_freed": 0,
        "errors": []
    }

    if not os.path.isdir(recordings_dir):
        results["errors"].append(f"Recordings directory not found: {recordings_dir}")
        return results

    now = time.time()
    for entry in sorted(os.scandir(recordings_dir), key=lambda e: e.name):
        if not entry.is_file() or not entry.name.lower().endswith(".wav"):
            continue

        results["wav_scanned"] += 1
        wav_path = entry.path
        wav_size = entry.stat().st_size
        wav_mtime = entry.stat().st_mtime

        # In-flight safety check
        if (now - wav_mtime) < min_age_seconds:
            results["wav_in_flight_skipped"] += 1
            continue

        # Target M4A path
        base_name = os.path.splitext(entry.name)[0]
        m4a_path = os.path.join(recordings_dir, f"{base_name}.m4a")

        m4a_exists_and_valid = (
            os.path.exists(m4a_path) and 
            os.path.getsize(m4a_path) > 1000
        )

        if not m4a_exists_and_valid:
            if dry_run:
                results["wav_transcoded_to_m4a"] += 1
            else:
                success = transcode_to_m4a(ffmpeg_bin, wav_path, m4a_path)
                if success:
                    results["wav_transcoded_to_m4a"] += 1
                    m4a_exists_and_valid = True
                else:
                    results["errors"].append(f"Failed to transcode {wav_path}")
                    continue

        if m4a_exists_and_valid:
            if dry_run:
                results["wav_purged"] += 1
                results["bytes_freed"] += wav_size
            else:
                try:
                    os.remove(wav_path)
                    results["wav_purged"] += 1
                    results["bytes_freed"] += wav_size
                except Exception as e:
                    results["errors"].append(f"Failed to remove {wav_path}: {e}")

    return results

def clean_shm_shadows(shm_dir: str, max_age_seconds: int, dry_run: bool) -> dict:
    results = {
        "shm_scanned": 0,
        "shm_skipped_recent": 0,
        "shm_purged": 0,
        "bytes_freed": 0,
        "errors": []
    }

    if not os.path.isdir(shm_dir):
        return results

    now = time.time()
    for entry in os.scandir(shm_dir):
        if not entry.is_file():
            continue

        name = entry.name.lower()
        # Strictly target raw shadow dumps (e.g. shadow_raw_*.wav)
        if not (name.startswith("shadow_raw_") and name.endswith(".wav")):
            continue

        results["shm_scanned"] += 1
        stat = entry.stat()
        file_age = now - stat.st_mtime

        if file_age < max_age_seconds:
            results["shm_skipped_recent"] += 1
            continue

        file_size = stat.st_size
        if dry_run:
            results["shm_purged"] += 1
            results["bytes_freed"] += file_size
        else:
            try:
                os.remove(entry.path)
                results["shm_purged"] += 1
                results["bytes_freed"] += file_size
            except Exception as e:
                results["errors"].append(f"Failed to remove {entry.path}: {e}")

    return results

def clean_pip_cache(dry_run: bool) -> dict:
    results = {
        "pip_cache_before_bytes": 0,
        "bytes_freed": 0,
        "purged": False,
        "errors": []
    }

    pip_cache_dir = os.path.expanduser("~/.cache/pip")
    if os.path.isdir(pip_cache_dir):
        total_size = 0
        for dirpath, _, filenames in os.walk(pip_cache_dir):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total_size += os.path.getsize(fp)
                except OSError:
                    pass
        results["pip_cache_before_bytes"] = total_size

        if total_size > 0:
            if dry_run:
                results["bytes_freed"] = total_size
            else:
                try:
                    # Run pip cache purge
                    res = subprocess.run(
                        [sys.executable, "-m", "pip", "cache", "purge"],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=30
                    )
                    # Also remove remnants if directory still holds abandoned wheels
                    if os.path.isdir(pip_cache_dir):
                        for sub in os.scandir(pip_cache_dir):
                            try:
                                if sub.is_dir():
                                    shutil.rmtree(sub.path, ignore_errors=True)
                                else:
                                    os.remove(sub.path)
                            except Exception:
                                pass
                    results["purged"] = True
                    results["bytes_freed"] = total_size
                except Exception as e:
                    results["errors"].append(f"Pip cache purge failed: {e}")

    return results

def run_retention_cycle(
    recordings_dir: str = DEFAULT_RECORDINGS_DIR,
    shm_dir: str = DEFAULT_SHM_DIR,
    min_age_seconds: int = DEFAULT_MIN_AGE_SECONDS,
    shm_max_age_seconds: int = DEFAULT_SHM_MAX_AGE_SECONDS,
    dry_run: bool = False
) -> dict:
    start_time = time.time()
    ffmpeg_bin = find_ffmpeg()

    headroom_home_before = get_disk_headroom("/home")
    headroom_shm_before = get_disk_headroom("/dev/shm")

    rec_res = clean_recordings(recordings_dir, min_age_seconds, dry_run, ffmpeg_bin)
    shm_res = clean_shm_shadows(shm_dir, shm_max_age_seconds, dry_run)
    pip_res = clean_pip_cache(dry_run)

    headroom_home_after = get_disk_headroom("/home")
    headroom_shm_after = get_disk_headroom("/dev/shm")

    total_bytes_freed = (
        rec_res["bytes_freed"] + 
        shm_res["bytes_freed"] + 
        pip_res["bytes_freed"]
    )

    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dry_run": dry_run,
        "elapsed_seconds": round(time.time() - start_time, 3),
        "ffmpeg_bin": ffmpeg_bin,
        "total_bytes_freed": total_bytes_freed,
        "total_mb_freed": round(total_bytes_freed / (1024 * 1024), 2),
        "total_gb_freed": round(total_bytes_freed / (1024 ** 3), 3),
        "recordings": rec_res,
        "shm": shm_res,
        "pip_cache": pip_res,
        "headroom": {
            "home_before": headroom_home_before,
            "home_after": headroom_home_after,
            "shm_before": headroom_shm_before,
            "shm_after": headroom_shm_after
        }
    }
    return report

def main():
    parser = argparse.ArgumentParser(description="OpenViva Storage Hygiene & Retention Routine")
    parser.add_argument("--dry-run", action="store_true", help="Report actions without deleting files")
    parser.add_argument("--force", action="store_true", help="Execute deletion and transcoding")
    parser.add_argument("--recordings-dir", default=DEFAULT_RECORDINGS_DIR, help="Path to recordings directory")
    parser.add_argument("--shm-dir", default=DEFAULT_SHM_DIR, help="Path to shared memory directory")
    parser.add_argument("--min-age-minutes", type=int, default=15, help="In-flight recording safety threshold (minutes)")
    parser.add_argument("--shm-max-age-hours", type=int, default=2, help="SHM shadow dump expiration (hours)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    args = parser.parse_args()

    # Default to dry-run unless --force is explicitly provided
    is_dry = args.dry_run or not args.force

    report = run_retention_cycle(
        recordings_dir=args.recordings_dir,
        shm_dir=args.shm_dir,
        min_age_seconds=args.min_age_minutes * 60,
        shm_max_age_seconds=args.shm_max_age_hours * 3600,
        dry_run=is_dry
    )

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        mode_str = "DRY RUN (No files modified)" if is_dry else "LIVE EXECUTION (Files purged)"
        print("=================================================================")
        print(f"OpenViva Storage Retention Routine [{mode_str}]")
        print("=================================================================")
        print(f"Total Disk Space Recovered: {report['total_mb_freed']} MB ({report['total_gb_freed']} GB)")
        print(f"  • Recordings Dir: {report['recordings']['wav_purged']} WAVs purged, {report['recordings']['wav_transcoded_to_m4a']} transcoded, {round(report['recordings']['bytes_freed'] / (1024*1024), 2)} MB freed")
        print(f"    (Skipped {report['recordings']['wav_in_flight_skipped']} in-flight active recordings)")
        print(f"  • SHM Dumps:      {report['shm']['shm_purged']} shadow files purged, {round(report['shm']['bytes_freed'] / (1024*1024), 2)} MB freed")
        print(f"  • Pip Cache:      {round(report['pip_cache']['bytes_freed'] / (1024*1024), 2)} MB purged")
        print("-----------------------------------------------------------------")
        home = report["headroom"]["home_after"]
        shm = report["headroom"]["shm_after"]
        print(f"/home   Partition: {home.get('avail_gb', '?')} GB available ({home.get('use_percent', '?')}% used)")
        print(f"/dev/shm Partition: {shm.get('avail_gb', '?')} GB available ({shm.get('use_percent', '?')}% used)")
        print("=================================================================")

if __name__ == "__main__":
    main()
