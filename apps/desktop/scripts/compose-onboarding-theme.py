#!/usr/bin/env python3
"""Compose and render the welcome guide's music, src/features/onboarding/assets/onboarding-theme.mp3.

The music is original. Every note, voicing and sound in it is written in this file and
synthesized from oscillators, decaying partials, filtered noise and a synthesized reverb impulse
response. Nothing is sampled, and the track neither quotes nor imitates an existing melody.

Arrangement (calm ambient in D major with Lydian colour, 72 BPM, 4/4, 1 bar = 10/3 s). The times
are the contract in src/features/onboarding/assets/onboarding-theme.ts and must not move:
  0.0-3.5 s  a sus2 pad rises from near silence through an opening low-pass filter, under a
             reversed-reverb riser and a breath of air noise.
  3.5 s      the bloom (`revealAt`): the pad's third arrives, the filter opens, a sub swell peaks,
             and a felt-piano dyad and a glass bell strike on the downbeat.
  3.5-8 s    the release: a three-note felt-piano motif while the bed's G chord fades in.
  8-48 s     the bed (`loopStart`..`loopEnd`): 12 bars, Dadd9 - A/C# - Bm9 - Gmaj9, three bars
             each, with sparse low-velocity plucks, faint bells and a slow filter drift. No beats.
  48-52 s    the tail: the bed's last chord and its reverb decaying; heard only past the loop.

Why the loop is sample-seamless: the bed's notes are rendered into a circular buffer exactly 40 s
long (tails past the end wrap onto the start), its reverb is a circular convolution and its EQ a
circular filter, and every time-varying parameter is periodic over 40 s. So samples 8 s..48 s of
the file are one period of a periodic signal: the sample after 48 s - 1/44100 is the one at 8 s,
reverb and pad releases included. The intro crossfades into that same periodic signal and is
fully faded out by 8 s; the tail is the bed rendered linearly with no notes starting at or after
48 s, which is identical to the periodic bed before 48 s because every filter here is causal.
The master stage is a fixed gain plus a memoryless soft saturation, which preserves periodicity.

Run from the repository root (needs python3 with numpy, and ffmpeg with libmp3lame on PATH):
  python3 apps/desktop/scripts/compose-onboarding-theme.py            # writes the mp3
  python3 apps/desktop/scripts/compose-onboarding-theme.py --wav x.wav  # also keeps a float WAV
It prints loudness, true peak and the loop splice step for the master and for the decoded mp3
(the mp3 is encoded twice so that the decoded file, not the master, meets the -20 LUFS target).
Seeds are fixed, so a rerun writes a byte-identical file. The mp3 keeps ffmpeg's LAME/Xing header,
so decoders (ffmpeg, AudioToolbox, WebKit's decodeAudioData) trim the encoder delay and padding
and the decoded audio is exactly 52 s with 8 s and 48 s at the same samples as the master.
"""

import argparse
import pathlib
import subprocess

import numpy as np

SR = 44100
BEAT = 60 / 72
BAR = 4 * BEAT
REVEAL_AT, LOOP_START, LOOP_END, DURATION = 3.5, 8.0, 48.0, 52.0
assert abs(12 * BAR - (LOOP_END - LOOP_START)) < 1e-9
LOOP_N = round((LOOP_END - LOOP_START) * SR)
XFADE_START = 4.6
TARGET_LUFS = -20.0
OUT = pathlib.Path(__file__).resolve().parents[1] / "src/features/onboarding/assets/onboarding-theme.mp3"
TAU = 2 * np.pi


def midi(name):
    """'F#4' -> 66."""
    pcs = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    pc = pcs[name[0]] + name.count("#") - name.count("b")
    return pc + 12 * (int(name.lstrip("ABCDEFG#b")) + 1)


def hz(name):
    return 440.0 * 2 ** ((midi(name) - 69) / 12)


def pan(sig, p):
    """Constant-power pan of a mono signal; p in [-1, 1]."""
    a = (p + 1) * np.pi / 4
    return np.stack([np.cos(a) * sig, np.sin(a) * sig])


def raised(n):
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(n, 1))


def end_fade(n, seconds):
    """1 until the last `seconds`, then a raised-cosine fade whose last sample is exactly 0."""
    m = round(seconds * SR)
    return np.concatenate([np.ones(n - m), 0.5 + 0.5 * np.cos(np.pi * (np.arange(m) + 1) / m)])


def envelope(hold, attack, release):
    """Raised-cosine attack, sustain until `hold` s, raised-cosine release reaching exactly 0."""
    nh, na, nr = round(hold * SR), round(attack * SR), round(release * SR)
    env = np.ones(nh + nr)
    na = min(na, nh + nr)
    env[:na] = raised(na)
    env[nh:] *= 0.5 + 0.5 * np.cos(np.pi * (np.arange(nr) + 1) / nr)
    return env


def fft_mask(sig, lo, hi):
    """Band-limit a short signal with a soft spectral mask (used on noise only)."""
    spec = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    mask = 1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4) / np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(spec * mask, len(sig))


# Instruments. Each returns one note as a mono or stereo array starting at its onset; the random
# phases come from the caller's generator, so the whole render is fixed by the seeds in
# `compose`.
def pad(name, t0, hold, cutoff, rng, attack=1.8, release=3.0, amp=1.0, gain=None, saw=0.62):
    """Warm analog-style pad note: three detuned band-limited saw/triangle blends with slow pitch
    drift, through a gentle (about 10 dB/oct) low-pass whose cutoff follows `cutoff(t)` in
    absolute seconds. The filter is applied per harmonic, so it is exact and keeps no state that
    would have to carry across the loop."""
    f0 = hz(name)
    env = envelope(hold, attack, release) * amp
    n = len(env)
    t = np.arange(n) / SR
    if gain is not None:
        env = env * gain(t0 + t)
    inv_fc4 = cutoff(t0 + t) ** -4.0
    out = np.zeros((2, n))
    for v, (cents, p) in enumerate(((-6.0, -0.45), (0.0, 0.0), (6.5, 0.45))):
        drift = cents + 2.2 * np.sin(TAU * (0.11 + 0.04 * v) * t + rng.uniform(0, TAU))
        phase = TAU * np.cumsum(f0 * 2 ** (drift / 1200)) / SR
        sig = np.zeros(n)
        for k in range(1, int(7000 / f0) + 1):
            weight = saw / k + ((1 - saw) / k**2 if k % 2 else 0.0)
            lowpass = 1 / np.sqrt(1 + (k * f0) ** 4 * inv_fc4) ** 0.85
            sig += weight * lowpass * np.sin(k * phase + rng.uniform(0, TAU))
        out += pan(sig, p)
    return out * env / 3


def pluck(name, vel, rng, level=1.0):
    """Felt-piano pluck: two slightly detuned strings of stretched partials whose upper partials
    decay faster, a soft 7 ms felt attack, and a short low-passed noise thump."""
    f0 = hz(name)
    t1 = 2.3 * (261.6 / f0) ** 0.45
    n = round(min(7.0, 5.5 * t1) * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    bright = 1500 + 4000 * vel
    for detune in (-1.3, 1.5):
        for k in range(1, 14):
            fk = k * f0 * np.sqrt(1 + 0.00035 * k * k) * 2 ** (detune / 1200)
            if fk > 9000:
                break
            amp = np.exp(-fk / bright) / k**1.25
            decay = np.exp(-t * (1 + 0.5 * (k - 1)) / t1)
            sig += amp * decay * np.sin(TAU * fk * t + rng.uniform(0, TAU))
    sig *= np.concatenate([raised(round(0.007 * SR)), np.ones(n)])[:n]
    sig /= np.max(np.abs(sig))
    thump = fft_mask(rng.standard_normal(n), 80, 900) * np.exp(-t / 0.018) * np.minimum(1, t / 0.003)
    sig += 0.35 * thump / np.max(np.abs(thump[: round(0.05 * SR)]))
    return sig * vel * level * end_fade(n, 0.8)


def bell(name, amp, rng):
    """Faint glass bell: inharmonic bar partials, each a beating pair, long soft decay."""
    f0 = hz(name)
    n = round(6.0 * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for ratio, a, tau in ((1.0, 1.0, 2.6), (2.76, 0.32, 1.1), (5.4, 0.12, 0.55), (8.93, 0.02, 0.3)):
        for beat in (-0.35, 0.35):
            sig += a * np.exp(-t / tau) * np.sin(TAU * (f0 * ratio + beat) * t + rng.uniform(0, TAU))
    att = np.concatenate([raised(round(0.004 * SR)), np.ones(n)])[:n]
    return sig * att * amp / 2 * end_fade(n, 1.0)


def sub(name, t0, hold, rng, attack=2.0, release=2.5, amp=1.0, gain=None):
    """Airy sub swell: a sine with a whisper of its octave."""
    f0 = hz(name)
    env = envelope(hold, attack, release) * amp
    t = np.arange(len(env)) / SR
    if gain is not None:
        env = env * gain(t0 + t)
    ph = rng.uniform(0, TAU)
    sig = np.sin(TAU * f0 * t + ph) + 0.12 * np.sin(TAU * 2 * f0 * t + 2 * ph)
    return pan(sig * env, 0.0)


# Space and tone: a synthesized reverb impulse response, biquad sections for the master EQ and
# the loudness meter, and FFT convolution that is circular for the loop and linear for the intro
# and the tail.
def make_ir(seconds, rt60s, seed):
    """Stereo plate-like impulse response: decorrelated noise per channel, split into bands that
    decay at their own RT60 (highs die first), 22 ms pre-delay, low end thinned to avoid mud."""
    rng = np.random.default_rng(seed)
    n = round(seconds * SR)
    t = np.arange(n) / SR
    edges = (0, 400, 1800, 5000, SR / 2)
    out = []
    for _ in range(2):
        f = np.fft.rfftfreq(n, 1 / SR)
        spec = np.fft.rfft(rng.standard_normal(n))
        ch = np.zeros(n)
        for (lo, hi), rt in zip(zip(edges[:-1], edges[1:]), rt60s):
            band = np.fft.irfft(spec * ((f >= lo) & (f < hi)), n)
            ch += band * np.exp(-6.91 * t / rt)
        ch = fft_mask(ch, 160, 9000) * np.minimum(1, t / 0.03)
        ch = np.concatenate([np.zeros(round(0.022 * SR)), ch])[:n] * np.exp(-((t / seconds) ** 10))
        out.append(ch / np.sqrt(np.sum(ch**2)))
    return np.array(out)


def biquad(kind, f0, q, gain_db=0.0):
    """RBJ cookbook coefficients (b, a), normalized."""
    a_ = 10 ** (gain_db / 40)
    w = TAU * f0 / SR
    cw, alpha = np.cos(w), np.sin(w) / (2 * q)
    if kind == "hp":
        b, a = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2], [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "lp":
        b, a = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2], [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b, a = [1 + alpha * a_, -2 * cw, 1 - alpha * a_], [1 + alpha / a_, -2 * cw, 1 - alpha / a_]
    else:  # high shelf
        s = 2 * np.sqrt(a_) * alpha
        b = [
            a_ * ((a_ + 1) + (a_ - 1) * cw + s),
            -2 * a_ * ((a_ - 1) + (a_ + 1) * cw),
            a_ * ((a_ + 1) + (a_ - 1) * cw - s),
        ]
        a = [(a_ + 1) - (a_ - 1) * cw + s, 2 * ((a_ - 1) - (a_ + 1) * cw), (a_ + 1) - (a_ - 1) * cw - s]
    return np.array(b) / a[0], np.array(a) / a[0]


def impulse(sections, n=16384):
    """Impulse response of a causal biquad cascade (decays far below -150 dB within n)."""
    x = np.zeros(n)
    x[0] = 1.0
    for b, a in sections:
        y = np.zeros(n)
        x1 = x2 = y1 = y2 = 0.0
        for i in range(n):
            y[i] = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
            x2, x1, y2, y1 = x1, x[i], y1, y[i]
        x = y
    return x


# The master EQ: rumble cut, a little less mud and presence, and a soft top.
EQ = impulse(
    [biquad("hp", 40, 0.707), biquad("peak", 260, 1.0, -1.5), biquad("peak", 3000, 0.8, -1.5), biquad("lp", 12000, 0.6)]
)


def convolve(x, h, circular):
    """Causal convolution along the last axis: circular over len(x), or linear truncated to len(x)."""
    n = x.shape[-1] if circular else x.shape[-1] + h.shape[-1]
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)
    return y[..., : x.shape[-1]]


class Bus:
    """Dry stereo bus plus a mono reverb send; `circular` buses wrap note tails past the end."""

    def __init__(self, seconds, circular):
        self.n, self.circular = round(seconds * SR), circular
        self.dry, self.send = np.zeros((2, self.n)), np.zeros(self.n)

    def add(self, start, sig, send, p=0.0):
        sig = pan(sig, p) if sig.ndim == 1 else sig
        s = round(start * SR)
        for off in range(0, sig.shape[1], self.n):
            chunk = sig[:, off : off + self.n]
            idx = s + off + np.arange(chunk.shape[1])
            idx = idx % self.n if self.circular else idx
            keep = (idx >= 0) & (idx < self.n)
            self.dry[:, idx[keep]] += chunk[:, keep]
            self.send[idx[keep]] += chunk[:, keep].mean(axis=0) * send

    def mix(self, ir):
        wet = convolve(np.stack([self.send, self.send]), ir, self.circular)
        return convolve(self.dry + wet, EQ, self.circular)


# The bed, in bars and beats from the loop start (bar 1, beat 1 = 8 s). Chords hold three bars;
# BED_CHORDS rows are (first bar, pad voicing, shimmer notes, sub root), BED_PLUCKS rows
# (bar, beat, note, velocity) and BED_BELLS rows (bar, beat, note, amplitude).
def bed_time(bar, beat):
    return (bar - 1) * BAR + (beat - 1) * BEAT


BED_CHORDS = (
    (1, ("D3", "A3", "E4", "F#4", "A4"), ("F#5", "E6"), "D2"),
    (4, ("C#3", "A3", "E4", "B4"), ("C#6", "E6"), "C#2"),
    (7, ("B2", "F#3", "D4", "A4", "C#5"), ("F#5", "C#6"), "B1"),
    (10, ("G2", "D3", "B3", "F#4", "A4"), ("B5", "F#6"), "G1"),
)
BED_PLUCKS = (
    (1, 1, "D3", 0.3), (1, 2.5, "F#5", 0.42), (1, 4, "A4", 0.3),
    (2, 2, "E5", 0.36), (2, 4.5, "D5", 0.28), (3, 2, "G#5", 0.22), (3, 3.5, "A5", 0.26),
    (4, 1, "C#3", 0.28), (4, 2.5, "C#5", 0.38), (4, 4, "E5", 0.3),
    (5, 2, "B4", 0.34), (5, 4, "A4", 0.26), (6, 2.5, "E5", 0.26),
    (7, 1, "B2", 0.28), (7, 2.5, "D5", 0.38), (7, 4, "F#5", 0.3),
    (8, 2, "C#6", 0.22), (8, 3.5, "B4", 0.3), (9, 2, "A4", 0.26), (9, 4, "F#4", 0.22),
    (10, 1, "G2", 0.28), (10, 2.5, "B4", 0.36), (10, 4, "D5", 0.3),
    (11, 1.5, "C#5", 0.24), (11, 3, "F#5", 0.26),
)
BED_BELLS = ((1, 3, "A6", 0.07), (5, 1.5, "E6", 0.06), (7, 3, "F#6", 0.065), (10, 2, "D6", 0.06))


def bed_cutoff(tau):
    """Slow filter drift, periodic over the 40 s loop (20 s and 40/3 s cycles)."""
    tau = np.asarray(tau) - LOOP_START
    return 2000 * (1 + 0.25 * np.sin(TAU * tau / 20 + 0.3) + 0.08 * np.sin(TAU * tau * 3 / 40))


def open_cutoff(t):
    return np.full(np.shape(t), 6000.0)


def render_bed(rng):
    loop = Bus(LOOP_END - LOOP_START, circular=True)
    linear = Bus(LOOP_END - LOOP_START + 12, circular=False)

    def put(start, sig, send, p=0.0):
        loop.add(start, sig, send, p)
        linear.add(start, sig, send, p)

    for first, voicing, shimmer, root in BED_CHORDS:
        t0 = bed_time(first, 1)
        for i, note in enumerate(voicing):
            amp = 0.06 if i == 0 else 0.085
            put(t0, pad(note, LOOP_START + t0, 3 * BAR, bed_cutoff, rng, amp=amp), 0.32)
        for note in shimmer:
            put(t0, pad(note, LOOP_START + t0, 3 * BAR, open_cutoff, rng, attack=3.0, amp=0.03, saw=0.04), 0.7)
        put(t0, sub(root, LOOP_START + t0, 3 * BAR, rng, amp=0.025), 0.05)
    for bar, beat, note, vel in BED_PLUCKS:
        p = np.clip((midi(note) - 66) / 30, -0.4, 0.4)
        put(bed_time(bar, beat), pluck(note, vel, rng, level=0.3), 0.5, p)
    for bar, beat, note, amp in BED_BELLS:
        put(bed_time(bar, beat), bell(note, amp, rng), 0.85, 0.25)
    # Air: band-passed noise breathing over a 10 s cycle, exactly one loop long so it is periodic.
    # The linear bus has no wrap, so the tail gets the loop's first seconds of air faded out
    # instead (it continues the loop's air seamlessly past 48 s).
    air = np.stack([fft_mask(rng.standard_normal(LOOP_N), 3200, 10000) for _ in range(2)])
    air *= 0.0045 / np.std(air) * (1 + 0.35 * np.sin(TAU * np.arange(LOOP_N) / (SR * 10)))
    put(0, air, 0.0)
    fade = np.cos(np.minimum(1, np.arange(round(3 * SR)) / (3 * SR)) * np.pi / 2)
    linear.add(LOOP_END - LOOP_START, air[:, : len(fade)] * fade, 0.0)
    return loop, linear


def intro_cutoff(t):
    t = np.asarray(t)
    rise = 170 * (3600 / 170) ** (np.clip(t / REVEAL_AT, 0, 1) ** 2.2)
    return np.where(t < REVEAL_AT, rise, 1600 + 2000 * np.exp(-(t - REVEAL_AT) / 1.3))


def intro_gain(t):
    """Pad level: from -40 dB to full at the bloom, then settling 2 dB lower."""
    t = np.asarray(t)
    rise = -40 * (1 - np.clip(t / REVEAL_AT, 0, 1)) ** 1.6
    db = np.where(t < REVEAL_AT, rise, -2 * (1 - np.exp(-(t - REVEAL_AT) / 1.2)))
    return 10 ** (db / 20)


def sub_swell(t):
    """Sub level: swells into the bloom, peaks just after it, then decays."""
    d = np.asarray(t) - REVEAL_AT - 0.1
    return np.where(d < 0, np.exp(-(d**2)), np.exp(-d / 2.4))


def render_intro(rng, ir):
    bus = Bus(LOOP_START + 1, circular=False)
    shape = {"cutoff": intro_cutoff, "rng": rng, "release": 2.0, "amp": 0.1, "gain": intro_gain}
    for note in ("D3", "A3", "E4", "A4"):
        bus.add(0, pad(note, 0, 7.4, attack=0.05, **shape), 0.32)
    bus.add(REVEAL_AT, pad("F#4", REVEAL_AT, 3.9, attack=0.35, **shape), 0.32)
    bus.add(0, sub("D2", 0, 7.4, rng, attack=0.05, release=0.5, amp=0.1, gain=sub_swell), 0.05)
    # The riser: the reverb of the bloom's own dyad and bell, reversed, so it swells into the
    # downbeat.
    source = pluck("D5", 0.8, rng) + pluck("A4", 0.7, rng)
    chime = bell("A6", 0.6, rng)
    source[: len(chime)] += chime[: len(source)]
    wet = convolve(np.stack([source, source]), ir, circular=False)[:, : round(3.2 * SR)]
    riser = wet[:, ::-1] * np.linspace(0, 1, wet.shape[1]) ** 1.5
    bus.add(REVEAL_AT - 3.2, riser / np.max(np.abs(riser)) * 0.1, 0.15)
    n = round((REVEAL_AT - 0.6) * SR)
    t = np.arange(n) / n
    air = fft_mask(rng.standard_normal(n), 2500, 8000) * t**4 * end_fade(n, 0.03)
    bus.add(0.6, air / np.max(np.abs(air)) * 0.012, 0.6)
    # The bloom: a felt-piano dyad and a glass bell on the downbeat, then the release's three-note
    # motif.
    bus.add(REVEAL_AT, pluck("A4", 0.62, rng, level=0.4), 0.5, -0.1)
    bus.add(REVEAL_AT, pluck("D5", 0.7, rng, level=0.4), 0.5, 0.1)
    bus.add(REVEAL_AT, bell("D6", 0.07, rng), 0.9, 0.2)
    for start, note, vel in ((4.25, "F#5", 0.4), (4.78, "E5", 0.34), (5.85, "B4", 0.3)):
        bus.add(start, pluck(note, vel, rng, level=0.4), 0.5, 0.15)
    return bus


# Measurement: BS.1770 loudness and a 4x oversampled true peak, used to set the master gain and
# to report the decoded mp3. The K-weighting coefficients are the standard's, re-derived for
# 44.1 kHz as RBJ sections.
def k_weighted(x):
    """BS.1770 K-weighting: the standard pre-filter shelf and RLB high-pass, at 44.1 kHz."""
    sections = [
        biquad("shelf", 1681.974450955533, 0.7071752369554196, 3.999843853973347),
        biquad("hp", 38.13547087602444, 0.5003270373238773),
    ]
    return convolve(x, impulse(sections), circular=False)


def loudness(x):
    """ITU-R BS.1770-4 integrated loudness and max short-term (3 s) loudness, in LUFS."""
    z = np.sum(k_weighted(x) ** 2, axis=0)
    c = np.concatenate([[0], np.cumsum(z)])

    def blocks(win):
        w, hop = round(win * SR), round(0.1 * SR)
        starts = np.arange(0, len(z) - w + 1, hop)
        return (c[starts + w] - c[starts]) / w

    gated = (b := blocks(0.4))[b > 10 ** ((-70 + 0.691) / 10)]
    rel = gated[gated > np.mean(gated) * 0.1]
    return -0.691 + 10 * np.log10(np.mean(rel)), -0.691 + 10 * np.log10(np.max(blocks(3.0)))


def true_peak_db(x):
    n = x.shape[-1]
    up = np.fft.irfft(np.fft.rfft(x, axis=-1), 4 * n, axis=-1) * 4
    return 20 * np.log10(np.max(np.abs(up)))


def compose():
    rng = np.random.default_rng(72)
    ir = make_ir(4.5, (3.6, 3.1, 2.3, 1.4), seed=7)
    loop_bus, linear_bus = render_bed(rng)
    bed = loop_bus.mix(ir)
    tail = linear_bus.mix(ir)[:, LOOP_N : LOOP_N + round((DURATION - LOOP_END) * SR)]
    intro = render_intro(rng, ir).mix(ir)[:, : round(LOOP_START * SR)]
    # Equal-power crossfade from the intro into the periodic bed, complete by the loop start.
    n0 = round(LOOP_START * SR)
    t = np.arange(n0) / SR
    x = np.clip((t - XFADE_START) / (LOOP_START - XFADE_START), 0, 1)
    fade_in, fade_out = np.sin(x * np.pi / 2), np.cos(x * np.pi / 2)
    before = bed[:, LOOP_N - n0 :]
    out = np.concatenate([intro * fade_out + before * fade_in, bed, tail], axis=1)
    nt = round(0.6 * SR)
    out[:, -nt:] *= raised(nt)[::-1]
    return out


def master(raw):
    integrated, _ = loudness(raw)
    x = raw * 10 ** ((TARGET_LUFS - integrated) / 20)
    return np.tanh(1.2 * x) / 1.2


def encode(x, path, codec):
    """Pipe float PCM through ffmpeg; returns what the written file decodes back to."""
    pcm = np.ascontiguousarray(x.T, dtype="<f4").tobytes()
    raw = ["-f", "f32le", "-ar", str(SR), "-ac", "2"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *raw, "-i", "pipe:0", *codec, str(path)], input=pcm, check=True)
    dec = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), *raw, "pipe:1"], capture_output=True, check=True)
    return np.frombuffer(dec.stdout, dtype="<f4").reshape(-1, 2).T.astype(np.float64)


def report(label, x):
    integrated, short_max = loudness(x)
    a, b = round(LOOP_START * SR), round(LOOP_END * SR)
    steps = np.abs(np.diff(x[:, a:b], axis=1))
    print(f"{label}: {x.shape[1] / SR:.4f} s, integrated {integrated:.2f} LUFS, max short-term {short_max:.2f} LUFS, true peak "
          f"{true_peak_db(x):.2f} dBTP, DC {np.abs(x.mean(axis=1)).max():.1e}")
    print(f"  loop step x[48s - 1 sample] -> x[8s] {np.abs(x[:, a] - x[:, b - 1]).max():.2e} (steps inside the loop: median "
          f"{np.median(steps):.2e}, max {steps.max():.2e}); tail start vs loop start |x[48s] - x[8s]| "
          f"{np.abs(x[:, a] - x[:, b]).max():.1e}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=pathlib.Path, default=OUT, help="mp3 path (default: the onboarding asset)")
    parser.add_argument("--wav", type=pathlib.Path, help="also write the float master as WAV")
    args = parser.parse_args()

    out = master(compose())
    report("master", out)
    if args.wav:
        encode(out, args.wav, ["-c:a", "pcm_f32le"])
    mp3 = [  # 160 kbps CBR without tags; ffmpeg still writes the LAME/Xing header (see above)
        "-c:a", "libmp3lame", "-b:a", "160k", "-map_metadata", "-1", "-id3v2_version", "0", "-write_id3v1", "0"
    ]
    decoded = encode(out, args.out, mp3)
    decoded = encode(out * 10 ** ((TARGET_LUFS - loudness(decoded)[0]) / 20), args.out, mp3)
    report("mp3 decoded", decoded)
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
