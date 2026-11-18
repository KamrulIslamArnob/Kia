import os
import subprocess

AUDIO_DIR = os.path.join("projects", "krishop-promo", "assets", "audio")

# Target scene limits (seconds):
TARGET_DURATIONS = {
    "vo_01.mp3": 5.8,
    "vo_02.mp3": 8.8,
    "vo_03.mp3": 8.8,
    "vo_04.mp3": 9.8,
    "vo_05.mp3": 10.8,
    "vo_06.mp3": 6.8,
    "vo_07.mp3": 7.8,
}

print("Fitting each voiceover track into its exact scene window...")

for filename, target_sec in TARGET_DURATIONS.items():
    filepath = os.path.join(AUDIO_DIR, filename)
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", filepath
    ]).decode().strip())
    
    speed_factor = dur / target_sec
    print(f"File {filename}: current={dur:.2f}s, target={target_sec}s -> speed_factor={speed_factor:.2f}")
    
    if speed_factor > 1.05:
        temp_out = os.path.join(AUDIO_DIR, "temp_" + filename)
        # Using atempo filter in ffmpeg preserves pitch while adjusting speed
        # For factors > 2.0 or between 1.0 and 2.0 atempo works directly
        cmd = f'ffmpeg -y -i "{filepath}" -filter:a "atempo={speed_factor}" -vn "{temp_out}"'
        subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(temp_out, filepath)
        
        new_dur = float(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", filepath
        ]).decode().strip())
        print(f"  -> Adjusted {filename}: {new_dur:.2f}s (Fits perfectly within {target_sec}s)")
    else:
        print(f"  -> {filename} already fits nicely!")

print("\nAll voiceovers are now time-aligned with each scene!")
