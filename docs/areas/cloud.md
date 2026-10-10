AWS resources, deployment steps, environment variable ownership, and cost tagging go here.

# Backend on one EC2 instance (IN-12)

The whole backend runs in Docker Compose on one **m7i-flex.large** (2 vCPU,
8 GiB, free-tier eligible). It runs server, rag-service, speech-ocr-service,
ingestion-service, ingestion-worker and Redis. Everything else is a managed
service or an API:

| Piece | Where |
|---|---|
| MongoDB | Atlas (`MONGODB_URI`) |
| Chroma | Chroma Cloud (`CHROMA_MODE=cloud`) |
| Uploaded files | S3 (`S3_BUCKET`), reached through the instance's IAM role |
| Table/formula OCR | API (`OCR_PROVIDER`, default Claude Haiku 5.5) |
| Embeddings, rerank, LLMs | Cohere, Anthropic, OpenAI APIs |
| Redis (BullMQ queue) | container on the instance; server and worker share it |
| Client | developers' laptops, pointed at the instance |

Docling parses on the instance's CPU with RapidOCR. Its models are built into
the ingestion image, so nothing is downloaded at runtime.

Why this size: the ingestion worker peaks at about 4–5 GB on a large PDF, and
the other services need about 1.5 GB together. 8 GiB plus a 4 GB swap file fits
that; the 4 GiB c7i-flex.large does not.

## One-time setup

### 1. AWS console

1. **EC2 → Launch instance**
   - Name `a2603-backend`, region **ap-southeast-1** (same as the S3 bucket).
   - AMI **Ubuntu Server 24.04 LTS**, type **m7i-flex.large**.
   - Key pair: create one and keep the `.pem` file. It is the only way in.
   - Storage **30 GB gp3**.
   - Security group: inbound **22 (SSH)** and **4000 (gateway API)**, source
     **My IP** for each team member. Never open 6379, 8001, 8002, 8003 or 27017.
     Those ports are bound to `127.0.0.1` in Compose and stay private.
2. **Elastic IP**: allocate one and associate it with the instance, so the
   address survives a stop/start. Atlas and the client both use it.
3. **IAM role for S3**: IAM → Roles → Create role → trusted entity *EC2*.
   Attach an inline policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
       "Resource": [
         "arn:aws:s3:::is4108-marshriskreport-rawfiles",
         "arn:aws:s3:::is4108-marshriskreport-rawfiles/*"
       ]
     }]
   }
   ```
   Then EC2 → the instance → Actions → Security → **Modify IAM role** → pick it.
   boto3 finds the role's credentials by itself, so the box's `.env` leaves
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty.

   Go to security group -> launch-wizard-1 -> Inbound rules -> add your IP address

### 2. Atlas and Chroma Cloud

- Atlas → **Network Access** → add the Elastic IP.
- Chroma Cloud: copy the Connect panel values into the `.env` (`CHROMA_MODE=cloud`,
  `CHROMA_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE`, `CHROMA_CLOUD_HOST`).

### 3. On the instance

- SSH in with the `.pem` key, then install Docker Engine and Compose plugin.
```bash
ssh -i a2603.pem ubuntu@<elastic-ip>
```

- If SSH fails, go to AWS console → EC2 → the instance → **Connect** to run the commands.
``` bash
# Docker Engine + Compose plugin
sudo apt-get update && sudo apt-get install -y ca-certificates curl git

curl -fsSL https://get.docker.com | sudo sh

echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-docker.conf
sudo sysctl --system && sudo systemctl restart docker

sudo groupadd docker
sudo usermod -aG docker ubuntu && exit   # log in again for the group to apply

# 4 GB swap: headroom for Docling's peak on large PDFs
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

git clone https://github.com/IS4108-Capstone-Project-IDI03/ai-risk-report-generator.git
cd ai-risk-report-generator && git checkout <branch>
```

From your laptop, copy the `.env` up. Never commit it:

```bash
scp -i a2603.pem .env ubuntu@<elastic-ip>:~/ai-risk-report-generator/.env
```

Or simply run `nano .env` on the instance and paste the contents. The `.env` must have all the values set to cloud use (MONGODB_URI to actual Atlas URI, CHROMA_MODE=cloud, all API keys filled, etc).

On the box, check: Atlas `MONGODB_URI`, `CHROMA_MODE=cloud` plus credentials,
AWS keys empty, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `OCR_PROVIDER=anthropic`.

### 4. Start

Start the backend services only. A plain `docker compose up` would also start
the client's dev server (~500 MB), which laptops run instead:

```bash
docker compose up -d --build redis server rag-service speech-ocr-service ingestion-service ingestion-worker
docker compose ps        # no client, mongo, chroma or ollama
```

The first build takes 10-20 minutes (npm, Python packages, Docling models);
later builds reuse the cache.

Laptops run only the client, against the instance:

```powershell
cd client
Copy-Item .env.example .env.development   # once; set SERVER_URL=http://<elastic-ip>:4000
npm run dev                               # forwards /api to the EC2 backend
npm run dev:local                         # forwards /api to http://localhost:4000 instead
```

`client/.env.development` is gitignored, so each developer keeps their own.
Without it, `npm run dev` also uses `http://localhost:4000`. Each developer's
IP must be allowed on port 4000 in the security group.

## Updating

```bash
cd ~/ai-risk-report-generator && git pull
docker compose up -d --build redis server rag-service speech-ocr-service ingestion-service ingestion-worker
docker image prune -f    # old image layers; the disk is 30 GB
```

## Checks

- Docling parses on the box without downloading anything: upload a small PDF
  through the client, then check that nothing was fetched:
  ```bash
  docker compose logs ingestion-worker | grep -i "huggingface\|download"   # expect no output
  ```
- Memory during a large document: `docker stats --no-stream` and `free -h`.
  If the worker plus swap nears the limit, lower `OCR_CONCURRENCY`.

## Cost

- Instance: covered by the free tier while the account's free-tier credits
  last; after that it bills hourly on demand (check current ap-southeast-1
  pricing). Stop it when idle. AWS also bills public IPv4 addresses, including
  the Elastic IP, by the hour.
- OCR: Claude Haiku 5.5 at US$0.10 / 0.50 per million input / output tokens:
  about 0.05¢ per table crop, so cents per document.
