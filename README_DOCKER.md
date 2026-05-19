# Docker instructions for Fix4ever backend

This file explains how to build and run the backend in Docker.

Prerequisites
- Docker is installed (you mentioned it's already installed).
- (Optional) Docker Compose v1.29+ or the docker-compose plugin.

Quick start (using docker-compose)

1. Copy or verify your `.env` file lives in the `Backend/` folder. The service reads environment variables from this file (do NOT commit secrets to git).

2. Build and start the services:

```powershell
# from Backend/ directory
docker compose up --build -d
```

3. Check logs and health:

```powershell
docker compose logs -f app
# or check health
docker compose ps
```

Run without local MongoDB
- If you use a remote MongoDB (Atlas), remove the `mongo` service from `docker-compose.yml` or keep it but remove `depends_on: - mongo` from the `app` service.

Building a single image and running it

```powershell
docker build -t fix4ever-backend:latest .
docker run --rm -p 8080:8080 --env-file .env --name fix4ever-backend fix4ever-backend:latest
```

Automated push script
---------------------

I've added a small PowerShell helper script at `./scripts/push-to-docker.ps1` that builds, tags and pushes the image to Docker Hub. It will prompt for your Docker Hub username, image name (default: `fix4ever-backend`) and tag (default: `latest`).

Usage (from `Backend/`):

```powershell
.\scripts\push-to-docker.ps1
```

Notes:
- The script expects you to be logged into Docker Hub (run `docker login` if needed).
- The script does not and should not contain secrets; it tags and pushes the built image to your Docker Hub account.
```

Notes and security
- The Dockerfile uses a multi-stage build to compile TypeScript and install only production dependencies in the final image.
- The `.env` file is read by the container at runtime. Do not bake secrets into the image.
- The image exposes port 8080 as requested.

Troubleshooting
- If the container fails to start, run `docker compose logs app` and check for missing environment variables (e.g., `MONGODB_URL`, `JWT_SECRET`).
- If you prefer non-root user inside the container, we can enhance the Dockerfile to create/apply a non-root runtime user.
