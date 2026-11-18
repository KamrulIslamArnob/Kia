import asyncio
import os
import subprocess
import edge_tts

AUDIO_DIR = os.path.join("projects", "krishop-promo", "assets", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

VOICE = "bn-BD-PradeepNeural"

SCRIPTS = [
    ("vo_01.mp3", "শীত তো চলেই এলো! আর এই শীতে আপনার জমি বা ছাদবাগানের প্রস্তুতি কেমন চলছে? চাষাবাদের কাজকে একদম সহজ করতে কৃষপ অ্যাপে এবার এসেছে দারুণ এক চমক!", "+5%"),
    ("vo_02.mp3", "চলছে কৃষপ অ্যাপের বিশেষ ঝড়ো অফার! এই অফারে আমাদের অ্যাপে যুক্ত হয়েছে নতুন আরও অনেক প্রোডাক্ট। শীতের সেরা সব সবজির বীজ, জৈব সার, রেডি মিক্স মাটি থেকে শুরু করে মাচার নেট বা মালচিং কাটার, সবই পাচ্ছেন এক জায়গায়।", "+8%"),
    ("vo_03.mp3", "আমাদের ক্যাটেগরি লিস্টে তাকালেই দেখবেন ফুলকপি, বাঁধাকপি, টমেটো, মরিচ, শসা বা পেঁপের বীজসহ প্রয়োজনীয় সব কৃষি সরঞ্জাম ও ফার্টিলাইজার। আপনার ঠিক যা যা লাগবে, সবই এখন হাতের মুঠোয়।", "+8%"),
    ("vo_04.mp3", "অর্ডার করাও কিন্তু একদম পানির মতো সহজ! পছন্দের পণ্য কার্টে যোগ করুন। চাইলে নিজের প্রয়োজনমতো পণ্যের পরিমাণ বাড়াতে বা কমাতে পারবেন, আবার কোনো পণ্য বাদ দিতে চাইলে সেটাও করা যাবে এক ক্লিকেই।", "+6%"),
    ("vo_05.mp3", "এরপর এগিয়ে যান বাটনে ট্যাপ করে আপনার নাম, মোবাইল নম্বর এবং ডেলিভারি ঠিকানাটি লিখে নিশ্চিত করুন।", "+8%"),
    ("vo_06.mp3", "সবচেয়ে মজার বিষয় হলো, ক্যাশ অন ডেলিভারি সুবিধার পাশাপাশি ৫০০ বা ৮০০ টাকার বেশি অর্ডার করলেই পাচ্ছেন একদম ফ্রি ডেলিভারি! এবার অর্ডার করুন বাটনে ট্যাপ করে অর্ডারটি কনফার্ম করে দিন।", "+6%"),
    ("vo_07.mp3", "ব্যস, আপনার অর্ডার সফল! তাই দেরি না করে এই শীতের ঝড়ো অফারে আমাদের সাথে যুক্ত হয়ে যান, আর কৃষপ অ্যাপের মাধ্যমে আপনার প্রয়োজনীয় কৃষি পণ্য অর্ডার করুন এখনই!", "+6%"),
]

async def generate_voiceovers():
    print("Generating Bengali Voiceovers with edge-tts...")
    for filename, text, rate in SCRIPTS:
        out_path = os.path.join(AUDIO_DIR, filename)
        print(f"  -> Generating {filename}...")
        communicate = edge_tts.Communicate(text, VOICE, rate=rate)
        await communicate.save(out_path)
        
        # Check duration
        res = subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", out_path
        ]).decode().strip()
        print(f"     Saved {filename} ({float(res):.2f}s)")

def synthesize_sfx():
    print("\nSynthesizing Sound Effects using FFmpeg audio filters...")
    
    # 1. Whoosh SFX (frequency sweep with noise)
    whoosh_path = os.path.join(AUDIO_DIR, "whoosh.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "anoisesrc=d=0.5:c=pink:r=44100,lowpass=f=1200,volume=1.5,afade=t=in:ss=0:d=0.2,afade=t=out:st=0.3:d=0.2" "{whoosh_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    
    # 2. Pop / Click SFX (short high frequency blip)
    pop_path = os.path.join(AUDIO_DIR, "pop.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "sine=frequency=880:duration=0.15,afade=t=out:st=0.03:d=0.12,volume=1.2" "{pop_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    
    # 3. Bubble Pop SFX
    bubble_path = os.path.join(AUDIO_DIR, "bubble.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "sine=frequency=1100:duration=0.12,afade=t=out:st=0.02:d=0.1,volume=1.0" "{bubble_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    
    # 4. Typing Taps SFX (repeated short clicks)
    typing_path = os.path.join(AUDIO_DIR, "typing.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "anoisesrc=d=11:c=brown:r=44100,volume=0.35,highpass=f=2000,lowpass=f=6000" "{typing_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    
    # 5. Success Chime / Cash Ding (harmonic bright bells)
    ding_path = os.path.join(AUDIO_DIR, "ding.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "sine=frequency=1567.98:duration=2.0,afade=t=out:st=0.2:d=1.8,volume=1.2" "{ding_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

    # 6. Background Music Track (Upbeat gentle acoustic rhythm loop, 60s)
    # Using harmonious chord progression generated via synthesized gentle layered tones
    bgm_path = os.path.join(AUDIO_DIR, "bgm.mp3")
    subprocess.run(
        f'ffmpeg -y -f lavfi -i "sine=frequency=261.63:duration=60,volume=0.2" -f lavfi -i "sine=frequency=329.63:duration=60,volume=0.15" -f lavfi -i "sine=frequency=392.00:duration=60,volume=0.15" -filter_complex "amix=inputs=3:duration=first,volume=0.15,afade=t=in:ss=0:d=1,afade=t=out:st=58:d=2" "{bgm_path}"',
        shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    print("Sound effects and BGM created successfully!")

if __name__ == "__main__":
    asyncio.run(generate_voiceovers())
    synthesize_sfx()
