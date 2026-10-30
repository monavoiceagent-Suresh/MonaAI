# Voice Processing Pipeline

## End-to-End Voice Call Flow

```
Phone Call
   ↓
WebSocket Stream (Exotel → Engine)
   ↓
ASR (Speech → Text)
   ↓
LLM (Text → Reply)
   ↓
TTS (Reply → Audio)
   ↓
WebSocket Stream (Engine → Exotel → Phone)
   ↓
Loop back to ASR
   ↓
Call Hangup Detection
   ↓
Outcome Extraction
   ↓
Webhook to Dashboard
```

---

## Component Breakdown

### 1. ASR (Automatic Speech Recognition)

**Provider:** ElevenLabs Scribe Realtime  
**Model:** `elevenlabs_asr_model_id` (default: `scribe_v2_realtime`)  
**Input:** Raw audio bytes over WebSocket (16-bit PCM, 16 kHz)  
**Output:** Recognized text transcript

**Location:** `app/providers/scribe.py::ScribeRealtime`

**Configuration:**
```python
asr=ScribeRealtime(
    api_key=settings.elevenlabs_api_key.get_secret_value(),
    model_id=settings.elevenlabs_asr_model_id,  # "scribe_v2_realtime"
    silence_ms=settings.endpointing_min_silence_ms,  # 500ms
    connect_timeout_ms=settings.asr_timeout_ms,  # 10000ms
)
```

**Timeout & Retries:**
- Connection timeout: 10 seconds
- If timeout: Session fails, call ends
- Per-call ASR failures: Up to 3 consecutive failures end the call

**Key Features:**
- Real-time streaming (low latency)
- Silence detection (500ms no-speech → end turn)
- Language auto-detection or override

---

### 2. LLM (Large Language Model)

**Primary:** Configurable (Groq or OpenRouter) via `LLM_PROVIDER` env var  
**Fallback:** Automatic fallback to secondary provider if configured

**Location:** `app/providers/chat_completions.py` + `app/providers/failover.py`

**Architecture:**
```
ChatCompletionsLLM (primary)
  ↓ (on timeout/5xx)
FailoverLLM (fallback handler)
  ↓ (if fallback configured)
ChatCompletionsLLM (fallback)
  ↓ (on both fail)
[Call ends]
```

**Configuration:**

**Primary (LLM_PROVIDER=groq):**
```python
ChatCompletionsLLM(
    api_key=settings.groq_api_key.get_secret_value(),
    base_url=settings.groq_base_url,  # "https://api.groq.com/openai/v1"
    model=settings.groq_model,  # "openai/gpt-oss-20b"
    max_tokens=settings.groq_max_output_tokens,  # 1024
    temperature=settings.groq_temperature,  # 0.4
    timeout_ms=4000,  # Primary gives up quickly for fallback to activate
    max_retries=0,  # No retries; time spent on retry = delayed fallback
    limiter=TokenBucket(settings.groq_max_requests_per_minute),  # 60/min
)
```

**Fallback (LLM_PROVIDER=groq, fallback=openrouter):**
```python
ChatCompletionsLLM(
    # Same structure, but:
    timeout_ms=8000,  # Fallback gets more time
    max_retries=1,  # One retry allowed
    # Rate limit: 20/min (OpenRouter free tier cap)
)
```

**Token Limits:**
- Per call: `llm_max_requests_per_call` (default: 40) — stops excessive/looping calls
- Per minute: `groq_max_requests_per_minute` (60) / `openrouter_max_requests_per_minute` (18)

**Deduplication:**
- `llm_dedup_window_ms` (700ms): Identical transcript delivered twice within this window is treated as retransmit, not new input

**LLM Failure Handling:**
- Consecutive failures: Up to 3 before call ends
- Rate limit hit (429): Backoff + retry (exponential)
- Timeout: Fallback activates (if available)

---

### 3. TTS (Text-to-Speech)

**Primary:** Configurable (Bakbak or ElevenLabs) via `tts_provider` env var  
**Fallback:** Optional second provider via `tts_fallback_enabled`

**Location:** `app/providers/bakbak_tts.py` + `app/providers/elevenlabs_tts.py` + `app/providers/failover.py`

**Configuration:**

**Bakbak (Primary):**
```python
BakbakTTS(
    api_key=settings.bakbak_api_key.get_secret_value(),
    base_url=settings.bakbak_base_url,  # "https://hub.getraya.app/v1"
    voices=settings.bakbak_voices,  # {language: {voice_id, model}}
)
```

**ElevenLabs (Fallback or Primary):**
```python
ElevenLabsTTS(
    api_key=settings.elevenlabs_api_key.get_secret_value(),
    stability=settings.elevenlabs_tts_stability,  # 0.5
    similarity_boost=settings.elevenlabs_tts_similarity_boost,  # 0.75
)
```

**Voice Selection:**
- Engine has agent's `voice_id` and `tts_model_id` from dashboard
- Looks up voice in provider API (Bakbak) or by voice_id (ElevenLabs)
- If voice not found: Fallback to provider's default voice for agent's language

**Streaming vs. Full Audio:**
- Audio streamed to Exotel as it becomes available (low latency)
- Exotel plays audio to caller in real-time

---

## Prompt Engineering & Context

### System Prompt Assembly

**Location:** `app/prompts.py::system_prompt()`

**Components (in order):**
1. Agent's `instructions` (main system prompt)
2. `knowledge` (facts, FAQ, context)
3. `collect_fields` (if any) — instructs LLM to gather these details
4. Outcome rules + fallback (custom outcomes if any; else fixed per-workflow)
5. Silence & interruption rules
6. JSON response format requirements

**Example Prompt (assembled):**
```
You are a sales representative for Acme Corp. You help potential customers understand our product offerings and schedule demos.

## Facts You Know
- Acme's product costs $99/month
- We support up to 1000 users
- Trial includes 2 weeks free

## Information to Gather
- Customer's budget
- Number of users in their organization

## Conversation Outcomes
When deciding the call outcome, classify as one of:
- Interested: Customer asked for a demo or pricing details
- Not interested: Customer explicitly declined or expressed disinterest
- Callback: Customer asked to be called back
- Inconclusive: No clear outcome

## Constraints
- Keep responses brief (under 2 sentences spoken aloud)
- Wait for the customer to finish speaking
- If silent for 500ms, assume they are done
- Speak clearly and naturally

Reply in JSON format:
{"thought": "...", "reply": "...", "continue_call": true/false}
```

### Workflow-Specific Prompts

Each workflow (general, lead_qualification, faq, appointment, order) has preset outcomes:

```python
# From prompts.py
OUTCOMES_BY_WORKFLOW = {
    "general": ["Interested", "Not interested", "Callback"],
    "lead_qualification": ["Qualified", "Unqualified", "Callback"],
    "faq": ["Resolved", "Unresolved", "Callback"],
    "appointment": ["Scheduled", "Declined", "Callback"],
    "order": ["Ordered", "Abandoned", "Callback"],
}
```

**Custom Outcomes (Dashboard Call Outcome Rules):**
- If workspace defines custom rules: use those instead
- If no custom rules: use workflow default
- Always: "Inconclusive" is the final fallback

---

## Rate Limiting

### Per-Provider Limits

**Groq:**
- Per-minute: 60 requests (shared across all calls in the process)
- Per-call: 40 requests max
- Burst window: 1 minute

**OpenRouter (Free Tier):**
- Per-minute: 20 requests
- Per-call: 40 requests max

### Token Bucket Implementation

```python
# From providers/rate_limit.py
class TokenBucket:
    def __init__(self, requests_per_minute):
        self.rate = requests_per_minute / 60  # tokens per second
        self.capacity = requests_per_minute
        self.tokens = capacity
        self.last_refill = now()
    
    def acquire(self):
        # Refill based on time elapsed
        elapsed = now() - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last_refill = now()
        
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
```

**Backoff on 429:**
```python
retry_backoff_base_ms = 300  # Start at 300ms
retry_backoff_max_ms = 2000  # Cap at 2000ms

# Each retry: delay = min(backoff_max, backoff_base * 2^attempt)
```

---

## Interruption & Turn-Taking

### Silence Detection (Endpointing)

**Mechanism:**
- ASR detects 500ms of silence → signals end-of-turn
- LLM generates reply
- TTS plays reply
- Loop back to ASR

**Configuration:**
```python
endpointing_min_silence_ms = 500  # Milliseconds of silence = end-of-turn
asr_timeout_ms = 10000  # Total ASR connection timeout
```

**Edge Cases:**
- Customer pauses mid-sentence: 500ms silence treated as end-of-turn
- Noisy environment: May trigger false-positive silence
- Workaround: Set `endpointing_min_silence_ms` higher (trade-off: slower responsiveness)

### Barge-In (Caller Interrupting Agent)

**Status:** Not verified in current codebase  
**Expected behavior:** If caller speaks while agent is playing TTS, ASR picks up interruption  
**Reality:** Unclear; needs testing in real Exotel call

---

## Transcript & Session Management

### Session Object

**Location:** `app/session.py`

**Lifetime:**
- Created when WebSocket connects (inbound or outbound)
- Destroyed when WebSocket closes or call hangup detected
- Holds: transcript, state, turn count, LLM rate limiter

**Transcript Assembly:**
```python
session.transcript = [
    {"speaker": "bot", "text": "Hello, how can I help?", "timestamp": 0},
    {"speaker": "customer", "text": "I need...", "timestamp": 2.5},
    {"speaker": "bot", "text": "Sure, let me...", "timestamp": 5.0},
    ...
]
```

### Hangup Detection

**For Outbound Calls:**
1. Exotel sends StatusCallback with `Status=completed` when call ends
2. Engine receives via HTTP POST
3. Engine marks session as ended
4. Extracts outcome and summary

**For Inbound Calls:**
1. Exotel closes WebSocket
2. Engine detects connection closed
3. Marks session ended
4. Extracts outcome

**Call Duration:**
- `max_call_duration_seconds` (default: 1800 = 30 mins)
- Engine can force-close calls exceeding this

---

## Outcome Extraction & Classification

### Process

**Location:** `app/prompts.py::parse_outcome()`

1. LLM returns structured JSON with `"outcome"` field
2. Parse to extract outcome name
3. Validate against allowed outcomes (custom rules or workflow defaults)
4. Store as `outcome_raw` (what LLM said) and `outcome` (normalized)
5. Webhook includes both to dashboard

**Example:**
```json
LLM Response:
{
  "thought": "Customer expressed strong interest and asked for a demo.",
  "reply": "Great! I'll have someone reach out to you within 24 hours.",
  "outcome": "Interested"
}

Stored in Database:
{
  "outcome": "Interested",
  "outcome_raw": "Interested"
}
```

### Custom Outcome Rules

**When used:** If dashboard configures custom rules for a workspace

**Flow:**
1. Dashboard POST `call_outcome_settings` (rules + fallback)
2. Dashboard sends rules in campaign dispatch or test-call request
3. Engine builds prompt with custom outcomes instead of defaults
4. Engine extracts outcome, validates against custom list
5. Returns outcome name back to dashboard

**Example (custom):**
```python
custom_outcomes = ["Very Interested", "Somewhat Interested", "Not Interested"]
outcome = "Very Interested"  # Must be in list
if outcome not in custom_outcomes:
    outcome = fallback  # "Inconclusive"
```

---

## Error Handling & Fallback Chain

### ASR Failure
```
Speech input
  ↓
ASR request fails (timeout, bad response)
  ↓
Retry up to 3 times
  ↓
If all fail: Agent says "I didn't hear that, please try again"
  ↓
Consecutive ASR failures >= 3: End call
```

### LLM Failure
```
Ask LLM for response
  ↓
Primary LLM (Groq) timeout or 5xx
  ↓
Try fallback LLM (OpenRouter) if configured
  ↓
If fallback succeeds: Use reply
  ↓
If fallback also fails: Agent says "I'm having trouble, let me transfer you"
  ↓
Consecutive LLM failures >= 3: End call
```

### TTS Failure
```
TTS request fails (provider down, timeout)
  ↓
Retry up to 1 time
  ↓
If fallback TTS configured: Try it
  ↓
If both fail: Agent says "I'm experiencing technical difficulties"
  ↓
Call ends (no audio = can't continue)
```

---

## Performance & Timing

### Latency Budget (Per Turn)

Assume customer has 5-second budget before getting bored:

| Component | Typical | Budget |
|-----------|---------|--------|
| ASR (listen) | 3-5 sec | 5s |
| LLM (think) | 0.5-1s | 2s |
| TTS (generate) | 1-2s | 2s |
| Buffer/Streaming | 0.5s | 0.5s |
| **Total** | **5-8.5s** | **~10s** |

**Optimization:**
- Start TTS generation while LLM still thinking (parallel)
- Stream TTS audio as soon as first chunk is ready (don't wait for full audio)
- Use fast LLM model with low `max_tokens` (e.g., Groq 20B instead of 70B)

### Concurrent Call Limits

**Engine Config:**
```python
max_concurrent_calls = 1  # Total limit
inbound_reserved_calls = 0  # How many reserved for inbound
```

- If 1 call max and 0 reserved: Any call (inbound or outbound) can be active
- If 5 calls max and 2 reserved: Up to 2 inbound + 3 outbound can run concurrently

**Constraints:**
- Each call holds a connection pool slot
- Each call uses memory for state + transcript
- Engine process must handle signal handling and cleanup

---

## Monitoring & Debugging

### Key Metrics

- **ASR latency:** Time from silence detection to full transcript
- **LLM latency:** Time from LLM request to response
- **TTS latency:** Time from reply text to first audio chunk
- **End-to-end latency:** Time from end of customer speech to start of agent reply
- **Call duration:** Total time from connect to disconnect
- **Drop rate:** Calls that failed to connect
- **Outcome distribution:** How many Interested vs. Not Interested, etc.

### Debug Logging

**Location:** `app/session.py::_debug_log()`

Enable via `LOG_LEVEL=DEBUG` to see:
- Turn-by-turn transcript
- LLM prompt + response
- TTS voice + model
- Rate limit state
- ASR/LLM/TTS latencies

---

**See also:**
- [configuration.md](configuration.md) — All voice pipeline environment variables
- [architecture.md](architecture.md) — Call flow diagrams
