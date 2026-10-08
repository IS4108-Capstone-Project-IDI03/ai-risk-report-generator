import os

from dotenv import load_dotenv

load_dotenv()

# OPENAI_API_KEY and the AWS credentials are read by their SDKs directly.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")
AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-1")
S3_BUCKET = os.getenv("S3_BUCKET", "")

# Photo interpretation (CP-05). The provider is config-swappable, as LLM_PROVIDER is in the
# RAG service — never hardcode it.
VISION_PROVIDER = os.getenv("VISION_PROVIDER", "gemini")
VISION_MODEL = os.getenv("VISION_MODEL", "gemini-3.8-flash")
# Must be a paid-tier key: Google may use free-tier content and have people read it.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
