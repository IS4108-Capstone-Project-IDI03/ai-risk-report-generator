import os

from dotenv import load_dotenv

load_dotenv()

# OPENAI_API_KEY and the AWS credentials are read by their SDKs directly.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")
AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-1")
S3_BUCKET = os.getenv("S3_BUCKET", "")
