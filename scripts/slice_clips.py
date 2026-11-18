import os
import subprocess
import sys

SOURCE_VIDEO = "Screen_Recording_20261110_183126.MP4"
OUTPUT_DIR = os.path.join("projects", "krishop-promo", "assets", "clips")
os.makedirs(OUTPUT_DIR, exist_ok=True)

def run_ffmpeg(cmd, description):
    print(f"--> {description}...")
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error in {description}: {res.stderr}")
        sys.exit(1)
    print(f"    Done: {description}")

# 1. Scene 1: 00:00 - 00:06 (6s)
clip1 = os.path.join(OUTPUT_DIR, "scene_01.mp4")
cmd1 = f'ffmpeg -y -ss 00:00:00 -t 00:00:06 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip1}"'
run_ffmpeg(cmd1, "Extract Scene 1")

# 2. Scene 2: 00:06 - 00:15 (9s)
clip2 = os.path.join(OUTPUT_DIR, "scene_02.mp4")
cmd2 = f'ffmpeg -y -ss 00:00:06 -t 00:00:09 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip2}"'
run_ffmpeg(cmd2, "Extract Scene 2")

# 3. Scene 3: 00:21.5 - 00:26 (4.5s slowed by 0.5x to 9s)
clip3 = os.path.join(OUTPUT_DIR, "scene_03.mp4")
cmd3 = f'ffmpeg -y -ss 00:00:21.5 -t 00:00:04.5 -i "{SOURCE_VIDEO}" -filter:v "setpts=2.0*PTS" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip3}"'
run_ffmpeg(cmd3, "Extract Scene 3 (0.5x Slowdown)")

# 4. Scene 4: 00:34.5 - 00:44.5 (10s)
clip4 = os.path.join(OUTPUT_DIR, "scene_04.mp4")
cmd4 = f'ffmpeg -y -ss 00:00:34.5 -t 00:00:10 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip4}"'
run_ffmpeg(cmd4, "Extract Scene 4")

# 5. Scene 5: 00:45 - 01:07 (22s sped up by 2x to 11s)
clip5 = os.path.join(OUTPUT_DIR, "scene_05.mp4")
cmd5 = f'ffmpeg -y -ss 00:00:45 -t 00:00:22 -i "{SOURCE_VIDEO}" -filter:v "setpts=0.5*PTS" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip5}"'
run_ffmpeg(cmd5, "Extract Scene 5 (2x Speed Ramp)")

# 6. Scene 6: 01:08 - 01:15 (7s)
clip6 = os.path.join(OUTPUT_DIR, "scene_06.mp4")
cmd6 = f'ffmpeg -y -ss 00:01:08 -t 00:00:07 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{clip6}"'
run_ffmpeg(cmd6, "Extract Scene 6")

# 7. Scene 7: 01:26 (1.5s) + 01:33 - 01:39.5 (6.5s) = 8s
# First extract part a and b, then concatenate
part_a = os.path.join(OUTPUT_DIR, "scene_07_a.mp4")
part_b = os.path.join(OUTPUT_DIR, "scene_07_b.mp4")
clip7 = os.path.join(OUTPUT_DIR, "scene_07.mp4")
run_ffmpeg(f'ffmpeg -y -ss 00:01:26 -t 00:00:01.5 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{part_a}"', "Scene 7 Part A")
run_ffmpeg(f'ffmpeg -y -ss 00:01:33 -t 00:00:06.5 -i "{SOURCE_VIDEO}" -an -c:v libx264 -crf 18 -preset fast -pix_fmt yuv420p -r 30 "{part_b}"', "Scene 7 Part B")

concat_file = os.path.join(OUTPUT_DIR, "scene_07_list.txt")
with open(concat_file, "w") as f:
    f.write(f"file 'scene_07_a.mp4'\nfile 'scene_07_b.mp4'\n")

run_ffmpeg(f'ffmpeg -y -f concat -safe 0 -i "{concat_file}" -c copy "{clip7}"', "Scene 7 Concat")

print("\n--- ALL CLIPS SUCCESSFULLY EXTRACTED ---")
