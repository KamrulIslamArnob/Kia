import os
import subprocess

AUDIO_DIR = os.path.join("projects", "krishop-promo", "assets", "audio")
OUTPUT_MASTER = os.path.join(AUDIO_DIR, "master_audio.mp3")

# Scene offsets in seconds:
# Scene 1: 0.1
# Scene 2: 6.1
# Scene 3: 15.1
# Scene 4: 24.1
# Scene 5: 34.1
# Scene 6: 45.1
# Scene 7: 52.1

print("Mixing master multi-track audio track with FFmpeg...")

filter_complex = (
    # Inputs:
    # 0: bgm.mp3 (volume 0.18)
    # 1: vo_01.mp3 (adelay=100|100)
    # 2: vo_02.mp3 (adelay=6100|6100)
    # 3: vo_03.mp3 (adelay=15100|15100)
    # 4: vo_04.mp3 (adelay=24100|24100)
    # 5: vo_05.mp3 (adelay=34100|34100)
    # 6: vo_06.mp3 (adelay=45100|45100)
    # 7: vo_07.mp3 (adelay=52100|52100)
    # 8: whoosh.mp3 (adelay=3800|3800)
    # 9: pop.mp3 (adelay=4200|4200)
    # 10: bubble.mp3 (adelay=17500|17500)
    # 11: typing.mp3 (adelay=35000|35000)
    # 12: ding.mp3 (adelay=52500|52500)
    "[0:a]volume=0.18[bgm];"
    "[1:a]adelay=100|100[v1];"
    "[2:a]adelay=6100|6100[v2];"
    "[3:a]adelay=15100|15100[v3];"
    "[4:a]adelay=24100|24100[v4];"
    "[5:a]adelay=34100|34100[v5];"
    "[6:a]adelay=45100|45100[v6];"
    "[7:a]adelay=52100|52100[v7];"
    "[8:a]adelay=3800|3800,volume=0.6[s1];"
    "[9:a]adelay=4200|4200,volume=0.8[s2];"
    "[10:a]adelay=17500|17500,volume=0.8[s3];"
    "[11:a]adelay=35000|35000,volume=0.4[s4];"
    "[12:a]adelay=52500|52500,volume=0.9[s5];"
    "[bgm][v1][v2][v3][v4][v5][v6][v7][s1][s2][s3][s4][s5]amix=inputs=13:duration=first:dropout_transition=2,volume=1.8[outa]"
)

cmd = [
    "ffmpeg", "-y",
    "-i", os.path.join(AUDIO_DIR, "bgm.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_01.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_02.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_03.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_04.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_05.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_06.mp3"),
    "-i", os.path.join(AUDIO_DIR, "vo_07.mp3"),
    "-i", os.path.join(AUDIO_DIR, "whoosh.mp3"),
    "-i", os.path.join(AUDIO_DIR, "pop.mp3"),
    "-i", os.path.join(AUDIO_DIR, "bubble.mp3"),
    "-i", os.path.join(AUDIO_DIR, "typing.mp3"),
    "-i", os.path.join(AUDIO_DIR, "ding.mp3"),
    "-filter_complex", filter_complex,
    "-map", "[outa]",
    "-t", "60",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    OUTPUT_MASTER
]

subprocess.run(cmd, check=True)

dur = subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", OUTPUT_MASTER
]).decode().strip()

print(f"Master audio track generated: {OUTPUT_MASTER} (Duration: {float(dur):.2f}s)")
