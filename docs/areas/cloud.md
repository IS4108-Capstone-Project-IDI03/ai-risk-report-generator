AWS resources, deployment steps, environment variable ownership, and cost tagging go here.

# App on one EC2 instance (IN-12)

The backend runs in Docker Compose on one **m7i-flex.large** (2 vCPU, 8 GiB,
free-tier eligible) and the client is served from the same box. Compose runs server,
rag-service, speech-ocr-service, privacy-service, ingestion-service, ingestion-worker,
converter (Gotenberg: Word and PowerPoint uploads to PDF, capped at 1 GB) and Redis,
with nginx on the host serving the built client on port 80. Everything else is
a managed service or an API:

| Piece | Where |
|---|---|
| MongoDB | Atlas (`MONGODB_URI`) |
| Chroma | Chroma Cloud (`CHROMA_MODE=cloud`) |
| Uploaded files | S3 (`S3_BUCKET`), reached through the instance's IAM role |
| Table/formula OCR | API (`OCR_PROVIDER`, default Claude Haiku 5.5) |
| Embeddings, rerank, LLMs | Cohere, Anthropic, OpenAI APIs |
| Redis (BullMQ queue) | container on the instance; server and worker share it |
| Client | static build (`npm run build`) served by nginx on the host on port 80; nginx forwards `/api` to `server` on 4000 |

Docling parses on the instance's CPU with RapidOCR. Its models are built into
the ingestion image, so nothing is downloaded at runtime.

Why this size: the ingestion worker peaks at about 4–5 GB on a large PDF, and
the other services need about 1.5 GB together (a client build briefly adds about 1 GB). 8 GiB plus a 4 GB swap file fits
that; the 4 GiB c7i-flex.large does not.

## One-time setup

### 1. AWS console

1. **EC2 → Launch instance**
   - Name `a2603-backend`, region **ap-southeast-1** (same as the S3 bucket).
   - AMI **Ubuntu Server 24.04 LTS**, type **m7i-flex.large**.
   - Key pair: create one and keep the `.pem` file. It is the only way in.
   - Storage **30 GB gp3**.
   - Security group (EC2 → Security groups → launch-wizard-1 → Inbound rules):
     - **80 (HTTP)**, source **0.0.0.0/0**: the web app, through nginx.
     - **22 (SSH)** and **4000 (gateway API)**, source **My IP** for each team
       member. 4000 is only for laptops running the client against the box.
     - Never open 3000, 6379, 8001, 8002, 8003 or 27017. The services listen
       on `127.0.0.1` or are reached through nginx, and stay private.
2. **Elastic IP**: allocate one and associate it with the instance, so the
   address survives a stop/start. Atlas, nginx and browsers all use it.
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

### 4. nginx

nginx on the host takes port 80. It serves the client's built files and
forwards `/api` to `server` on 4000. The Vite dev server doesn't run on the
instance: it's for development only and isn't safe to expose. Install nginx
from nginx.org's stable repository:

```bash
sudo apt install -y curl gnupg2 ca-certificates lsb-release ubuntu-keyring

curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor \
    | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
https://nginx.org/packages/ubuntu `lsb_release -cs` nginx" \
    | sudo tee /etc/apt/sources.list.d/nginx.list

# prefer nginx.org's packages over Ubuntu's
echo -e "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" \
    | sudo tee /etc/apt/preferences.d/99nginx

sudo apt update && sudo apt install -y nginx
```

Create the folder the deploy script builds the client into. It holds one
folder per release, a `current` link to the live one, and `assets/`, shared
by all releases:

```bash
sudo mkdir -p /var/www/a2603 && sudo chown "$USER": /var/www/a2603
```

Replace the default site with one that serves the client. Put the Elastic IP
in `server_name`:

```bash
sudo rm -f /etc/nginx/conf.d/default.conf
sudo nano /etc/nginx/conf.d/a2603.conf
```

```nginx
server {
    listen 80;
    server_name <elastic-ip>;
    root /var/www/a2603/current;

    # Knowledge documents upload as one body of up to 100 MB (the gateway's
    # limit). nginx's default is 1 MB, which would refuse most of them with 413.
    client_max_body_size 100m;

    # Hashed file names: a changed file gets a new name, so cache forever.
    # Shared by all releases, so a page loaded before a deploy can still
    # fetch the lazily loaded chunks it expects.
    location /assets/ {
        alias /var/www/a2603/assets/;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Pass streamed chat answers through as they arrive.
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Any other path is an app screen: serve index.html, never cached, so a
    # deploy shows on the next load.
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

```bash
sudo nginx -t                                   # check the config
sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

### 5. Start

Run the deploy script once by hand. It builds the client into
`/var/www/a2603` and starts the backend services (not a plain
`docker compose up`, which would also start the local-only client dev server,
mongo, chroma and ollama):

```bash
bash scripts/deploy-ec2.sh
docker compose ps        # no client, mongo, chroma or ollama
```

Open `http://<elastic-ip>` in a browser.

If the box ran the client container before, stop it once, after nginx is
serving the build: `docker compose rm -sf client`.

`VITE_*` variables are fixed into the client when it's built, not read at
runtime; the client uses none today.

To see logs, `docker compose logs -f server` or `docker compose logs -f ingestion-worker` or `docker compose logs -f # for all services`.

To see EC2 resource usage, `htop  # btop for nicer interface but need to install for new instances` or `docker stats`.

These services have `restart: unless-stopped`, so they come back after a
crash and when the instance starts, with no `docker compose up` needed.

The first build takes ~10 minutes (npm, Python packages, Docling models);
later builds reuse the cache.

To work on the client, a laptop can also run its own client against the
instance:

```powershell
cd client
Copy-Item .env.example .env.development   # once; set SERVER_URL=http://<elastic-ip>:4000
npm run dev                               # forwards /api to the EC2 backend
npm run dev:local                         # forwards /api to http://localhost:4000 instead
```

`client/.env.development` is gitignored, so each developer keeps their own.
Without it, `npm run dev` also uses `http://localhost:4000`. Each developer's
IP must be allowed on port 4000 in the security group.

## Updating by hand

Normally the cron job below does this. To update straight away, run it
yourself; it does nothing if the latest commit is already deployed:

```bash
cd ~/ai-risk-report-generator && bash scripts/deploy-ec2.sh
```

To force a full redeploy of the same commit, `rm ~/.a2603-deployed-rev` first.

## Automatic updates

`scripts/deploy-ec2.sh` checks `origin/main` every 5 minutes (cron). When there
are new commits it fast-forwards the checkout and builds the client in a
throwaway Node container into a new release folder. It then rebuilds and
recreates the backend services, switches nginx to the new release, keeps the
last 3 releases and prunes old images. Docker's build cache makes unchanged
services quick. The live site changes only after a successful build, and a
failed round is retried next time: the deployed commit is only recorded in
`~/.a2603-deployed-rev` once everything has succeeded. It skips a round while a document is being ingested, since recreating the
worker would kill that ingestion, and tries again 5 minutes later.

Set it up once on the instance:

```bash
cd ~/ai-risk-report-generator
git checkout main                     # the script deploys main (DEPLOY_BRANCH overrides)
bash scripts/deploy-ec2.sh --dry-run  # shows what it would do; changes nothing
# Safe to re-run: drops any existing deploy line before adding one.
( crontab -l 2>/dev/null | grep -v 'deploy-ec2.sh'; echo '*/5 * * * * bash $HOME/ai-risk-report-generator/scripts/deploy-ec2.sh >> $HOME/deploy.log 2>&1' ) | crontab -
```

If `crontab -l` shows multiple lines, remove duplicates with

```bash
( crontab -l | grep -v 'deploy-ec2.sh'; echo '*/5 * * * * bash $HOME/ai-risk-report-generator/scripts/deploy-ec2.sh >> $HOME/deploy.log 2>&1' ) | crontab -
crontab -l    # should now show one line

```

Check what it did with `tail -f ~/deploy.log`. It only writes when something
happens: a deploy, a skip while ingesting, or an error. It stops, and logs why,
when the checkout is on another branch or has local edits (it only fast-forwards,
never merges). `.env` is gitignored, so deploys never touch it. To remove it, run
`crontab -l | grep -v 'deploy-ec2.sh' | crontab -`.

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
