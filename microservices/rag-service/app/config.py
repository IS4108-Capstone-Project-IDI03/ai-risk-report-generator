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
