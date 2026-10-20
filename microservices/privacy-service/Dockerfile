FROM python:3.11-slim

WORKDIR /app

# Installs the spaCy model too (a pinned wheel in pyproject.toml), so the
# container never downloads it at run time.
COPY . .
RUN pip install --no-cache-dir .

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
