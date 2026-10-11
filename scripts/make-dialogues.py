# Builds multi-speaker test dialogues (macOS `say` voices) as single WAV files
# with controlled gaps between turns, plus ground truth (text + turn positions).
# Usage: python3 scripts/make-dialogues.py tests/e2e/dialogues
import array, json, os, re, subprocess, sys, tempfile, wave

OUT = sys.argv[1]
V = {"A": "Samantha", "B": "Daniel", "C": "Flo (Inglês (EUA))", "D": "Eddy (Inglês (Reino Unido))"}
DIALOGUES = {
    # name: (gap between turns in ms, [(speaker, text)])
    "d1_gap800": (800, [
        ("A", "Did you have a chance to look at the new dashboard?"),
        ("B", "Yes, I checked it this morning. The charts load much faster now."),
        ("A", "Great. Did you notice any problems with the filters?"),
        ("B", "Only one. The date filter resets when you change the page."),
        ("A", "Okay, I will open a ticket for that."),
        ("B", "Thanks. I can review the fix tomorrow."),
    ]),
    "d2_gap300_three": (300, [
        ("A", "Let's decide where to hold the team offsite this year."),
        ("B", "I would prefer somewhere close to the city, so nobody has to fly."),
        ("D", "That works for me. The hotel near the lake had good reviews."),
        ("A", "How many rooms do they have available in March?"),
        ("D", "I think about forty, but I need to confirm with them."),
        ("B", "Please send the price as well, because the budget is tight."),
        ("A", "Sounds good. Let's talk again on Thursday."),
    ]),
    "d3_gap0_same_gender": (0, [
        ("A", "Can you share your screen for a moment?"),
        ("C", "Sure, give me one second while I find the right window."),
        ("A", "I can see it now. Could you zoom in on the second table?"),
        ("C", "Of course. These numbers are from the last two weeks."),
        ("A", "They look lower than I expected."),
        ("C", "Yes, the holiday affected the results."),
    ]),
}

def say_frames(voice, text, tmp):
    p = os.path.join(tmp, "t.wav")
    subprocess.run(["say", "-v", voice, "-o", p, "--file-format=WAVE", "--data-format=LEI16@22050", text], check=True)
    with wave.open(p) as a:
        assert a.getnchannels() == 1 and a.getsampwidth() == 2 and a.getframerate() == 22050
        return array.array("h", a.readframes(a.getnframes()))

os.makedirs(OUT, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    for name, (gap_ms, turns) in DIALOGUES.items():
        pcm = array.array("h")
        words, turn_after, bounds = [], [], []
        for i, (spk, text) in enumerate(turns):
            if i > 0:
                pcm.extend([0] * int(22050 * gap_ms / 1000))
            t0 = len(pcm) / 22050
            pcm.extend(say_frames(V[spk], text, tmp))
            bounds.append({"speaker": spk, "start": round(t0, 3), "end": round(len(pcm) / 22050, 3)})
            words += re.findall(r"[A-Za-z']+", text)
            if i < len(turns) - 1:
                turn_after.append(len(words))  # a turn happens after this many words
        with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(pcm.tobytes())
        open(os.path.join(OUT, name + ".txt"), "w").write(" ".join(t for _, t in turns) + "\n")
        json.dump({"gapMs": gap_ms, "turnAfterWord": turn_after, "nWords": len(words), "turns": bounds},
                  open(os.path.join(OUT, name + ".json"), "w"), indent=1)
        print(name, f"{len(pcm)/22050:.1f}s", "turns:", len(turn_after))
