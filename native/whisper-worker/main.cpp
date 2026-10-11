// whisper-worker: long-lived helper that owns a whisper.cpp model (Metal) and a
// Silero VAD model. Requests arrive on stdin as binary frames; responses are
// JSON lines on stdout. Logs (including ggml/Metal init) go to stderr.
//
// stdin frame (little endian): 24-byte header + payload
//   u32 magic 'LCWK' (0x4B57434C) | u8 type | u8 version(1) | u16 reserved
//   u32 id | u32 payloadLength | u64 timestampNs (opaque, echoed back)
// types:
//   10 VAD         payload: float32 mono 16 kHz samples (contiguous stream chunk)
//   11 TRANSCRIBE  payload: u32 jsonLen | json options | float32 mono 16 kHz samples
//   12 VAD_RESET   payload: empty
//
// VAD and transcription run on separate threads so VAD keeps up while an
// inference is in flight. The caller guarantees at most one TRANSCRIBE in flight.

#include "whisper.h"

#include <chrono>
#include <condition_variable>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

static const uint32_t MAGIC = 0x4B57434C;
enum : uint8_t { T_VAD = 10, T_TRANSCRIBE = 11, T_VAD_RESET = 12 };

struct Request {
    uint8_t type;
    uint32_t id;
    uint64_t ts;
    std::vector<uint8_t> payload;
};

static std::mutex g_out_mtx;
static void emit(const std::string & line) {
    std::lock_guard<std::mutex> lk(g_out_mtx);
    fwrite(line.data(), 1, line.size(), stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static std::string json_escape(const char * s) {
    std::string o;
    for (const unsigned char * p = (const unsigned char *) s; *p; ++p) {
        switch (*p) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (*p < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", *p); o += b; }
                else o += (char) *p;
        }
    }
    return o;
}

static double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

static bool read_exact(void * dst, size_t n) {
    uint8_t * p = (uint8_t *) dst;
    while (n > 0) {
        ssize_t r = read(STDIN_FILENO, p, n);
        if (r <= 0) return false;
        p += r; n -= (size_t) r;
    }
    return true;
}

// Minimal extraction of flat JSON options ("key": value). Options are produced
// by our own TypeScript client, so a full JSON parser is not needed.
static std::string json_get(const std::string & js, const std::string & key) {
    auto k = js.find("\"" + key + "\"");
    if (k == std::string::npos) return "";
    auto c = js.find(':', k);
    if (c == std::string::npos) return "";
    size_t i = c + 1;
    while (i < js.size() && js[i] == ' ') i++;
    if (i < js.size() && js[i] == '"') {
        std::string v;
        for (size_t j = i + 1; j < js.size(); j++) {
            if (js[j] == '\\' && j + 1 < js.size()) { v += js[++j]; continue; }
            if (js[j] == '"') break;
            v += js[j];
        }
        return v;
    }
    size_t e = js.find_first_of(",}", i);
    return js.substr(i, e - i);
}

template <typename T> struct Queue {
    std::mutex m; std::condition_variable cv; std::deque<T> q; bool closed = false;
    void push(T v) { { std::lock_guard<std::mutex> lk(m); q.push_back(std::move(v)); } cv.notify_one(); }
    bool pop(T & out) {
        std::unique_lock<std::mutex> lk(m);
        cv.wait(lk, [&] { return closed || !q.empty(); });
        if (q.empty()) return false;
        out = std::move(q.front()); q.pop_front(); return true;
    }
    void close() { { std::lock_guard<std::mutex> lk(m); closed = true; } cv.notify_all(); }
};

int main(int argc, char ** argv) {
    std::string model, vad_model;
    int n_threads = 4;
    bool use_gpu = true;
    bool tdrz = false; // tinydiarize speaker-turn detection (needs a *-tdrz model)
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--model" && i + 1 < argc) model = argv[++i];
        else if (a == "--vad-model" && i + 1 < argc) vad_model = argv[++i];
        else if (a == "--threads" && i + 1 < argc) n_threads = atoi(argv[++i]);
        else if (a == "--no-gpu") use_gpu = false;
        else if (a == "--tdrz") tdrz = true;
    }
    if (model.empty() || vad_model.empty()) {
        fprintf(stderr, "usage: whisper-worker --model PATH --vad-model PATH [--threads N] [--no-gpu]\n");
        return 2;
    }

    double t0 = now_ms();
    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = use_gpu;
    cparams.flash_attn = true;
    whisper_context * ctx = whisper_init_from_file_with_params(model.c_str(), cparams);
    if (!ctx) {
        emit(std::string("{\"type\":\"error\",\"fatal\":true,\"message\":\"failed to load model ") + json_escape(model.c_str()) + "\"}");
        return 3;
    }
    whisper_vad_context_params vparams = whisper_vad_default_context_params();
    vparams.n_threads = 1;
    vparams.use_gpu = false; // tiny LSTM: CPU is faster than a GPU round-trip
    whisper_vad_context * vctx = whisper_vad_init_from_file_with_params(vad_model.c_str(), vparams);
    if (!vctx) {
        emit(std::string("{\"type\":\"error\",\"fatal\":true,\"message\":\"failed to load VAD model ") + json_escape(vad_model.c_str()) + "\"}");
        return 3;
    }
    double load_ms = now_ms() - t0;

    // Warm-up so the first real request does not pay Metal pipeline compilation.
    {
        std::vector<float> silence(16000, 0.0f);
        whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        wp.print_progress = false; wp.print_realtime = false; wp.print_timestamps = false; wp.print_special = false;
        wp.n_threads = n_threads; wp.language = "en";
        whisper_full(ctx, wp, silence.data(), (int) silence.size());
    }
    {
        char buf[1024];
        snprintf(buf, sizeof buf,
                 "{\"type\":\"ready\",\"model\":\"%s\",\"loadMs\":%.1f,\"warmupMs\":%.1f,\"system\":\"%s\"}",
                 json_escape(model.c_str()).c_str(), load_ms, now_ms() - t0 - load_ms,
                 json_escape(whisper_print_system_info()).c_str());
        emit(buf);
    }

    Queue<Request> vad_q, asr_q;

    std::thread vad_thread([&] {
        Request r;
        while (vad_q.pop(r)) {
            if (r.type == T_VAD_RESET) { whisper_vad_reset_state(vctx); continue; }
            const float * s = (const float *) r.payload.data();
            int n = (int) (r.payload.size() / sizeof(float));
            double s0 = now_ms();
            if (!whisper_vad_detect_speech_no_reset(vctx, s, n)) {
                emit("{\"type\":\"error\",\"id\":" + std::to_string(r.id) + ",\"message\":\"vad failed\"}");
                continue;
            }
            int np = whisper_vad_n_probs(vctx);
            const float * probs = whisper_vad_probs(vctx);
            std::string o = "{\"type\":\"vad\",\"id\":" + std::to_string(r.id) + ",\"ts\":" + std::to_string(r.ts) +
                            ",\"samples\":" + std::to_string(n) + ",\"ms\":";
            char b[32]; snprintf(b, sizeof b, "%.2f", now_ms() - s0); o += b;
            o += ",\"probs\":[";
            for (int i = 0; i < np; i++) { snprintf(b, sizeof b, i ? ",%.3f" : "%.3f", probs[i]); o += b; }
            o += "]}";
            emit(o);
        }
    });

    std::thread asr_thread([&] {
        Request r;
        while (asr_q.pop(r)) {
            if (r.payload.size() < 4) continue;
            uint32_t jl; memcpy(&jl, r.payload.data(), 4);
            if (4 + (size_t) jl > r.payload.size()) continue;
            std::string opts((const char *) r.payload.data() + 4, jl);
            const float * s = (const float *) (r.payload.data() + 4 + jl);
            int n = (int) ((r.payload.size() - 4 - jl) / sizeof(float));

            whisper_full_params wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
            wp.print_progress = false; wp.print_realtime = false; wp.print_timestamps = false; wp.print_special = false;
            wp.n_threads = n_threads;
            wp.language = "en";
            wp.translate = false;
            wp.no_context = true;        // never condition on the previous window's decode
            wp.single_segment = false;
            wp.token_timestamps = true;  // word timing drives LocalAgreement + buffer trimming
            wp.suppress_blank = true;
            wp.suppress_nst = true;      // suppress non-speech tokens ([music], (applause)…)
            wp.temperature_inc = 0.0f;   // no temperature fallback: bounded latency
            wp.no_speech_thold = 0.6f;
            wp.tdrz_enable = tdrz;
            std::string prompt = json_get(opts, "prompt");
            if (!prompt.empty()) wp.initial_prompt = prompt.c_str();
            std::string ac = json_get(opts, "audioCtx");
            if (!ac.empty()) wp.audio_ctx = atoi(ac.c_str());

            double s0 = now_ms();
            int rc = whisper_full(ctx, wp, s, n);
            double infer_ms = now_ms() - s0;
            if (rc != 0) {
                emit("{\"type\":\"error\",\"id\":" + std::to_string(r.id) + ",\"message\":\"whisper_full failed\"}");
                continue;
            }
            std::string o = "{\"type\":\"result\",\"id\":" + std::to_string(r.id) + ",\"ts\":" + std::to_string(r.ts) +
                            ",\"samples\":" + std::to_string(n);
            char b[64]; snprintf(b, sizeof b, ",\"inferMs\":%.1f,\"segments\":[", infer_ms); o += b;
            int ns = whisper_full_n_segments(ctx);
            const whisper_token eot = whisper_token_eot(ctx);
            for (int i = 0; i < ns; i++) {
                int nt = whisper_full_n_tokens(ctx, i);
                double sum_logp = 0; int cnt = 0;
                std::string toks;
                for (int j = 0; j < nt; j++) {
                    whisper_token_data td = whisper_full_get_token_data(ctx, i, j);
                    if (td.id >= eot) continue; // special / timestamp tokens
                    sum_logp += td.plog; cnt++;
                    const char * txt = whisper_full_get_token_text(ctx, i, j);
                    char tb[96];
                    snprintf(tb, sizeof tb, "%s{\"t0\":%lld,\"t1\":%lld,\"p\":%.3f,\"text\":\"", toks.empty() ? "" : ",",
                             (long long) td.t0 * 10, (long long) td.t1 * 10, td.p);
                    toks += tb; toks += json_escape(txt); toks += "\"}";
                }
                char sb[256];
                snprintf(sb, sizeof sb, "%s{\"t0\":%lld,\"t1\":%lld,\"speakerTurnNext\":%s,\"noSpeechProb\":%.3f,\"avgLogprob\":%.3f,\"text\":\"",
                         i ? "," : "", (long long) whisper_full_get_segment_t0(ctx, i) * 10,
                         (long long) whisper_full_get_segment_t1(ctx, i) * 10,
                         whisper_full_get_segment_speaker_turn_next(ctx, i) ? "true" : "false",
                         whisper_full_get_segment_no_speech_prob(ctx, i), cnt ? sum_logp / cnt : 0.0);
                o += sb; o += json_escape(whisper_full_get_segment_text(ctx, i)); o += "\",\"tokens\":[" + toks + "]}";
            }
            o += "]}";
            emit(o);
        }
    });

    // Reader loop: exits when stdin closes (parent died or asked us to stop).
    for (;;) {
        uint8_t h[24];
        if (!read_exact(h, sizeof h)) break;
        uint32_t magic; memcpy(&magic, h, 4);
        if (magic != MAGIC) { fprintf(stderr, "[whisper-worker] bad magic, exiting\n"); break; }
        Request r;
        r.type = h[4];
        memcpy(&r.id, h + 8, 4);
        uint32_t len; memcpy(&len, h + 12, 4);
        memcpy(&r.ts, h + 16, 8);
        if (len > 64u * 1024 * 1024) { fprintf(stderr, "[whisper-worker] payload too large\n"); break; }
        r.payload.resize(len);
        if (len && !read_exact(r.payload.data(), len)) break;
        if (r.type == T_VAD || r.type == T_VAD_RESET) vad_q.push(std::move(r));
        else if (r.type == T_TRANSCRIBE) asr_q.push(std::move(r));
    }
    vad_q.close(); asr_q.close();
    vad_thread.join(); asr_thread.join();
    whisper_vad_free(vctx);
    whisper_free(ctx);
    return 0;
}
