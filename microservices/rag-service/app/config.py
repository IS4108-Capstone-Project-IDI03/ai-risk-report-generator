import os

from dotenv import load_dotenv

load_dotenv()

# The LLM provider is config-swappable — never hardcode "anthropic" or
# "gemini" in application code.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5-5")
# Starts at high: cited engineering prose is intelligence-sensitive work.
# Raise to xhigh only if a measured comparison shows it drafts better.
LLM_EFFORT = os.getenv("LLM_EFFORT", "high")
# The pre-survey checklist (CP-30): short inspection points from given passages, so
# less thinking than drafting needs. Same provider and model as drafting.
CHECKLIST_EFFORT = os.getenv("CHECKLIST_EFFORT", "medium")

# Knowledge base chat (CB-01). Provider names come from env, like LLM_PROVIDER above.
# The defaults are the CB-01 model comparison's winner (docs/DECISIONS.md, 2026-10-15).
CHAT_PROVIDER = os.getenv("CHAT_PROVIDER", "openai")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-6.1-sol")
# Chat usually does well at low effort (fewer thinking tokens: cheaper and faster).
CHAT_EFFORT = os.getenv("CHAT_EFFORT", "low")
# The small model that turns a follow-up into a search question (the plan step).
CHAT_PLAN_PROVIDER = os.getenv("CHAT_PLAN_PROVIDER", "anthropic")
CHAT_PLAN_MODEL = os.getenv("CHAT_PLAN_MODEL", "claude-haiku-5-5")
# Below this rerank relevance score nothing counts as an answer, so chat declines.
# ponytail: a first guess; the CB-01 eval tunes it.
CHAT_MIN_RELEVANCE = float(os.getenv("CHAT_MIN_RELEVANCE", "0.2"))
# A real OpenAI key for chat. Not OPENAI_API_KEY: that one is a Groq key for Whisper.
OPENAI_CHAT_API_KEY = os.getenv("OPENAI_CHAT_API_KEY")

# privacy-service masks client details before drafting calls (PV-02). The gateway decides
# per request whether protection is on; this service never reads PII_PROTECTION.
PRIVACY_SERVICE_URL = os.getenv("PRIVACY_SERVICE_URL", "http://localhost:8004")
# Seconds. A batch of 66 texts took 0.65 s locally; a timeout fails the draft (fail closed).
PRIVACY_TIMEOUT = float(os.getenv("PRIVACY_TIMEOUT", "10"))

# The site walk proposal step (CP-22). The free-text reading uses LLM_PROVIDER and
# SITE_WALK_MODEL at this effort; the fixed choices (place, severity, category, photo)
# use this classifier.
SITE_WALK_EFFORT = os.getenv("SITE_WALK_EFFORT", "medium")
# The model that reads the walk, on LLM_PROVIDER. The 31 Oct comparison with the tuned
# prompt on the held-out site walks (never used for tuning): Sonnet matched every place
# (100%, Opus 92%, GPT-6.1 Sol 97%) with the same recall, at ~40% of Opus's cost
# (eval/results/2026-10-31-held-out-*-tuned.log).
SITE_WALK_MODEL = os.getenv("SITE_WALK_MODEL", "claude-sonnet-5-5")
# A key of app/site_walk/jev.py's adapter registry. Jev needs TYPESAFE_API_KEY.
SITE_WALK_CLASSIFIER = os.getenv("SITE_WALK_CLASSIFIER", "jev")
# A pick below this probability is marked "Check" for the engineer; it is never hidden.
# The cutoff the document labelling evaluation chose for Jev (IN-05, 2026-10-07).
SITE_WALK_CHECK_BELOW = 0.70
